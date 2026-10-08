from dataclasses import asdict
import json

import pytest

from axis_evo.task_spec import load_task_spec, task_spec_from_dict


def test_task_spec_loader_valid_input(task_path, task_data):
    spec = load_task_spec(task_path)
    assert asdict(spec) == task_data
    assert spec.acceptance["file_assertions"][0]["expected"] == '"timeout": 20'


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("schema_version",), True),
        (("schema_version",), 1.0),
        (("schema_version",), "1"),
        (("schema_version",), 2),
        (("task_id",), 42),
        (("title",), " "),
        (("goal",), None),
        (("workspace",), "seed"),
        (("workspace", "seed_dir"), 12),
        (("acceptance",), []),
        (("acceptance", "pytest"), True),
        (("acceptance", "pytest", "enabled"), 1),
        (("acceptance", "pytest", "args"), "-q"),
        (("acceptance", "pytest", "args"), [1]),
        (("acceptance", "file_assertions"), {}),
        (("acceptance", "file_assertions"), [None]),
        (("acceptance", "file_assertions", 0, "path"), ""),
        (("acceptance", "file_assertions", 0, "operator"), 3),
        (("acceptance", "file_assertions", 0, "expected"), 20),
    ],
)
def test_task_spec_loader_rejects_malformed_required_input(task_data, tmp_path, path, value):
    target = task_data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    task_path = tmp_path / "invalid.json"
    task_path.write_text(json.dumps(task_data), encoding="utf-8")
    with pytest.raises(ValueError):
        load_task_spec(task_path)


@pytest.mark.parametrize("key", ["schema_version", "task_id", "title", "goal", "workspace", "acceptance"])
def test_task_spec_loader_rejects_missing_fields(task_data, tmp_path, key):
    del task_data[key]
    path = tmp_path / "missing.json"
    path.write_text(json.dumps(task_data), encoding="utf-8")
    with pytest.raises(ValueError):
        load_task_spec(path)


@pytest.mark.parametrize("value", [None, [], "task"])
def test_task_spec_loader_rejects_non_object_root(tmp_path, value):
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(ValueError):
        load_task_spec(path)


@pytest.mark.parametrize(
    "text",
    [
        "{",
        '{"schema_version":1,"schema_version":1}',
        '{"workspace":{"seed_dir":"a","seed_dir":"b"}}',
        '{"schema_version":NaN}',
    ],
)
def test_task_spec_loader_rejects_invalid_json(tmp_path, text):
    path = tmp_path / "invalid.json"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        load_task_spec(path)


def test_task_spec_loader_rejects_unknown_fields(task_data, tmp_path):
    task_data["future_recovery"] = {}
    path = tmp_path / "unknown.json"
    path.write_text(json.dumps(task_data), encoding="utf-8")
    with pytest.raises(ValueError):
        load_task_spec(path)


def test_task_spec_detaches_input_data(task_data):
    spec = task_spec_from_dict(task_data)
    task_data["acceptance"]["pytest"]["args"].append("changed")
    assert spec.acceptance["pytest"]["args"] == ["-q"]
