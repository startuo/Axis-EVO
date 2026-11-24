import {useEffect,useRef,useState} from 'react';
import {feedbackApi} from '../../lib/feedback';
import type {FeedbackProposal,TaskFeedback} from '../../lib/feedbackData';
import type {RuntimeProfile,RuntimeThread} from '../../lib/runtime';
import {Field} from '../ui/Primitives';

const evaluations={MET_EXPECTATIONS:'符合预期',NEEDS_IMPROVEMENT:'需要改进',UNABLE_TO_ASSESS:'无法判断'};
const reasons={UNDERSTANDING:'任务理解错误',OUTPUT:'输出结果有问题',PROCESS:'操作过程不符合要求',OTHER:'其他'};
const acceptance=(value:string)=>value==='PASSED'?'通过':value==='FAILED'?'未通过':'尚无独立验收';

export function RuntimeFeedback({thread,token,profiles,onCase}:{thread:RuntimeThread;token:string|null;profiles:RuntimeProfile[];onCase:(id:string)=>void}){
  const [records,setRecords]=useState<TaskFeedback[]>([]);
  const [evaluation,setEvaluation]=useState<keyof typeof evaluations|null>(null);
  const [reason,setReason]=useState('');
  const [comment,setComment]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [proposal,setProposal]=useState<FeedbackProposal|null>(null);
  const [confirmed,setConfirmed]=useState('');
  const [profileKey,setProfileKey]=useState('');
  const pending=useRef(false);
  const alive=useRef(true);
  const eligible=['FINISHED','FAILED'].includes(thread.status);
  const profile=profiles.find(p=>`${p.id}@${p.revision}`===profileKey)??profiles[0];
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!eligible)return;
    const controller=new AbortController();
    feedbackApi.list(thread.projectId,thread.id,controller.signal).then(v=>{if(!controller.signal.aborted){setRecords(v.records);setLoaded(true);}})
      .catch(()=>{if(!controller.signal.aborted)setError('反馈记录暂时无法核验，请刷新后查看。');});
    return()=>controller.abort();
  },[thread.projectId,thread.id,eligible]);
  async function perform(action:()=>Promise<void>){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{await action();}catch{if(alive.current)setError('操作未确认，请刷新查看真实记录；没有自动重发。');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  if(!eligible)return null;
  return <section className="task-feedback" aria-label="任务反馈">
    <p className="caption">评价这次任务</p>
    <div className="form-actions">{(Object.keys(evaluations) as (keyof typeof evaluations)[]).map(key=><button type="button" className="text-button" key={key} aria-pressed={evaluation===key} disabled={busy||!token||!loaded} onClick={()=>{setEvaluation(key);setReason('');setProposal(null);setConfirmed('');}}>{evaluations[key]}</button>)}</div>
    {evaluation&&<form onSubmit={event=>{event.preventDefault();void perform(async()=>{
      const saved=await feedbackApi.submit(thread.projectId,thread.id,{submissionId:'feedback_'+crypto.randomUUID().replaceAll('-',''),evaluation,reason:reason||null,comment,supersedesId:records.at(-1)?.id??null});
      if(alive.current){setRecords(current=>[...current,saved]);setEvaluation(null);setComment('');setReason('');}
    });}}>
      {evaluation==='NEEDS_IMPROVEMENT'&&<label>改进原因（可选）<select aria-label="改进原因" value={reason} onChange={e=>setReason(e.target.value)}><option value="">未选择</option>{Object.entries(reasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      <label>反馈说明<textarea aria-label="反馈说明" value={comment} rows={2} maxLength={512} onChange={e=>setComment(e.target.value)} placeholder="可选，简短说明你的观察"/></label>
      <div className="form-actions"><button className="button secondary" disabled={busy||new TextEncoder().encode(comment).length>2048}>保存反馈</button><button type="button" className="text-button" onClick={()=>setEvaluation(null)}>取消</button></div>
    </form>}
    {records.length>0&&<details className="conversation-disclosure" open><summary>已保存反馈（{records.length}）</summary>{records.map((f,i)=><div className="feedback-record" key={f.id}>
      <p><strong>{evaluations[f.body.evaluation]}</strong><small> · {new Date(f.createdAt).toLocaleString()}{f.body.supersedesId?' · 追加更正':''}</small></p>
      {f.body.reason&&<p>{reasons[f.body.reason as keyof typeof reasons]}</p>}{f.body.comment&&<p className="feedback-comment">{f.body.comment}</p>}
      <p className="caption">独立验收：{acceptance(f.body.source.acceptance.status)}；用户评价不改变执行事实。</p>
      <details><summary>反馈证据详情</summary><Field label="Skill 版本" value={`${f.body.source.skillRef.skill_id}@${f.body.source.skillRef.skill_version}`}/><Field label="来源" value={f.body.source.type==='CORE_RUN'?'实际文件任务 Run':'失败的规划尝试，无 Run'}/><Field label="Core Run" value={f.body.source.runId??'无'}/><Field label="Card SHA-256" value={f.body.source.cardSha256}/><Field label="Core 证据摘要" value={f.body.source.evidenceSha256??'无'}/><Field label="反馈摘要" value={f.sha256}/><Field label="初始归因" value="UNDETERMINED"/></details>
      {i===records.length-1&&f.body.source.type==='CORE_RUN'&&<button type="button" className="text-button" disabled={busy} onClick={()=>void perform(async()=>{const p=await feedbackApi.prepare(thread.projectId,f.id);if(alive.current){setProposal(p);setConfirmed('');}})}>基于反馈改进 Skill</button>}
    </div>)}</details>}
    {proposal&&<section className="feedback-revision" aria-label="反馈修订授权"><h3>审阅修订目标</h3>
      <p className="feedback-comment">{proposal.body.objective}</p>
      <p className="caption">此反馈将用于 Development，不能再充当该修订的独立盲测。</p>
      <label>修订模型<select aria-label="反馈修订模型" value={profile?`${profile.id}@${profile.revision}`:''} onChange={e=>{setProfileKey(e.target.value);setConfirmed('');}}>{profiles.map(p=><option key={`${p.id}@${p.revision}`} value={`${p.id}@${p.revision}`}>{p.name} ({p.modelId}) · r{p.revision}</option>)}</select></label>
      <label className="evolution-checkbox"><input type="checkbox" checked={confirmed===proposal.sha256} onChange={e=>setConfirmed(e.target.checked?proposal.sha256:'')}/>我已审阅反馈与客观证据，授权建立修订 Case</label>
      <details><summary>修订技术详情</summary><Field label="提案 SHA-256" value={proposal.sha256}/><Field label="完整历史摘要" value={proposal.body.evidenceSha256}/></details>
      <button type="button" className="button primary" disabled={busy||confirmed!==proposal.sha256||!profile?.credentialConfigured} onClick={()=>void perform(async()=>{const c=await feedbackApi.authorize(thread.projectId,proposal,profile!.id,profile!.revision);if(alive.current)onCase(c.id);})}>授权开始修订</button>
    </section>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
