"""Provider-reported usage is accounting evidence, never task quality evidence."""
import time
import threading

from axis_evo.planning_adapter import PlanningTransportError
from .agent_images import image_context_reserve
from .agent_store import canonical

MAX_OUTPUT_TOKENS = 4096
DEFAULT_CONTEXT_LIMIT = 128 * 1024
DEFAULT_LOCAL_CONTEXT_LIMIT = 16 * 1024


def context_window(configured=None, *, local_gateway=False):
    return configured or (DEFAULT_LOCAL_CONTEXT_LIMIT if local_gateway else DEFAULT_CONTEXT_LIMIT)


def output_token_limit(profile):
    window = profile.get('contextWindow')
    default = min(MAX_OUTPUT_TOKENS, max(1, window // 4)) if window is not None else MAX_OUTPUT_TOKENS
    return profile.get('maxOutputTokens', default)


def _token_count(value):
    return type(value) is int and 0 <= value <= 10_000_000


def usage(envelope):
    value = envelope.get('usage')
    if type(value) is not dict:
        return None
    if 'input_tokens' in value or 'output_tokens' in value:
        # Anthropic input_tokens is the uncached remainder. Include cache
        # reads and writes once in the context and conservative budget.
        miss, output = value.get('input_tokens'), value.get('output_tokens')
        hit = value.get('cache_read_input_tokens', 0)
        write = value.get('cache_creation_input_tokens', 0)
        if not all(map(_token_count, (miss, output, hit, write))):
            return None
        prompt = miss + hit + write
        total = prompt + output
        if not _token_count(total):
            return None
        cache_reported = bool({'cache_read_input_tokens', 'cache_creation_input_tokens'} & value.keys())
    else:
        prompt, output, total = (value.get(key) for key in
            ('prompt_tokens', 'completion_tokens', 'total_tokens'))
        if not all(map(_token_count, (prompt, output, total))) or total != prompt + output:
            return None
        details = value.get('prompt_tokens_details')
        if type(details) is not dict:
            details = {}
        hit = value.get('cacheHitTokens', value.get('prompt_cache_hit_tokens', details.get('cached_tokens')))
        # Qwen4 Chat Completions reports both names for the same cache write.
        nested_write = details.get('cache_write_tokens', details.get('cache_creation_input_tokens'))
        write = value.get('cacheWriteTokens', nested_write)
        miss = value.get('cacheMissTokens', value.get('prompt_cache_miss_tokens'))
        cache_reported = hit is not None or write is not None or miss is not None
        if cache_reported:
            hit = hit if hit is not None else 0
            write = write if write is not None else 0
            if not _token_count(hit) or not _token_count(write) or hit + write > prompt:
                cache_reported = False
            elif miss is None:
                miss = prompt - hit - write
            elif not _token_count(miss) or hit + write + miss != prompt:
                cache_reported = False
    result = {'prompt_tokens': prompt, 'completion_tokens': output, 'total_tokens': total,
        'promptTokens': prompt, 'completionTokens': output, 'totalTokens': total,
        'basis': 'PROVIDER_REPORTED_NOT_INVOICE'}
    if cache_reported:
        result.update(cacheHitTokens=hit, cacheWriteTokens=write, cacheMissTokens=miss,
                      cacheHitRate=hit / prompt if prompt else 0)
    return result


def take_usage(message):
    message = dict(message)
    observed = message.pop('_usage', None)
    return message, usage({'usage': observed})


def summarize(events):
    requests = [e for e in events if e['kind'] == 'model_request']
    replies = [e['payload'] for e in events if e['kind'] == 'model_usage']
    known = [value for r in replies if (value := usage({'usage': r.get('usage')}))]
    cache_known = [value for value in known if 'cacheHitTokens' in value]
    cache_prompt = sum(value['promptTokens'] for value in cache_known)
    denied=sum(e['kind']=='model_not_dispatched' for e in events)
    dispatched=len(requests)-denied
    return {'modelRequests': dispatched,'modelAttempts':len(requests),'notDispatched':denied,'responsesWithUsage': len(known),
        'usageComplete': len(known) == dispatched,
        'promptTokens': sum(r['prompt_tokens'] for r in known),
        'completionTokens': sum(r['completion_tokens'] for r in known),
        'totalTokens': sum(r['total_tokens'] for r in known),
        'cacheReportedResponses': len(cache_known),
        'cacheHitTokens': sum(value['cacheHitTokens'] for value in cache_known) if cache_known else None,
        'cacheWriteTokens': sum(value['cacheWriteTokens'] for value in cache_known) if cache_known else None,
        'cacheMissTokens': sum(value['cacheMissTokens'] for value in cache_known) if cache_known else None,
        'cacheHitRate': sum(value['cacheHitTokens'] for value in cache_known) / cache_prompt if cache_prompt else None,
        'costBasis': 'CONSERVATIVE_UNDISCOUNTED_INPUT_NOT_INVOICE',
        'modelDurationMs': round(sum(r.get('durationMs', 0) for r in replies), 2),
        'basis': 'PROVIDER_REPORTED_PARTIAL' if len(known) != dispatched else 'PROVIDER_REPORTED_NOT_INVOICE'}


def current_context(events, profile):
    configured = profile.get('contextWindow')
    limit = context_window(configured, local_gateway=profile.get('protocol')=='local-gateway')
    basis = 'PROFILE_CONFIGURED' if configured else 'HARNESS_DEFAULT'
    for event in reversed(events):
        if event['kind'] == 'model_usage' and (observed := usage({'usage': event['payload'].get('usage')})):
            return {'contextTokens': observed['promptTokens'], 'contextLimit': limit, 'contextLimitBasis': basis,
                    'contextMeasuredRound': event['payload'].get('round'),
                    **{name: observed.get(name) for name in (
                        'cacheHitRate', 'cacheHitTokens', 'cacheWriteTokens', 'cacheMissTokens')}}
    return {'contextTokens': None, 'contextLimit': limit, 'contextLimitBasis': basis,
            'contextMeasuredRound': None, 'cacheHitRate': None, 'cacheHitTokens': None,
            'cacheWriteTokens': None, 'cacheMissTokens': None}


class ModelBudget:
    """Host-supplied shared cap. Reserve a conservative UTF-8 byte upper bound.

    Unknown/failed requests retain their entire reservation and stop further
    dispatch. This object never retries. The operator supplies rate ceilings,
    including any cache-write premium. Usage is not an authenticated invoice.
    """
    def __init__(self, completion, *, requests, tokens, cost_cny, input_per_million, output_per_million, journal):
        self.completion = completion
        self.limits = {'requests': requests, 'tokens': tokens, 'costCny': cost_cny}
        self.input_rate, self.output_rate = input_per_million, output_per_million
        self.journal = journal
        self.requests = self.tokens = 0
        self.cost = 0.0
        self.uncertain = False
        self._rejected_reply = False
        self._lock = threading.Lock()

    def remaining_requests(self):
        return 0 if self.uncertain or self._rejected_reply else self.limits['requests'] - self.requests

    def remaining_tokens(self):
        return 0 if self.uncertain else max(0, self.limits['tokens'] - self.tokens)

    def restore(self, rows):
        """Explicit host resume of accounting only; never replay a request."""
        if self.requests or len(rows)>3*self.limits['requests']:
            raise ValueError('Budget journal cannot be restored')
        intents={}
        completed={}
        for row in rows:
            number=row['request']
            if row['phase']=='intent':
                if number!=len(intents)+1:
                    raise ValueError('Budget attempt sequence changed')
                intents[number]=row
            elif row['phase']=='result':
                observed=usage({'usage':row['usage']})
                if number not in intents or number in completed or observed is None:
                    raise ValueError('Budget receipt identity invalid')
                completed[number]=observed
                self._rejected_reply |= row.get('replyStatus') == 'REJECTED'
            else:
                self.uncertain=True
        self.requests=len(intents)
        for number,row in intents.items():
            if number in completed:
                observed=completed[number]
                self.tokens+=observed['total_tokens']
                self.cost+=(observed['prompt_tokens']*self.input_rate+observed['completion_tokens']*self.output_rate)/1_000_000
            else:
                self.tokens+=row['reservedTokens'];self.cost+=row['reservedCostCny'];self.uncertain=True
        if self.requests>self.limits['requests'] or self.tokens>self.limits['tokens'] or self.cost>self.limits['costCny']:
            self.uncertain=True

    def _record_usage(self, number, observed, reserved_tokens, reserved_cost, start, **fields):
        actual_cost = (observed['prompt_tokens'] * self.input_rate
                       + observed['completion_tokens'] * self.output_rate) / 1_000_000
        self.tokens += observed['total_tokens'] - reserved_tokens
        self.cost += actual_cost - reserved_cost
        self.journal({'phase':'result','request':number,'usage':observed,'estimatedCostCny':actual_cost,
                      'durationMs':(time.monotonic()-start)*1000,**fields})
        return observed['total_tokens'] > reserved_tokens or actual_cost > reserved_cost

    def __call__(self, providers, profile, messages, tools, cancelled):
        reserved_input = len(canonical({'messages': messages, 'tools': tools}).encode('utf-8')) + 1024
        reserved_input += sum(image_context_reserve(message.get('_images', ())) for message in messages)
        max_output = output_token_limit(profile)
        reserved_tokens = reserved_input + max_output
        reserved_cost = (reserved_input * self.input_rate + max_output * self.output_rate) / 1_000_000
        with self._lock:
            reason = None
            if self.uncertain:
                reason = 'UNCONFIRMED_PRIOR_USAGE'
            elif self._rejected_reply:
                reason = 'PREVIOUS_REPLY_REJECTED'
            elif self.requests >= self.limits['requests']:
                reason = 'REQUEST_LIMIT_REACHED'
            elif self.tokens >= self.limits['tokens']:
                reason = 'TOKEN_LIMIT_REACHED'
            elif self.cost >= self.limits['costCny']:
                reason = 'COST_LIMIT_REACHED'
            elif self.tokens + reserved_tokens > self.limits['tokens']:
                reason = 'TOKEN_RESERVATION_EXCEEDS_REMAINING'
            elif self.cost + reserved_cost > self.limits['costCny']:
                reason = 'COST_RESERVATION_EXCEEDS_REMAINING'
            if reason is not None:
                error = PlanningTransportError('authorized_acceptance_budget')
                error.budget_decision = {'reason':reason, 'reservedTokens':reserved_tokens,
                    'remainingTokens':self.remaining_tokens(), 'remainingRequests':self.remaining_requests()}
                raise error
            self.requests += 1
            number = self.requests
            self.tokens += reserved_tokens
            self.cost += reserved_cost
            self.journal({'phase': 'intent', 'request': number, 'reservedTokens': reserved_tokens,
                'reservedCostCny': reserved_cost, 'model': profile['modelId']})
        start = time.monotonic()
        try:
            reply = self.completion(providers, profile, messages, tools, cancelled)
            observed = usage({'usage': reply.get('_usage')})
            if observed is None:
                raise PlanningTransportError('usage_unconfirmed')
            with self._lock:
                if self._record_usage(number,observed,reserved_tokens,reserved_cost,start):
                    self.uncertain = True
                    raise PlanningTransportError('usage_reservation_exceeded')
            return reply
        except BaseException as error:
            observed=usage({'usage':getattr(error,'reported_usage',None)})
            with self._lock:
                if observed is None:
                    self.uncertain = True
                    self.journal({'phase':'unconfirmed','request':number,'furtherDispatch':'STOPPED'})
                else:
                    self._rejected_reply = True
                    self.uncertain |= self._record_usage(number,observed,reserved_tokens,reserved_cost,start,
                        replyStatus='REJECTED',furtherDispatch='STOPPED')
            raise
