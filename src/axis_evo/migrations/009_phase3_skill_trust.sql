CREATE TABLE IF NOT EXISTS shadow_suites (
    suite_id TEXT PRIMARY KEY NOT NULL,
    suite_version INTEGER NOT NULL CHECK(suite_version>0),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.suite_id') IS suite_id AND json_type(fact_json,'$.suite_id') IS CASE WHEN suite_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.suite_version') IS suite_version AND json_type(fact_json,'$.suite_version') IS CASE WHEN suite_version IS NULL THEN 'null' ELSE 'integer' END)
);

CREATE TRIGGER IF NOT EXISTS shadow_suites_no_replace BEFORE INSERT ON shadow_suites WHEN EXISTS(SELECT 1 FROM shadow_suites WHERE suite_id=NEW.suite_id) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS shadow_suites_no_update BEFORE UPDATE ON shadow_suites BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS shadow_suites_no_delete BEFORE DELETE ON shadow_suites BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS shadow_cases (
    case_key TEXT PRIMARY KEY NOT NULL,
    suite_id TEXT NOT NULL REFERENCES shadow_suites(suite_id),
    case_id TEXT NOT NULL,
    case_version INTEGER NOT NULL CHECK(case_version>0),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.case_key') IS case_key AND json_type(fact_json,'$.case_key') IS CASE WHEN case_key IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.suite_id') IS suite_id AND json_type(fact_json,'$.suite_id') IS CASE WHEN suite_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.case_id') IS case_id AND json_type(fact_json,'$.case_id') IS CASE WHEN case_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.case_version') IS case_version AND json_type(fact_json,'$.case_version') IS CASE WHEN case_version IS NULL THEN 'null' ELSE 'integer' END),
    UNIQUE(suite_id,case_id)
);

CREATE TRIGGER IF NOT EXISTS shadow_cases_no_replace BEFORE INSERT ON shadow_cases WHEN EXISTS(SELECT 1 FROM shadow_cases WHERE case_key=NEW.case_key OR (suite_id=NEW.suite_id AND case_id=NEW.case_id)) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS shadow_cases_no_update BEFORE UPDATE ON shadow_cases BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS shadow_cases_no_delete BEFORE DELETE ON shadow_cases BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS shadow_trial_intents (
    trial_id TEXT PRIMARY KEY NOT NULL,
    case_key TEXT NOT NULL REFERENCES shadow_cases(case_key),
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.trial_id') IS trial_id AND json_type(fact_json,'$.trial_id') IS CASE WHEN trial_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.case_key') IS case_key AND json_type(fact_json,'$.case_key') IS CASE WHEN case_key IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS CASE WHEN skill_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS CASE WHEN skill_version IS NULL THEN 'null' ELSE 'integer' END),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version)
);

CREATE TRIGGER IF NOT EXISTS shadow_trial_intents_no_replace BEFORE INSERT ON shadow_trial_intents WHEN EXISTS(SELECT 1 FROM shadow_trial_intents WHERE trial_id=NEW.trial_id) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_intents_no_update BEFORE UPDATE ON shadow_trial_intents BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_intents_no_delete BEFORE DELETE ON shadow_trial_intents BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS shadow_trial_results (
    trial_id TEXT PRIMARY KEY NOT NULL REFERENCES shadow_trial_intents(trial_id),
    result_id TEXT NOT NULL UNIQUE,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.trial_id') IS trial_id AND json_type(fact_json,'$.trial_id') IS CASE WHEN trial_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.result_id') IS result_id AND json_type(fact_json,'$.result_id') IS CASE WHEN result_id IS NULL THEN 'null' ELSE 'text' END)
);

CREATE TRIGGER IF NOT EXISTS shadow_trial_results_no_replace BEFORE INSERT ON shadow_trial_results WHEN EXISTS(SELECT 1 FROM shadow_trial_results WHERE trial_id=NEW.trial_id OR result_id=NEW.result_id) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_results_no_update BEFORE UPDATE ON shadow_trial_results BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_results_no_delete BEFORE DELETE ON shadow_trial_results BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS skill_comparisons (
    comparison_id TEXT PRIMARY KEY NOT NULL,
    suite_id TEXT NOT NULL REFERENCES shadow_suites(suite_id),
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.comparison_id') IS comparison_id AND json_type(fact_json,'$.comparison_id') IS CASE WHEN comparison_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.suite_id') IS suite_id AND json_type(fact_json,'$.suite_id') IS CASE WHEN suite_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS CASE WHEN skill_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS CASE WHEN skill_version IS NULL THEN 'null' ELSE 'integer' END),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version)
);

CREATE TRIGGER IF NOT EXISTS skill_comparisons_no_replace BEFORE INSERT ON skill_comparisons WHEN EXISTS(SELECT 1 FROM skill_comparisons WHERE comparison_id=NEW.comparison_id) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS skill_comparisons_no_update BEFORE UPDATE ON skill_comparisons BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS skill_comparisons_no_delete BEFORE DELETE ON skill_comparisons BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS skill_trust_assessments (
    assessment_id TEXT PRIMARY KEY NOT NULL,
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL,
    comparison_id TEXT REFERENCES skill_comparisons(comparison_id),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.assessment_id') IS assessment_id AND json_type(fact_json,'$.assessment_id') IS CASE WHEN assessment_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS CASE WHEN skill_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS CASE WHEN skill_version IS NULL THEN 'null' ELSE 'integer' END),
    CHECK(json_extract(fact_json,'$.comparison_id') IS comparison_id AND json_type(fact_json,'$.comparison_id') IS CASE WHEN comparison_id IS NULL THEN 'null' ELSE 'text' END),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version)
);

CREATE TRIGGER IF NOT EXISTS skill_trust_assessments_no_replace BEFORE INSERT ON skill_trust_assessments WHEN EXISTS(SELECT 1 FROM skill_trust_assessments WHERE assessment_id=NEW.assessment_id) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_assessments_no_update BEFORE UPDATE ON skill_trust_assessments BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_assessments_no_delete BEFORE DELETE ON skill_trust_assessments BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TABLE IF NOT EXISTS skill_trust_evidence_refs (
    ref_id TEXT PRIMARY KEY NOT NULL,
    assessment_id TEXT NOT NULL REFERENCES skill_trust_assessments(assessment_id),
    ordinal INTEGER NOT NULL CHECK(ordinal>=0),
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL,
    run_id TEXT REFERENCES runs(run_id),
    comparison_id TEXT REFERENCES skill_comparisons(comparison_id),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND json_type(fact_json,'$.schema_version') IS 'integer' AND json_extract(fact_json,'$.schema_version') IS 1),
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64 AND fact_sha256 NOT GLOB '*[^0-9a-f]*'),
    CHECK(json_extract(fact_json,'$.ref_id') IS ref_id AND json_type(fact_json,'$.ref_id') IS CASE WHEN ref_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.assessment_id') IS assessment_id AND json_type(fact_json,'$.assessment_id') IS CASE WHEN assessment_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.ordinal') IS ordinal AND json_type(fact_json,'$.ordinal') IS CASE WHEN ordinal IS NULL THEN 'null' ELSE 'integer' END),
    CHECK(json_extract(fact_json,'$.skill_id') IS skill_id AND json_type(fact_json,'$.skill_id') IS CASE WHEN skill_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.skill_version') IS skill_version AND json_type(fact_json,'$.skill_version') IS CASE WHEN skill_version IS NULL THEN 'null' ELSE 'integer' END),
    CHECK(json_extract(fact_json,'$.run_id') IS run_id AND json_type(fact_json,'$.run_id') IS CASE WHEN run_id IS NULL THEN 'null' ELSE 'text' END),
    CHECK(json_extract(fact_json,'$.comparison_id') IS comparison_id AND json_type(fact_json,'$.comparison_id') IS CASE WHEN comparison_id IS NULL THEN 'null' ELSE 'text' END),
    FOREIGN KEY(skill_id,skill_version) REFERENCES skill_versions(skill_id,skill_version),
    UNIQUE(assessment_id,ordinal),
    CHECK((run_id IS NULL) != (comparison_id IS NULL))
);

CREATE TRIGGER IF NOT EXISTS skill_trust_evidence_refs_no_replace BEFORE INSERT ON skill_trust_evidence_refs WHEN EXISTS(SELECT 1 FROM skill_trust_evidence_refs WHERE ref_id=NEW.ref_id OR (assessment_id=NEW.assessment_id AND ordinal=NEW.ordinal)) BEGIN SELECT RAISE(ABORT,'Immutable evaluation identity'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_evidence_refs_no_update BEFORE UPDATE ON skill_trust_evidence_refs BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_evidence_refs_no_delete BEFORE DELETE ON skill_trust_evidence_refs BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_evidence_refs_identity BEFORE INSERT ON skill_trust_evidence_refs WHEN NOT EXISTS(SELECT 1 FROM skill_trust_assessments a WHERE a.assessment_id=NEW.assessment_id AND a.skill_id=NEW.skill_id AND a.skill_version=NEW.skill_version) BEGIN SELECT RAISE(ABORT,'Foreign assessment evidence'); END;

CREATE TRIGGER IF NOT EXISTS shadow_cases_manifest_guard BEFORE INSERT ON shadow_cases
WHEN NOT EXISTS(SELECT 1 FROM shadow_suites s,json_each(s.fact_json,'$.cases') e WHERE s.suite_id=NEW.suite_id AND json_extract(e.value,'$.case_key') IS NEW.case_key AND json_extract(e.value,'$.case_id') IS NEW.case_id AND json_extract(e.value,'$.case_sha256') IS NEW.fact_sha256)
BEGIN SELECT RAISE(ABORT,'Case is outside closed suite manifest'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_intents_card_guard BEFORE INSERT ON shadow_trial_intents
WHEN NOT EXISTS(SELECT 1 FROM skill_versions v WHERE v.skill_id=NEW.skill_id AND v.skill_version=NEW.skill_version AND v.card_sha256 IS json_extract(NEW.fact_json,'$.card_sha256'))
BEGIN SELECT RAISE(ABORT,'Trial Card identity mismatch'); END;

CREATE TRIGGER IF NOT EXISTS shadow_trial_results_intent_guard BEFORE INSERT ON shadow_trial_results
WHEN NOT EXISTS(SELECT 1 FROM shadow_trial_intents i WHERE i.trial_id=NEW.trial_id AND i.fact_sha256 IS json_extract(NEW.fact_json,'$.intent_sha256'))
BEGIN SELECT RAISE(ABORT,'Result Intent digest mismatch'); END;

CREATE TRIGGER IF NOT EXISTS skill_comparisons_reference_guard BEFORE INSERT ON skill_comparisons
WHEN NOT EXISTS(SELECT 1 FROM skill_versions v WHERE v.skill_id IS json_extract(NEW.fact_json,'$.reference_skill_ref.skill_id') AND v.skill_version IS json_extract(NEW.fact_json,'$.reference_skill_ref.skill_version') AND v.card_sha256 IS json_extract(NEW.fact_json,'$.reference_card_sha256'))
BEGIN SELECT RAISE(ABORT,'Reference Skill identity mismatch'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_assessments_comparison_guard BEFORE INSERT ON skill_trust_assessments
WHEN NEW.comparison_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM skill_comparisons c WHERE c.comparison_id=NEW.comparison_id AND c.skill_id=NEW.skill_id AND c.skill_version=NEW.skill_version AND c.fact_sha256 IS json_extract(NEW.fact_json,'$.comparison_sha256'))
BEGIN SELECT RAISE(ABORT,'Assessment comparison identity mismatch'); END;

CREATE TRIGGER IF NOT EXISTS skill_trust_evidence_refs_manifest_guard BEFORE INSERT ON skill_trust_evidence_refs
WHEN NOT EXISTS(SELECT 1 FROM skill_trust_assessments a,json_each(a.fact_json,'$.evidence_refs') e WHERE a.assessment_id=NEW.assessment_id AND json(e.value)=json(NEW.fact_json))
BEGIN SELECT RAISE(ABORT,'Evidence reference is outside closed assessment manifest'); END;
