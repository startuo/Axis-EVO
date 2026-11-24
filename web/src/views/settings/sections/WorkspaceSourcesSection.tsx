import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import type { Workspace } from '@axis/protocol';
import { errorMessage } from '../../../lib/format';
import { ConfirmButton, EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';
import type { SettingsData } from '../useSettingsData';

export interface WorkspaceSource {
  id: string;
  name: string;
  path: string;
  kind: 'knowledge' | 'skills';
  enabled: boolean;
}

type SourceResult = { sources: WorkspaceSource[] };
type Request = SettingsData['request'];

export function WorkspaceSourcesSection({ workspaces, request }: { workspaces: Workspace[]; request: Request }) {
  const [selected, setSelected] = useState('');
  const workspace = workspaces.find((entry) => entry.id === selected) ?? workspaces[0];
  return (
    <section className="set-section" aria-label="资料来源">
      <SectionHeader icon={BookOpen} title="资料来源" description="按工作区连接知识与 Skill 目录。撤销后，后续任务无法读取该来源。" />
      {!workspace ? <EmptyHint>先在工作区设置中授权一个目录。</EmptyHint> : (
        <>
          <Field label="资料来源所属工作区">
            <Select value={workspace.id} onChange={(event) => setSelected(event.target.value)}>
              {workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </Select>
          </Field>
          <SourceList key={workspace.id} workspaceId={workspace.id} request={request} />
        </>
      )}
    </section>
  );
}

function SourceList({ workspaceId, request }: { workspaceId: string; request: Request }) {
  const [sources, setSources] = useState<WorkspaceSource[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [kind, setKind] = useState<WorkspaceSource['kind']>('knowledge');
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let active = true;
    request<SourceResult>('workspace.sources', { workspaceId }).then((result) => {
      if (active) setSources(result.sources);
    }).catch((failure: unknown) => {
      if (active) setError(errorMessage(failure));
    });
    return () => { active = false; };
  }, [request, revision, workspaceId]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !consent || !name.trim() || !path.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await request<SourceResult>('workspace.sourceAdd', {
        workspaceId, name: name.trim(), path: path.trim(), kind, shareWithProvider: true,
      });
      setSources(result.sources);
      setName('');
      setPath('');
      setConsent(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  async function revoke(sourceId: string) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await request<SourceResult>('workspace.sourceRevoke', { workspaceId, sourceId });
      setSources(result.sources);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <p className="set-test-result fail" role="alert">{error}</p>}
      {sources === null ? (
        error ? <div><button className="button" onClick={() => { setError(''); setRevision((value) => value + 1); }}>重新读取来源</button></div>
          : <p role="status">正在读取资料来源…</p>
      ) : (
        <>
          <form className="set-card" onSubmit={(event) => void add(event)} aria-label="连接新来源">
            <h3 className="set-card-title">连接新来源</h3>
            <div className="set-form-grid">
              <Field label="资料目录">
                <TextInput value={path} onChange={(event) => setPath(event.target.value)} placeholder="例如 F:/projects/notes" required />
              </Field>
              <Field label="来源名称">
                <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
              </Field>
              <Field label="资料类型">
                <Select value={kind} onChange={(event) => setKind(event.target.value as WorkspaceSource['kind'])}>
                  <option value="knowledge">知识目录</option>
                  <option value="skills">Skill 目录</option>
                </Select>
              </Field>
            </div>
            <label className="set-workspace-consent">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              允许所选模型服务处理任务所需的来源内容
            </label>
            <div className="set-form-actions">
              <button className="button primary" disabled={saving || !consent || !name.trim() || !path.trim()}>
                <Plus size={14} aria-hidden />连接资料来源
              </button>
            </div>
          </form>
          <div className="set-list" aria-label="已连接的资料来源">
            {sources.length === 0 && <EmptyHint>这个工作区没有已连接的资料来源。</EmptyHint>}
            {sources.map((source) => (
              <div className="set-row" key={source.id}>
                <div className="set-row-main">
                  <div className="set-row-title"><span className="set-source-name">{source.name}</span></div>
                  <code className="set-row-path" title={source.path}>{source.path}</code>
                  <div className="set-row-sub">
                    {source.kind === 'knowledge' ? '知识目录' : 'Skill 目录'}
                    {source.enabled ? '，已授权' : '，已撤销'}
                  </div>
                </div>
                {source.enabled && <div className="set-row-actions">
                  <ConfirmButton label={`撤销来源 ${source.name}`} confirmLabel="确认撤销"
                    confirmAriaLabel={`确认撤销 ${source.name}`}
                    onConfirm={() => void revoke(source.id)} disabled={saving}>
                    撤销授权
                  </ConfirmButton>
                </div>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
