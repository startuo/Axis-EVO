/** 工作区：授权路径+模式、列表、切换模式、移除。 */
import { useState } from 'react';
import { FolderLock, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { PermissionMode, Workspace } from '@axis/protocol';
import { PermissionChip } from '../../../components/PermissionChip';
import { useToast } from '../../../components/Toasts';
import { MODE_LABEL, MODE_ORDER, errorMessage, timeAgo } from '../../../lib/format';
import type { useSocket } from '../../../hooks/useSocket';
import { workspaceModes } from '../native';
import { ConfirmButton, EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';

export interface WorkspaceSectionProps {
  workspaces: Workspace[];
  request: ReturnType<typeof useSocket>['request'];
  pythonRuntime?: boolean;
}

export function WorkspaceSection({ workspaces, request, pythonRuntime = false }: WorkspaceSectionProps) {
  const toast = useToast();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PermissionMode>('workspace-write');
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const visible = workspaces.filter((w) => !removedIds.has(w.id));

  const authorize = async () => {
    if (!path.trim() || busy || (pythonRuntime && !shared)) return;
    setBusy(true);
    try {
      await request('workspace.authorize', {
        path: path.trim(), name: name.trim() || undefined, mode,
        ...(pythonRuntime ? { shareWithProvider: true } : {}),
      });
      toast.push('success', '工作区已授权');
      setPath(''); setName(''); setShared(false);
    } catch (e) {
      toast.push('error', `授权失败：${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const setWorkspaceMode = async (workspaceId: string, next: PermissionMode) => {
    try {
      await request('workspace.setMode', { workspaceId, mode: next });
    } catch (e) {
      toast.push('error', `切换模式失败：${errorMessage(e)}`);
    }
  };

  const remove = async (workspaceId: string) => {
    try {
      await request('workspace.remove', { workspaceId });
      setRemovedIds((cur) => new Set([...cur, workspaceId]));
      toast.push('success', '工作区已移除');
    } catch (e) {
      toast.push('error', `移除失败：${errorMessage(e)}`);
    }
  };

  return (
    <section className="set-section" aria-label="工作区">
      <SectionHeader icon={FolderLock} title="工作区" description="授权代理可访问的目录，并为每个工作区设定默认权限模式。所有文件工具都被限制在授权工作区内。" />

      <div className="set-card">
        <h3 className="set-card-title">授权新工作区</h3>
        <div className="set-form-grid">
          <Field label="目录路径">
            <TextInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="例如 F:/projects/my-app" aria-label="目录路径" />
          </Field>
          <Field label="显示名称（可选）">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="默认使用目录名" aria-label="显示名称" />
          </Field>
          <Field label="权限模式">
            <Select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} aria-label="权限模式">
              {(pythonRuntime ? workspaceModes : MODE_ORDER).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
        {pythonRuntime && (
          <label className="set-workspace-consent">
            <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
            允许所选模型服务处理任务所需的工作区材料
          </label>
        )}
        <div className="set-form-actions">
          <button className="button primary" onClick={() => void authorize()}
            disabled={busy || path.trim().length === 0 || (pythonRuntime && !shared)}>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
            授权工作区
          </button>
        </div>
      </div>

      <div className="set-list" aria-label="已授权工作区">
        {visible.length === 0 && <EmptyHint>尚未授权任何工作区。添加一个目录以开始。</EmptyHint>}
        {visible.map((w) => (
          <div key={w.id} className="set-row">
            <div className="set-row-main">
              <div className="set-row-title">{w.name}</div>
              <code className="set-row-path" title={w.path}>{w.path}</code>
              <div className="set-row-sub">授权于 {timeAgo(w.authorizedAt)}</div>
            </div>
            <div className="set-row-actions">
              {pythonRuntime ? <WorkspaceModeControl workspace={w} request={request} /> : (
                <>
                  <PermissionChip mode={w.mode} onChange={(m) => void setWorkspaceMode(w.id, m)} />
                  <ConfirmButton onConfirm={() => void remove(w.id)} className="icon-button set-danger"
                    confirmLabel="确认移除" label={`移除工作区 ${w.name}`}>
                    <Trash2 size={15} aria-hidden />
                  </ConfirmButton>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceModeControl({ workspace, request }: {
  workspace: Workspace;
  request: WorkspaceSectionProps['request'];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const setMode = async (next: PermissionMode) => {
    if (!(workspaceModes as readonly string[]).includes(next) || next === workspace.mode || busy) return;
    setBusy(true);
    try {
      await request('workspace.setMode', { workspaceId: workspace.id, mode: next });
    } catch (e) {
      toast.push('error', `切换模式失败：${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Select aria-label={`工作区 ${workspace.name} 权限模式`} value={workspace.mode} disabled={busy}
      onChange={(event) => void setMode(event.target.value as PermissionMode)}>
      {workspaceModes.map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
    </Select>
  );
}
