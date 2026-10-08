"""Execution-fact event types and the version 1 envelope."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


class EventType(StrEnum):
    RUN_STARTED = "RUN_STARTED"
    TASK_LOADED = "TASK_LOADED"
    STEP_PLANNED = "STEP_PLANNED"
    TOOL_INTENT = "TOOL_INTENT"
    TOOL_RESULT = "TOOL_RESULT"
    FILE_OBSERVED = "FILE_OBSERVED"
    VALIDATION_STARTED = "VALIDATION_STARTED"
    VALIDATION_PASSED = "VALIDATION_PASSED"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    STEP_CONFIRMED = "STEP_CONFIRMED"
    RUN_COMPLETED = "RUN_COMPLETED"
    RUN_FAILED = "RUN_FAILED"
    RUN_INTERRUPTED = "RUN_INTERRUPTED"


@dataclass(frozen=True)
class Event:
    event_id: str
    task_id: str
    run_id: str
    seq: int
    event_type: EventType
    occurred_at: str
    payload: dict[str, Any]
    step_id: str | None = None
    tool_call_id: str | None = None
    schema_version: int = field(default=1, init=False)


def utc_now() -> str:
    """Observational metadata only; persisted seq defines event order."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
