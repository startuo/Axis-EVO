CREATE TABLE IF NOT EXISTS plan_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL CHECK (typeof(proposal_id) = 'text' AND length(trim(proposal_id)) > 0 AND instr(proposal_id, char(0)) = 0),
    schema_version INTEGER NOT NULL CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    card_sha256 TEXT NOT NULL CHECK (typeof(card_sha256) = 'text' AND length(card_sha256) = 64 AND instr(card_sha256, char(0)) = 0 AND card_sha256 NOT GLOB '*[^0-9a-f]*'),
    task_spec_sha256 TEXT NOT NULL CHECK (typeof(task_spec_sha256) = 'text' AND length(task_spec_sha256) = 64 AND instr(task_spec_sha256, char(0)) = 0 AND task_spec_sha256 NOT GLOB '*[^0-9a-f]*'),
    adapter_name TEXT NOT NULL CHECK (typeof(adapter_name) = 'text' AND length(trim(adapter_name)) > 0 AND instr(adapter_name, char(0)) = 0),
    model_id TEXT NOT NULL CHECK (typeof(model_id) = 'text' AND length(trim(model_id)) > 0 AND instr(model_id, char(0)) = 0),
    request_json TEXT NOT NULL CHECK (typeof(request_json) = 'text' AND length(CAST(request_json AS BLOB)) <= 131072 AND json_valid(request_json) AND json_type(request_json) = 'object'),
    request_sha256 TEXT NOT NULL CHECK (typeof(request_sha256) = 'text' AND length(request_sha256) = 64 AND instr(request_sha256, char(0)) = 0 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
    response_text TEXT NOT NULL CHECK (typeof(response_text) = 'text' AND length(CAST(response_text AS BLOB)) <= 65536 AND json_valid(response_text) AND json_type(response_text) = 'object'),
    response_sha256 TEXT NOT NULL CHECK (typeof(response_sha256) = 'text' AND length(response_sha256) = 64 AND instr(response_sha256, char(0)) = 0 AND response_sha256 NOT GLOB '*[^0-9a-f]*'),
    plan_json TEXT NOT NULL CHECK (typeof(plan_json) = 'text' AND length(CAST(plan_json AS BLOB)) <= 32768 AND json_valid(plan_json) AND json_type(plan_json) = 'object'),
    plan_sha256 TEXT NOT NULL CHECK (typeof(plan_sha256) = 'text' AND length(plan_sha256) = 64 AND instr(plan_sha256, char(0)) = 0 AND plan_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL CHECK (typeof(created_at) = 'text' AND length(trim(created_at)) > 0 AND instr(created_at, char(0)) = 0),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_versions(skill_id, skill_version)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS plan_run_links (
    run_id TEXT PRIMARY KEY NOT NULL CHECK (typeof(run_id) = 'text' AND length(trim(run_id)) > 0 AND instr(run_id, char(0)) = 0),
    proposal_id TEXT NOT NULL UNIQUE,
    approved_plan_sha256 TEXT NOT NULL CHECK (typeof(approved_plan_sha256) = 'text' AND length(approved_plan_sha256) = 64 AND instr(approved_plan_sha256, char(0)) = 0 AND approved_plan_sha256 NOT GLOB '*[^0-9a-f]*'),
    linked_at TEXT NOT NULL CHECK (typeof(linked_at) = 'text' AND length(trim(linked_at)) > 0 AND instr(linked_at, char(0)) = 0),
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (proposal_id) REFERENCES plan_proposals(proposal_id)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS plan_proposals_insert_guard BEFORE INSERT ON plan_proposals
BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM plan_proposals WHERE proposal_id = NEW.proposal_id)
        THEN RAISE(ABORT, 'Plan proposal already exists') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM skill_versions WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version AND card_sha256 = NEW.card_sha256
    ) THEN RAISE(ABORT, 'Plan proposal requires the recorded Skill version and Card hash') END;
    SELECT CASE WHEN COALESCE((
        SELECT state FROM skill_state_events WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version
        ORDER BY transition_seq DESC LIMIT 1
    ), '') != 'TRUSTED' THEN RAISE(ABORT, 'Plan proposal requires TRUSTED state') END;
END;

CREATE TRIGGER IF NOT EXISTS plan_run_links_insert_guard BEFORE INSERT ON plan_run_links
BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM plan_run_links WHERE run_id = NEW.run_id OR proposal_id = NEW.proposal_id)
        THEN RAISE(ABORT, 'Run or proposal already has a planning association') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM runs AS r JOIN plan_proposals AS p ON p.proposal_id = NEW.proposal_id
        JOIN skill_versions AS v ON v.skill_id = p.skill_id AND v.skill_version = p.skill_version
        WHERE r.run_id = NEW.run_id AND r.status = 'RUNNING' AND r.ended_at IS NULL
            AND r.task_spec_sha256 = p.task_spec_sha256 AND NEW.approved_plan_sha256 = p.plan_sha256
            AND v.card_sha256 = p.card_sha256
    ) THEN RAISE(ABORT, 'Plan association requires matching Run, proposal, approval and Card') END;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM events WHERE run_id = NEW.run_id)
        THEN RAISE(ABORT, 'Plan association must precede Run events') END;
    SELECT CASE WHEN COALESCE((
        SELECT s.state FROM skill_state_events AS s JOIN plan_proposals AS p
            ON p.skill_id = s.skill_id AND p.skill_version = s.skill_version
        WHERE p.proposal_id = NEW.proposal_id ORDER BY s.transition_seq DESC LIMIT 1
    ), '') != 'TRUSTED' THEN RAISE(ABORT, 'Plan association requires TRUSTED state') END;
END;

CREATE TRIGGER IF NOT EXISTS plan_proposals_no_update BEFORE UPDATE ON plan_proposals
BEGIN SELECT RAISE(ABORT, 'Plan proposals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS plan_proposals_no_delete BEFORE DELETE ON plan_proposals
BEGIN SELECT RAISE(ABORT, 'Plan proposals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS plan_run_links_no_update BEFORE UPDATE ON plan_run_links
BEGIN SELECT RAISE(ABORT, 'Plan associations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS plan_run_links_no_delete BEFORE DELETE ON plan_run_links
BEGIN SELECT RAISE(ABORT, 'Plan associations are immutable'); END;
