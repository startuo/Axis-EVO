import { runtimeRequest, RuntimeError } from './runtime';
import { record } from './evolution';

export type ResearchCondition = { total: number; passed: number; recordedNonpass: number; unknown: number; notSubmitted: number };
export type ResearchSnapshot = { experimentId: string; protocolSha256: string; sourceTreeSha256: string;
  datasetManifestSha256: string; caseRole: string; runKind: string; modelProfileSha256: string;
  conditions: Record<'A' | 'B' | 'C', ResearchCondition>; unknownAttempts: number; sealed: boolean };
export type ResearchReadinessData = { schemaVersion: number; mode: string; sourceTreeSha256: string;
  formalHoldoutStatus: string; livePilotStatus: string; experiments: ResearchSnapshot[]; browserExecutionAvailable: false };
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export async function readResearchReadiness(projectId: string, signal?: AbortSignal): Promise<ResearchReadinessData> {
  const raw: unknown = await runtimeRequest(`/projects/${encodeURIComponent(projectId)}/skill-evolution/research`, { signal });
  if (!record(raw) || raw.schemaVersion !== 1 || raw.mode !== 'READ_ONLY_RESEARCH_EVIDENCE'
      || !hash(raw.sourceTreeSha256) || typeof raw.formalHoldoutStatus !== 'string' || typeof raw.livePilotStatus !== 'string'
      || raw.browserExecutionAvailable !== false || !Array.isArray(raw.experiments) || raw.experiments.length > 8
      || !raw.experiments.every(e => record(e) && typeof e.experimentId === 'string' && hash(e.protocolSha256)
        && hash(e.sourceTreeSha256) && hash(e.datasetManifestSha256) && hash(e.modelProfileSha256)
        && typeof e.caseRole === 'string' && typeof e.runKind === 'string' && typeof e.sealed === 'boolean'
        && count(e.unknownAttempts) && record(e.conditions) && ['A', 'B', 'C'].every(key => {
          const condition = (e.conditions as Record<string, unknown>)[key];
          return record(condition) && ['total', 'passed', 'recordedNonpass', 'unknown', 'notSubmitted'].every(k => count(condition[k]))
            && condition.total === (condition.passed as number) + (condition.recordedNonpass as number)
              + (condition.unknown as number) + (condition.notSubmitted as number);
        }))) throw new RuntimeError('INVALID_RESEARCH_EVIDENCE', '研究快照结构或分母不匹配；未推断正式实验结果。');
  return raw as ResearchReadinessData;
}
