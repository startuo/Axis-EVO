import { useEffect, useState, type FormEvent } from 'react';
import { Terminal } from 'lucide-react';
import type { Workspace } from '@axis/protocol';
import { errorMessage } from '../../../lib/format';
import { EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';
import type { SettingsData } from '../useSettingsData';

type Check = { name: string; argv: string[] };
type ExecutionPolicy = {
  enabled: boolean;
  imageId: string | null;
  timeoutSeconds: number;
  checks: Check[];
  protectedPaths: string[];
  postEditCheck?: Check | null;
};
type ExecutionSettings = {
  policy: ExecutionPolicy & { id?: string | null };
  environment: { available: boolean; images: { id: string; name: string }[]; reason?: string };
};
type Request = SettingsData['request'];
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

function parseCheck(line: string, fallbackName: string): Check {
  let parsed: unknown;
  try {
    parsed = line.startsWith('[') || line.startsWith('{') ? JSON.parse(line) : ['/bin/sh', '-c', line];
  } catch {
    throw new Error('命令的 JSON 格式无效。');
  }
  const object = !Array.isArray(parsed) && parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown> : undefined;
  const name = object ? object.name : fallbackName;
  const argv = object ? object.argv : parsed;
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || !Array.isArray(argv)
      || argv.length < 1 || argv.length > 64 || !argv[0]
      || argv.some((argument) => typeof argument !== 'string' || argument.includes('\u0000'))) {
    throw new Error('检查需要名称和非空命令参数。');
  }
  return { name, argv };
}

export function WorkspaceExecutionSection({ workspaces, request }: { workspaces: Workspace[]; request: Request }) {
  const [selected, setSelected] = useState('');
  const workspace = workspaces.find((entry) => entry.id === selected) ?? workspaces[0];
  return (
    <section className="set-section" aria-label="项目命令与验证">
      <SectionHeader icon={Terminal} title="项目命令与验证" description="命令在项目的容器副本中运行。容器无法联网或挂载宿主目录。" />
      {!workspace ? <EmptyHint>先在工作区设置中授权一个目录。</EmptyHint> : (
        <>
          <Field label="执行授权所属工作区">
            <Select value={workspace.id} onChange={(event) => setSelected(event.target.value)}>
              {workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </Select>
          </Field>
          <ExecutionLoader key={workspace.id} workspaceId={workspace.id} request={request} />
        </>
      )}
    </section>
  );
}

function ExecutionLoader({ workspaceId, request }: { workspaceId: string; request: Request }) {
  const [value, setValue] = useState<ExecutionSettings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    request<ExecutionSettings>('workspace.execution', { workspaceId }).then((result) => {
      if (active) setValue(result);
    }).catch((failure: unknown) => {
      if (active) setError(errorMessage(failure));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [request, revision, workspaceId]);

  const refresh = () => { setError(''); setLoading(true); setRevision((count) => count + 1); };
  return (
    <>
      <div><button className="button" disabled={loading} onClick={refresh}>刷新执行环境</button></div>
      {error && <p className="set-test-result fail" role="alert">{error}</p>}
      {loading && <p role="status">正在检查本机执行环境…</p>}
      {value && (
        <>
          {!value.environment.available && (
            <p role="status">{value.environment.reason ?? '本机 Docker Linux 引擎不可用。'}</p>
          )}
          <ExecutionForm key={value.policy.id ?? 'unconfigured'} value={value} disabled={loading || !!error}
            onEdit={() => setSaved(false)}
            onSave={async (policy) => {
              const confirmed = await request<ExecutionSettings['policy']>('workspace.setExecution', { workspaceId, policy });
              setValue((current) => current && { ...current, policy: confirmed });
              setSaved(true);
            }} />
          {saved && <p className="set-test-result ok" role="status">执行授权已保存</p>}
        </>
      )}
    </>
  );
}

function ExecutionForm({ value, disabled, onEdit, onSave }: {
  value: ExecutionSettings; disabled: boolean; onEdit: () => void;
  onSave: (policy: ExecutionPolicy) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(value.policy.enabled);
  const [imageId, setImageId] = useState(value.policy.imageId ?? '');
  const [timeout, setTimeoutValue] = useState(String(value.policy.timeoutSeconds));
  const [checks, setChecks] = useState(value.policy.checks.map((check) => JSON.stringify(check)).join('\n'));
  const [paths, setPaths] = useState(value.policy.protectedPaths.join('\n'));
  const [hook, setHook] = useState(value.policy.postEditCheck ? JSON.stringify(value.policy.postEditCheck) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const imageAvailable = value.environment.images.some((image) => image.id === imageId);
  const canSave = !disabled && !saving && (!enabled || value.environment.available && imageAvailable);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setError('');
    setSaving(true);
    try {
      const timeoutSeconds = Number(timeout);
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) {
        throw new Error('单次命令时限须为 1–120 秒。');
      }
      const configuredChecks = lines(checks);
      const protectedPaths = lines(paths);
      if (configuredChecks.length > 8 || protectedPaths.length > 64) {
        throw new Error('最多设置 8 条固定命令和 64 个固定验收文件。');
      }
      await onSave({
        enabled, imageId: imageId || null, timeoutSeconds,
        checks: configuredChecks.map((line, index) => parseCheck(line, `项目验收 ${index + 1}`)),
        protectedPaths,
        postEditCheck: hook.trim() ? parseCheck(hook.trim(), '编辑后检查') : null,
      });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="set-card set-list" onChange={onEdit} onSubmit={(event) => void save(event)} aria-label="执行授权配置">
      <label className="set-workspace-consent">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={saving} />
        授权隔离项目执行
      </label>
      <div className="set-form-grid">
        <Field label="执行镜像" hint="只使用本机已安装且受信任的 Linux 镜像。">
          <Select value={imageId} onChange={(event) => setImageId(event.target.value)} disabled={saving}>
            <option value="">选择执行镜像</option>
            {value.environment.images.map((image) => <option key={image.id} value={image.id}>{image.name}</option>)}
            {imageId && !imageAvailable && <option value={imageId}>此前选定的镜像，当前不可用</option>}
          </Select>
        </Field>
        <Field label="命令时限（秒）">
          <TextInput type="number" min={1} max={120} step={1} required value={timeout}
            onChange={(event) => setTimeoutValue(event.target.value)} disabled={saving} />
        </Field>
      </div>
      <Field label="固定验收命令" hint="每行一项。可填命令、JSON 参数数组，或含 name 和 argv 的 JSON 对象。">
        <textarea className="set-input set-textarea" rows={4} value={checks} disabled={saving}
          placeholder={'["python","-m","unittest","discover"]'} onChange={(event) => setChecks(event.target.value)} />
      </Field>
      <Field label="固定验收文件" hint="每行一个项目相对文件路径。启用时保存实际字节，并禁止 Agent 修改这些文件。">
        <textarea className="set-input set-textarea" rows={3} value={paths} disabled={saving}
          placeholder="tests/test_calculator.py" onChange={(event) => setPaths(event.target.value)} />
      </Field>
      <Field label="编辑后检查（可选）" hint="文件写入后运行一条轻量命令，最多 10 秒。">
        <TextInput value={hook} disabled={saving} placeholder={'["python","-m","compileall","src"]'}
          onChange={(event) => setHook(event.target.value)} />
      </Field>
      {error && <p className="set-test-result fail" role="alert">{error}</p>}
      <div className="set-form-actions set-actions-top">
        <button className="button primary" disabled={!canSave}>保存执行授权</button>
      </div>
    </form>
  );
}
