from dataclasses import FrozenInstanceError, asdict

import pytest

from axis_evo.events import Event, EventType


def test_event_schema_version_is_fixed_to_one():
    fields = dict(
        event_id="evt_test", task_id="task_test", run_id="run_test", seq=1,
        event_type=EventType.TOOL_INTENT, occurred_at="2026-09-28T09:10:00Z",
        payload={},
    )
    event = Event(**fields)
    assert event.schema_version == 1
    assert "payload_version" not in asdict(event)
    with pytest.raises(TypeError):
        Event(**fields, schema_version=2)
    with pytest.raises(FrozenInstanceError):
        event.schema_version = 2
