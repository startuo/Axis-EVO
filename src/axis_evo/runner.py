"""Sequential execution of an explicit plan, without model selection or recovery."""

from collections.abc import Sequence
from copy import deepcopy
from dataclasses import asdict, replace
from math import isfinite
from pathlib import Path, PureWindowsPath
import sqlite3
from uuid import uuid4

from .events import EventType
from .hashing import canonical_json_bytes
from .models import PlanStep, Run, RunStatus
from .plugins import PluginRegistry
from .sandbox import Sandbox
from .skill_binding import preflight_skill_binding, record_skill_invocation_binding
from .skill_card import SkillRef
from .storage import append_event, create_run, finish_run
from .task_spec import load_task_spec
from .tools import execute_tool_call
from .validators import preflight_acceptance, validate_acceptance


def _validate_json_native(value) -> None:
    value_type = type(value)
    if value_type is dict:
        for key, item in value.items():
            if type(key) is not str:
                raise ValueError("PlanStep.arguments dict keys must be exactly str")
            _validate_json_native(item)
    elif value_type is list:
        for item in value:
            _validate_json_native(item)
    elif value_type is float and not isfinite(value):
        raise ValueError("PlanStep.arguments floats must be finite")
    elif value_type not in (str, int, float, bool, type(None)):
        raise ValueError("PlanStep.arguments must contain only exact JSON-native types")


def _snapshot_plan(plan: Sequence[PlanStep], tool_registry: PluginRegistry) -> list[PlanStep]:
    if not isinstance(plan, Sequence) or isinstance(plan, (str, bytes, bytearray)):
        raise ValueError("plan must be a sequence of PlanStep objects")
    snapshot = []
    step_ids = set()
    for step in plan:
        if not isinstance(step, PlanStep):
            raise ValueError("plan must contain only PlanStep objects")
        if type(step.step_id) is not str or not step.step_id.strip():
            raise ValueError("step_id must be a nonempty string")
        if step.step_id in step_ids:
            raise ValueError(f"duplicate step_id: {step.step_id}")
        step_ids.add(step.step_id)
        if type(step.tool_name) is not str or not step.tool_name.strip():
            raise ValueError("tool_name must be a nonempty string")
        if type(step.arguments) is not dict:
            raise ValueError("PlanStep.arguments must be a dict")
        _validate_json_native(step.arguments)
        try:
            tool_registry.get(step.tool_name)
        except KeyError as error:
            raise ValueError(f"unknown tool: {step.tool_name}") from error
        arguments = deepcopy(step.arguments)
        canonical_json_bytes(arguments)
        snapshot.append(PlanStep(step.step_id, step.tool_name, arguments))
    return snapshot


def _resolve_seed(task_spec_path: Path, seed_reference: str) -> Path:
    windows_path = PureWindowsPath(seed_reference)
    if windows_path.drive or windows_path.root or ":" in seed_reference or "\x00" in seed_reference:
        raise ValueError("seed_dir must be a relative task asset path")
    task_directory = task_spec_path.parent
    seed = (task_directory / seed_reference.replace("\\", "/")).resolve(strict=True)
    if not seed.is_relative_to(task_directory):
        raise ValueError("seed_dir escapes the TaskSpec directory")
    if not seed.is_dir():
        raise NotADirectoryError(seed)
    return seed


def run_task(
    connection: sqlite3.Connection,
    task_spec_path: str | Path,
    workspace_path: str | Path,
    plan: Sequence[PlanStep],
    tool_registry: PluginRegistry,
    model_plugin: str = "explicit_plan",
    *,
    run_id: str | None = None,
    skill_ref: SkillRef | None = None,
    plan_proposal_id: str | None = None,
    approved_plan_sha256: str | None = None,
) -> Run:
    """Run a snapshotted deterministic plan and return its normally observed terminal Run.

    Unexpected execution exceptions propagate with the workspace and incomplete
    RUNNING trace preserved. A returned failure result is confirmed, then ends
    the run without executing later steps or final acceptance.
    """
    if connection.in_transaction:
        raise ValueError("run_task requires a connection without an active transaction")
    if type(model_plugin) is not str or not model_plugin.strip():
        raise ValueError("model_plugin must be a nonempty metadata string")
    if run_id is not None and (type(run_id) is not str or not run_id.strip()):
        raise ValueError("run_id must be a nonempty string")
    if plan_proposal_id is None and approved_plan_sha256 is not None:
        raise ValueError("Plan approval requires a proposal identity")
    steps = _snapshot_plan(plan, tool_registry)
    if skill_ref is not None:
        skill_ref = preflight_skill_binding(connection, steps, skill_ref)
    task_path = Path(task_spec_path).resolve(strict=True)
    task_spec = load_task_spec(task_path)
    if plan_proposal_id is not None:
        from .planning_provenance import preflight_plan_proposal, record_plan_run_link
        preflight_plan_proposal(connection, plan_proposal_id, approved_plan_sha256,
                                task_spec, steps, skill_ref, tool_registry)
    seed = _resolve_seed(task_path, task_spec.workspace["seed_dir"])
    preflight_acceptance(task_spec)
    sandbox = Sandbox.from_seed(seed, workspace_path)
    preflight_acceptance(task_spec, sandbox)
    run = create_run(connection, task_spec, sandbox.root, model_plugin, run_id=run_id)
    if plan_proposal_id is not None:
        record_plan_run_link(connection, run.run_id, plan_proposal_id, approved_plan_sha256,
                             steps, skill_ref, tool_registry)
    append_event(connection, run.run_id, EventType.RUN_STARTED, {
        "workspace_path": run.workspace_path, "model_plugin": run.model_plugin,
    })
    append_event(connection, run.run_id, EventType.TASK_LOADED, {
        "task_spec_sha256": run.task_spec_sha256,
    })

    for step in steps:
        tool_call_id = f"call_{uuid4().hex}"
        event_fields = {"step_id": step.step_id, "tool_call_id": tool_call_id}
        if skill_ref is not None:
            record_skill_invocation_binding(connection, run.run_id, tool_call_id, step, skill_ref)
        append_event(connection, run.run_id, EventType.STEP_PLANNED, {
            "tool_name": step.tool_name, "arguments": step.arguments,
        }, **event_fields)
        tool = tool_registry.get(step.tool_name)
        result = execute_tool_call(connection, run.run_id, sandbox, tool, step, tool_call_id)
        append_event(connection, run.run_id, EventType.STEP_CONFIRMED, {
            "tool_call_id": tool_call_id, "tool_status": result.status,
        }, **event_fields)
        if result.status != "SUCCESS":
            terminal = finish_run(connection, run.run_id, RunStatus.FAILED, {
                "reason": "TOOL_REPORTED_FAILURE", "step_id": step.step_id,
                "tool_call_id": tool_call_id, "tool_status": result.status,
            }, **event_fields)
            return replace(run, status=RunStatus.FAILED, ended_at=terminal.occurred_at)

    validation_result = validate_acceptance(connection, run.run_id, sandbox, task_spec)
    validation_event = append_event(
        connection, run.run_id,
        EventType.VALIDATION_PASSED if validation_result.passed else EventType.VALIDATION_FAILED,
        asdict(validation_result),
    )
    status = RunStatus.COMPLETED if validation_result.passed else RunStatus.FAILED
    terminal_payload = {"validation_event_id": validation_event.event_id}
    if not validation_result.passed:
        terminal_payload["reason"] = "VALIDATION_FAILED"
    terminal = finish_run(connection, run.run_id, status, terminal_payload)
    return replace(run, status=status, ended_at=terminal.occurred_at)
