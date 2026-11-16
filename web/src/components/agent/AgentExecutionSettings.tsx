import { useEffect, useState } from 'react';
import { Check, Terminal } from 'lucide-react';
import { agentApi, type ExecutionSettings } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';

function ExecutionForm({ value, data }: { value: ExecutionSettings; data: AgentWorkspaceController }) {
  const [enabled, setEnabled] = useState(value.policy.enabled);
  const [image, setImage] = useState(value.policy.imageId ?? '');
  const [timeout, setTimeout] = useState(value.policy.timeoutSeconds);
  const [checks, setChecks] = useState(value.policy.checks.map(c => JSON.stringify(c.argv)).join('\n'));
  const [paths, setPaths] = useState(value.policy.protectedPaths.join('\n'));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save() {
    try {
      const commands = checks.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => ({ name: `项目验收 ${index + 1}`, argv: line.startsWith('[') ? JSON.parse(line) as string[] : ['/bin/sh', '-c', line] }));
      if (commands.length > 8 || commands.some(c => !Array.isArray(c.argv) || !c.argv.length || c.argv.some(arg => typeof arg !== 'string'))) throw new Error('最多填写8条命令；也可输入JSON参数数组。');
      setError('');
      const ok = await data.mutate('execution-policy', () => agentApi.executionPolicy(data.workspaceId, { enabled, imageId: image || null, timeoutSeconds: timeout, checks: commands, protectedPaths: paths.split('\n').map(line => line.trim()).filter(Boolean) }));
      if (ok) setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '命令格式无效。'); }
  }
  return <form className="agent-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label className="agent-consent"><input type="checkbox" aria-label="允许隔离项目执行" checked={enabled} onChange={event => { setEnabled(event.target.checked); setSaved(false); }}/><span>允许 Agent 在隔离副本中运行这个项目的命令与测试。</span></label>
    <p>执行副本不连接网络，不挂载本机目录，也不把容器内修改写回项目。实际文件修改仍通过工作区写入权限保存。Docker 不可用时停止执行。</p>
    <div className="agent-field-row"><label>本机执行镜像<select aria-label="执行镜像" value={image} onChange={event => { setImage(event.target.value); setSaved(false); }}><option value="">选择已安装的 Linux 镜像</option>{value.environment.images.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{image && !value.environment.images.some(item => item.id === image) && <option value={image}>此前授权的镜像（目前不可用）</option>}</select><small>只使用你信任的镜像。Agent 不能自行下载或更换环境。</small></label><label>单次命令时限（秒）<input aria-label="命令时限" type="number" min={1} max={120} value={timeout} onChange={event => setTimeout(Number(event.target.value))}/></label></div>
    <label>固定验收命令<textarea aria-label="固定验收命令" rows={3} value={checks} placeholder="python -m unittest discover -s tests" onChange={event => { setChecks(event.target.value); setSaved(false); }}/><small>每行一条命令，最多8条；也可填写JSON参数数组。Agent和Skill候选不能更改这些定义。</small></label>
    <label>固定验收文件<textarea aria-label="固定验收文件" rows={3} value={paths} placeholder="tests/test_calculator.py" onChange={event => { setPaths(event.target.value); setSaved(false); }}/><small>每行一个项目相对路径。保存时保留原始字节；Agent不能修改这些文件，评价在只读副本中使用固定版本。</small></label>
    <p className="agent-subtle">项目验证只说明这些具体检查的结果。代码演化需要固定验收文件；模型认可不能代替实际对比。</p>
    {error && <p role="alert" className="agent-inline-error">{error}</p>}
    <div className="agent-form-actions"><button className="button secondary" disabled={!!data.busy || enabled && (!image || !value.environment.available)}>保存执行授权</button>{saved && <span role="status"><Check size={14}/>已保存</span>}</div>
  </form>;
}

export function AgentExecutionSettings({ data }: { data: AgentWorkspaceController }) {
  const [result, setResult] = useState<{ workspaceId: string; value: ExecutionSettings } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!data.workspaceId) return;
    const abort = new AbortController();
    void agentApi.execution(data.workspaceId, abort.signal).then(value => { if (!abort.signal.aborted) { setResult({ workspaceId: data.workspaceId, value }); setError(''); } }).catch(failure => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '执行环境读取失败。'); });
    return () => abort.abort();
  }, [data.workspaceId, data.revision]);
  const current = result?.workspaceId === data.workspaceId ? result.value : null;
  return <section className="agent-settings-section"><div className="agent-section-heading"><div><h2><Terminal size={18}/>项目命令与验证</h2><p>一次设置授权，Agent 按目标选择命令、分析失败并继续修复。</p></div></div>{!data.workspaceId ? <p>先选择工作区。</p> : error ? <p role="alert">{error}</p> : current ? <>{!current.environment.available && <p role="status">{current.environment.reason}</p>}<ExecutionForm key={current.policy.id ?? 'new'} value={current} data={data}/></> : <p role="status">正在检查本机执行环境…</p>}</section>;
}
