"""Strict Skill Card v1 protocol and immutable in-memory content snapshots."""

from dataclasses import dataclass
import json
import re
from typing import Any

from .hashing import canonical_json_bytes


_SKILL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_CARD_KEYS = frozenset(("schema_version", "skill_id", "skill_version", "name",
                        "description", "instructions", "allowed_tools", "source"))


def _text(value: Any, name: str, *, nonempty: bool = False) -> None:
    if type(value) is not str:
        raise TypeError(f"{name} must be an exact str")
    try:
        value.encode("utf-8")
    except UnicodeError as error:
        raise ValueError(f"{name} must be valid UTF-8 text") from error
    if nonempty and not value.strip():
        raise ValueError(f"{name} must not be blank")


def _keys(value: Any, expected: frozenset[str], name: str) -> None:
    if type(value) is not dict:
        raise TypeError(f"{name} must be an exact JSON object")
    if any(type(key) is not str for key in value) or set(value) != expected:
        raise ValueError(f"{name} has missing, unknown or non-string keys")


@dataclass(frozen=True)
class SkillRef:
    skill_id: str
    skill_version: int

    def __post_init__(self) -> None:
        _text(self.skill_id, "skill_id", nonempty=True)
        if _SKILL_ID.fullmatch(self.skill_id) is None:
            raise ValueError("skill_id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}")
        if type(self.skill_version) is not int:
            raise TypeError("skill_version must be an exact int")
        if self.skill_version < 1:
            raise ValueError("skill_version must be positive")

    def to_dict(self) -> dict[str, Any]:
        return {"skill_id": self.skill_id, "skill_version": self.skill_version}


@dataclass(frozen=True)
class SkillSource:
    kind: str
    ref: SkillRef | None = None

    def __post_init__(self) -> None:
        if type(self.kind) is not str or self.kind not in ("MANUAL", "DERIVED"):
            raise ValueError("source kind must be MANUAL or DERIVED")
        if self.kind == "MANUAL":
            if self.ref is not None:
                raise ValueError("MANUAL source must not have a reference")
        else:
            if type(self.ref) is not SkillRef:
                raise TypeError("DERIVED source requires a SkillRef")
            object.__setattr__(self, "ref", SkillRef(self.ref.skill_id, self.ref.skill_version))

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, **(self.ref.to_dict() if self.ref is not None else {})}


def skill_source_from_dict(value: dict[str, Any]) -> SkillSource:
    if type(value) is not dict:
        raise TypeError("source must be an exact JSON object")
    kind = value.get("kind")
    if type(kind) is not str or kind not in ("MANUAL", "DERIVED"):
        raise ValueError("source kind must be MANUAL or DERIVED")
    expected = frozenset(("kind",)) if kind == "MANUAL" else frozenset(("kind", "skill_id", "skill_version"))
    _keys(value, expected, "source")
    return SkillSource(kind, SkillRef(value["skill_id"], value["skill_version"]) if kind == "DERIVED" else None)


@dataclass(frozen=True)
class SkillCard:
    """Construction accepts an exact tools list; storage snapshots it as a tuple."""

    skill_id: str
    skill_version: int
    name: str
    description: str
    instructions: str
    allowed_tools: list[str] | tuple[str, ...]
    source: SkillSource
    schema_version: int = 1

    def __post_init__(self) -> None:
        SkillRef(self.skill_id, self.skill_version)
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ValueError("schema_version must be the exact integer 1")
        _text(self.name, "name", nonempty=True)
        _text(self.description, "description")
        _text(self.instructions, "instructions", nonempty=True)
        if type(self.allowed_tools) is not list:
            raise TypeError("allowed_tools input must be an exact JSON list")
        tools = tuple(self.allowed_tools)
        for tool in tools:
            _text(tool, "allowed_tools item", nonempty=True)
        if len(set(tools)) != len(tools):
            raise ValueError("allowed_tools must be unique")
        if type(self.source) is not SkillSource:
            raise TypeError("source must be a SkillSource")
        if self.skill_version > 1 and self.source.kind != "DERIVED":
            raise ValueError("versions after v1 must be DERIVED")
        object.__setattr__(self, "allowed_tools", tools)
        object.__setattr__(self, "source", skill_source_from_dict(self.source.to_dict()))

    @property
    def ref(self) -> SkillRef:
        return SkillRef(self.skill_id, self.skill_version)

    def to_dict(self) -> dict[str, Any]:
        return {"schema_version": self.schema_version, "skill_id": self.skill_id,
                "skill_version": self.skill_version, "name": self.name, "description": self.description,
                "instructions": self.instructions, "allowed_tools": list(self.allowed_tools),
                "source": self.source.to_dict()}

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_dict())


def skill_card_from_dict(value: dict[str, Any]) -> SkillCard:
    _keys(value, _CARD_KEYS, "Skill Card")
    return SkillCard(skill_id=value["skill_id"], skill_version=value["skill_version"],
                     name=value["name"], description=value["description"], instructions=value["instructions"],
                     allowed_tools=value["allowed_tools"], source=skill_source_from_dict(value["source"]),
                     schema_version=value["schema_version"])


def _json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate Skill Card JSON key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"nonfinite JSON value: {value}")


def skill_card_from_json(value: str | bytes) -> SkillCard:
    if type(value) is bytes:
        value = value.decode("utf-8", errors="strict")
    _text(value, "Skill Card JSON")
    return skill_card_from_dict(json.loads(value, object_pairs_hook=_json_object, parse_constant=_reject_constant))
