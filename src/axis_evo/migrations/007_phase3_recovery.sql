CREATE TABLE IF NOT EXISTS recovery_cases (
    case_id TEXT PRIMARY KEY NOT NULL,
    source_run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
    checkpoint_id TEXT NOT NULL REFERENCES checkpoint_records(checkpoint_id),
    fact_json TEXT NOT NULL CHECK (json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=2097152),
    fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK (json_extract(fact_json,'$.schema_version')=1),
    CHECK (case_id = json_extract(fact_json,'$.case_id')),
    CHECK (source_run_id = json_extract(fact_json,'$.source_run_id')),
    CHECK (checkpoint_id = json_extract(fact_json,'$.checkpoint_id'))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS recovery_cases_no_update BEFORE UPDATE ON recovery_cases
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_cases_no_delete BEFORE DELETE ON recovery_cases
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_cases_no_replace BEFORE INSERT ON recovery_cases
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_cases WHERE case_id=NEW.case_id OR source_run_id=NEW.source_run_id) THEN RAISE(ABORT,'Recovery evidence already exists') END; END;

CREATE TABLE IF NOT EXISTS recovery_assessments (
    assessment_id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES recovery_cases(case_id),
    fact_json TEXT NOT NULL CHECK (json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=2097152),
    fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK (json_extract(fact_json,'$.schema_version')=1),
    CHECK (assessment_id = json_extract(fact_json,'$.assessment_id')),
    CHECK (case_id = json_extract(fact_json,'$.case_id'))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS recovery_assessments_no_update BEFORE UPDATE ON recovery_assessments
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_assessments_no_delete BEFORE DELETE ON recovery_assessments
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_assessments_no_replace BEFORE INSERT ON recovery_assessments
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_assessments WHERE assessment_id=NEW.assessment_id) THEN RAISE(ABORT,'Recovery evidence already exists') END; END;

CREATE TABLE IF NOT EXISTS recovery_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL UNIQUE REFERENCES recovery_cases(case_id),
    assessment_id TEXT NOT NULL UNIQUE REFERENCES recovery_assessments(assessment_id),
    fact_json TEXT NOT NULL CHECK (json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=2097152),
    fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK (json_extract(fact_json,'$.schema_version')=1),
    CHECK (proposal_id = json_extract(fact_json,'$.proposal_id')),
    CHECK (case_id = json_extract(fact_json,'$.case_id')),
    CHECK (assessment_id = json_extract(fact_json,'$.assessment_id'))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS recovery_proposals_no_update BEFORE UPDATE ON recovery_proposals
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_proposals_no_delete BEFORE DELETE ON recovery_proposals
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_proposals_no_replace BEFORE INSERT ON recovery_proposals
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_proposals WHERE proposal_id=NEW.proposal_id OR case_id=NEW.case_id OR assessment_id=NEW.assessment_id) THEN RAISE(ABORT,'Recovery evidence already exists') END; END;

CREATE TABLE IF NOT EXISTS recovery_dispatches (
    case_id TEXT PRIMARY KEY NOT NULL REFERENCES recovery_cases(case_id),
    proposal_id TEXT NOT NULL UNIQUE REFERENCES recovery_proposals(proposal_id),
    reserved_child_run_id TEXT NOT NULL UNIQUE,
    workspace_path TEXT NOT NULL UNIQUE,
    approved_recovery_sha256 TEXT NOT NULL,
    fact_json TEXT NOT NULL CHECK (json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=2097152),
    fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK (json_extract(fact_json,'$.schema_version')=1),
    CHECK (case_id = json_extract(fact_json,'$.case_id')),
    CHECK (proposal_id = json_extract(fact_json,'$.proposal_id')),
    CHECK (reserved_child_run_id = json_extract(fact_json,'$.reserved_child_run_id')),
    CHECK (workspace_path = json_extract(fact_json,'$.workspace_path')),
    CHECK (approved_recovery_sha256 = json_extract(fact_json,'$.approved_recovery_sha256'))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS recovery_dispatches_no_update BEFORE UPDATE ON recovery_dispatches
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_dispatches_no_delete BEFORE DELETE ON recovery_dispatches
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_dispatches_no_replace BEFORE INSERT ON recovery_dispatches
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_dispatches WHERE case_id=NEW.case_id OR proposal_id=NEW.proposal_id OR reserved_child_run_id=NEW.reserved_child_run_id OR workspace_path=NEW.workspace_path) THEN RAISE(ABORT,'Recovery evidence already exists') END; END;

CREATE TABLE IF NOT EXISTS recovery_outcomes (
    case_id TEXT PRIMARY KEY NOT NULL REFERENCES recovery_dispatches(case_id),
    child_run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
    fact_json TEXT NOT NULL CHECK (json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=2097152),
    fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK (json_extract(fact_json,'$.schema_version')=1),
    CHECK (case_id = json_extract(fact_json,'$.case_id')),
    CHECK (child_run_id = json_extract(fact_json,'$.child_run_id'))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS recovery_outcomes_no_update BEFORE UPDATE ON recovery_outcomes
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_outcomes_no_delete BEFORE DELETE ON recovery_outcomes
BEGIN SELECT RAISE(ABORT,'Recovery evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS recovery_outcomes_no_replace BEFORE INSERT ON recovery_outcomes
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_outcomes WHERE case_id=NEW.case_id OR child_run_id=NEW.child_run_id) THEN RAISE(ABORT,'Recovery evidence already exists') END; END;

CREATE TRIGGER IF NOT EXISTS recovery_cases_guard BEFORE INSERT ON recovery_cases
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM checkpoint_records c JOIN runs r ON r.run_id=c.run_id WHERE c.checkpoint_id=NEW.checkpoint_id AND r.run_id=NEW.source_run_id AND r.status IN ('RUNNING','FAILED')) THEN RAISE(ABORT,'Source and checkpoint mismatch') END; END;

CREATE TRIGGER IF NOT EXISTS recovery_proposals_guard BEFORE INSERT ON recovery_proposals
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM recovery_assessments a WHERE a.assessment_id=NEW.assessment_id AND a.case_id=NEW.case_id AND json_extract(a.fact_json,'$.executable')=1) THEN RAISE(ABORT,'Proposal requires executable assessment') END; END;

CREATE TRIGGER IF NOT EXISTS recovery_dispatches_guard BEFORE INSERT ON recovery_dispatches
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM recovery_proposals p WHERE p.proposal_id=NEW.proposal_id AND p.case_id=NEW.case_id AND p.fact_sha256=NEW.approved_recovery_sha256 AND json_extract(p.fact_json,'$.reserved_child_run_id')=NEW.reserved_child_run_id AND json_extract(p.fact_json,'$.workspace_path')=NEW.workspace_path) OR EXISTS (SELECT 1 FROM runs WHERE run_id=NEW.reserved_child_run_id) THEN RAISE(ABORT,'Dispatch requires exact unconsumed approval') END; END;

CREATE TRIGGER IF NOT EXISTS recovery_outcomes_guard BEFORE INSERT ON recovery_outcomes
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM recovery_dispatches d JOIN runs r ON r.run_id=d.reserved_child_run_id WHERE d.case_id=NEW.case_id AND r.run_id=NEW.child_run_id AND r.status IN ('COMPLETED','FAILED') AND r.ended_at IS NOT NULL AND r.workspace_path=d.workspace_path AND r.task_spec_sha256=json_extract(d.fact_json,'$.derived_task_spec_sha256')) THEN RAISE(ABORT,'Outcome requires exact terminal child') END; END;
