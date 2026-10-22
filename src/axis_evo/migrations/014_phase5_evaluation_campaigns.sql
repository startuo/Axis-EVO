CREATE TABLE IF NOT EXISTS evaluation_policy_scopes (
    policy_id TEXT PRIMARY KEY NOT NULL CHECK(policy_id='evolution-gate-v2'),
    governance_id TEXT NOT NULL CHECK(governance_id='enabled'),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_extract(fact_json,'$.schema_version') IS 1 AND json_type(fact_json,'$.schema_version') IS 'integer'),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(governance_id) REFERENCES evolution_governance(governance_id),
    CHECK(json_extract(fact_json,'$.policy_id') IS policy_id AND json_extract(fact_json,'$.governance_id') IS governance_id)
);
CREATE TRIGGER IF NOT EXISTS evaluation_policy_scopes_no_replace BEFORE INSERT ON evaluation_policy_scopes
WHEN EXISTS(SELECT 1 FROM evaluation_policy_scopes WHERE policy_id=NEW.policy_id)
BEGIN SELECT RAISE(ABORT,'campaign policy already exists'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_policy_scopes_no_update BEFORE UPDATE ON evaluation_policy_scopes
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_policy_scopes_no_delete BEFORE DELETE ON evaluation_policy_scopes
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;

CREATE TABLE IF NOT EXISTS evaluation_campaigns (
    campaign_id TEXT PRIMARY KEY NOT NULL,
    policy_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK(typeof(skill_version)='integer' AND skill_version>0),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_extract(fact_json,'$.schema_version') IS 1 AND json_type(fact_json,'$.schema_version') IS 'integer'),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(skill_id,skill_version),
    FOREIGN KEY(policy_id) REFERENCES evaluation_policy_scopes(policy_id),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    CHECK(json_extract(fact_json,'$.campaign_id') IS campaign_id AND json_extract(fact_json,'$.policy_id') IS policy_id
      AND json_extract(fact_json,'$.skill_id') IS skill_id AND json_extract(fact_json,'$.skill_version') IS skill_version)
);
CREATE TRIGGER IF NOT EXISTS evaluation_campaigns_no_replace BEFORE INSERT ON evaluation_campaigns
WHEN EXISTS(SELECT 1 FROM evaluation_campaigns WHERE campaign_id=NEW.campaign_id OR (skill_id=NEW.skill_id AND skill_version=NEW.skill_version))
BEGIN SELECT RAISE(ABORT,'candidate campaign already exists'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_campaigns_prospective BEFORE INSERT ON evaluation_campaigns
WHEN EXISTS(SELECT 1 FROM shadow_trial_intents WHERE skill_id=NEW.skill_id AND skill_version=NEW.skill_version)
 OR EXISTS(SELECT 1 FROM json_each(NEW.fact_json,'$.slots') s JOIN shadow_trial_intents t ON t.trial_id=json_extract(s.value,'$.trial_id'))
BEGIN SELECT RAISE(ABORT,'campaign must precede every candidate and declared Trial'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_campaigns_no_update BEFORE UPDATE ON evaluation_campaigns
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_campaigns_no_delete BEFORE DELETE ON evaluation_campaigns
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;

CREATE TABLE IF NOT EXISTS evaluation_dispatches (
    claim_id TEXT PRIMARY KEY NOT NULL,
    campaign_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('EVALUATE','TRIAL','FINALIZE')),
    slot_id TEXT NOT NULL CHECK(length(slot_id)>0),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_extract(fact_json,'$.schema_version') IS 1 AND json_type(fact_json,'$.schema_version') IS 'integer'),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(campaign_id,phase,slot_id),
    FOREIGN KEY(campaign_id) REFERENCES evaluation_campaigns(campaign_id),
    CHECK(json_extract(fact_json,'$.claim_id') IS claim_id AND json_extract(fact_json,'$.campaign_id') IS campaign_id
      AND json_extract(fact_json,'$.phase') IS phase AND json_extract(fact_json,'$.slot_id') IS slot_id)
);
CREATE TRIGGER IF NOT EXISTS evaluation_dispatches_no_replace BEFORE INSERT ON evaluation_dispatches
WHEN EXISTS(SELECT 1 FROM evaluation_dispatches WHERE claim_id=NEW.claim_id OR (campaign_id=NEW.campaign_id AND phase=NEW.phase AND slot_id=NEW.slot_id))
BEGIN SELECT RAISE(ABORT,'campaign dispatch already claimed'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_dispatches_prospective BEFORE INSERT ON evaluation_dispatches
WHEN (NEW.phase='EVALUATE' AND (
 EXISTS(SELECT 1 FROM evaluation_dispatches WHERE campaign_id=NEW.campaign_id)
 OR EXISTS(SELECT 1 FROM evaluation_campaign_receipts WHERE campaign_id=NEW.campaign_id)
 OR EXISTS(SELECT 1 FROM evaluation_campaigns c, json_each(c.fact_json,'$.slots') s
   JOIN shadow_trial_intents t ON t.trial_id=json_extract(s.value,'$.trial_id') WHERE c.campaign_id=NEW.campaign_id)))
 OR (NEW.phase='TRIAL' AND (
 NOT EXISTS(SELECT 1 FROM evaluation_dispatches WHERE campaign_id=NEW.campaign_id AND phase='EVALUATE')
 OR EXISTS(SELECT 1 FROM evaluation_dispatches WHERE campaign_id=NEW.campaign_id AND phase='FINALIZE')
 OR EXISTS(SELECT 1 FROM shadow_trial_results WHERE trial_id=NEW.slot_id)
 OR NOT EXISTS(SELECT 1 FROM evaluation_campaigns c, json_each(c.fact_json,'$.slots') s
   JOIN shadow_trial_intents t ON t.trial_id=json_extract(s.value,'$.trial_id')
   WHERE c.campaign_id=NEW.campaign_id AND t.trial_id=NEW.slot_id
   AND t.fact_sha256=json_extract(NEW.fact_json,'$.proof.intent_sha256')
   AND json_extract(t.fact_json,'$.request_sha256')=json_extract(NEW.fact_json,'$.proof.request_sha256'))
 OR EXISTS(SELECT 1 FROM evaluation_campaigns c, json_each(c.fact_json,'$.slots') s
   WHERE c.campaign_id=NEW.campaign_id AND NOT EXISTS(
     SELECT 1 FROM shadow_trial_intents t WHERE t.trial_id=json_extract(s.value,'$.trial_id')))))
BEGIN SELECT RAISE(ABORT,'campaign dispatch must precede its model result'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_dispatches_no_update BEFORE UPDATE ON evaluation_dispatches
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_dispatches_no_delete BEFORE DELETE ON evaluation_dispatches
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;

CREATE TABLE IF NOT EXISTS evaluation_campaign_receipts (
    campaign_id TEXT PRIMARY KEY NOT NULL,
    comparison_id TEXT UNIQUE,
    assessment_id TEXT UNIQUE,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_extract(fact_json,'$.schema_version') IS 1 AND json_type(fact_json,'$.schema_version') IS 'integer'),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    FOREIGN KEY(campaign_id) REFERENCES evaluation_campaigns(campaign_id),
    FOREIGN KEY(comparison_id) REFERENCES skill_comparisons(comparison_id),
    FOREIGN KEY(assessment_id) REFERENCES skill_trust_assessments(assessment_id),
    CHECK((comparison_id IS NULL)=(assessment_id IS NULL)),
    CHECK(json_extract(fact_json,'$.campaign_id') IS campaign_id AND json_extract(fact_json,'$.comparison_id') IS comparison_id
      AND json_extract(fact_json,'$.assessment_id') IS assessment_id)
);
CREATE TRIGGER IF NOT EXISTS evaluation_campaign_receipts_no_replace BEFORE INSERT ON evaluation_campaign_receipts
WHEN EXISTS(SELECT 1 FROM evaluation_campaign_receipts WHERE campaign_id=NEW.campaign_id OR comparison_id=NEW.comparison_id OR assessment_id=NEW.assessment_id)
BEGIN SELECT RAISE(ABORT,'campaign evaluation already sealed'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_campaign_receipts_no_update BEFORE UPDATE ON evaluation_campaign_receipts
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_campaign_receipts_no_delete BEFORE DELETE ON evaluation_campaign_receipts
BEGIN SELECT RAISE(ABORT,'campaign facts are immutable'); END;
