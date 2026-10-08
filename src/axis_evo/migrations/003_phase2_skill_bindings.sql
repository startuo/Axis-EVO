CREATE TABLE IF NOT EXISTS skill_invocation_bindings (
    run_id TEXT NOT NULL CHECK (typeof(run_id) = 'text' AND length(trim(run_id)) > 0 AND instr(run_id, char(0)) = 0),
    tool_call_id TEXT NOT NULL CHECK (typeof(tool_call_id) = 'text' AND length(trim(tool_call_id)) > 0 AND instr(tool_call_id, char(0)) = 0),
    step_id TEXT NOT NULL CHECK (typeof(step_id) = 'text' AND length(trim(step_id)) > 0 AND instr(step_id, char(0)) = 0),
    tool_name TEXT NOT NULL CHECK (typeof(tool_name) = 'text' AND length(trim(tool_name)) > 0 AND instr(tool_name, char(0)) = 0),
    arguments_sha256 TEXT NOT NULL CHECK (
        typeof(arguments_sha256) = 'text' AND length(arguments_sha256) = 64
        AND instr(arguments_sha256, char(0)) = 0 AND arguments_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    skill_id TEXT NOT NULL CHECK (
        typeof(skill_id) = 'text' AND length(skill_id) BETWEEN 1 AND 128
        AND instr(skill_id, char(0)) = 0 AND skill_id GLOB '[A-Za-z0-9]*'
        AND skill_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    card_sha256 TEXT NOT NULL CHECK (
        typeof(card_sha256) = 'text' AND length(card_sha256) = 64
        AND instr(card_sha256, char(0)) = 0 AND card_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    bound_state TEXT NOT NULL CHECK (bound_state = 'TRUSTED'),
    bound_at TEXT NOT NULL CHECK (typeof(bound_at) = 'text' AND length(trim(bound_at)) > 0 AND instr(bound_at, char(0)) = 0),
    PRIMARY KEY (run_id, tool_call_id),
    UNIQUE (run_id, step_id),
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_versions(skill_id, skill_version)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS skill_bindings_insert_guard BEFORE INSERT ON skill_invocation_bindings
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM skill_invocation_bindings WHERE run_id = NEW.run_id
            AND (tool_call_id = NEW.tool_call_id OR step_id = NEW.step_id)
    ) THEN RAISE(ABORT, 'Invocation or step already has a Skill binding') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM runs WHERE run_id = NEW.run_id AND status = 'RUNNING' AND ended_at IS NULL
    ) THEN RAISE(ABORT, 'Skill binding requires a RUNNING Run') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM events WHERE run_id = NEW.run_id AND tool_call_id = NEW.tool_call_id
    ) THEN RAISE(ABORT, 'Skill binding must precede invocation events') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM skill_versions WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version
            AND card_sha256 = NEW.card_sha256
    ) THEN RAISE(ABORT, 'Skill binding requires the recorded version and Card hash') END;
    SELECT CASE WHEN COALESCE((
        SELECT state FROM skill_state_events WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version
        ORDER BY transition_seq DESC LIMIT 1
    ), '') != 'TRUSTED' THEN RAISE(ABORT, 'Skill binding requires TRUSTED state') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM skill_versions AS v, json_each(v.card_json, '$.allowed_tools') AS tool
        WHERE v.skill_id = NEW.skill_id AND v.skill_version = NEW.skill_version
            AND json_valid(v.card_json) = 1 AND json_type(v.card_json, '$.allowed_tools') = 'array'
            AND tool.type = 'text' AND tool.value = NEW.tool_name
    ) THEN RAISE(ABORT, 'Tool is outside the recorded Skill allowlist') END;
END;

CREATE TRIGGER IF NOT EXISTS skill_bindings_no_update BEFORE UPDATE ON skill_invocation_bindings
BEGIN SELECT RAISE(ABORT, 'Skill invocation bindings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_bindings_no_delete BEFORE DELETE ON skill_invocation_bindings
BEGIN SELECT RAISE(ABORT, 'Skill invocation bindings are immutable'); END;
