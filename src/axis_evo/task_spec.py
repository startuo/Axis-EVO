"""Load the small, explicit TaskSpec JSON v1 structure without coercion."""

from copy import deepcopy
import json
from pathlib import Path
from typing import Any

from .models import TaskSpec


def _object(value: Any, keys: set[str], location: str) -> dict[str, Any]:
    if type(value) is not dict or value.keys() != keys:
        raise ValueError(f"{location} must be an object with keys {sorted(keys)}")
    return value


def _text(value: Any, location: str) -> None:
    if type(value) is not str or not value.strip():
        raise ValueError(f"{location} must be a nonempty string")


def task_spec_from_dict(value: Any) -> TaskSpec:
    spec = _object(
        value,
        {"schema_version", "task_id", "title", "goal", "workspace", "acceptance"},
        "TaskSpec",
    )
    if type(spec["schema_version"]) is not int or spec["schema_version"] != 1:
        raise ValueError("TaskSpec.schema_version must be integer 1")
    for key in ("task_id", "title", "goal"):
        _text(spec[key], f"TaskSpec.{key}")

    workspace = _object(spec["workspace"], {"seed_dir"}, "workspace")
    _text(workspace["seed_dir"], "workspace.seed_dir")
    acceptance = _object(
        spec["acceptance"], {"pytest", "file_assertions"}, "acceptance"
    )
    pytest_spec = _object(acceptance["pytest"], {"enabled", "args"}, "acceptance.pytest")
    if type(pytest_spec["enabled"]) is not bool:
        raise ValueError("acceptance.pytest.enabled must be a boolean")
    args = pytest_spec["args"]
    if type(args) is not list or any(type(arg) is not str for arg in args):
        raise ValueError("acceptance.pytest.args must be an array of strings")

    assertions = acceptance["file_assertions"]
    if type(assertions) is not list:
        raise ValueError("acceptance.file_assertions must be an array")
    for index, assertion in enumerate(assertions):
        location = f"acceptance.file_assertions[{index}]"
        _object(assertion, {"path", "operator", "expected"}, location)
        _text(assertion["path"], f"{location}.path")
        _text(assertion["operator"], f"{location}.operator")
        if type(assertion["expected"]) is not str:
            raise ValueError(f"{location}.expected must be a string")

    return TaskSpec(**deepcopy(spec))


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def load_task_spec(path: str | Path) -> TaskSpec:
    value = json.loads(
        Path(path).read_text(encoding="utf-8"),
        object_pairs_hook=_unique_object,
        parse_constant=_reject_constant,
    )
    return task_spec_from_dict(value)
