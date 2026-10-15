-- Web orchestration only. Never applied to the Core evidence database.
CREATE TABLE runtime_jobs (
 job_id TEXT PRIMARY KEY REFERENCES runtime_threads(id),
 identity_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN
 ('QUEUED','PLANNING','AWAITING_APPROVAL','DISPATCH_RESERVED','EXECUTING','FINISHED','FAILED','OUTCOME_UNKNOWN')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE runtime_dispatches (
 dispatch_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES runtime_jobs(job_id),
 proposal_id TEXT NOT NULL UNIQUE, approved_plan_sha256 TEXT NOT NULL,
 reserved_run_id TEXT NOT NULL UNIQUE, worker_identity TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
 CHECK(length(approved_plan_sha256)=64 AND approved_plan_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE TABLE runtime_worker_claims (
 job_id TEXT NOT NULL REFERENCES runtime_jobs(job_id), phase TEXT NOT NULL CHECK(phase IN ('planning','execution')),
 worker_identity TEXT NOT NULL UNIQUE, dispatch_id TEXT UNIQUE REFERENCES runtime_dispatches(dispatch_id),
 claimed_at TEXT NOT NULL, PRIMARY KEY(job_id,phase),
 CHECK((phase='planning' AND dispatch_id IS NULL) OR (phase='execution' AND dispatch_id IS NOT NULL)));
CREATE TABLE runtime_worker_observations (
 observation_id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES runtime_jobs(job_id),
 worker_identity TEXT, kind TEXT NOT NULL, detail_json TEXT NOT NULL, observed_at TEXT NOT NULL);
CREATE TRIGGER runtime_jobs_identity BEFORE UPDATE ON runtime_jobs
 WHEN NEW.job_id IS NOT OLD.job_id OR NEW.identity_json IS NOT OLD.identity_json OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'job identity is immutable'); END;
CREATE TRIGGER runtime_jobs_transition BEFORE UPDATE OF state ON runtime_jobs
 WHEN NEW.state != OLD.state AND NOT (
 (OLD.state='QUEUED' AND NEW.state IN ('PLANNING','FAILED')) OR
 (OLD.state='PLANNING' AND NEW.state IN ('AWAITING_APPROVAL','FAILED')) OR
 (OLD.state='AWAITING_APPROVAL' AND NEW.state='DISPATCH_RESERVED') OR
 (OLD.state='DISPATCH_RESERVED' AND NEW.state='EXECUTING') OR
 (OLD.state='EXECUTING' AND NEW.state IN ('FINISHED','FAILED')) OR
 (OLD.state NOT IN ('FINISHED','FAILED') AND NEW.state='OUTCOME_UNKNOWN') OR
 (OLD.state='OUTCOME_UNKNOWN' AND NEW.state='FINISHED'))
 BEGIN SELECT RAISE(ABORT,'invalid job transition'); END;
CREATE TRIGGER runtime_claim_identity BEFORE INSERT ON runtime_worker_claims
 WHEN NEW.phase='execution' AND NOT EXISTS (
 SELECT 1 FROM runtime_dispatches d JOIN runtime_threads t ON t.id=d.job_id
 WHERE d.dispatch_id=NEW.dispatch_id AND d.job_id=NEW.job_id AND d.worker_identity=NEW.worker_identity
 AND d.proposal_id=t.proposal_id AND d.approved_plan_sha256=t.approved_digest AND d.reserved_run_id=t.reserved_run_id)
 BEGIN SELECT RAISE(ABORT,'worker dispatch identity mismatch'); END;
