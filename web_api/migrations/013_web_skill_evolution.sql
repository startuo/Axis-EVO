-- Web provenance only. Core migrations, lifecycle and approval remain unchanged.
CREATE TABLE IF NOT EXISTS web_evolution_facts (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN (
        'CASE_INTENT','CASE_RESULT','GENERATION_INTENT','GENERATION_CLAIM','GENERATION_RESULT',
        'DRAFT','CORE_REVISION_INTENT','CORE_REVISION_LINK','CANDIDATE_AUTH','CANDIDATE_RECEIPT',
        'OP_INTENT','OP_CLAIM','OP_RESULT','PROCESS_OBSERVATION','TRACE_SOURCE','TRACE_CANDIDATE')),
    parent_id TEXT REFERENCES web_evolution_facts(id),
    slot TEXT NOT NULL,
    body_json TEXT NOT NULL CHECK(length(CAST(body_json AS BLOB)) <= 196608),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
    created_at TEXT NOT NULL,
    UNIQUE(project_id,kind,slot)
);
CREATE TRIGGER IF NOT EXISTS web_evolution_no_update BEFORE UPDATE ON web_evolution_facts
BEGIN SELECT RAISE(ABORT,'Web evolution facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS web_evolution_no_delete BEFORE DELETE ON web_evolution_facts
BEGIN SELECT RAISE(ABORT,'Web evolution facts are retained'); END;
CREATE TRIGGER IF NOT EXISTS web_evolution_no_replace BEFORE INSERT ON web_evolution_facts
WHEN EXISTS(SELECT 1 FROM web_evolution_facts WHERE id=NEW.id
    OR (project_id=NEW.project_id AND kind=NEW.kind AND slot=NEW.slot))
BEGIN SELECT RAISE(ABORT,'Web evolution identity already consumed'); END;
CREATE TRIGGER IF NOT EXISTS web_evolution_parent BEFORE INSERT ON web_evolution_facts
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM web_evolution_facts WHERE id=NEW.parent_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Web evolution parent belongs to another project or is missing'); END;
