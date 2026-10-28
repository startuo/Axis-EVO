import type {SkillRef} from './runtime';

export type FeedbackSource={type:'CORE_RUN'|'PLANNING_ATTEMPT';projectId:string;threadId:string;
  conversationId:string|null;turnId:string|null;skillRef:SkillRef;cardSha256:string;sourceSha256:string;
  jobIdentitySha256:string;taskSpecSha256:string;proposalId:string|null;runId:string|null;
  runStatus:string|null;evidenceSha256:string|null;terminalEventId:string|null;
  acceptance:{status:'PASSED'|'FAILED'|'NOT_AVAILABLE';eventId:string|null};attribution:'UNDETERMINED'};
export type FeedbackFact={id:string;projectId:string;threadId:string;kind:string;parentId:string|null;
  slot:string;sha256:string;createdAt:string;body:Record<string,unknown>};
export type FeedbackCase=Omit<FeedbackFact,'threadId'>;
export type TaskFeedback=FeedbackFact&{body:{schemaVersion:1;dataRole:'DEVELOPMENT';source:FeedbackSource;
  evaluation:'MET_EXPECTATIONS'|'NEEDS_IMPROVEMENT'|'UNABLE_TO_ASSESS';reason:string|null;comment:string;supersedesId:string|null}};
export type FeedbackProposal=FeedbackFact&{body:{feedbackId:string;feedbackSha256:string;source:FeedbackSource;evidenceSha256:string;objective:string}};
const obj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=4096;
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const nullable=(v:unknown)=>v===null||text(v);
function source(v:unknown,project:string,thread?:string){
  if(!obj(v)||v.projectId!==project||!text(v.threadId)||thread!==undefined&&v.threadId!==thread
    ||!['CORE_RUN','PLANNING_ATTEMPT'].includes(String(v.type))||!obj(v.skillRef)||!text(v.skillRef.skill_id)
    ||!Number.isSafeInteger(v.skillRef.skill_version)||Number(v.skillRef.skill_version)<1
    ||!['cardSha256','sourceSha256','jobIdentitySha256','taskSpecSha256'].every(k=>hash(v[k]))
    ||!nullable(v.conversationId)||!nullable(v.turnId)||(v.conversationId===null)!==(v.turnId===null)
    ||!nullable(v.proposalId)||v.attribution!=='UNDETERMINED'
    ||!obj(v.acceptance)||!['PASSED','FAILED','NOT_AVAILABLE'].includes(String(v.acceptance.status)))return false;
  if(v.type==='PLANNING_ATTEMPT')return v.runId===null&&v.runStatus===null&&v.evidenceSha256===null
    &&v.terminalEventId===null&&v.acceptance.status==='NOT_AVAILABLE'&&v.acceptance.eventId===null;
  return text(v.runId)&&text(v.proposalId)&&text(v.terminalEventId)&&hash(v.evidenceSha256)
    &&['COMPLETED','FAILED'].includes(String(v.runStatus))
    &&(v.acceptance.status==='NOT_AVAILABLE'?v.acceptance.eventId===null:text(v.acceptance.eventId))
    &&(v.runStatus!=='COMPLETED'||v.acceptance.status==='PASSED')
    &&(v.runStatus!=='FAILED'||v.acceptance.status!=='PASSED');
}
function fact(v:unknown,project:string,kind:string,thread?:string){
  return obj(v)&&text(v.id)&&v.projectId===project&&text(v.threadId)&&(thread===undefined||v.threadId===thread)
    &&v.kind===kind&&nullable(v.parentId)&&text(v.slot)&&hash(v.sha256)&&text(v.createdAt)&&obj(v.body);
}
function feedback(v:unknown,project:string,thread?:string){
  if(!fact(v,project,'FEEDBACK',thread)||!obj(v)||!obj(v.body))return false;
  const b=v.body;
  return b.schemaVersion===1&&b.dataRole==='DEVELOPMENT'&&source(b.source,project,String(v.threadId))
    &&['MET_EXPECTATIONS','NEEDS_IMPROVEMENT','UNABLE_TO_ASSESS'].includes(String(b.evaluation))
    &&(b.reason===null||['UNDERSTANDING','OUTPUT','PROCESS','OTHER'].includes(String(b.reason)))
    &&(b.evaluation==='NEEDS_IMPROVEMENT'||b.reason===null)&&typeof b.comment==='string'
    &&new TextEncoder().encode(b.comment).length<=2048&&nullable(b.supersedesId)&&v.parentId===b.supersedesId;
}
export function validateFeedbackData(path:string,data:unknown,mutating=false){
  const parts=path.split('/'),project=decodeURIComponent(parts[2]??''),thread=parts[3]==='threads'?decodeURIComponent(parts[4]??''):undefined;
  let ok=false;
  if(thread&& !mutating)ok=obj(data)&&data.threadId===thread&&Array.isArray(data.records)&&data.records.length<=128&&data.records.every(f=>feedback(f,project,thread));
  else if(path.endsWith('/revision-proposals'))ok=fact(data,project,'REVISION_PROPOSAL')&&obj(data)&&obj(data.body)
    &&source(data.body.source,project,String(data.threadId))&&text(data.body.feedbackId)&&hash(data.body.feedbackSha256)
    &&hash(data.body.evidenceSha256)&&text(data.body.objective)&&data.parentId===data.body.feedbackId;
  else if(parts[3]==='feedback-revisions')ok=obj(data)&&text(data.id)
    &&data.projectId===project&&data.kind==='CASE_INTENT'&&hash(data.sha256)&&data.parentId===null
    &&text(data.createdAt)&&data.slot===data.id&&obj(data.body)&&data.body.origin==='EVIDENCE_DRIVEN'
    &&text(data.body.objective)&&hash(data.body.sourceCardSha256)&&hash(data.body.evidenceSha256)
    &&Array.isArray(data.body.selectedRunIds)&&data.body.selectedRunIds.length===1&&text(data.body.selectedRunIds[0])
    &&obj(data.body.feedbackSource)&&hash(data.body.feedbackSource.proposalSha256)&&hash(data.body.feedbackSource.feedbackSha256)
    &&text(data.body.feedbackSource.authorizationId)&&text(data.body.feedbackSource.feedbackId)
    &&data.body.feedbackSource.proposalId===decodeURIComponent(parts[4]??'');
  else ok=feedback(data,project,thread);
  if(!ok)throw new Error('反馈响应的来源、结构或证据关联无效。');
}
