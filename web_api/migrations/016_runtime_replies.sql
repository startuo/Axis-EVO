-- Optional Web conversation evidence; no changes to Core or migrations 001-015.
CREATE TABLE runtime_chat_requests (
 request_id TEXT PRIMARY KEY NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES runtime_conversations(conversation_id),
 message_id TEXT NOT NULL UNIQUE,
 project_id TEXT NOT NULL,
 prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 8192),
 admission_json TEXT NOT NULL,
 admission_sha256 TEXT NOT NULL CHECK(length(admission_sha256)=64),
 profile_json TEXT NOT NULL,
 profile_sha256 TEXT NOT NULL CHECK(length(profile_sha256)=64),
 request_json TEXT NOT NULL,
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 worker_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_chat_facts (
 fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL REFERENCES runtime_chat_requests(request_id),
 worker_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('CLAIMED','RESPONSE','FAILED','INTERRUPTED')),
 payload_json TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 created_at TEXT NOT NULL,
 UNIQUE(request_id,kind)
);
CREATE UNIQUE INDEX runtime_chat_one_terminal ON runtime_chat_facts(request_id)
 WHERE kind IN ('RESPONSE','FAILED','INTERRUPTED');
CREATE TRIGGER runtime_chat_fact_identity BEFORE INSERT ON runtime_chat_facts
 WHEN NOT EXISTS(SELECT 1 FROM runtime_chat_requests
  WHERE request_id=NEW.request_id AND worker_id=NEW.worker_id)
 OR (NEW.kind IN ('RESPONSE','FAILED') AND NOT EXISTS(
  SELECT 1 FROM runtime_chat_facts WHERE request_id=NEW.request_id AND kind='CLAIMED'))
 OR EXISTS(SELECT 1 FROM runtime_chat_facts WHERE request_id=NEW.request_id
  AND kind IN ('RESPONSE','FAILED','INTERRUPTED'))
 BEGIN SELECT RAISE(ABORT,'invalid reply fact identity or terminal order'); END;
CREATE TABLE runtime_conversation_items (
 conversation_id TEXT NOT NULL REFERENCES runtime_conversations(conversation_id),
 seq INTEGER NOT NULL CHECK(typeof(seq)='integer' AND seq BETWEEN 1 AND 64),
 kind TEXT NOT NULL CHECK(kind IN ('CHAT','TASK')),
 source_id TEXT NOT NULL,
 message_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,seq),
 UNIQUE(kind,source_id)
);
CREATE TRIGGER runtime_conversation_item_source BEFORE INSERT ON runtime_conversation_items
 WHEN (NEW.kind='CHAT' AND NOT EXISTS(SELECT 1 FROM runtime_chat_requests
  WHERE request_id=NEW.source_id AND conversation_id=NEW.conversation_id AND message_id=NEW.message_id))
 OR (NEW.kind='TASK' AND NOT EXISTS(SELECT 1 FROM runtime_turns
  WHERE turn_id=NEW.source_id AND conversation_id=NEW.conversation_id AND user_message_id=NEW.message_id))
 OR NEW.seq!=(SELECT coalesce(max(seq),0)+1 FROM runtime_conversation_items WHERE conversation_id=NEW.conversation_id)
 BEGIN SELECT RAISE(ABORT,'invalid conversation item source or order'); END;
