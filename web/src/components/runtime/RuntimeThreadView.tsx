import { FileCheck2 } from 'lucide-react';
import {useState} from 'react';
import type { RuntimeThread } from '../../lib/runtime';
import { taskPresentation, toolLabels } from '../../lib/runtimePresentation';
import { AxisLogo } from '../ui/AxisLogo';
import { Badge, Field } from '../ui/Primitives';
import { RuntimeProposalReview } from './RuntimeProposal';
import { RuntimeSupervisionPanel } from './RuntimeSupervision';
import {RuntimeInvocationDetail} from './RuntimeInvocationDetail';
import '../../styles/conversation.css';

export const threadLabels:Record<RuntimeThread['status'],string>={QUEUED:'等待模型',PLANNING:'正在处理',AWAITING_APPROVAL:'等待批准',DISPATCH_RESERVED:'正在启动执行',EXECUTING:'执行中',FINISHED:'处理已结束',FAILED:'未能完成',UNKNOWN:'结果未能确认'};

export function RuntimeThreadView({thread,busy,canAct,approve,openReview}:{thread:RuntimeThread;busy:boolean;canAct:boolean;approve:()=>void;openReview:()=>void;inConversation?:boolean}) {
  const status=taskPresentation(thread);
  const events=thread.run?.events??[];
  const calls=events.filter(e=>e.type==='TOOL_INTENT');
  const [openCalls,setOpenCalls]=useState<string[]>([]);
  return <article className="runtime-thread-page runtime-conversation runtime-task-message">
    <section role="group" className="conversation-user" aria-label="你的任务输入"><p className="conversation-user-bubble">{thread.prompt}</p></section>
    <section role="group" className="conversation-assistant" aria-label="任务事实">
      <header className="conversation-assistant-heading"><AxisLogo size={24}/><strong>AXIS</strong><Badge tone={status.tone}>{status.label}</Badge><button type="button" className="text-button" onClick={openReview}><FileCheck2 size={15}/>查看证据</button></header>
      {status.message&&<p role="status" aria-label={status.label} className="task-outcome">{status.message}</p>}
      {thread.run?.inspection.traceConsistent===false&&<p className="conversation-failure" role="alert">执行证据存在不一致，请查看证据。</p>}
      {thread.status==='AWAITING_APPROVAL' && (thread.readPolicy?.autoApprovalPending?<p role="status">正在核对项目读取授权…</p>:<RuntimeProposalReview thread={thread} busy={busy} canAct={canAct} onApprove={approve}/>)}
      {calls.length>0 && <ol className="tool-activity" aria-label="工具活动">{calls.map(intent=>{
        const result=events.find(e=>e.type==='TOOL_RESULT'&&e.toolCallId===intent.toolCallId);
        const step=thread.proposal?.steps.find(s=>s.step_id===intent.stepId);
        return <li key={intent.id}><details onToggle={event=>{const opened=event.currentTarget.open;setOpenCalls(current=>opened?[...new Set([...current,intent.id])]:current.filter(id=>id!==intent.id));}}><summary><span>{toolLabels[step?.tool_name??'']??'工具调用'}{typeof step?.arguments.path==='string'?` ${step.arguments.path}`:''}</span><span>{result?'已有工具结果':'尚无工具结果'}</span></summary><div className="tool-activity-detail">{intent.toolCallId&&<RuntimeInvocationDetail thread={thread} callId={intent.toolCallId} open={openCalls.includes(intent.id)}/>}<button type="button" className="text-button" onClick={openReview}>查看调用证据</button></div></details></li>;
      })}</ol>}
      {thread.readPolicy?.approvalSource==='POLICY'&&<p className="caption">已按项目读取策略批准，仅访问授权文件。</p>}
      {thread.proposal&&thread.status!=='AWAITING_APPROVAL'&&<details className="conversation-disclosure"><summary>原定操作</summary><RuntimeProposalReview thread={thread} busy={busy} canAct={false} onApprove={approve}/></details>}
      <details key={thread.id+'-details'} className="conversation-disclosure"><summary>任务详情</summary><div className="conversation-disclosure-body">
        {thread.errorCode&&<Field label="诊断代码" value={thread.errorCode}/>}
        <Field label="记录的模型" value={thread.profileSnapshot.modelId}/>
        {thread.readPolicy&&<><Field label="读取授权来源" value={thread.readPolicy.approvalSource==='POLICY'?'项目策略':'尚无策略批准收据'}/><Field label="授权读取路径" value={thread.readPolicy.allowedPaths.join('，')}/></>}
        {thread.run&&<><Field label="Core Run" value={thread.run.id} copy/><Field label="Core 存储状态" value={thread.run.status}/><Field label="独立验收事件" value={events.filter(e=>e.type==='VALIDATION_PASSED'||e.type==='VALIDATION_FAILED').at(-1)?.type??'尚无结果'}/><Field label="Inspector 观察" value={thread.run.inspection.observations.join('，')||'未记录异常观察'}/>{thread.run.inspection.issues.map((issue,i)=><p key={i}>{issue}</p>)}</>}
        {thread.run?.recovery.map(r=><p key={r.id}>独立恢复子任务：{r.childStatus??'尚无结果'}。原任务结果仍为 {r.sourceOutcome}。</p>)}
        <RuntimeSupervisionPanel thread={thread}/>
      </div></details>
    </section>
  </article>;
}
