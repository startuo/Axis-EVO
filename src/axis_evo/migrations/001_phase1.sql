CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED')),
    task_spec_json TEXT NOT NULL,
    task_spec_sha256 TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    model_plugin TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_pk INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    event_type TEXT NOT NULL,
    step_id TEXT NULL,
    tool_call_id TEXT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_run_type ON events(run_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_run_tool_call ON events(run_id, tool_call_id);
