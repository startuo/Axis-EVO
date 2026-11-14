import { ChevronRight, Download, FileText, LoaderCircle, Square } from 'lucide-react';
import { agentApi, agentRunning, agentStatus, agentStopReason, type AgentArtifact, type AgentEvent } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';
import { SafeMarkdown } from '../ui/SafeMarkdown';
import { AxisLogo } from '../ui/AxisLogo';
import { CopyButton } from '../ui/Primitives';
import { AgentFeedback } from './AgentFeedback';

const eventLabels: Record<string, string> = { tool_intent: '准备调用', tool_result: '工具回执', assistant: '模型回复', model_response: '模型回复', model_request: '请求模型', validation: '实际验证', feedback: '用户反馈', agent_feedback: '用户反馈', cancelled: '停止请求', cancel_requested: '停止请求', unknown: '结果待确认', skill_use: '使用 Skill', skill_selected: '使用 Skill', skill_loaded: '已读取 Skill', artifact: '已保存交付版本', error: '执行异常', terminal: '本轮结束', completed: '本轮结束', started: '任务开始', claimed: '任务开始' };
function eventTitle(event: AgentEvent) {
  const tool = event.payload.tool ?? event.payload.toolName ?? event.payload.name;
  return `${eventLabels[event.kind] ?? event.kind}${typeof tool === 'string' ? ` · ${tool}` : ''}`;
}

export function AgentArtifacts({ artifacts, open }: { artifacts: AgentArtifact[]; open: (artifact: AgentArtifact) => void }) {
  return <div className="agent-artifact-list">{artifacts.map(artifact => <button key={artifact.id} onClick={() => open(artifact)}><FileText size={19}/><span><strong>{artifact.filename}</strong><small>{artifact.verified ? '与工作区当前文件一致' : artifact.historicalVerified ? '已保留版本 · 当前文件已变更或不可读取' : '此版本尚未核验'} · {new Intl.NumberFormat('zh-CN').format(artifact.sizeBytes)} B</small></span><ChevronRight size={15}/></button>)}</div>;
}

export function AgentConversation({ data, openArtifact }: { data: AgentWorkspaceController; openArtifact: (artifact: AgentArtifact) => void }) {
  return <div className="agent-conversation">{data.conversation?.turns.map(turn => <section className="agent-turn" key={turn.id} aria-label="对话轮次">
    <div className="agent-user-message">{turn.prompt}</div>
    <div className="agent-response-heading"><AxisLogo size={23}/><strong>Axis</strong>{agentRunning(turn.status) && <span className="agent-live" role="status"><LoaderCircle className="loader" size={13}/>{agentStatus(turn.status)}</span>}{!agentRunning(turn.status) && !['COMPLETED', 'FINISHED'].includes(turn.status) && <span className="agent-turn-state">{agentStatus(turn.status)}</span>}{agentRunning(turn.status) && <button className="text-button agent-stop" disabled={!!data.busy} onClick={() => void data.mutate(`cancel:${turn.id}`, () => agentApi.cancel(turn.id))}><Square size={11}/>停止</button>}</div>
    {turn.events.length > 0 && <details className="agent-activity"><summary><span>{turn.events.filter(e => e.kind === 'tool_result').length} 次工具调用</span><span>{agentRunning(turn.status) ? '查看当前进展' : '查看过程与证据'}</span><ChevronRight size={13}/></summary><ol>{turn.events.map(event => <li key={event.id}><details><summary><span>{eventTitle(event)}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol></details>}
    {turn.answer && <SafeMarkdown text={turn.answer}/>}
    {turn.code && !agentRunning(turn.status) && <details className="agent-turn-error"><summary>结束原因</summary><code>{turn.code}</code></details>}
    {!turn.answer && !agentRunning(turn.status) && <p className="agent-turn-note">{agentStopReason(turn.code) ?? (['UNKNOWN', 'OUTCOME_UNKNOWN'].includes(turn.status) ? '本次执行结果尚未确认。请检查保留的记录与文件，没有自动重复操作。' : turn.status === 'BLOCKED' ? 'Agent 已停止在当前边界。查看过程中的原因，补充条件后可继续协作。' : turn.status === 'LIMIT_REACHED' ? '本轮已到达执行上限，已完成的操作与交付物保留在这里。' : '本轮没有最终回复；已记录的执行事实与交付物仍然保留。')}</p>}
    <AgentArtifacts artifacts={turn.artifacts} open={openArtifact}/>
    {!agentRunning(turn.status) && <AgentFeedback turn={turn} data={data}/>}
  </section>)}</div>;
}

export function AgentArtifactPreview({ artifact, close }: { artifact: AgentArtifact; close: () => void }) {
  const verified = artifact.verified || artifact.historicalVerified;
  function download() {
    if (!verified) return;
    const url = URL.createObjectURL(new Blob([artifact.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = artifact.filename.replace(/[\\/\u0000-\u001f]/g, '_');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="agent-artifact-preview"><header><div><FileText size={17}/><strong>{artifact.filename}</strong></div><button className="text-button" onClick={close}>关闭</button></header><div className="agent-artifact-scroll"><p className="agent-verification">{artifact.verified ? '已保存版本通过字节核验，与工作区当前文件一致。' : artifact.historicalVerified ? '这是经过字节核验的已保留版本。工作区当前文件已变更或不可读取，预览与下载仍对应本轮保存的内容。' : '此版本尚未核验，暂不提供下载。'}</p><div className="agent-artifact-actions"><button className="button secondary" disabled={!verified} onClick={download}><Download size={14}/>下载此版本</button><CopyButton value={artifact.content} label="复制交付内容"/></div>{/\.md(?:own|x)?$/i.test(artifact.filename) ? <SafeMarkdown text={artifact.content}/> : <pre className="agent-file-text">{artifact.content}</pre>}<details className="agent-artifact-evidence"><summary>保存位置与执行证据</summary><dl><dt>工作区相对路径</dt><dd>{artifact.path}</dd><dt>SHA-256</dt><dd>{artifact.sha256}</dd><dt>文件大小</dt><dd>{artifact.sizeBytes} B</dd></dl><p>字节核验确认保存内容；文档中的判断仍需结合来源评估。</p></details></div></section>;
}
