-- Web-only additive evidence. Never rewrite Core outcomes or migration history.
CREATE TABLE web_feedback_facts (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES runtime_threads(id),
    kind TEXT NOT NULL CHECK(kind IN ('FEEDBACK','REVISION_PROPOSAL','REVISION_AUTH','REVISION_LINK')),
    parent_id TEXT REFERENCES web_feedback_facts(id),
    slot TEXT NOT NULL,
    body_json TEXT NOT NULL CHECK(length(CAST(body_json AS BLOB)) <= 16384),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
    created_at TEXT NOT NULL,
    UNIQUE(project_id,kind,slot)
);
CREATE TRIGGER web_feedback_no_update BEFORE UPDATE ON web_feedback_facts
BEGIN SELECT RAISE(ABORT,'Feedback facts are immutable'); END;
CREATE TRIGGER web_feedback_no_delete BEFORE DELETE ON web_feedback_facts
BEGIN SELECT RAISE(ABORT,'Feedback history is retained'); END;
CREATE TRIGGER web_feedback_no_replace BEFORE INSERT ON web_feedback_facts
WHEN EXISTS(SELECT 1 FROM web_feedback_facts WHERE id=NEW.id
    OR (project_id=NEW.project_id AND kind=NEW.kind AND slot=NEW.slot))
BEGIN SELECT RAISE(ABORT,'Feedback identity already consumed'); END;
CREATE TRIGGER web_feedback_source BEFORE INSERT ON web_feedback_facts
WHEN NOT EXISTS(SELECT 1 FROM runtime_threads WHERE id=NEW.thread_id AND project_id=NEW.project_id)
 OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM web_feedback_facts
    WHERE id=NEW.parent_id AND project_id=NEW.project_id AND thread_id=NEW.thread_id))
BEGIN SELECT RAISE(ABORT,'Feedback source is foreign or missing'); END;
