# Evidence-gated Skill evolution

Phase 3 / Step 4 adds opt-in governance to the existing immutable registry.
It does not replace Runner, Skill Binding, Shadow Evaluation, Acceptance,
Inspector, Checkpoint or Recovery. The normal tool execution boundary and
Crash Window B are unchanged.

## Explicit setup and authority

Initialize in order: `connect_database`, `initialize_skill_schema`,
`initialize_skill_binding_schema`, `initialize_skill_planning_schema`,
`initialize_agent_episode_schema`, `initialize_checkpoint_schema`,
`initialize_recovery_schema`, `initialize_skill_trust_schema`,
`initialize_skill_evolution_schema`. Imports and read APIs never migrate.

All public evolution APIs are available from `axis_evo.skill_evolution`.
Writers own their short transaction and reject an active caller transaction.
Readers are logically read-only and support `PRAGMA query_only=ON`.

`enable_evolution_governance(connection, governance_policy)` permanently records
`EVIDENCE_GATED` through supported APIs. Its exact policy has these fields:

```python
{
    "policy_id": "evolution-gate-v1",
    "suite_id": "caller-reviewed-suite",
    "suite_sha256": suite.fact_sha256,
    "minimum_eligible_cases": 5,
    "repetitions_per_case": 1,
}
```

An absent 010 schema preserves legacy behavior; a partial/weak/shadowed schema
fails closed. Existing TRUSTED versions are closed-pinned at enablement so an
explicit later selection can return to them. New TRUSTED transitions require
a gated receipt. Supported disable/rebind/update APIs do not exist.

## Revision and candidate APIs

```python
case = create_evolution_case(connection, source_ref,
    {"assessment_id": exact_source_assessment_id}, objective)
intent = reserve_revision_intent(connection, case.data["case_id"], draft)
revision = record_revision_proposal(connection, intent.data["revision_id"])
approve_skill_revision(connection, revision.data["revision_id"], revision.fact_sha256)
candidate = materialize_skill_candidate(connection, revision.data["revision_id"])
manager.promote(candidate.skill_id, candidate.skill_version, "SHADOW")
```

`create_revision_proposal(connection, case_id, draft)` is a convenience wrapper
over the two explicit intent/result transactions. Failure of result publication
preserves the committed intent; it never automatically replays it.
`get_revision_proposal(connection, revision_id)` verifies exact stored bytes.

Draft keys are exactly `name`, `description`, `instructions`, `allowed_tools`,
`change_summary`, `reason_codes`, `supporting_evidence_ids`, `declared_risks`,
`expected_behavior_change`. Lists contain exact strings. Evidence IDs must
belong to the case. Current SkillCard rules apply. Total canonical draft is
bounded to 64 KiB; each textual field is bounded to 32 KiB; each auxiliary list
has at most 64 entries. The source Assessment must cover all current verified
historical evidence when creating the case. Historical UNKNOWN remains context,
with attribution INDETERMINATE; it is not evidence of a Skill defect.

Revision Intent commits separately. The result pins its exact input, parent
SkillRef, Card hash and proposed content. Caller-owned input is detached.
Returned `EvolutionFact` is frozen; `.data` returns a fresh JSON-native copy.
Each complete evolution fact is bounded to 2 MiB; oversized historical manifests
are rejected rather than truncated.
`fact_sha256` is SHA-256 of the exact stored canonical JSON UTF-8 bytes, including
fact identity and audit metadata. Approval requires that exact lowercase digest.

Capability expansion is recorded as `CAPABILITY_EXPANSION_REQUIRED` and cannot
materialize. A candidate uses the same logical Skill identity and exact DERIVED
parent. Existing continuous version allocation and candidate receipt share
SkillManager's original BEGIN IMMEDIATE/COMMIT. Failure leaves no version gap.
Candidate/SHADOW versions cannot use the unchanged TRUSTED production path.
Model-assisted drafting is not implemented; no live drafting provider is called.

## Gate, approval and atomic promotion

```python
gate = evaluate_evolution_gate(connection, candidate.ref, assessment_id)
proposal = propose_skill_promotion(connection, case.data["case_id"],
    candidate.ref, assessment_id)
approve_skill_promotion(connection, proposal.data["proposal_id"], proposal.fact_sha256)
event = promote_evaluated_skill(connection, proposal.data["proposal_id"], proposal.fact_sha256)
```

Gate v1 requires the pinned closed Suite, at least five independently specified
cases, exactly one reference/candidate pair per case, eligible reference outcomes,
all candidate outcomes SIMULATED_PASS and zero regressions. Exact direct parent,
Cards, lifecycle prefixes, tool permissions, Comparison, Assessment, Oracle and
full Trial census are reverified. Extra retries of any outcome cannot be omitted.
Candidate trials from another Suite also block this closed v1 protocol. Repetition
counts other than one are unsupported. Capability reduction remains INCOMPARABLE
because the frozen Comparison requires equal tool sets.

Public execution-evidence inspection finishes before BEGIN IMMEDIATE. Under that
write lock the complete reference/candidate snapshots must remain identical, the
Assessment must cover current complete history, and all immutable evaluation
facts and census are rechecked. The proposal pins that complete manifest.
Legal new evidence makes approval stale; corruption blocks integrity. Neither
`NO_REGRESSION_OBSERVED` nor an approval row alone proves promotion occurred.

The old supported `manager.promote(..., "TRUSTED")` route checks governance
inside its original write transaction. Optional `evolution_authorization` is
exactly `{"proposal_id": id, "approved_promotion_sha256": digest}`; it executes
the same fixed verifier, not a callback or caller gate claim. TRUSTED lifecycle
event and unique receipt commit together. Approval consumption is derived from
the append-only receipt, never from mutating an approval. Replays and competing
writers cannot consume one revision/candidate twice. No automatic retry follows
an uncertain outcome.

## Activation and inspection

```python
selection = propose_skill_activation(connection, candidate.ref,
    expected_previous_event_id=previous_event_id, reason="explicit selection")
approve_skill_activation(connection, selection.data["activation_id"], selection.fact_sha256)
activate_approved_skill(connection, selection.data["activation_id"], selection.fact_sha256)
preferred = resolve_preferred_skill(connection, candidate.skill_id)
report = inspect_skill_evolution(connection, case.data["case_id"])
```

No activation event means no preferred selection (`None`). The default previous
ID of `None` explicitly asserts an empty prefix. Later proposals pin the exact
previous event ID, sequence and digest. A→B→A cannot revive an old approval.
Selecting an old eligible TRUSTED version appends a new event; it does not undo
TRUSTED history, modify existing Runs/Plans, quarantine a version or cancel work.
The resolver never implicitly chooses the latest version.

Inspection reports exact source evidence, revisions/approvals, candidate Cards
and lifecycle, pinned promotion gates/receipts, activation events, preferred
selection, unresolved prefixes and integrity issues. A successful promotion is
verified against its historical approved gate; legal later evidence does not
rewrite that past decision. The subsystem has no automatic revocation policy.
Corrupted pinned facts still fail verification. Inspection brackets independent
execution inspection with identical committed reports and snapshots, performs
no model call or application write, and never repairs corruption. SQLite internal
WAL/SHM coordination is permitted; no `immutable=1` shortcut is used.

## Storage and research limits

010 has twelve append-only fact tables for governance, cases, revision intents,
proposals, approvals, candidates, promotion proposals/approvals/receipts and
activation proposals/approvals/events. New-table-only triggers reject UPDATE,
DELETE and INSERT OR REPLACE across all unique consumption identities. Foreign
keys bind actual historical Cards and lifecycle events. No historical table,
schema or migration is changed.

This boundary protects supported current APIs, not an SQLite owner who fabricates
the entire history or replaces code/old binaries. Digest submission is explicit
trusted caller approval, not authenticated human review. Static plans demonstrate
the protocol, not autonomous improvement, semantic obedience or absence of model
error. Case independence comes from benchmark design; hashes do not prove it.
SQLite does not atomically transact external files. No new Recovery algorithm,
compensation, runtime revocation, autonomous replanning or next milestone is added.

The public `examples/skill_evolution.py` creates its own transparent toy tasks
and public expectations. It does not include the private benchmark or hidden
Oracle answers. Full independent negative/fault evidence stays in the review ZIP
under the repository's publication policy.

## Public verification and reproduction

### Current protocol reproduction

Frozen baseline: `c9a83b6912f130a2cefe978995ada8cc272da389`. The tested source
commit and final remote identity are recorded in `TEST_RESULTS.md` in this docs directory and the
private `REVIEW_MANIFEST.txt`; execution-time HEAD and raw source/test hashes
are retained separately. A working-tree test result is not attributed to a
future commit before its bytes have been compared.

The new opt-in APIs and exact policy are documented in
this document. With a fresh output directory:

```powershell
git clone https://github.com/startuo/Axis-EVO.git
Set-Location Axis-EVO
$env:PYTHONPATH = (Join-Path (Get-Location) 'src')
python examples/skill_evolution.py .local/evolution-demo
```

This public example uses five transparent, independently specified toy tasks.
It records deterministic caller drafting, exact revision approval, immutable
candidate creation, isolated paired Shadow Trials, gate eligibility, separate
promotion approval, an atomic TRUSTED event/receipt, explicit activation, and an
approved Plan executed by the original Runner. It checks output bytes and the
read-only evidence report. It requires no private fixture, provider credential,
or model network call. Its preset adapter does not demonstrate autonomous Skill
improvement or model obedience. Reusing an output directory is rejected.

Governance must be explicitly enabled. An absent 010 schema preserves legacy
behavior; enabled governance blocks the supported direct TRUSTED promotion route.
It cannot be disabled through supported APIs. New schemas do not change historical
DDL. Activation is a separate exact-digest approval; selecting an older eligible
version changes future routing only. Existing Runs remain pinned.

The full private tests, hidden Oracles, fault harnesses, frozen baseline source
and raw evidence are in `axis-evo-phase3-step4-review.zip`, excluded from public
Git by AGENTS.md. An authorized reviewer must check the manifest hashes, overlay
the review tests/fixtures onto a clone of its specified source commit, then run:

```powershell
python -m pip install -e '.[test]'
python -m pytest -q tests/unit/test_skill_evolution.py
python -m pytest -q tests/integration/test_skill_evolution_storage.py
python -m pytest -q tests/integration/test_skill_evolution_flow.py
python -m pytest -q tests/integration/test_skill_evolution_activation.py
python -m pytest -q tests/integration/test_skill_evolution_faults.py
python -m pytest -q tests/experiments/test_skill_evolution_baseline.py
python -m pytest -q tests/experiments/test_skill_evolution_metrics.py
python -m pytest -q
```

Historical fault tests require Git metadata; a bare extracted ZIP is not claimed
to run that frozen harness unchanged. Runtime-specific raw logs, JUnit results,
warnings and skip reasons are kept in the private archive. Windows symlink cases
require OS privilege; FIFO requires POSIX. No fresh Linux result or remote CI run
is claimed. Tested Python versions and actual measured counts are in
`TEST_RESULTS.md` in this docs directory. No LICENSE or GitHub Actions workflow was added.

Arbitrary SQLite-owner fabrication, replaced binaries and hostile OS escape are
outside this application boundary. UNKNOWN does not imply causality, Skill blame,
retry permission or automatic revocation. The step adds no new Recovery decision.
