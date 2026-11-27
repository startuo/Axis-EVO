"""In-memory comparison of host request prefixes, independent of Provider billing."""
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

from .agent_store import canonical


@dataclass(frozen=True)
class RequestPrefix:
    profile: str
    tools: bytes
    system: tuple[bytes, ...]
    messages: tuple[bytes, ...]
    size: int

    @classmethod
    def from_request(cls, profile, tools, messages):
        tool_line = canonical(sorted(tools, key=lambda tool: tool['function']['name'])).encode() + b'\n'
        lines = tuple(canonical(item).encode() + b'\n' for item in messages)
        system = tuple(line for item, line in zip(messages, lines) if item['role'] == 'system')
        return cls(profile['configSha256'], tool_line, system, lines, len(tool_line) + sum(map(len, lines)))


def _matched_bytes(previous, current):
    count = 0
    for old, new in zip((previous.tools, *previous.messages), (current.tools, *current.messages)):
        if old != new:
            return count + next((i for i, (left, right) in enumerate(zip(old, new)) if left != right),
                                min(len(old), len(new)))
        count += len(old)
    return count


class PrefixProbe:
    """Bounded per-service LRU. Request bytes stay in memory and are never journaled here."""

    def __init__(self, capacity=24):
        self.capacity = capacity
        self._requests = OrderedDict()
        self._lock = Lock()

    def compare(self, conversation, current, *, compacted=False):
        with self._lock:
            previous = self._requests.get(conversation)
        if previous is None:
            return {'prefixMatchBytes': 0, 'prefixMatchRatio': None, 'prefixDivergence': 'FIRST_REQUEST'}
        matched = _matched_bytes(previous, current)
        if previous.profile != current.profile:
            divergence = 'PROFILE_CHANGED'
        elif previous.tools != current.tools:
            divergence = 'TOOLS_CHANGED'
        elif previous.system != current.system:
            divergence = 'SYSTEM_CHANGED'
        elif matched == previous.size:
            divergence = 'NONE'
        else:
            divergence = 'COMPACT_EPOCH' if compacted else 'HISTORY_MUTATED'
        return {'prefixMatchBytes': matched, 'prefixMatchRatio': matched / previous.size,
                'prefixDivergence': divergence}

    def remember(self, conversation, request):
        with self._lock:
            self._requests[conversation] = request
            self._requests.move_to_end(conversation)
            if len(self._requests) > self.capacity:
                self._requests.popitem(last=False)
