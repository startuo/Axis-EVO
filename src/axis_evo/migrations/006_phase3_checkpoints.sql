CREATE TABLE IF NOT EXISTS checkpoint_records (
    checkpoint_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(checkpoint_id))>0),
    schema_version INTEGER NOT NULL CHECK (typeof(schema_version)='integer' AND schema_version=1),
    run_id TEXT NOT NULL,
    checkpoint_kind TEXT NOT NULL CHECK (checkpoint_kind IN ('TERMINAL','CONTROLLED_STEP')),
    event_cursor_seq INTEGER NOT NULL CHECK (typeof(event_cursor_seq)='integer' AND event_cursor_seq>=1),
    event_prefix_sha256 TEXT NOT NULL CHECK (typeof(event_prefix_sha256)='text' AND length(event_prefix_sha256)=64 AND event_prefix_sha256 NOT GLOB '*[^0-9a-f]*'),
    task_spec_sha256 TEXT NOT NULL CHECK (typeof(task_spec_sha256)='text' AND length(task_spec_sha256)=64 AND task_spec_sha256 NOT GLOB '*[^0-9a-f]*'),
    skill_id TEXT,
    skill_version INTEGER,
    card_sha256 TEXT,
    proposal_id TEXT,
    plan_sha256 TEXT,
    workspace_root TEXT NOT NULL,
    workspace_manifest_json TEXT NOT NULL CHECK (json_valid(workspace_manifest_json) AND length(CAST(workspace_manifest_json AS BLOB))<=131072),
    workspace_manifest_sha256 TEXT NOT NULL CHECK (typeof(workspace_manifest_sha256)='text' AND length(workspace_manifest_sha256)=64 AND workspace_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=524288),
    snapshot_sha256 TEXT NOT NULL CHECK (typeof(snapshot_sha256)='text' AND length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
    captured_at TEXT NOT NULL CHECK (length(trim(captured_at))>0),
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    FOREIGN KEY (proposal_id) REFERENCES plan_proposals(proposal_id),
    CHECK ((skill_id IS NULL AND skill_version IS NULL AND card_sha256 IS NULL)
        OR (skill_id IS NOT NULL AND typeof(skill_version)='integer' AND skill_version>=1 AND card_sha256 IS NOT NULL AND typeof(card_sha256)='text' AND length(card_sha256)=64 AND card_sha256 NOT GLOB '*[^0-9a-f]*')),
    CHECK ((proposal_id IS NULL AND plan_sha256 IS NULL)
        OR (proposal_id IS NOT NULL AND plan_sha256 IS NOT NULL AND typeof(plan_sha256)='text' AND length(plan_sha256)=64 AND plan_sha256 NOT GLOB '*[^0-9a-f]*'))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS checkpoint_artifacts (
    checkpoint_id TEXT NOT NULL,
    path TEXT NOT NULL CHECK (length(path)>0),
    size_bytes INTEGER NOT NULL CHECK (typeof(size_bytes)='integer' AND size_bytes BETWEEN 0 AND 1048576),
    sha256 TEXT NOT NULL CHECK (typeof(sha256)='text' AND length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    content BLOB NOT NULL CHECK (typeof(content)='blob' AND length(content)=size_bytes),
    PRIMARY KEY (checkpoint_id,path),
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoint_records(checkpoint_id)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS checkpoint_artifacts_manifest_guard BEFORE INSERT ON checkpoint_artifacts
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM checkpoint_records r, json_each(r.workspace_manifest_json,'$.entries') e
        WHERE r.checkpoint_id=NEW.checkpoint_id AND json_extract(e.value,'$.type')='file'
            AND json_extract(e.value,'$.path')=NEW.path
            AND json_extract(e.value,'$.sha256')=NEW.sha256
            AND json_extract(e.value,'$.size_bytes')=NEW.size_bytes
    ) THEN RAISE(ABORT,'Artifact disagrees with checkpoint manifest') END;
END;

CREATE TRIGGER IF NOT EXISTS checkpoint_records_no_replace BEFORE INSERT ON checkpoint_records
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM checkpoint_records WHERE checkpoint_id=NEW.checkpoint_id) THEN RAISE(ABORT,'Checkpoint evidence already exists') END; END;

CREATE TRIGGER IF NOT EXISTS checkpoint_records_no_update BEFORE UPDATE ON checkpoint_records
BEGIN SELECT RAISE(ABORT,'Checkpoint evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS checkpoint_records_no_delete BEFORE DELETE ON checkpoint_records
BEGIN SELECT RAISE(ABORT,'Checkpoint evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS checkpoint_artifacts_no_replace BEFORE INSERT ON checkpoint_artifacts
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM checkpoint_artifacts WHERE checkpoint_id=NEW.checkpoint_id AND path=NEW.path) THEN RAISE(ABORT,'Checkpoint evidence already exists') END; END;

CREATE TRIGGER IF NOT EXISTS checkpoint_artifacts_no_update BEFORE UPDATE ON checkpoint_artifacts
BEGIN SELECT RAISE(ABORT,'Checkpoint evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS checkpoint_artifacts_no_delete BEFORE DELETE ON checkpoint_artifacts
BEGIN SELECT RAISE(ABORT,'Checkpoint evidence is immutable'); END;
