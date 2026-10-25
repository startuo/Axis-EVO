import type {RuntimeThread} from '../../lib/runtime';
import {Field} from '../ui/Primitives';
import {toolLabels} from '../../lib/runtimePresentation';

export function RuntimeProposalReview({thread,busy,canAct,onApprove}:{thread:RuntimeThread;busy:boolean;canAct:boolean;onApprove:()=>void}) {
  const proposal=thread.proposal;
  if(!proposal)return null;
  const approved=proposal.approvedPlanSha256===proposal.planSha256;
  const canApprove=canAct&&thread.status==='AWAITING_APPROVAL'&&!approved&&!thread.runId;
  return <section className="proposed-actions" aria-label="待执行操作">
    <p>{approved?'已批准的操作':'请确认以下操作。批准后将在此任务的工作区执行。'}</p>
    <ol>{proposal.steps.map(step=><li key={step.step_id}>
      <strong>{toolLabels[step.tool_name]??step.tool_name} {typeof step.arguments.path==='string'?step.arguments.path:''}</strong>
      {step.tool_name==='patch_file'&&typeof step.arguments.old==='string'&&typeof step.arguments.new==='string'?<div className="proposed-diff" aria-label="拟替换片段"><div><span>替换前</span><pre>{step.arguments.old}</pre></div><div><span>替换后</span><pre>{step.arguments.new}</pre></div></div>
        :step.tool_name==='write_file'&&typeof step.arguments.content==='string'?<div className="proposed-diff"><span>写入内容（将覆盖同名文件）</span><pre>{step.arguments.content}</pre></div>
        :step.tool_name==='run_tests'?<p>运行任务测试代码。</p>:null}
      <details className="conversation-disclosure"><summary>全部参数</summary><dl className="readable-arguments">{Object.entries(step.arguments).map(([key,value])=><div key={key}><dt>{key}</dt><dd><pre>{typeof value==='string'?value:JSON.stringify(value,null,2)}</pre></dd></div>)}</dl></details>
    </li>)}</ol>
    <details className="conversation-disclosure"><summary>操作身份与批准摘要</summary><div className="conversation-disclosure-body"><Field label="Plan SHA-256" value={proposal.planSha256} copy/><Field label="Proposal ID" value={proposal.proposalId} copy/><Field label="Skill" value={`${thread.skillRef.skill_id}@${thread.skillRef.skill_version}`}/><Field label="Card SHA-256" value={proposal.cardSha256} copy/><Field label="TaskSpec SHA-256" value={proposal.taskSpecSha256} copy/><Field label="模型版本" value={`${thread.profileSnapshot.name} (${thread.profileSnapshot.revision})`}/></div></details>
    <details className="conversation-disclosure"><summary>模型快照</summary><div className="conversation-disclosure-body"><Field label="记录的模型" value={thread.profileSnapshot.modelId}/><Field label="Provider Config SHA-256" value={thread.profileSnapshot.configSha256} copy/></div></details>
    {!approved&&<button type="button" className="button primary" disabled={!canApprove||busy} onClick={onApprove}>{busy?'正在提交批准…':'批准并执行'}</button>}
  </section>;
}
