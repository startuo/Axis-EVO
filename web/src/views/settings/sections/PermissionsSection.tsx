/** 权限：默认模式 + 命令规则编辑（allow / prompt / deny，首个匹配生效）。 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Shield, Trash2 } from 'lucide-react';
import type { PermissionMode, Settings, Workspace } from '@axis/protocol';
import type { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../components/Toasts';
import { MODE_LABEL, MODE_ORDER, errorMessage } from '../../../lib/format';
import { EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';
import { WorkspaceModeControl } from './WorkspaceSection';

type CommandRule = Settings['commandRules'][number];
type RuleAction = CommandRule['action'];

const ACTION_LABEL: Record<RuleAction, string> = { allow: '允许', prompt: '询问', deny: '拒绝' };
const ACTION_ORDER: RuleAction[] = ['allow', 'prompt', 'deny'];

export interface PermissionsSectionProps {
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

export function WorkspacePermissionsSection({ workspaces, request }: {
  workspaces: Workspace[];
  request: ReturnType<typeof useSocket>['request'];
}) {
  return (
    <section className="set-section" aria-label="权限">
      <SectionHeader icon={Shield} title="权限" description="逐个工作区设置读取或写入权限。项目命令由后端在已授权的隔离容器中执行。" />
      <div className="set-list">
        {!workspaces.length && <EmptyHint>请先授权工作区。</EmptyHint>}
        {workspaces.map((workspace) => (
          <div className="set-row" key={workspace.id}>
            <div className="set-row-main">
              <div className="set-row-title">{workspace.name}</div>
              <code className="set-row-path" title={workspace.path}>{workspace.path}</code>
            </div>
            <div className="set-row-actions"><WorkspaceModeControl workspace={workspace} request={request} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PermissionsSection({ settings, updateSettings }: PermissionsSectionProps) {
  const toast = useToast();
  const [rules, setRules] = useState<CommandRule[]>(settings?.commandRules ?? []);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setRules(settings?.commandRules ?? []);
  }, [settings?.commandRules, dirty]);

  const setDefaultMode = async (mode: PermissionMode) => {
    try {
      await updateSettings({ defaultMode: mode });
      toast.push('success', '默认权限模式已更新');
    } catch (e) {
      toast.push('error', `更新失败：${errorMessage(e)}`);
    }
  };

  const editRule = (index: number, patch: Partial<CommandRule>) => {
    setRules((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRule = () => { setRules((cur) => [...cur, { pattern: '', action: 'prompt' }]); setDirty(true); };
  const removeRule = (index: number) => { setRules((cur) => cur.filter((_, i) => i !== index)); setDirty(true); };

  const save = async () => {
    const cleaned = rules.filter((r) => r.pattern.trim().length > 0).map((r) => ({ ...r, pattern: r.pattern.trim() }));
    setBusy(true);
    try {
      await updateSettings({ commandRules: cleaned });
      setRules(cleaned);
      setDirty(false);
      toast.push('success', '命令规则已保存');
    } catch (e) {
      toast.push('error', `保存失败：${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section" aria-label="权限">
      <SectionHeader icon={Shield} title="权限" description="设定新会话的默认权限模式，并配置 shell 命令规则。规则按顺序匹配，首个命中生效；未命中的危险命令仍会触发审批。" />

      <div className="set-card">
        <Field label="默认权限模式" hint="新会话默认采用此模式；单个会话仍可在聊天中临时调整。">
          <Select value={settings?.defaultMode ?? 'workspace-write'} onChange={(e) => void setDefaultMode(e.target.value as PermissionMode)} aria-label="默认权限模式">
            {MODE_ORDER.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </Select>
        </Field>
      </div>

      <div className="set-card">
        <div className="set-card-head">
          <h3 className="set-card-title">命令规则</h3>
          <button className="button" onClick={addRule}><Plus size={14} aria-hidden /> 添加规则</button>
        </div>
        {rules.length === 0 && <EmptyHint>暂无自定义规则。例如允许 <code>npm test</code>、拒绝 <code>rm -rf</code>。</EmptyHint>}
        <div className="set-rules">
          {rules.map((rule, i) => (
            <div key={i} className="set-rule-row">
              <TextInput
                value={rule.pattern}
                onChange={(e) => editRule(i, { pattern: e.target.value })}
                placeholder="命令匹配模式，例如 npm test"
                aria-label={`规则 ${i + 1} 模式`}
                className="set-rule-pattern"
              />
              <Select value={rule.action} onChange={(e) => editRule(i, { action: e.target.value as RuleAction })} aria-label={`规则 ${i + 1} 动作`}>
                {ACTION_ORDER.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
              </Select>
              <button className="icon-button set-danger" aria-label={`删除规则 ${i + 1}`} onClick={() => removeRule(i)}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="set-form-actions">
          <button className="button primary" onClick={() => void save()} disabled={busy || !dirty}>
            {busy && <LoaderCircle size={14} className="spin" aria-hidden />} 保存规则
          </button>
          {dirty && <span className="set-dirty-note">有未保存的更改</span>}
        </div>
      </div>
    </section>
  );
}
