import { runtimeRequest, RuntimeError, type SkillRef } from './runtime';

export type RevisionDraft = {
  name: string; description: string; instructions: string; allowed_tools: string[];
  change_summary: string; reason_codes: string[]; supporting_evidence_ids: string[];
  declared_risks: string[]; expected_behavior_change: string;
};
export type EvolutionFact = { id: string; projectId: string; kind: string; parentId: string | null;
  slot: string; sha256: string; createdAt: string; body: Record<string, unknown> };
export type EvolutionCaseSummary = { id: string; sha256: string; createdAt: string;
  sourceSkillRef: SkillRef; objective: string; origin: string };
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
export type EvolutionReport = { case: EvolutionFact; facts: EvolutionFact[]; limitations: string[]; attribution: string };
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
// The existing loopback bridge admits four connections. Keep evolution reads
// sequential so library/preview/polling cannot crowd out an approval or assets.
let readTail: Promise<void> = Promise.resolve();
let queuedReads = 0;
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  if (queuedReads >= 8) throw new RuntimeError('EVOLUTION_READ_BUSY', '演化读取队列已满，请稍后刷新。');
  queuedReads++;
  const previous = readTail;
  let release!: () => void;
  readTail = new Promise<void>(resolve => { release = resolve; });
  try {
    await previous;
    signal?.throwIfAborted();
    return await runtimeRequest<unknown>(path, { signal });
  } finally { queuedReads--; release(); }
}
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
      && Array.isArray(value.facts) && value.facts.length <= 256 && value.facts.every(f => fact(f, project)));
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
    const value = await runtimeRequest<unknown>(`${base(project)}/${path.map(encodeURIComponent).join('/')}`,
      { body, csrfToken: token });
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
