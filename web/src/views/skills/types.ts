/** View-local types for the skills stream (result shapes of skill.list etc.). */
import type { McpServer, Session, Skill, SkillCheck, SkillEvolution } from '@axis/protocol';

export interface SkillVersionInfo {
  skillId: string;
  version: number;
  instructions?: string;
  cardSha256: string;
  parentVersion?: number;
  status: 'candidate' | 'observing' | 'adopted' | 'rejected';
  origin: string;
  createdAt: string;
  cycleId?: string | null;
}

export interface ProductSkillVersion {
  skillId: string;
  version: number;
  cardSha256: string;
  source: { sourceId: string; path: string };
  state: string;
  preferred: boolean;
  createdAt: string;
  cycleId: string | null;
}

interface FixedCheckResult {
  name?: string;
  check?: { kind: string; value: string };
  referencePassed: boolean;
  candidatePassed: boolean;
  comparable?: boolean;
}

export interface ProductEvolutionCycle {
  id: string;
  skillId?: string | null;
  status: string;
  workerActive: boolean;
  facts: Array<{ kind: string; payload: Record<string, unknown> }>;
  result?: { candidate?: { skillId?: string; version?: number }; reasons?: string[] } | null;
  simLedger: {
    rationale: string | null;
    prediction: string | null;
    measuredOutcome: {
      status: string; eligible?: boolean; gateSha256?: string;
      checks?: FixedCheckResult[]; commandChecks?: FixedCheckResult[]; reasons?: string[];
      historicalCases?: Array<{ experienceId: string; reasons: string[]; checks: FixedCheckResult[]; commandChecks: FixedCheckResult[] }>;
    };
    modelAndBenchmark: {
      generationModel?: { modelId: string } | null;
      evaluationModel?: { modelId: string } | null;
      benchmarkRequestSha256?: string | null;
      checkOrigin?: string | null;
    };
  };
}

export interface EvolutionEvidenceSummary {
  checkResults: Array<{ check: SkillCheck; referencePass: boolean; candidatePass: boolean }>;
  sourceUsedBrowserMaterial: boolean;
  evidenceSha256: string;
}

export interface SkillListResult {
  skills: Skill[];
  evolutions: SkillEvolution[];
  versions: SkillVersionInfo[];
  evidence: Record<string, EvolutionEvidenceSummary>;
  policy: 'off' | 'observe' | 'auto';
  cycles?: ProductEvolutionCycle[];
}

export interface BrowserStatusResult {
  running: boolean;
  port: number;
  expectedExtensionVersion?: string;
  error?: string;
  instances: Array<{
    id: string; label: string; browser: string; version: string;
    extensionVersion?: string; extensionUpdateRequired: boolean; extensionId: string; connected: boolean;
  }>;
  bindings: Array<{
    id: string; instanceId: string; tabId: number; documentId: string; urlSha256: string;
    url: string; title: string; snapshotId: string | null; active: boolean;
  }>;
}

export interface BrowserTabsResult {
  attached: boolean;
  instances: BrowserStatusResult['instances'];
  tabs: Array<{ id: number; windowId: number; title: string; url: string; active: boolean; instanceId: string }>;
}

export type { McpServer, Session, Skill, SkillCheck, SkillEvolution };
