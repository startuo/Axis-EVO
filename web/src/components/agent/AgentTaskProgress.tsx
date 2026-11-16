import { useState } from 'react';
import { Check, Circle, GitCompareArrows, LoaderCircle, Terminal } from 'lucide-react';
import { agentApi, type AgentTurn, type ProjectChanges } from '../../lib/agent';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function AgentTaskProgress({ turn }: { turn: AgentTurn }) {
  const [changes, setChanges] = useState<ProjectChanges | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const plan = [...turn.events].reverse().find(event => event.kind === 'task_plan')?.payload.steps;
  const steps = Array.isArray(plan) ? plan.filter(object).filter(step => typeof step.title === 'string' && typeof step.status === 'string') : [];
  const commands = turn.events.filter(event => event.kind === 'tool_result' && object(event.payload.data) && Array.isArray(event.payload.data.argv)).map(event => event.payload.data as Record<string, unknown>);
  const checks = new Map<string, Record<string, unknown>>();
  turn.events.filter(event => event.kind === 'verification_result').forEach(event => checks.set(String(event.payload.name), event.payload));
  async function inspect() {
    setLoading(true); setError('');
    try { setChanges(await agentApi.changes(turn.id)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法读取差异。'); }
    finally { setLoading(false); }
  }
  return <div className="agent-task-progress">
    {steps.length > 0 && <section className="agent-plan"><h3>工作计划</h3><ol>{steps.map((step, index) => <li key={index}>{step.status === 'completed' ? <Check size={14}/> : step.status === 'in_progress' ? <LoaderCircle size={14} className="loader"/> : <Circle size={13}/>}<span>{String(step.title)}</span></li>)}</ol><small>计划由 Agent 更新，实际结果以验证记录为准。</small></section>}
    {(commands.length > 0 || checks.size > 0) && <section className="agent-command-results"><h3><Terminal size={15}/>项目验证</h3>{commands.map((command, index) => <details key={index}><summary><code>{(command.argv as string[]).join(' ')}</code><span>{command.exitCode === 0 ? '退出码 0' : typeof command.exitCode === 'number' ? `退出码 ${command.exitCode}` : '未确认结束'}</span></summary><pre>{String(command.stdout ?? '没有可显示的输出。')}</pre>{command.outputTruncated === true && <p>输出达到上限，显示内容已截断。</p>}<small>隔离副本执行 · 不写回本机项目</small></details>)}{[...checks.values()].map(check => <details key={String(check.name)}><summary><strong>{String(check.name)}</strong><span>{check.passed === true ? '通过' : '未通过'}</span></summary><pre>{object(check.result) ? String(check.result.stdout ?? check.result.status) : '结果不可用'}</pre></details>)}</section>}
    {turn.artifacts.length > 0 && <section className="agent-project-changes"><button type="button" className="text-button" disabled={loading} onClick={() => void inspect()}><GitCompareArrows size={15}/>{loading ? '正在核对差异…' : '查看本轮文件差异'}</button>{error && <p role="alert">{error}</p>}{changes && <><p>每个文件的首次修改前与最后保存版本对比；多文件保存不构成一次原子提交。</p>{changes.files.map(file => <details key={file.path}><summary><code>{file.path}</code><span>{file.matchesCurrentFile ? '匹配当前文件' : '当前文件已变化'}</span></summary><pre>{file.diff || '内容没有变化。'}</pre></details>)}</>}</section>}
  </div>;
}
