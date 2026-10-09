CREATE TABLE IF NOT EXISTS agent_episodes (
    episode_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(episode_id)) > 0),
    task_spec_path TEXT NOT NULL,
    task_spec_sha256 TEXT NOT NULL CHECK (length(task_spec_sha256)=64 AND task_spec_sha256 NOT GLOB '*[^0-9a-f]*'),
    seed_path TEXT NOT NULL,
    seed_manifest_json TEXT NOT NULL CHECK (json_valid(seed_manifest_json) AND length(CAST(seed_manifest_json AS BLOB))<=131072),
    seed_sha256 TEXT NOT NULL CHECK (length(seed_sha256)=64 AND seed_sha256 NOT GLOB '*[^0-9a-f]*'),
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version)='integer' AND skill_version>=1),
    card_sha256 TEXT NOT NULL CHECK (length(card_sha256)=64 AND card_sha256 NOT GLOB '*[^0-9a-f]*'),
    workspace_root TEXT NOT NULL,
    adapter_name TEXT NOT NULL CHECK (length(trim(adapter_name))>0),
    model_id TEXT NOT NULL CHECK (length(trim(model_id))>0),
    max_attempts INTEGER NOT NULL CHECK (typeof(max_attempts)='integer' AND max_attempts BETWEEN 1 AND 5),
    include_message_excerpts INTEGER NOT NULL CHECK (typeof(include_message_excerpts)='integer' AND include_message_excerpts IN (0,1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS agent_attempts (
    episode_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL CHECK (typeof(attempt_no)='integer' AND attempt_no BETWEEN 1 AND 5),
    previous_run_id TEXT,
    feedback_json TEXT NOT NULL CHECK (json_valid(feedback_json) AND length(CAST(feedback_json AS BLOB))<=16384),
    feedback_sha256 TEXT NOT NULL CHECK (length(feedback_sha256)=64 AND feedback_sha256 NOT GLOB '*[^0-9a-f]*'),
    allocated_at TEXT NOT NULL,
    PRIMARY KEY (episode_id,attempt_no),
    FOREIGN KEY (episode_id) REFERENCES agent_episodes(episode_id),
    FOREIGN KEY (previous_run_id) REFERENCES runs(run_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS agent_attempt_facts (
    episode_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('PROPOSAL_RECORDED','PLANNING_FAILED','STALLED')),
    proposal_id TEXT UNIQUE,
    error_category TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (episode_id,attempt_no),
    FOREIGN KEY (episode_id,attempt_no) REFERENCES agent_attempts(episode_id,attempt_no),
    FOREIGN KEY (proposal_id) REFERENCES plan_proposals(proposal_id),
    CHECK ((kind='PLANNING_FAILED' AND proposal_id IS NULL AND error_category IS NOT NULL)
        OR (kind IN ('PROPOSAL_RECORDED','STALLED') AND proposal_id IS NOT NULL AND error_category IS NULL))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS agent_dispatches (
    episode_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    proposal_id TEXT NOT NULL UNIQUE,
    approved_plan_sha256 TEXT NOT NULL CHECK (length(approved_plan_sha256)=64 AND approved_plan_sha256 NOT GLOB '*[^0-9a-f]*'),
    reserved_run_id TEXT NOT NULL UNIQUE CHECK (length(trim(reserved_run_id))>0),
    workspace_path TEXT NOT NULL UNIQUE,
    reserved_at TEXT NOT NULL,
    PRIMARY KEY (episode_id,attempt_no),
    FOREIGN KEY (episode_id,attempt_no) REFERENCES agent_attempt_facts(episode_id,attempt_no),
    FOREIGN KEY (proposal_id) REFERENCES plan_proposals(proposal_id)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS agent_attempts_guard BEFORE INSERT ON agent_attempts
BEGIN
    SELECT CASE WHEN NEW.attempt_no != COALESCE((SELECT MAX(attempt_no)+1 FROM agent_attempts WHERE episode_id=NEW.episode_id),1)
        OR NEW.attempt_no > COALESCE((SELECT max_attempts FROM agent_episodes WHERE episode_id=NEW.episode_id),0)
        THEN RAISE(ABORT,'Attempt sequence or budget mismatch') END;
    SELECT CASE WHEN (NEW.attempt_no=1 AND NEW.previous_run_id IS NOT NULL)
        OR (NEW.attempt_no>1 AND NOT EXISTS (
            SELECT 1 FROM agent_dispatches d JOIN runs r ON r.run_id=d.reserved_run_id
            JOIN plan_run_links l ON l.run_id=r.run_id AND l.proposal_id=d.proposal_id
            WHERE d.episode_id=NEW.episode_id AND d.attempt_no=NEW.attempt_no-1
                AND r.run_id=NEW.previous_run_id AND r.status='FAILED' AND r.ended_at IS NOT NULL
        )) THEN RAISE(ABORT,'Previous attempt requires a linked terminal FAILED Run') END;
END;

CREATE TRIGGER IF NOT EXISTS agent_attempt_facts_guard BEFORE INSERT ON agent_attempt_facts
BEGIN
    SELECT CASE WHEN NEW.proposal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM agent_episodes e JOIN agent_attempts a USING(episode_id)
        JOIN plan_proposals p ON p.proposal_id=NEW.proposal_id
        WHERE a.episode_id=NEW.episode_id AND a.attempt_no=NEW.attempt_no
            AND p.skill_id=e.skill_id AND p.skill_version=e.skill_version
            AND p.card_sha256=e.card_sha256 AND p.task_spec_sha256=e.task_spec_sha256
            AND p.adapter_name=e.adapter_name AND p.model_id=e.model_id
            AND json_extract(p.request_json,'$.request_schema_version')=2
            AND json_extract(p.request_json,'$.agent_feedback')=json(a.feedback_json)
    ) THEN RAISE(ABORT,'Attempt proposal disagrees with pinned context') END;
END;

CREATE TRIGGER IF NOT EXISTS agent_dispatches_guard BEFORE INSERT ON agent_dispatches
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM agent_attempt_facts f JOIN plan_proposals p USING(proposal_id)
        WHERE f.episode_id=NEW.episode_id AND f.attempt_no=NEW.attempt_no
            AND f.proposal_id=NEW.proposal_id AND f.kind='PROPOSAL_RECORDED'
            AND p.plan_sha256=NEW.approved_plan_sha256
    ) OR EXISTS (SELECT 1 FROM runs WHERE run_id=NEW.reserved_run_id)
      OR EXISTS (SELECT 1 FROM plan_run_links WHERE proposal_id=NEW.proposal_id)
      THEN RAISE(ABORT,'Dispatch requires an unconsumed exact approved proposal') END;
END;

CREATE TRIGGER IF NOT EXISTS agent_episodes_no_replace BEFORE INSERT ON agent_episodes
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_episodes WHERE episode_id=NEW.episode_id) THEN RAISE(ABORT,'Agent evidence already exists') END; END;
CREATE TRIGGER IF NOT EXISTS agent_episodes_no_update BEFORE UPDATE ON agent_episodes
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_episodes_no_delete BEFORE DELETE ON agent_episodes
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS agent_attempts_no_replace BEFORE INSERT ON agent_attempts
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_attempts WHERE episode_id=NEW.episode_id AND attempt_no=NEW.attempt_no) THEN RAISE(ABORT,'Agent evidence already exists') END; END;
CREATE TRIGGER IF NOT EXISTS agent_attempts_no_update BEFORE UPDATE ON agent_attempts
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_attempts_no_delete BEFORE DELETE ON agent_attempts
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS agent_attempt_facts_no_replace BEFORE INSERT ON agent_attempt_facts
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_attempt_facts WHERE (episode_id=NEW.episode_id AND attempt_no=NEW.attempt_no) OR proposal_id=NEW.proposal_id) THEN RAISE(ABORT,'Agent evidence already exists') END; END;
CREATE TRIGGER IF NOT EXISTS agent_attempt_facts_no_update BEFORE UPDATE ON agent_attempt_facts
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_attempt_facts_no_delete BEFORE DELETE ON agent_attempt_facts
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS agent_dispatches_no_replace BEFORE INSERT ON agent_dispatches
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_dispatches WHERE (episode_id=NEW.episode_id AND attempt_no=NEW.attempt_no) OR proposal_id=NEW.proposal_id OR reserved_run_id=NEW.reserved_run_id OR workspace_path=NEW.workspace_path) THEN RAISE(ABORT,'Agent evidence already exists') END; END;
CREATE TRIGGER IF NOT EXISTS agent_dispatches_no_update BEFORE UPDATE ON agent_dispatches
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_dispatches_no_delete BEFORE DELETE ON agent_dispatches
BEGIN SELECT RAISE(ABORT,'Agent evidence is immutable'); END;
