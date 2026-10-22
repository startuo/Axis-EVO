import { runtimeRequest, RuntimeError, type SkillRef } from './runtime';

export type RevisionDraft = {
  name: string; description: string; instructions: string; allowed_tools: string[];
  change_summary: string; reason_codes: string[]; supporting_evidence_ids: string[];
  declared_risks: string[]; expected_behavior_change: string;
};
export type EvolutionFact = { id: string; projectId: string; kind: string; parentId: string | null;
  slot: string; sha256: string; createdAt: string; body: Record<string, unknown> };
export type EvolutionCaseSummary = { id: string; sha256: string; createdAt: string;
  sourceSkillRef: SkillRef; objective: string; origin: string; coreCaseId?: string | null };
export type EvolutionSkill = { skillRef: SkillRef; name: string; description: string; state: string;
  allowedTools: string[]; source: { kind: string; skill_id?: string; skill_version?: number };
  cardSha256: string; preferred: boolean; transitionCount: number; isConfiguredAnchor: boolean; activationHeadId: string | null };
export type EvolutionLibrary = { skills: EvolutionSkill[]; cases: EvolutionCaseSummary[];
  evolutionSchemaAvailable: boolean; allowEvolvedSkills: boolean; capability: string };
export type EvidencePreview = { sourceCard: { instructions: string; allowed_tools: string[] };
  state: string; cardSha256: string; evidenceSha256: string; attribution: string;
  integrityIssues: { code: string }[]; runs: { run_id: string; observed_outcome: string;
    source_evidence_sha256: string; attribution: string; integrity_status: string }[];
  recoveryLineages: unknown[]; limitations: string[] };
export type CampaignTrial = { trial_id: string; case_id: string; role: string | null; outcome: string;
  intent_sha256: string | null; result_sha256: string | null };
export type CampaignEvidence = { schemaVersion: number; campaignId: string; campaignSha256: string;
  policyId: string; policySha256: string; suiteId: string; suiteSha256: string;
  referenceSkillRef: SkillRef; candidateSkillRef: SkillRef; historicalContext: CampaignTrial[]; trials: CampaignTrial[];
  profile: { adapter_name: string; model_id: string; profile_id: string; profile_revision: number; config_sha256: string };
  sealed: boolean; complete: boolean; receiptSha256: string | null; assessmentId: string | null;
  dispatchClaimCount: number; unknownCount: number; heldoutImprovement: string };
export type GenerationEvidence = { skillRef: SkillRef; parentSkillRef: SkillRef | null; cardSha256: string;
  state: string; candidateReceiptSha256: string | null; evolutionCaseId: string | null;
  promotionReceiptSha256: string | null; promotionProposalSha256: string | null; policyId: string | null;
  heldoutImprovement: string };
export type EvolutionReport = { case: EvolutionFact; facts: EvolutionFact[]; limitations: string[]; attribution: string;
  lineage?: GenerationEvidence[]; campaigns?: CampaignEvidence[]; campaignPolicyEnabled?: boolean;
  activations?: { activationId: string; sha256: string; sequence: number; skillRef: SkillRef }[] };
export type RevisionGeneration = { intent: EvolutionFact; result: EvolutionFact | null;
  status: string; workerActive: boolean; drafts: EvolutionFact[] };

export function generationSource(value: RevisionGeneration): { instructions: string; allowed_tools: string[] } | null {
  try {
    const raw: unknown = JSON.parse(text(value.intent.body, 'requestJson'));
    if (!record(raw) || !record(raw.source_skill_card) || typeof raw.source_skill_card.instructions !== 'string'
        || !Array.isArray(raw.source_skill_card.allowed_tools)
        || !raw.source_skill_card.allowed_tools.every(tool => typeof tool === 'string')) return null;
    return { instructions: raw.source_skill_card.instructions, allowed_tools: raw.source_skill_card.allowed_tools as string[] };
  } catch { return null; }
}

const draftKeys = ['name', 'description', 'instructions', 'allowed_tools', 'change_summary',
  'reason_codes', 'supporting_evidence_ids', 'declared_risks', 'expected_behavior_change'];
const arrays = ['allowed_tools', 'reason_codes', 'supporting_evidence_ids', 'declared_risks'];
export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const ref = (value: unknown): value is SkillRef => record(value) && typeof value.skill_id === 'string'
  && typeof value.skill_version === 'number' && Number.isSafeInteger(value.skill_version) && value.skill_version > 0;
const nullableHash = (value: unknown) => value === null || hash(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const trial = (value: unknown) => record(value) && typeof value.trial_id === 'string'
  && typeof value.case_id === 'string' && (value.role === null || ['reference', 'candidate'].includes(String(value.role)))
  && typeof value.outcome === 'string' && nullableHash(value.intent_sha256) && nullableHash(value.result_sha256);
function campaign(value: unknown): value is CampaignEvidence {
  return record(value) && value.schemaVersion === 1 && typeof value.campaignId === 'string' && hash(value.campaignSha256)
    && value.policyId === 'evolution-gate-v2' && hash(value.policySha256) && typeof value.suiteId === 'string'
    && hash(value.suiteSha256) && ref(value.referenceSkillRef) && ref(value.candidateSkillRef)
    && record(value.profile) && typeof value.profile.adapter_name === 'string' && typeof value.profile.model_id === 'string'
    && typeof value.profile.profile_id === 'string' && count(value.profile.profile_revision) && hash(value.profile.config_sha256)
    && Array.isArray(value.trials) && value.trials.length <= 64 && value.trials.every(trial)
    && Array.isArray(value.historicalContext) && value.historicalContext.length <= 256 && value.historicalContext.every(trial)
    && typeof value.sealed === 'boolean' && typeof value.complete === 'boolean' && nullableHash(value.receiptSha256)
    && (value.assessmentId === null || typeof value.assessmentId === 'string') && count(value.dispatchClaimCount)
    && count(value.unknownCount) && value.heldoutImprovement === 'NOT_MEASURED';
}
function generations(value: unknown) {
  return Array.isArray(value) && value.length <= 100 && value.every(g => record(g) && ref(g.skillRef)
    && (g.parentSkillRef === null || ref(g.parentSkillRef)) && hash(g.cardSha256) && typeof g.state === 'string'
    && nullableHash(g.candidateReceiptSha256) && nullableHash(g.promotionReceiptSha256) && nullableHash(g.promotionProposalSha256)
    && (g.evolutionCaseId === null || typeof g.evolutionCaseId === 'string')
    && (g.policyId === null || typeof g.policyId === 'string') && g.heldoutImprovement === 'NOT_MEASURED');
}
export const text = (body: Record<string, unknown>, key: string) => typeof body[key] === 'string' ? body[key] as string : '';

export function validDraft(value: unknown): value is RevisionDraft {
  return record(value) && Object.keys(value).length === draftKeys.length
    && draftKeys.every(key => arrays.includes(key)
      ? Array.isArray(value[key]) && value[key].length <= 64 && value[key].every(v => typeof v === 'string')
      : typeof value[key] === 'string')
    && typeof value.instructions === 'string' && !!value.instructions.trim()
    && new TextEncoder().encode(JSON.stringify(value)).length <= 49152;
}

function fact(value: unknown, project: string): value is EvolutionFact {
  return record(value) && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)
    && value.projectId === project && typeof value.kind === 'string'
    && (value.parentId === null || typeof value.parentId === 'string')
    && hash(value.sha256) && typeof value.createdAt === 'string' && record(value.body);
}

function requireData<T>(value: unknown, valid: boolean): T {
  if (!valid) throw new RuntimeError('INVALID_EVOLUTION_DATA', '演化记录身份或结构不匹配；未自动使用其他记录。');
  return value as T;
}
const base = (project: string) => `/projects/${encodeURIComponent(project)}/skill-evolution`;
// Serialize this page's evidence reads and governance mutations. Expensive
// history validation must not compete with an approval's owned transaction.
let readTail: Promise<void> = Promise.resolve();
let queuedReads = 0;
async function queued<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (queuedReads >= 8) throw new RuntimeError('EVOLUTION_READ_BUSY', '演化读取队列已满，请稍后刷新。');
  queuedReads++;
  const previous = readTail;
  let release!: () => void;
  readTail = new Promise<void>(resolve => { release = resolve; });
  try {
    await previous;
    signal?.throwIfAborted();
    return await request();
  } finally { queuedReads--; release(); }
}
const read = (path: string, signal?: AbortSignal) => queued(() => runtimeRequest<unknown>(path, { signal }), signal);
export const evolutionApi = {
  async library(project: string, signal?: AbortSignal) {
    const value = await read(`${base(project)}/library`, signal);
    return requireData<EvolutionLibrary>(value, record(value) && Array.isArray(value.skills)
      && value.skills.length <= 100 && value.skills.every(s => record(s) && ref(s.skillRef) && hash(s.cardSha256)
        && typeof s.name === 'string' && typeof s.state === 'string' && Array.isArray(s.allowedTools)
        && s.allowedTools.every(t => typeof t === 'string') && typeof s.preferred === 'boolean')
      && Array.isArray(value.cases) && typeof value.evolutionSchemaAvailable === 'boolean'
      && typeof value.allowEvolvedSkills === 'boolean');
  },
  async preview(project: string, skill: SkillRef, signal?: AbortSignal) {
    const value = await read(`${base(project)}/evidence/${encodeURIComponent(skill.skill_id)}/${skill.skill_version}`, signal);
    return requireData<EvidencePreview>(value, record(value) && record(value.sourceCard)
      && typeof value.sourceCard.instructions === 'string' && hash(value.cardSha256)
      && hash(value.evidenceSha256) && Array.isArray(value.runs) && Array.isArray(value.integrityIssues));
  },
  async report(project: string, id: string, signal?: AbortSignal) {
    const value = await read(`${base(project)}/cases/${encodeURIComponent(id)}`, signal);
    return requireData<EvolutionReport>(value, record(value) && fact(value.case, project) && value.case.id === id
      && Array.isArray(value.facts) && value.facts.length <= 256 && value.facts.every(f => fact(f, project))
      && (value.lineage === undefined || generations(value.lineage))
      && (value.campaigns === undefined || Array.isArray(value.campaigns) && value.campaigns.length <= 8 && value.campaigns.every(campaign))
      && (value.campaignPolicyEnabled === undefined || typeof value.campaignPolicyEnabled === 'boolean')
      && (value.activations === undefined || Array.isArray(value.activations) && value.activations.length <= 256
        && value.activations.every(a => record(a) && typeof a.activationId === 'string' && hash(a.sha256) && count(a.sequence) && ref(a.skillRef))));
  },
  async generation(project: string, id: string, signal?: AbortSignal) {
    const value = await read(`${base(project)}/generations/${encodeURIComponent(id)}`, signal);
    return requireData<RevisionGeneration>(value, record(value) && fact(value.intent, project) && value.intent.id === id
      && (value.result === null || fact(value.result, project) && value.result.parentId === id)
      && typeof value.status === 'string' && typeof value.workerActive === 'boolean' && Array.isArray(value.drafts)
      && value.drafts.every(f => fact(f, project) && f.parentId === id)
      && (value.status !== 'VALID' || record(value.result) && record(value.result.body) && validDraft(value.result.body.draft)));
  },
  async mutate(project: string, path: string[], body: unknown, token: string) {
    const value = await queued(() => runtimeRequest<unknown>(`${base(project)}/${path.map(encodeURIComponent).join('/')}`,
      { body, csrfToken: token, timeoutMs: 60000 }));
    return requireData<EvolutionFact>(value, fact(value, project));
  },
};

export function instructionDiff(before: string, after: string): { kind: 'same' | 'removed' | 'added'; text: string }[] {
  const a = before.split('\n'), b = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return [...a.slice(0, prefix).map(text => ({ kind: 'same' as const, text })),
    ...a.slice(prefix, a.length - suffix).map(text => ({ kind: 'removed' as const, text })),
    ...b.slice(prefix, b.length - suffix).map(text => ({ kind: 'added' as const, text })),
    ...a.slice(a.length - suffix).map(text => ({ kind: 'same' as const, text }))];
}
