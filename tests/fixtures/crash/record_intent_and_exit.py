"""A real abrupt process exit after the production append API has returned."""

import os
import sys

from axis_evo.events import EventType
from axis_evo.storage import append_event, connect_database, create_run
from axis_evo.task_spec import load_task_spec


connection = connect_database(sys.argv[1])
spec = load_task_spec(sys.argv[2])
run = create_run(connection, spec, "workspace", "test_model", run_id="run_hard_crash")
append_event(
    connection, run.run_id, EventType.TOOL_INTENT,
    {"tool_name": "patch_file", "arguments": {"path": "config.json", "timeout": 20}},
    event_id="evt_hard_crash", step_id="step_001", tool_call_id="call_001",
)
assert not connection.in_transaction
os._exit(70)
