"""Provider-reported usage is accounting evidence, never task quality evidence."""
import time
import threading

from axis_evo.planning_adapter import PlanningTransportError
from .agent_store import canonical

MAX_OUTPUT_TOKENS = 4096


def usage(envelope):
    value = envelope.get('usage')
    keys = ('prompt_tokens', 'completion_tokens', 'total_tokens')
    if (type(value) is not dict or any(type(value.get(k)) is not int or not 0 <= value[k] <= 10_000_000 for k in keys)
            or value['total_tokens'] != value['prompt_tokens'] + value['completion_tokens']):
        return None
    return {k: value[k] for k in keys} | {'basis': 'PROVIDER_REPORTED_NOT_INVOICE'}


def take_usage(message):
    message = dict(message)
    observed = message.pop('_usage', None)
    return message, usage({'usage': observed})


def summarize(events):
    requests = [e for e in events if e['kind'] == 'model_request']
    replies = [e['payload'] for e in events if e['kind'] == 'model_usage']
    known = [r['usage'] for r in replies if r.get('usage')]
    denied=sum(e['kind']=='model_not_dispatched' for e in events)
    dispatched=len(requests)-denied
    return {'modelRequests': dispatched,'modelAttempts':len(requests),'notDispatched':denied,'responsesWithUsage': len(known),
        'usageComplete': len(known) == dispatched,
        'promptTokens': sum(r['prompt_tokens'] for r in known),
        'completionTokens': sum(r['completion_tokens'] for r in known),
        'totalTokens': sum(r['total_tokens'] for r in known),
        'modelDurationMs': round(sum(r.get('durationMs', 0) for r in replies), 2),
        'basis': 'PROVIDER_REPORTED_PARTIAL' if len(known) != dispatched else 'PROVIDER_REPORTED_NOT_INVOICE'}


class ModelBudget:
    """Host-supplied shared cap. Reserve a conservative UTF-8 byte upper bound.

    Unknown/failed requests retain their entire reservation and stop further
    dispatch. This object never retries. Prices are supplied by the operator,
    not inferred from a model name or treated as an authenticated invoice.
    """
    def __init__(self, completion, *, requests, tokens, cost_cny, input_per_million, output_per_million, journal):
        self.completion = completion
        self.limits = {'requests': requests, 'tokens': tokens, 'costCny': cost_cny}
        self.input_rate, self.output_rate = input_per_million, output_per_million
        self.journal = journal
        self.requests = self.tokens = 0
        self.cost = 0.0
        self.uncertain = False
        self._lock = threading.Lock()

    def remaining_requests(self):
        return 0 if self.uncertain else self.limits['requests'] - self.requests

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

    def __call__(self, providers, profile, messages, tools, cancelled):
        reserved_input = len(canonical({'messages': messages, 'tools': tools}).encode('utf-8')) + 1024
        reserved_tokens = reserved_input + MAX_OUTPUT_TOKENS
        reserved_cost = (reserved_input * self.input_rate + MAX_OUTPUT_TOKENS * self.output_rate) / 1_000_000
        with self._lock:
            reason = None
            if self.uncertain:
                reason = 'UNCONFIRMED_PRIOR_USAGE'
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
            actual_cost = (observed['prompt_tokens'] * self.input_rate + observed['completion_tokens'] * self.output_rate) / 1_000_000
            with self._lock:
                self.tokens += observed['total_tokens'] - reserved_tokens
                self.cost += actual_cost - reserved_cost
                self.journal({'phase': 'result', 'request': number, 'usage': observed,
                    'estimatedCostCny': actual_cost, 'durationMs': (time.monotonic()-start)*1000})
                if observed['total_tokens'] > reserved_tokens or actual_cost > reserved_cost:
                    self.uncertain = True
                    raise PlanningTransportError('usage_reservation_exceeded')
            return reply
        except BaseException:
            with self._lock:
                self.uncertain = True
                self.journal({'phase': 'unconfirmed', 'request': number, 'furtherDispatch': 'STOPPED'})
            raise
