/**
 * Skills view (skills-mcp stream) — MOUNT POINT.
 *
 * Real data over the socket: skill.list (skills + evolution cycles + immutable
 * versions + hashed evidence summaries), skill.feedback, skill.setPolicy,
 * skill.import; live updates via skill.updated / evolution.updated events.
 * MCP management lives in the MCP tab (shared McpPanel, also imported by the
 * settings stream); Edge bridge management lives in the browser tab.
 *
 * The visible heading "技能库" is stable across all states (shell contract).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookOpen, FolderInput, Globe, LoaderCircle, Plug, RefreshCw } from 'lucide-react';
import type { Skill, SkillEvolution, Workspace } from '@axis/protocol';
import { useSocket, useSocketEvent, useSocketStatus } from '../../hooks/useSocket';
import { fadeUp, motionProps } from '../../lib/motion';
import { BrowserPanel } from './BrowserPanel';
import { SkillDetail } from './SkillDetail';
import type { EvolutionEvidenceSummary, ProductEvolutionCycle, ProductSkillVersion, SkillListResult, SkillVersionInfo } from './types';
import './skills.css';

type Tab = 'skills' | 'mcp' | 'browser';
const MOCK_UI = import.meta.env.MODE === 'test';
const FixtureMcpPanel = MOCK_UI ? lazy(() => import('./McpPanel').then(module => ({ default: module.McpPanel }))) : null;
const NO_WORKSPACES: Workspace[] = [];

const POLICY_OPTIONS: Array<{ value: 'off' | 'observe' | 'auto'; label: string; hint: string }> = [
  { value: 'off', label: '关闭', hint: '仅记录反馈，不生成候选' },
  { value: 'observe', label: '观察', hint: '生成候选并 A/B，保留供检查，不自动采用' },
  { value: 'auto', label: '自动', hint: '全部检查通过 + 有改善 + 无退步 + 评审无反对时自动采用' },
];

const STATUS_CHIP: Record<Skill['status'], { text: string; chip: string }> = {
  active: { text: '活跃', chip: 'success' },
  candidate: { text: '候选', chip: 'info' },
  observing: { text: '观察中', chip: 'warn' },
  archived: { text: '已归档', chip: 'muted' },
};

const SOURCE_LABEL: Record<Skill['source'], string> = {
  workspace: '工作区', global: '全局', imported: '导入', evolved: '进化',
};

export function SkillsView({ workspaces = NO_WORKSPACES }: { workspaces?: Workspace[] } = {}) {
  const { request } = useSocket();
  const socketStatus = useSocketStatus();
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [evolutions, setEvolutions] = useState<SkillEvolution[]>([]);
  const [versions, setVersions] = useState<SkillVersionInfo[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<SkillVersionInfo[]>([]);
  const [cycles, setCycles] = useState<ProductEvolutionCycle[]>([]);
  const [evidence, setEvidence] = useState<Record<string, EvolutionEvidenceSummary>>({});
  const [policy, setPolicy] = useState<'off' | 'observe' | 'auto'>('observe');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceChoice, setWorkspaceChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const workspaceId = workspaces.find(workspace => workspace.id === workspaceChoice)?.id ?? workspaces[0]?.id;
  const reloadNumber = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++reloadNumber.current;
    try {
      const result = await request<SkillListResult>('skill.list', workspaceId ? { workspaceId } : undefined);
      if (seq !== reloadNumber.current) return;
      setSkills(Array.isArray(result?.skills) ? result.skills : []);
      setEvolutions(Array.isArray(result?.evolutions) ? result.evolutions : []);
      setVersions(Array.isArray(result?.versions) ? result.versions : []);
      setCycles(result.cycles ?? []);
      setEvidence(result?.evidence ?? {});
      if (result?.policy) setPolicy(result.policy);
      setError(null);
    } catch (e) {
      if (seq === reloadNumber.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === reloadNumber.current) setLoading(false);
    }
  }, [request, workspaceId]);

  useEffect(() => {
    if (socketStatus === 'open') {
      setLoading(true);
      void refresh();
    }
    return () => { reloadNumber.current += 1; };
  }, [socketStatus, refresh]);

  useSocketEvent((e) => {
    if (e.type === 'skill.updated' || e.type === 'evolution.updated') void refresh();
  });

  const selected = useMemo(
    () => skills.find(s => s.id === selectedId) ?? skills[0] ?? null,
    [skills, selectedId],
  );
  const selectedWorkspace = selected?.workspaceId ?? workspaceId;
  const selectedSkillId = selected?.id;

  useEffect(() => {
    setSelectedVersions([]);
    if (!selectedSkillId || !selectedWorkspace || !selected?.workspaceId) return;
    let active = true;
    void request<{ versions: ProductSkillVersion[] }>('skill.versions',
      { workspaceId: selectedWorkspace, skillId: selectedSkillId }).then(
      data => {
        if (!active) return;
        setSelectedVersions(data.versions.map(version => ({
          skillId: version.skillId, version: version.version, cardSha256: version.cardSha256,
          status: version.preferred ? 'adopted' : version.state === 'SHADOW' ? 'observing' : 'candidate',
          origin: version.source.path, createdAt: version.createdAt, cycleId: version.cycleId,
        })));
      },
      reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { active = false; };
  }, [request, selectedSkillId, selectedWorkspace, selected?.workspaceId, selected?.version, cycles]);

  const rollback = async (target: number) => {
    if (!selectedSkillId || !selectedWorkspace) return;
    await request('skill.rollback', {
      workspaceId: selectedWorkspace, skillId: selectedSkillId, version: target,
      reason: `用户从版本历史选择 v${target} 作为后续任务版本`,
    });
    await refresh();
  };

  const changePolicy = async (next: 'off' | 'observe' | 'auto') => {
    setPolicyBusy(true);
    try {
      const settings = await request<{ evolutionPolicy: 'off' | 'observe' | 'auto' }>('skill.setPolicy',
        { policy: next, ...(workspaceId ? { workspaceId } : {}) });
      setPolicy(settings.evolutionPolicy);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPolicyBusy(false);
    }
  };

  const doImport = async () => {
    if (!importPath.trim()) { setImportError('请输入工作区内 SKILL.md 的相对路径。'); return; }
    setImportBusy(true);
    setImportError(null);
    try {
      const skill = await request<Skill>('skill.import', { path: importPath.trim(), ...(workspaceId ? { workspaceId } : {}) });
      setImportPath('');
      setImportOpen(false);
      await refresh();
      setSelectedId(skill.id);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  };

  const observingCount = skills.filter(s => s.status === 'observing').length;

  return (
    <div className="sk-view" data-view="skills">
      <header className="sk-header">
        <div className="sk-title-block">
          <h1 className="sk-title">技能库</h1>
          <p className="sk-subtitle">技能版本、进化证据和 Edge 浏览器绑定</p>
        </div>
        <div className="sk-header-actions">
          {workspaces.length > 1 && (
            <select className="sk-select" aria-label="技能工作区" value={workspaceId} onChange={event => {
              setSelectedId(null);
              setWorkspaceChoice(event.target.value);
            }}>
              {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          )}
          <div className="sk-policy" role="group" aria-label="进化策略">
            <span className="sk-policy-label">进化策略</span>
            <div className="sk-policy-group">
              {POLICY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  className={`sk-policy-btn ${option.value}`}
                  aria-pressed={policy === option.value}
                  title={option.hint}
                  disabled={policyBusy || (!MOCK_UI && !workspaceId)}
                  onClick={() => void changePolicy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <button className="icon-button" aria-label="刷新技能列表" title="刷新" onClick={() => void refresh()}>
            <RefreshCw size={15} aria-hidden />
          </button>
        </div>
      </header>

      <div className="sk-tabs" role="tablist" aria-label="技能库分区">
        <button className="sk-tab" role="tab" aria-selected={tab === 'skills'} onClick={() => setTab('skills')}>
          <BookOpen size={14} aria-hidden /> 技能
          {skills.length > 0 && <span className="chip muted">{skills.length}</span>}
          {observingCount > 0 && <span className="chip warn">{observingCount} 观察中</span>}
        </button>
        {FixtureMcpPanel && (
          <button className="sk-tab" role="tab" aria-selected={tab === 'mcp'} onClick={() => setTab('mcp')}>
            <Plug size={14} aria-hidden /> MCP 服务
          </button>
        )}
        <button className="sk-tab" role="tab" aria-selected={tab === 'browser'} onClick={() => setTab('browser')}>
          <Globe size={14} aria-hidden /> Edge 浏览器
        </button>
      </div>

      <div className="sk-body">
        <AnimatePresence mode="wait">
          <motion.div key={tab} {...motionProps(reduce, fadeUp)}>
        {tab === 'skills' && (
          <div className="sk-panel">
            {error && <div className="sk-error" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
            {loading ? (
              <div className="sk-loading"><LoaderCircle size={15} className="spin" aria-hidden /> 正在加载技能…</div>
            ) : skills.length === 0 ? (
              <div className="sk-empty">
                <BookOpen size={24} strokeWidth={1.5} aria-hidden />
                <div className="sk-empty-title">还没有技能</div>
                <div className="sk-empty-desc">
                  {workspaceId || MOCK_UI ? '导入工作区内的 SKILL.md 后，Agent 可按需查找和读取。' : '请先在设置中授权一个工作区。'}
                </div>
                {(workspaceId || MOCK_UI) && (
                  <button className="button primary" onClick={() => setImportOpen(v => !v)}>
                    <FolderInput size={14} aria-hidden /> 导入 SKILL.md
                  </button>
                )}
              </div>
            ) : (
              <div className="sk-split">
                <div className="sk-list-pane" role="listbox" aria-label="技能列表">
                  <button className="button" style={{ alignSelf: 'flex-start' }} onClick={() => setImportOpen(v => !v)}>
                    <FolderInput size={13} aria-hidden /> 导入
                  </button>
                  {skills.map(skill => {
                    const status = STATUS_CHIP[skill.status];
                    return (
                      <button
                        key={skill.id}
                        role="option"
                        aria-selected={selected?.id === skill.id}
                        className={`sk-card${selected?.id === skill.id ? ' selected' : ''}`}
                        onClick={() => setSelectedId(skill.id)}
                      >
                        <span className="sk-card-top">
                          <span className="sk-card-name">{skill.name}</span>
                          <span className="sk-version">v{skill.version}</span>
                        </span>
                        {skill.description && <span className="sk-card-desc">{skill.description}</span>}
                        <span className="sk-card-meta">
                          <span className={`chip ${status.chip}`}>{status.text}</span>
                          <span className="chip muted">{SOURCE_LABEL[skill.source]}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="sk-detail-pane">
                  {selected && (
                    <SkillDetail
                      skill={selected}
                      versions={selected.workspaceId ? selectedVersions : versions}
                      evolutions={evolutions}
                      evidence={evidence}
                      cycles={cycles}
                      onRollback={selectedWorkspace ? rollback : undefined}
                      onFeedbackSubmitted={() => void refresh()}
                    />
                  )}
                </div>
              </div>
            )}

            {importOpen && (
              <div className="sk-mcp-form" style={{ marginTop: 16, maxWidth: 640 }}>
                <label className="sk-field">
                  <span className="sk-field-label">工作区内 SKILL.md 相对路径</span>
                  <input
                    className="sk-input"
                    value={importPath}
                    onChange={e => setImportPath(e.target.value)}
                    placeholder="例如 skills/report-writer/SKILL.md"
                    aria-label="导入路径"
                  />
                </label>
                {importError && <div className="sk-form-error" role="alert">{importError}</div>}
                <div className="sk-feedback-row">
                  <button className="button primary" disabled={importBusy} onClick={() => void doImport()}>
                    {importBusy && <LoaderCircle size={14} className="spin" aria-hidden />} 导入
                  </button>
                  <button className="button" onClick={() => { setImportOpen(false); setImportError(null); }}>取消</button>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'mcp' && FixtureMcpPanel && <div className="sk-panel"><Suspense><FixtureMcpPanel /></Suspense></div>}
        {tab === 'browser' && <div className="sk-panel"><BrowserPanel /></div>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default SkillsView;
