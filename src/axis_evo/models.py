"""Small fact models; these types do not execute or classify anything."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class RunStatus(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    INTERRUPTED = "INTERRUPTED"


@dataclass(frozen=True)
class TaskSpec:
    schema_version: int
    task_id: str
    title: str
    goal: str
    workspace: dict[str, str]
    acceptance: dict[str, Any]


@dataclass(frozen=True)
class Run:
    run_id: str
    task_id: str
    status: RunStatus
    task_spec_json: str
    task_spec_sha256: str
    workspace_path: str
    model_plugin: str
    started_at: str
    ended_at: str | None = None


@dataclass(frozen=True)
class PlanStep:
    step_id: str
    tool_name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    """What a tool reports about its invocation, not a file observation."""

    status: str
    message: str
    duration_ms: float
    result: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FileObservation:
    """A future core filesystem observation; no observation is performed here."""

    path: str
    exists: bool
    sha256: str | None = None
    size_bytes: int | None = None


@dataclass(frozen=True)
class ValidationResult:
    passed: bool
    message: str
    details: dict[str, Any] = field(default_factory=dict)
