CREATE TABLE IF NOT EXISTS evolution_governance (
    governance_id TEXT PRIMARY KEY NOT NULL CHECK(governance_id='enabled'),
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.governance_id') IS governance_id AND json_type(fact_json,'$.governance_id') IS 'text'),
    CHECK(length(governance_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS evolution_governance_no_replace BEFORE INSERT ON evolution_governance
WHEN EXISTS(SELECT 1 FROM evolution_governance WHERE governance_id=NEW.governance_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS evolution_governance_no_update BEFORE UPDATE ON evolution_governance
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS evolution_governance_no_delete BEFORE DELETE ON evolution_governance
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS evolution_cases (
    case_id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL, skill_version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    CHECK(json_extract(fact_json,'$.case_id') IS case_id AND json_type(fact_json,'$.case_id') IS 'text'),
    CHECK(length(case_id)>0),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS 'text'),
    CHECK(length(skill_id)>0),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS 'integer'),
    CHECK(typeof(skill_version)='integer' AND skill_version>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS evolution_cases_no_replace BEFORE INSERT ON evolution_cases
WHEN EXISTS(SELECT 1 FROM evolution_cases WHERE case_id=NEW.case_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS evolution_cases_no_update BEFORE UPDATE ON evolution_cases
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS evolution_cases_no_delete BEFORE DELETE ON evolution_cases
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_revision_intents (
    revision_id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(case_id) REFERENCES evolution_cases(case_id),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_extract(fact_json,'$.case_id') IS case_id AND json_type(fact_json,'$.case_id') IS 'text'),
    CHECK(length(case_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_revision_intents_no_replace BEFORE INSERT ON skill_revision_intents
WHEN EXISTS(SELECT 1 FROM skill_revision_intents WHERE revision_id=NEW.revision_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_intents_no_update BEFORE UPDATE ON skill_revision_intents
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_intents_no_delete BEFORE DELETE ON skill_revision_intents
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_revision_proposals (
    revision_id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(revision_id) REFERENCES skill_revision_intents(revision_id),
    FOREIGN KEY(case_id) REFERENCES evolution_cases(case_id),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_extract(fact_json,'$.case_id') IS case_id AND json_type(fact_json,'$.case_id') IS 'text'),
    CHECK(length(case_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_revision_proposals_no_replace BEFORE INSERT ON skill_revision_proposals
WHEN EXISTS(SELECT 1 FROM skill_revision_proposals WHERE revision_id=NEW.revision_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_proposals_no_update BEFORE UPDATE ON skill_revision_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_proposals_no_delete BEFORE DELETE ON skill_revision_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_revision_approvals (
    revision_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(revision_id) REFERENCES skill_revision_proposals(revision_id),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_revision_approvals_no_replace BEFORE INSERT ON skill_revision_approvals
WHEN EXISTS(SELECT 1 FROM skill_revision_approvals WHERE revision_id=NEW.revision_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_approvals_no_update BEFORE UPDATE ON skill_revision_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_revision_approvals_no_delete BEFORE DELETE ON skill_revision_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_evolution_candidates (
    revision_id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL, skill_version INTEGER NOT NULL, transition_seq INTEGER NOT NULL CHECK(transition_seq=1),
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(skill_id,skill_version),
    FOREIGN KEY(revision_id) REFERENCES skill_revision_approvals(revision_id),
    FOREIGN KEY(skill_id,skill_version,transition_seq) REFERENCES skill_state_events(skill_id,skill_version,transition_seq),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS 'text'),
    CHECK(length(skill_id)>0),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS 'integer'),
    CHECK(typeof(skill_version)='integer' AND skill_version>0),
    CHECK(json_extract(fact_json,'$.transition_seq') IS transition_seq AND json_type(fact_json,'$.transition_seq') IS 'integer'),
    CHECK(typeof(transition_seq)='integer' AND transition_seq>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_evolution_candidates_no_replace BEFORE INSERT ON skill_evolution_candidates
WHEN EXISTS(SELECT 1 FROM skill_evolution_candidates WHERE revision_id=NEW.revision_id OR (skill_id=NEW.skill_id AND skill_version=NEW.skill_version))
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_evolution_candidates_no_update BEFORE UPDATE ON skill_evolution_candidates
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_evolution_candidates_no_delete BEFORE DELETE ON skill_evolution_candidates
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_promotion_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL, revision_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(revision_id) REFERENCES skill_evolution_candidates(revision_id),
    CHECK(json_extract(fact_json,'$.proposal_id') IS proposal_id AND json_type(fact_json,'$.proposal_id') IS 'text'),
    CHECK(length(proposal_id)>0),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_promotion_proposals_no_replace BEFORE INSERT ON skill_promotion_proposals
WHEN EXISTS(SELECT 1 FROM skill_promotion_proposals WHERE proposal_id=NEW.proposal_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_proposals_no_update BEFORE UPDATE ON skill_promotion_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_proposals_no_delete BEFORE DELETE ON skill_promotion_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_promotion_approvals (
    proposal_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(proposal_id) REFERENCES skill_promotion_proposals(proposal_id),
    CHECK(json_extract(fact_json,'$.proposal_id') IS proposal_id AND json_type(fact_json,'$.proposal_id') IS 'text'),
    CHECK(length(proposal_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_promotion_approvals_no_replace BEFORE INSERT ON skill_promotion_approvals
WHEN EXISTS(SELECT 1 FROM skill_promotion_approvals WHERE proposal_id=NEW.proposal_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_approvals_no_update BEFORE UPDATE ON skill_promotion_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_approvals_no_delete BEFORE DELETE ON skill_promotion_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_promotion_receipts (
    proposal_id TEXT PRIMARY KEY NOT NULL, revision_id TEXT NOT NULL UNIQUE, skill_id TEXT NOT NULL, skill_version INTEGER NOT NULL, transition_seq INTEGER NOT NULL CHECK(transition_seq=3),
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(skill_id,skill_version),
    FOREIGN KEY(proposal_id) REFERENCES skill_promotion_approvals(proposal_id),
    FOREIGN KEY(revision_id) REFERENCES skill_evolution_candidates(revision_id),
    FOREIGN KEY(skill_id,skill_version,transition_seq) REFERENCES skill_state_events(skill_id,skill_version,transition_seq),
    CHECK(json_extract(fact_json,'$.proposal_id') IS proposal_id AND json_type(fact_json,'$.proposal_id') IS 'text'),
    CHECK(length(proposal_id)>0),
    CHECK(json_extract(fact_json,'$.revision_id') IS revision_id AND json_type(fact_json,'$.revision_id') IS 'text'),
    CHECK(length(revision_id)>0),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS 'text'),
    CHECK(length(skill_id)>0),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS 'integer'),
    CHECK(typeof(skill_version)='integer' AND skill_version>0),
    CHECK(json_extract(fact_json,'$.transition_seq') IS transition_seq AND json_type(fact_json,'$.transition_seq') IS 'integer'),
    CHECK(typeof(transition_seq)='integer' AND transition_seq>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_promotion_receipts_no_replace BEFORE INSERT ON skill_promotion_receipts
WHEN EXISTS(SELECT 1 FROM skill_promotion_receipts WHERE proposal_id=NEW.proposal_id OR (skill_id=NEW.skill_id AND skill_version=NEW.skill_version) OR revision_id=NEW.revision_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_receipts_no_update BEFORE UPDATE ON skill_promotion_receipts
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_promotion_receipts_no_delete BEFORE DELETE ON skill_promotion_receipts
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_activation_proposals (
    activation_id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL, skill_version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    CHECK(json_extract(fact_json,'$.activation_id') IS activation_id AND json_type(fact_json,'$.activation_id') IS 'text'),
    CHECK(length(activation_id)>0),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS 'text'),
    CHECK(length(skill_id)>0),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS 'integer'),
    CHECK(typeof(skill_version)='integer' AND skill_version>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_activation_proposals_no_replace BEFORE INSERT ON skill_activation_proposals
WHEN EXISTS(SELECT 1 FROM skill_activation_proposals WHERE activation_id=NEW.activation_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_proposals_no_update BEFORE UPDATE ON skill_activation_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_proposals_no_delete BEFORE DELETE ON skill_activation_proposals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_activation_approvals (
    activation_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(activation_id) REFERENCES skill_activation_proposals(activation_id),
    CHECK(json_extract(fact_json,'$.activation_id') IS activation_id AND json_type(fact_json,'$.activation_id') IS 'text'),
    CHECK(length(activation_id)>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_activation_approvals_no_replace BEFORE INSERT ON skill_activation_approvals
WHEN EXISTS(SELECT 1 FROM skill_activation_approvals WHERE activation_id=NEW.activation_id)
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_approvals_no_update BEFORE UPDATE ON skill_activation_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_approvals_no_delete BEFORE DELETE ON skill_activation_approvals
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TABLE IF NOT EXISTS skill_activation_events (
    activation_id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL, skill_version INTEGER NOT NULL, activation_seq INTEGER NOT NULL CHECK(activation_seq>0),
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(skill_id,activation_seq),
    FOREIGN KEY(activation_id) REFERENCES skill_activation_approvals(activation_id),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    CHECK(json_extract(fact_json,'$.activation_id') IS activation_id AND json_type(fact_json,'$.activation_id') IS 'text'),
    CHECK(length(activation_id)>0),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS 'text'),
    CHECK(length(skill_id)>0),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS 'integer'),
    CHECK(typeof(skill_version)='integer' AND skill_version>0),
    CHECK(json_extract(fact_json,'$.activation_seq') IS activation_seq AND json_type(fact_json,'$.activation_seq') IS 'integer'),
    CHECK(typeof(activation_seq)='integer' AND activation_seq>0),
    CHECK(json_type(fact_json,'$.created_at') IS 'text' AND length(json_extract(fact_json,'$.created_at'))>0)
);

CREATE TRIGGER IF NOT EXISTS skill_activation_events_no_replace BEFORE INSERT ON skill_activation_events
WHEN EXISTS(SELECT 1 FROM skill_activation_events WHERE activation_id=NEW.activation_id OR (skill_id=NEW.skill_id AND activation_seq=NEW.activation_seq))
BEGIN SELECT RAISE(ABORT,'evolution fact identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_events_no_update BEFORE UPDATE ON skill_activation_events
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_activation_events_no_delete BEFORE DELETE ON skill_activation_events
BEGIN SELECT RAISE(ABORT,'evolution facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS skill_evolution_candidates_link BEFORE INSERT ON skill_evolution_candidates
WHEN NOT EXISTS(SELECT 1 FROM skill_versions v JOIN skill_state_events s USING(skill_id,skill_version)
 WHERE v.skill_id=NEW.skill_id AND v.skill_version=NEW.skill_version AND s.transition_seq=1 AND s.state='CANDIDATE'
 AND v.card_sha256=json_extract(NEW.fact_json,'$.card_sha256'))
BEGIN SELECT RAISE(ABORT,'candidate event/Card mismatch'); END;
CREATE TRIGGER IF NOT EXISTS skill_promotion_receipts_link BEFORE INSERT ON skill_promotion_receipts
WHEN NOT EXISTS(SELECT 1 FROM skill_evolution_candidates c JOIN skill_promotion_proposals p USING(revision_id)
 JOIN skill_state_events s ON s.skill_id=c.skill_id AND s.skill_version=c.skill_version
 WHERE p.proposal_id=NEW.proposal_id AND c.revision_id=NEW.revision_id AND c.skill_id=NEW.skill_id
 AND c.skill_version=NEW.skill_version AND s.transition_seq=3 AND s.state='TRUSTED'
 AND s.occurred_at=json_extract(NEW.fact_json,'$.transition_occurred_at'))
BEGIN SELECT RAISE(ABORT,'promotion event/candidate mismatch'); END;
CREATE TRIGGER IF NOT EXISTS skill_activation_events_link BEFORE INSERT ON skill_activation_events
WHEN NEW.activation_seq != COALESCE((SELECT MAX(activation_seq) FROM skill_activation_events WHERE skill_id=NEW.skill_id),0)+1
 OR NOT EXISTS(SELECT 1 FROM skill_state_events s JOIN skill_activation_proposals p ON p.skill_id=s.skill_id AND p.skill_version=s.skill_version
 WHERE p.activation_id=NEW.activation_id AND s.skill_id=NEW.skill_id AND s.skill_version=NEW.skill_version AND s.state='TRUSTED')
BEGIN SELECT RAISE(ABORT,'activation identity/sequence mismatch'); END;
