from dataclasses import asdict
import hashlib
import json

import pytest

from axis_evo.hashing import canonical_json_bytes, canonical_json_sha256
from axis_evo.task_spec import load_task_spec


def test_canonical_json_is_deterministic_utf8():
    first = {"b": [True, None, 2], "a": {"z": 1, "x": "中文"}}
    second = {"a": {"x": "中文", "z": 1}, "b": [True, None, 2]}
    expected = '{"a":{"x":"中文","z":1},"b":[true,null,2]}'.encode("utf-8")
    assert canonical_json_bytes(first) == canonical_json_bytes(second) == expected
    assert canonical_json_sha256(first) == hashlib.sha256(expected).hexdigest()


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_canonical_json_rejects_non_json_numbers(value):
    with pytest.raises(ValueError):
        canonical_json_bytes({"value": value})


def test_task_spec_sha256_is_deterministic(task_path, task_data, tmp_path):
    reordered = dict(reversed(list(task_data.items())))
    reordered["acceptance"] = dict(reversed(list(task_data["acceptance"].items())))
    other_path = tmp_path / "reordered.json"
    other_path.write_text(json.dumps(reordered, indent=4), encoding="utf-8")
    first = asdict(load_task_spec(task_path))
    second = asdict(load_task_spec(other_path))
    assert first == second
    assert canonical_json_sha256(first) == canonical_json_sha256(second)
    assert len(canonical_json_sha256(first)) == 64
