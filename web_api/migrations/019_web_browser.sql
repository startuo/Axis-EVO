CREATE TABLE browser_operations (
 operation_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL,
 binding_id TEXT, action TEXT NOT NULL, request_json TEXT NOT NULL,
 request_sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE browser_operation_facts (
 fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL REFERENCES browser_operations(operation_id),
 kind TEXT NOT NULL CHECK(kind IN ('DISPATCHED','RESULT','REJECTED','UNKNOWN','LATE_RESULT')),
 payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX browser_operation_dispatched ON browser_operation_facts(operation_id) WHERE kind='DISPATCHED';
CREATE UNIQUE INDEX browser_operation_terminal ON browser_operation_facts(operation_id) WHERE kind IN ('RESULT','REJECTED','UNKNOWN');
CREATE UNIQUE INDEX browser_operation_late ON browser_operation_facts(operation_id) WHERE kind='LATE_RESULT';
CREATE TRIGGER browser_operations_no_update BEFORE UPDATE ON browser_operations BEGIN SELECT RAISE(ABORT,'browser intent is immutable'); END;
CREATE TRIGGER browser_operations_no_delete BEFORE DELETE ON browser_operations BEGIN SELECT RAISE(ABORT,'browser intent is retained'); END;
CREATE TRIGGER browser_operations_no_replace BEFORE INSERT ON browser_operations WHEN EXISTS(SELECT 1 FROM browser_operations WHERE operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'browser intent cannot be replaced'); END;
CREATE TRIGGER browser_facts_no_update BEFORE UPDATE ON browser_operation_facts BEGIN SELECT RAISE(ABORT,'browser facts are immutable'); END;
CREATE TRIGGER browser_facts_no_delete BEFORE DELETE ON browser_operation_facts BEGIN SELECT RAISE(ABORT,'browser facts are retained'); END;
CREATE TRIGGER browser_facts_no_replace BEFORE INSERT ON browser_operation_facts WHEN EXISTS(SELECT 1 FROM browser_operation_facts WHERE fact_id=NEW.fact_id) BEGIN SELECT RAISE(ABORT,'browser facts cannot be replaced'); END;
CREATE TRIGGER browser_facts_after_terminal BEFORE INSERT ON browser_operation_facts WHEN NEW.kind!='LATE_RESULT' AND EXISTS(SELECT 1 FROM browser_operation_facts WHERE operation_id=NEW.operation_id AND kind IN ('RESULT','REJECTED','UNKNOWN')) BEGIN SELECT RAISE(ABORT,'browser outcome is terminal'); END;
