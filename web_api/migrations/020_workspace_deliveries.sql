CREATE TABLE workspace_drafts (
 draft_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 reply_id TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL, source_json TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, parent_id TEXT REFERENCES workspace_drafts(draft_id),
 version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL
);
CREATE TABLE workspace_deliveries (
 delivery_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE REFERENCES workspace_drafts(draft_id),
 request_json TEXT NOT NULL, approval_sha256 TEXT NOT NULL, content TEXT NOT NULL,
 run_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE workspace_delivery_facts (
 fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
 delivery_id TEXT NOT NULL REFERENCES workspace_deliveries(delivery_id),
 kind TEXT NOT NULL CHECK(kind IN ('APPROVED','DISPATCHED','COMPLETED','FAILED','REJECTED','UNKNOWN')),
 payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX workspace_delivery_single_fact ON workspace_delivery_facts(delivery_id,kind);
CREATE UNIQUE INDEX workspace_delivery_single_terminal ON workspace_delivery_facts(delivery_id) WHERE kind IN ('COMPLETED','FAILED','REJECTED','UNKNOWN');
CREATE TRIGGER workspace_drafts_no_update BEFORE UPDATE ON workspace_drafts BEGIN SELECT RAISE(ABORT,'draft lineage is immutable'); END;
CREATE TRIGGER workspace_drafts_no_delete BEFORE DELETE ON workspace_drafts BEGIN SELECT RAISE(ABORT,'draft history is retained'); END;
CREATE TRIGGER workspace_drafts_no_replace BEFORE INSERT ON workspace_drafts WHEN EXISTS(SELECT 1 FROM workspace_drafts WHERE draft_id=NEW.draft_id OR reply_id=NEW.reply_id) BEGIN SELECT RAISE(ABORT,'draft identity cannot be replaced'); END;
CREATE TRIGGER workspace_deliveries_no_update BEFORE UPDATE ON workspace_deliveries BEGIN SELECT RAISE(ABORT,'delivery approval is immutable'); END;
CREATE TRIGGER workspace_deliveries_no_delete BEFORE DELETE ON workspace_deliveries BEGIN SELECT RAISE(ABORT,'delivery history is retained'); END;
CREATE TRIGGER workspace_deliveries_no_replace BEFORE INSERT ON workspace_deliveries WHEN EXISTS(SELECT 1 FROM workspace_deliveries WHERE delivery_id=NEW.delivery_id OR draft_id=NEW.draft_id) BEGIN SELECT RAISE(ABORT,'delivery cannot be replayed'); END;
CREATE TRIGGER workspace_delivery_facts_no_update BEFORE UPDATE ON workspace_delivery_facts BEGIN SELECT RAISE(ABORT,'delivery facts are immutable'); END;
CREATE TRIGGER workspace_delivery_facts_no_delete BEFORE DELETE ON workspace_delivery_facts BEGIN SELECT RAISE(ABORT,'delivery facts are retained'); END;
CREATE TRIGGER workspace_delivery_facts_no_replace BEFORE INSERT ON workspace_delivery_facts WHEN EXISTS(SELECT 1 FROM workspace_delivery_facts WHERE fact_id=NEW.fact_id) BEGIN SELECT RAISE(ABORT,'delivery facts cannot be replaced'); END;
CREATE TRIGGER workspace_delivery_after_terminal BEFORE INSERT ON workspace_delivery_facts WHEN EXISTS(SELECT 1 FROM workspace_delivery_facts WHERE delivery_id=NEW.delivery_id AND kind IN ('COMPLETED','FAILED','REJECTED','UNKNOWN')) BEGIN SELECT RAISE(ABORT,'delivery outcome is terminal'); END;
