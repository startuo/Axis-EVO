CREATE TABLE IF NOT EXISTS skills (
    skill_id TEXT PRIMARY KEY NOT NULL CHECK (
        typeof(skill_id) = 'text' AND length(skill_id) BETWEEN 1 AND 128
        AND instr(skill_id, char(0)) = 0 AND skill_id GLOB '[A-Za-z0-9]*'
        AND skill_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    created_at TEXT NOT NULL CHECK (typeof(created_at) = 'text' AND length(trim(created_at)) > 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS skill_versions (
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    schema_version INTEGER NOT NULL CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
    card_json TEXT NOT NULL CHECK (typeof(card_json) = 'text'),
    card_sha256 TEXT NOT NULL CHECK (
        typeof(card_sha256) = 'text' AND length(card_sha256) = 64
        AND instr(card_sha256, char(0)) = 0 AND card_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    source_kind TEXT NOT NULL,
    source_skill_id TEXT NULL,
    source_skill_version INTEGER NULL,
    created_at TEXT NOT NULL CHECK (typeof(created_at) = 'text' AND length(trim(created_at)) > 0),
    PRIMARY KEY (skill_id, skill_version),
    FOREIGN KEY (skill_id) REFERENCES skills(skill_id),
    FOREIGN KEY (source_skill_id, source_skill_version) REFERENCES skill_versions(skill_id, skill_version),
    CHECK (
        (source_kind = 'MANUAL' AND skill_version = 1 AND source_skill_id IS NULL AND source_skill_version IS NULL)
        OR (source_kind = 'DERIVED' AND source_skill_id IS NOT NULL AND source_skill_version IS NOT NULL
            AND typeof(source_skill_version) = 'integer' AND source_skill_version >= 1)
    )
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS skill_state_events (
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    transition_seq INTEGER NOT NULL CHECK (typeof(transition_seq) = 'integer' AND transition_seq >= 1),
    state TEXT NOT NULL,
    occurred_at TEXT NOT NULL CHECK (typeof(occurred_at) = 'text' AND length(trim(occurred_at)) > 0),
    PRIMARY KEY (skill_id, skill_version, transition_seq),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_versions(skill_id, skill_version),
    CHECK (
        (transition_seq = 1 AND state = 'CANDIDATE')
        OR (transition_seq = 2 AND state = 'SHADOW')
        OR (transition_seq = 3 AND state = 'TRUSTED')
    )
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS skills_insert_guard BEFORE INSERT ON skills
BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM skills WHERE skill_id = NEW.skill_id)
        THEN RAISE(ABORT, 'Skill identity already exists') END;
END;

CREATE TRIGGER IF NOT EXISTS skill_versions_insert_guard BEFORE INSERT ON skill_versions
BEGIN
    SELECT CASE WHEN NEW.skill_version != (
        SELECT COALESCE(MAX(skill_version), 0) + 1 FROM skill_versions WHERE skill_id = NEW.skill_id
    ) THEN RAISE(ABORT, 'Skill version must be the next committed version') END;
    SELECT CASE WHEN NEW.source_kind = 'DERIVED' AND NOT EXISTS (
        SELECT 1 FROM skill_versions
        WHERE skill_id = NEW.source_skill_id AND skill_version = NEW.source_skill_version
    ) THEN RAISE(ABORT, 'Derived source must already exist') END;
END;

CREATE TRIGGER IF NOT EXISTS skill_state_events_insert_guard BEFORE INSERT ON skill_state_events
BEGIN
    SELECT CASE WHEN NEW.transition_seq != (
        SELECT COALESCE(MAX(transition_seq), 0) + 1 FROM skill_state_events
        WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version
    ) THEN RAISE(ABORT, 'Lifecycle transition must be the next committed sequence') END;
END;

CREATE TRIGGER IF NOT EXISTS skills_no_update BEFORE UPDATE ON skills
BEGIN SELECT RAISE(ABORT, 'Skill identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS skills_no_delete BEFORE DELETE ON skills
BEGIN SELECT RAISE(ABORT, 'Skill identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_versions_no_update BEFORE UPDATE ON skill_versions
BEGIN SELECT RAISE(ABORT, 'Skill versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_versions_no_delete BEFORE DELETE ON skill_versions
BEGIN SELECT RAISE(ABORT, 'Skill versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_state_events_no_update BEFORE UPDATE ON skill_state_events
BEGIN SELECT RAISE(ABORT, 'Lifecycle history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS skill_state_events_no_delete BEFORE DELETE ON skill_state_events
BEGIN SELECT RAISE(ABORT, 'Lifecycle history is append-only'); END;
