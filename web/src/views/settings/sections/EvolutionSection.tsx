/** Skill 进化策略：off / observe / auto，调用 skills-mcp 的 skill.setPolicy。 */
import { useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { Settings, Workspace } from '@axis/protocol';
import { useToast } from '../../../components/Toasts';
import { errorMessage } from '../../../lib/format';
import type { useSocket } from '../../../hooks/useSocket';
import { EmptyHint, Field, SectionHeader, Select } from '../ui';

type Policy = Settings['evolutionPolicy'];

const OPTIONS: { value: Policy; title: string; desc: string }[] = [
  { value: 'off', title: '关闭', desc: '不记录使用反馈，也不生成候选技能。技能库保持静态。' },
  { value: 'observe', title: '观察', desc: '记录反馈并生成候选版本，但必须经人工审核确认后才会采纳。推荐默认。' },
  { value: 'auto', title: '自动', desc: '对通过评估检查的候选自动采纳为新版本，无需人工介入。' },
];

export interface EvolutionSectionProps {
  settings: Settings | null;
  refreshSettings: () => Promise<Settings>;
  request: ReturnType<typeof useSocket>['request'];
  pythonWorkspaces?: Workspace[];
}

export function EvolutionSection({ settings, refreshSettings, request, pythonWorkspaces }: EvolutionSectionProps) {
  const toast = useToast();
  const [pending, setPending] = useState<Policy | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const workspace = pythonWorkspaces?.find((item) => item.id === workspaceId) ?? pythonWorkspaces?.[0];
  const current = (pythonWorkspaces ? workspace?.evolutionPolicy : settings?.evolutionPolicy) ?? 'observe';

  const choose = async (policy: Policy) => {
    if (policy === current || pending || (pythonWorkspaces && !workspace)) return;
    setPending(policy);
    try {
      await request('skill.setPolicy', { policy, ...(workspace ? { workspaceId: workspace.id } : {}) });
      if (!pythonWorkspaces) await refreshSettings();
      toast.push('success', '进化策略已更新');
    } catch (e) {
      toast.push('error', `更新失败：${errorMessage(e)}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="set-section" aria-label="Skill 进化策略">
      <SectionHeader icon={Sparkles} title="Skill 进化策略" description={pythonWorkspaces
        ? '为所选工作区设置技能演进策略。候选采纳受该工作区的评估规则约束。'
        : '控制技能如何根据使用反馈自我演进。策略与技能库视图共享同一设置，实时同步。'} />
      {pythonWorkspaces && (workspace ? (
        <div className="set-card">
          <Field label="策略工作区">
            <Select aria-label="策略工作区" value={workspace.id} onChange={(event) => setWorkspaceId(event.target.value)}
              disabled={pending !== null}>
              {pythonWorkspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </Field>
        </div>
      ) : <EmptyHint>请先授权工作区。</EmptyHint>)}
      {(!pythonWorkspaces || workspace) && <div className="set-policy-grid" role="radiogroup" aria-label="进化策略">
        {OPTIONS.map((opt) => {
          const selected = current === opt.value;
          const isPending = pending === opt.value;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={selected}
              className={`set-policy-card${selected ? ' selected' : ''}`}
              onClick={() => void choose(opt.value)}
              disabled={pending !== null}
            >
              <span className="set-policy-title">
                {opt.title}
                {isPending && <LoaderCircle size={13} className="spin" aria-hidden />}
                {selected && !isPending && <span className="set-policy-check" aria-hidden>✓</span>}
              </span>
              <span className="set-policy-desc">{opt.desc}</span>
            </button>
          );
        })}
      </div>}
    </section>
  );
}
