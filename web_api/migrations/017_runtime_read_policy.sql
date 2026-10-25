-- Web-only explicit bounded read authority. Original Core schemas are unchanged.
CREATE TABLE runtime_read_policies (
 policy_sha256 TEXT PRIMARY KEY NOT NULL CHECK(length(policy_sha256)=64),
 project_id TEXT NOT NULL,
 policy_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_read_authority (
 authority_id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id TEXT NOT NULL,
 policy_sha256 TEXT REFERENCES runtime_read_policies(policy_sha256),
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_read_admissions (
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES runtime_jobs(job_id),
 authority_id INTEGER NOT NULL REFERENCES runtime_read_authority(authority_id),
 policy_sha256 TEXT NOT NULL REFERENCES runtime_read_policies(policy_sha256),
 created_at TEXT NOT NULL
);
CREATE TABLE runtime_read_approvals (
 dispatch_id TEXT PRIMARY KEY NOT NULL REFERENCES runtime_dispatches(dispatch_id),
 job_id TEXT NOT NULL UNIQUE REFERENCES runtime_read_admissions(job_id),
 authority_id INTEGER NOT NULL REFERENCES runtime_read_authority(authority_id),
 policy_sha256 TEXT NOT NULL REFERENCES runtime_read_policies(policy_sha256),
 proposal_id TEXT NOT NULL UNIQUE,
 approved_plan_sha256 TEXT NOT NULL CHECK(length(approved_plan_sha256)=64),
 planning_worker TEXT NOT NULL,
 planning_exit_observation_id INTEGER NOT NULL REFERENCES runtime_worker_observations(observation_id),
 created_at TEXT NOT NULL
);
CREATE TRIGGER runtime_read_admission_identity BEFORE INSERT ON runtime_read_admissions
 WHEN NOT EXISTS(SELECT 1 FROM runtime_read_authority a JOIN runtime_jobs j
  ON json_extract(j.identity_json,'$.projectId')=a.project_id
  WHERE a.authority_id=NEW.authority_id AND a.policy_sha256=NEW.policy_sha256 AND j.job_id=NEW.job_id)
 BEGIN SELECT RAISE(ABORT,'read admission identity mismatch'); END;
CREATE TRIGGER runtime_read_approval_identity BEFORE INSERT ON runtime_read_approvals
 WHEN NOT EXISTS(SELECT 1 FROM runtime_dispatches d JOIN runtime_read_admissions a ON a.job_id=d.job_id
  WHERE d.dispatch_id=NEW.dispatch_id AND d.job_id=NEW.job_id
  AND d.proposal_id=NEW.proposal_id AND d.approved_plan_sha256=NEW.approved_plan_sha256
  AND a.policy_sha256=NEW.policy_sha256 AND a.authority_id=NEW.authority_id)
 OR NOT EXISTS(SELECT 1 FROM runtime_worker_claims c JOIN runtime_worker_observations o
  ON o.job_id=c.job_id AND o.worker_identity=c.worker_identity
  WHERE c.job_id=NEW.job_id AND c.phase='planning' AND c.worker_identity=NEW.planning_worker
  AND o.observation_id=NEW.planning_exit_observation_id AND o.kind='EXIT_OBSERVED'
  AND json_extract(o.detail_json,'$.phase')='planning' AND json_extract(o.detail_json,'$.exitCode')=0)
 BEGIN SELECT RAISE(ABORT,'read policy approval identity mismatch'); END;
