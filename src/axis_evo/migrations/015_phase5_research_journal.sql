CREATE TABLE IF NOT EXISTS research_experiments (
    experiment_id TEXT PRIMARY KEY NOT NULL,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64)
);
CREATE TABLE IF NOT EXISTS research_submissions (
    slot_id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL REFERENCES research_experiments(experiment_id),
    trial_id TEXT NOT NULL UNIQUE REFERENCES shadow_trial_intents(trial_id),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64)
);
CREATE TABLE IF NOT EXISTS research_observations (
    slot_id TEXT PRIMARY KEY NOT NULL REFERENCES research_submissions(slot_id),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64)
);
CREATE TABLE IF NOT EXISTS research_seals (
    experiment_id TEXT PRIMARY KEY NOT NULL REFERENCES research_experiments(experiment_id),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64)
);
CREATE TRIGGER IF NOT EXISTS research_experiments_no_update BEFORE UPDATE ON research_experiments
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_experiments_no_delete BEFORE DELETE ON research_experiments
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_experiments_no_replace BEFORE INSERT ON research_experiments
WHEN EXISTS(SELECT 1 FROM research_experiments WHERE experiment_id=NEW.experiment_id)
BEGIN SELECT RAISE(ABORT,'research experiment already exists'); END;
CREATE TRIGGER IF NOT EXISTS research_submissions_no_update BEFORE UPDATE ON research_submissions
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_submissions_no_delete BEFORE DELETE ON research_submissions
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_submissions_no_replace BEFORE INSERT ON research_submissions
WHEN EXISTS(SELECT 1 FROM research_submissions WHERE slot_id=NEW.slot_id OR trial_id=NEW.trial_id)
BEGIN SELECT RAISE(ABORT,'research call cannot be replayed'); END;
CREATE TRIGGER IF NOT EXISTS research_submissions_prospective BEFORE INSERT ON research_submissions
WHEN EXISTS(SELECT 1 FROM research_seals WHERE experiment_id=NEW.experiment_id)
 OR EXISTS(SELECT 1 FROM shadow_trial_results WHERE trial_id=NEW.trial_id)
BEGIN SELECT RAISE(ABORT,'research call must precede its result and seal'); END;
CREATE TRIGGER IF NOT EXISTS research_observations_no_update BEFORE UPDATE ON research_observations
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_observations_no_delete BEFORE DELETE ON research_observations
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_observations_no_replace BEFORE INSERT ON research_observations
WHEN EXISTS(SELECT 1 FROM research_observations WHERE slot_id=NEW.slot_id)
BEGIN SELECT RAISE(ABORT,'research observation already exists'); END;
CREATE TRIGGER IF NOT EXISTS research_seals_no_update BEFORE UPDATE ON research_seals
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_seals_no_delete BEFORE DELETE ON research_seals
BEGIN SELECT RAISE(ABORT,'research facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_seals_no_replace BEFORE INSERT ON research_seals
WHEN EXISTS(SELECT 1 FROM research_seals WHERE experiment_id=NEW.experiment_id)
BEGIN SELECT RAISE(ABORT,'research experiment is already sealed'); END;
