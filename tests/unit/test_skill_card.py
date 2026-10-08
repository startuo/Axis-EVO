from copy import deepcopy
from dataclasses import FrozenInstanceError
import hashlib
import json

import pytest

from axis_evo.hashing import canonical_json_bytes
from axis_evo.skill_card import SkillRef, SkillSource, skill_card_from_dict, skill_card_from_json, skill_source_from_dict


@pytest.fixture
def card_data():
    return {"schema_version": 1, "skill_id": "edit.config", "skill_version": 1,
            "name": "配置修改", "description": "", "instructions": "读取配置\r\n检查后修改。",
            "allowed_tools": ["read_file", "patch_file", "future_tool"], "source": {"kind": "MANUAL"}}


@pytest.mark.parametrize("skill_id", ["a", "A-1._", "1" * 128])
def test_skill_ref_exact_identity(skill_id):
    ref = SkillRef(skill_id, 1)
    assert ref.to_dict() == {"skill_id": skill_id, "skill_version": 1}
    with pytest.raises(FrozenInstanceError):
        ref.skill_version = 2


@pytest.mark.parametrize("skill_id", ["", " ", " name", "name ", ".name", "-name", "a/b", "a\\b", "a:b", "a\n", "中文", "a\x00b", "a" * 129, 1, True, None])
def test_skill_ref_rejects_invalid_identifier(skill_id):
    with pytest.raises((TypeError, ValueError)):
        SkillRef(skill_id, 1)


@pytest.mark.parametrize("version", [True, False, 0, -1, 1.0, "1", None])
def test_skill_ref_requires_positive_exact_integer(version):
    with pytest.raises((TypeError, ValueError)):
        SkillRef("skill", version)


@pytest.mark.parametrize("field,value", [
    ("schema_version", True), ("schema_version", 2), ("schema_version", 1.0),
    ("skill_id", "../escape"), ("skill_id", ""), ("skill_version", True),
    ("skill_version", 0), ("skill_version", -1), ("skill_version", 1.0),
    ("name", " \t"), ("name", 1), ("name", "\ud800"),
    ("description", None), ("description", "\udfff"),
    ("instructions", "\r\n"), ("instructions", b"bytes"), ("instructions", "\ud800"),
    ("allowed_tools", ("read_file",)), ("allowed_tools", {"read_file"}),
    ("allowed_tools", ["read_file", "read_file"]), ("allowed_tools", [1]),
    ("allowed_tools", [True]), ("allowed_tools", [""]), ("allowed_tools", [" "]),
    ("allowed_tools", ["\ud800"]), ("allowed_tools", [b"read_file"]),
    ("source", {}), ("source", {"kind": "UNKNOWN"}), ("source", {"kind": "DERIVED"}),
    ("source", {"kind": "DERIVED", "skill_id": "a"}),
    ("source", {"kind": "DERIVED", "skill_id": "a", "skill_version": True}),
    ("source", {"kind": "MANUAL", "skill_id": "a", "skill_version": 1}),
    ("source", {"kind": "DERIVED", "skill_id": "a", "skill_version": 1, "extra": 1}),
    ("source", [("kind", "MANUAL")]), ("source", {1: "MANUAL"}),
])
def test_card_parser_rejects_invalid_field(card_data, field, value):
    card_data[field] = value
    with pytest.raises((TypeError, ValueError)):
        skill_card_from_dict(card_data)


@pytest.mark.parametrize("field", ["schema_version", "skill_id", "skill_version", "name", "description", "instructions", "allowed_tools", "source"])
def test_card_parser_rejects_missing_field(card_data, field):
    card_data.pop(field)
    with pytest.raises(ValueError):
        skill_card_from_dict(card_data)


@pytest.mark.parametrize("key", ["state", "trust_score", "metadata", 1])
def test_card_parser_rejects_unknown_or_nonstring_key(card_data, key):
    card_data[key] = "unexpected"
    with pytest.raises(ValueError):
        skill_card_from_dict(card_data)


def test_card_snapshots_nested_input_and_returns_detached_json(card_data):
    card_data["source"] = {"kind": "DERIVED", "skill_id": "source", "skill_version": 3}
    original = deepcopy(card_data)
    card = skill_card_from_dict(card_data)
    card_data["allowed_tools"].append("write_file")
    card_data["source"]["skill_version"] = 999
    output = card.to_dict()
    output["allowed_tools"].clear()
    output["source"]["skill_id"] = "other"
    assert card.to_dict() == original
    assert type(card.allowed_tools) is tuple
    with pytest.raises(FrozenInstanceError):
        card.instructions = "changed"
    with pytest.raises(FrozenInstanceError):
        card.source.kind = "MANUAL"
    with pytest.raises(FrozenInstanceError):
        card.source.ref.skill_version = 4


def test_card_round_trip_is_exact_canonical_json(card_data):
    card = skill_card_from_dict(card_data)
    expected = canonical_json_bytes(card_data)
    assert card.canonical_bytes() == expected
    parsed = skill_card_from_json(expected)
    assert parsed.canonical_bytes() == expected
    assert hashlib.sha256(parsed.canonical_bytes()).hexdigest() == hashlib.sha256(expected).hexdigest()
    assert parsed.instructions == "读取配置\r\n检查后修改。"
    assert parsed.allowed_tools == ("read_file", "patch_file", "future_tool")


def test_card_accepts_empty_tools_description_and_preserves_text(card_data):
    card_data.update(name=" 名称 ", instructions=" 步骤 ", allowed_tools=[])
    card = skill_card_from_dict(card_data)
    assert card.name == " 名称 "
    assert card.instructions == " 步骤 "
    assert card.allowed_tools == ()
    assert card.description == ""


@pytest.mark.parametrize("text", [
    '{"schema_version":1,"schema_version":1}',
    '{"source":{"kind":"MANUAL","kind":"MANUAL"}}',
    '{"schema_version":NaN}', '{"schema_version":Infinity}', '{"schema_version":-Infinity}',
    '[]', 'null', '{}', '{broken', b'\xff', '{"name":"\\ud800"}',
])
def test_card_json_rejects_malformed_or_ambiguous_json(text):
    with pytest.raises((ValueError, TypeError)):
        skill_card_from_json(text)


@pytest.mark.parametrize("field,value", [
    ("instructions", float("nan")), ("description", float("inf")),
    ("name", float("-inf")), ("allowed_tools", [object()]),
])
def test_card_rejects_non_json_native_values(card_data, field, value):
    card_data[field] = value
    with pytest.raises((ValueError, TypeError)):
        skill_card_from_dict(card_data)


def test_card_rejects_python_container_and_scalar_subclasses(card_data):
    class CustomDict(dict):
        pass

    class CustomList(list):
        pass

    class CustomStr(str):
        pass

    class CustomInt(int):
        pass

    for value in (CustomDict(card_data),):
        with pytest.raises(TypeError):
            skill_card_from_dict(value)
    for field, value in (("allowed_tools", CustomList(["read_file"])), ("name", CustomStr("name")),
                         ("skill_version", CustomInt(1)), ("source", CustomDict(kind="MANUAL"))):
        data = {**card_data, field: value}
        with pytest.raises((ValueError, TypeError)):
            skill_card_from_dict(data)


def test_source_shapes_and_later_manual_card_rejection(card_data):
    assert skill_source_from_dict({"kind": "MANUAL"}).to_dict() == {"kind": "MANUAL"}
    source = skill_source_from_dict({"kind": "DERIVED", "skill_id": "a", "skill_version": 1})
    assert source == SkillSource("DERIVED", SkillRef("a", 1))
    with pytest.raises(ValueError):
        SkillSource("MANUAL", SkillRef("a", 1))
    with pytest.raises(TypeError):
        SkillSource("DERIVED")
    card_data["skill_version"] = 2
    with pytest.raises(ValueError):
        skill_card_from_dict(card_data)


@pytest.mark.parametrize("location", ["card", "source"])
def test_duplicate_keys_in_otherwise_valid_card_are_rejected(card_data, location):
    text = canonical_json_bytes(card_data).decode("utf-8")
    if location == "card":
        text = '{"schema_version":1,' + text[1:]
    else:
        text = text.replace('"source":{"kind":"MANUAL"}', '"source":{"kind":"MANUAL","kind":"MANUAL"}')
    assert json.loads(text) == card_data
    with pytest.raises(ValueError, match="duplicate"):
        skill_card_from_json(text)
