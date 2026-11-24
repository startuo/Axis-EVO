/**
 * Skill detail pane (skills-mcp stream): instructions, immutable version
 * history, evolution timeline and the feedback form.
 */
import { useState } from 'react';
import { BookOpen, ChevronRight, History } from 'lucide-react';
import type { Skill, SkillEvolution } from '@axis/protocol';
import type { EvolutionEvidenceSummary, ProductEvolutionCycle, SkillVersionInfo } from './types';
import { EvolutionTimeline } from './EvolutionTimeline';
import { FeedbackForm } from './FeedbackForm';

export interface SkillDetailProps {
  skill: Skill;
  versions: SkillVersionInfo[];
  evolutions: SkillEvolution[];
  evidence: Record<string, EvolutionEvidenceSummary>;
  cycles?: ProductEvolutionCycle[];
  onRollback?: (version: number) => Promise<void>;
  onFeedbackSubmitted?: (evolutionId: string) => void;
}

const STATUS_CHIP: Record<Skill['status'], { text: string; chip: string }> = {
  active: { text: '活跃', chip: 'success' },
  candidate: { text: '候选', chip: 'info' },
  observing: { text: '观察中', chip: 'warn' },
  archived: { text: '已归档', chip: 'muted' },
};

const SOURCE_LABEL: Record<Skill['source'], string> = {
  workspace: '工作区',
  global: '全局目录',
  imported: '已导入',
  evolved: '进化产生',
};

const VERSION_STATUS: Record<SkillVersionInfo['status'], { text: string; chip: string }> = {
  candidate: { text: '候选', chip: 'info' },
  observing: { text: '观察中', chip: 'warn' },
  adopted: { text: '已采用', chip: 'success' },
  rejected: { text: '已拒绝', chip: 'danger' },
};

export function SkillDetail({ skill, versions, evolutions, evidence, cycles = [], onRollback, onFeedbackSubmitted }: SkillDetailProps) {
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState<number | null>(null);
  const [rollbackNotice, setRollbackNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const status = STATUS_CHIP[skill.status];
  const skillVersions = versions.filter(v => v.skillId === skill.id).sort((a, b) => b.version - a.version);
  const skillEvolutions = evolutions.filter(e => e.skillId === skill.id);
  const relatedCycles = cycles.filter(cycle => cycle.skillId === skill.id
    || cycle.result?.candidate?.skillId === skill.id || skillVersions.some(version => version.cycleId === cycle.id)
    || cycle.facts.some(fact => {
      const reference = fact.kind === 'skill_candidate_intent' ? fact.payload.referenceSkill : null;
      return reference !== null && typeof reference === 'object' && 'skillId' in reference && reference.skillId === skill.id;
    }));
  const rollbackTo = async (version: number) => {
    if (!onRollback || rollbackBusy !== null) return;
    setRollbackBusy(version);
    setRollbackNotice(null);
    try {
      await onRollback(version);
      setRollbackNotice({ message: `后续任务将使用版本 v${version}` });
    } catch (error) {
      setRollbackNotice({ message: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setRollbackBusy(null);
    }
  };

  return (
    <div className="sk-detail" data-testid="skill-detail">
      <div className="sk-detail-head">
        <div>
          <h2 className="sk-detail-name">{skill.name}</h2>
          {skill.description && <p className="sk-detail-desc">{skill.description}</p>}
          <div className="sk-detail-meta">
            <span className={`chip ${status.chip}`}>{status.text}</span>
            <span className="chip muted">{SOURCE_LABEL[skill.source]}</span>
            <span className="sk-version">v{skill.version}</span>
            {skill.parentVersion !== undefined && <span className="sk-version">← v{skill.parentVersion}</span>}
            {skill.path && <span className="sk-hash" title={skill.path}>{skill.path}</span>}
          </div>
        </div>
      </div>

      <div className="sk-section">
        <div className="sk-section-title"><BookOpen size={13} aria-hidden /> 当前指令（v{skill.version}）</div>
        <pre className="sk-instructions">{skill.instructions}</pre>
        {skill.cardSha256 && <div className="sk-hash">card sha256 {skill.cardSha256}</div>}
      </div>

      <div className="sk-section">
        <div className="sk-section-title"><History size={13} aria-hidden /> 版本历史（不可变）</div>
        {skillVersions.length === 0 ? (
          <p className="sk-form-note">暂无版本记录。</p>
        ) : (
          <div className="sk-versions">
            {skillVersions.map(version => {
              const vs = VERSION_STATUS[version.status];
              const open = openVersion === version.version;
              return (
                <div key={version.version}>
                  <div className="sk-version-row">
                    <span className="sk-version">v{version.version}</span>
                    <span className={`chip ${vs.chip}`}>{vs.text}</span>
                    <span className="sk-version-origin">{version.origin}{version.parentVersion !== undefined ? ` / 父版本 v${version.parentVersion}` : ''}</span>
                    <span className="sk-version-date">{new Date(version.createdAt).toLocaleString()}</span>
                    <button
                      className="icon-button sk-version-toggle"
                      aria-label={`查看 v${version.version} ${version.instructions ? '指令' : '版本回执'}`}
                      aria-expanded={open}
                      onClick={() => setOpenVersion(open ? null : version.version)}
                    >
                      <ChevronRight size={14} className={`chev${open ? ' open' : ''}`} aria-hidden />
                    </button>
                    {onRollback && version.version !== skill.version && skill.rollbackVersions?.includes(version.version) && (
                      <button type="button" className="text-button" disabled={rollbackBusy !== null}
                        onClick={() => void rollbackTo(version.version)}>
                        {rollbackBusy === version.version ? '回退中…' : `回退至 v${version.version}`}
                      </button>
                    )}
                  </div>
                  {open && <pre className="sk-version-body">{version.instructions ?? `SHA-256 ${version.cardSha256}`}</pre>}
                </div>
              );
            })}
          </div>
        )}
        {rollbackNotice && <p className={rollbackNotice.error ? 'sk-form-error' : 'sk-form-note'}
          role={rollbackNotice.error ? 'alert' : 'status'}>{rollbackNotice.message}</p>}
      </div>

      <div className="sk-section">
        <div className="sk-section-title">进化时间线</div>
        <EvolutionTimeline evolutions={skillEvolutions} evidence={evidence} cycles={relatedCycles} />
      </div>

      <FeedbackForm skill={skill} onSubmitted={onFeedbackSubmitted} />
    </div>
  );
}

export default SkillDetail;
