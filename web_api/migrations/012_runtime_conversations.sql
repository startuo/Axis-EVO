-- Web-only conversation facts. Core migrations 001-010 and Web 011 are unchanged.
CREATE TABLE runtime_conversations (
 conversation_id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL,
 title TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_turns (
 turn_id TEXT PRIMARY KEY NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES runtime_conversations(conversation_id),
 turn_number INTEGER NOT NULL CHECK(typeof(turn_number)='integer' AND turn_number BETWEEN 1 AND 16),
 thread_id TEXT NOT NULL UNIQUE REFERENCES runtime_threads(id),
 user_message_id TEXT NOT NULL UNIQUE REFERENCES runtime_messages(message_id) DEFERRABLE INITIALLY DEFERRED,
 reserved_run_id TEXT NOT NULL UNIQUE,
 task_template_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(conversation_id,turn_number)
);
CREATE TABLE runtime_messages (
 message_id TEXT PRIMARY KEY NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES runtime_conversations(conversation_id),
 turn_id TEXT NOT NULL REFERENCES runtime_turns(turn_id),
 kind TEXT NOT NULL CHECK(kind IN ('USER_MESSAGE','MODEL_PLANNING_RESULT','SYSTEM_ACTIVITY','TOOL_EVIDENCE','VALIDATION_RESULT','ASSISTANT_PRESENTATION')),
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_contexts (
 turn_id TEXT PRIMARY KEY NOT NULL REFERENCES runtime_turns(turn_id),
 context_json TEXT NOT NULL,
 context_sha256 TEXT NOT NULL CHECK(length(context_sha256)=64),
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_turn_observations (
 observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
 turn_id TEXT NOT NULL REFERENCES runtime_turns(turn_id),
 kind TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 observed_at TEXT NOT NULL,
 UNIQUE(turn_id,kind,payload_sha256)
);
