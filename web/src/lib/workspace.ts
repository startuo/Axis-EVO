import {runtimeRequest} from './runtime';

export type Delivery = {id:string;state:'EXECUTING'|'COMPLETED'|'FAILED'|'REJECTED'|'UNKNOWN';runId:string;path:string;filename:string;approvalSha256:string;currentBytesVerified:boolean;facts:{seq:number;kind:string;payload:Record<string,unknown>;createdAt:string}[]};
export type WorkspaceDraft = {id:string;projectId:string;conversationId:string;replyId:string;prompt:string;source:Record<string,unknown>;sourceSha256:string;parentId:string|null;version:number;createdAt:string;modelStatus:'QUEUED'|'RESPONDING'|'REPLIED'|'FAILED'|'INTERRUPTED';content:string;contentSha256:string|null;delivery:Delivery|null};
export type DeliveryProposal = {request:{draftId:string;filename:string;contentSha256:string;sourceSha256:string;version:number;action:'write_file';acceptance:'EXACT_UTF8_BYTES';skillIdentity:null};approvalSha256:string;content:string};
export type ArtifactPreview = {threadId:string;runId:string;path:string;sha256:string;content:string;before:string|null;currentBytesVerified:true;taskStatus:string;source:'RECORDED_HASH_MATCHED_LOCAL_BYTES'};
export type DeliveryEvidence = {draftId:string;source:Record<string,unknown>;delivery:Delivery|null;inspection:Record<string,unknown>|null};

const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const delivery=(v:unknown)=>obj(v)&&typeof v.id==='string'&&/^delivery_[a-f0-9]{32}$/.test(v.id)
  &&typeof v.runId==='string'&&typeof v.path==='string'&&typeof v.filename==='string'&&hash(v.approvalSha256)
  &&['EXECUTING','COMPLETED','FAILED','REJECTED','UNKNOWN'].includes(String(v.state))&&typeof v.currentBytesVerified==='boolean'
  &&Array.isArray(v.facts)&&v.facts.length<=4&&v.facts.every(f=>obj(f)&&Number.isInteger(f.seq)&&typeof f.kind==='string'&&obj(f.payload)&&typeof f.createdAt==='string');
const draft=(v:unknown)=>obj(v)&&typeof v.id==='string'&&/^draft_[a-f0-9]{32}$/.test(v.id)
  &&typeof v.projectId==='string'&&typeof v.conversationId==='string'&&typeof v.replyId==='string'&&typeof v.prompt==='string'
  &&typeof v.content==='string'&&v.content.length<=32768&&(v.contentSha256===null||hash(v.contentSha256))
  &&Number.isInteger(v.version)&&Number(v.version)>0&&typeof v.createdAt==='string'&&(v.parentId===null||typeof v.parentId==='string')
  &&hash(v.sourceSha256)&&obj(v.source)&&['QUEUED','RESPONDING','REPLIED','FAILED','INTERRUPTED'].includes(String(v.modelStatus))
  &&(v.delivery===null||delivery(v.delivery));
export function validateWorkspaceData(path:string,data:unknown):boolean {
  if(path.endsWith('/workspace-drafts'))return Array.isArray(data)&&data.length<=64&&data.every(draft);
  if(path.endsWith('/artifact-preview'))return obj(data)&&typeof data.content==='string'&&(data.before===null||typeof data.before==='string')&&data.currentBytesVerified===true&&data.source==='RECORDED_HASH_MATCHED_LOCAL_BYTES'&&hash(data.sha256);
  if(path.endsWith('/prepare'))return obj(data)&&obj(data.request)&&data.request.action==='write_file'&&data.request.acceptance==='EXACT_UTF8_BYTES'&&typeof data.content==='string'&&hash(data.approvalSha256);
  if(path.endsWith('/evidence'))return obj(data)&&typeof data.draftId==='string'&&obj(data.source)&&(data.delivery===null||delivery(data.delivery))&&(data.inspection===null||obj(data.inspection));
  return draft(data);
}
const route=(project:string)=>'/projects/'+encodeURIComponent(project)+'/workspace/drafts';
export const workspaceApi={
  list:(project:string,conversation:string,signal?:AbortSignal)=>runtimeRequest<WorkspaceDraft[]>('/projects/'+encodeURIComponent(project)+'/conversations/'+encodeURIComponent(conversation)+'/workspace-drafts',{signal}),
  create:(project:string,body:{prompt:string;messageId:string;profileId:string;profileRevision:number;shareContent:true;conversationId:string|null;bindingId?:string;parentDraftId?:string})=>runtimeRequest<WorkspaceDraft>(route(project),{body,timeoutMs:40000}),
  get:(project:string,id:string)=>runtimeRequest<WorkspaceDraft>(route(project)+'/'+encodeURIComponent(id)),
  prepare:(project:string,id:string,filename:string)=>runtimeRequest<DeliveryProposal>(route(project)+'/'+encodeURIComponent(id)+'/prepare',{body:{filename}}),
  approve:(project:string,id:string,proposal:DeliveryProposal)=>runtimeRequest<WorkspaceDraft>(route(project)+'/'+encodeURIComponent(id)+'/approve',{body:{filename:proposal.request.filename,approvalSha256:proposal.approvalSha256}}),
  evidence:(project:string,id:string)=>runtimeRequest<DeliveryEvidence>(route(project)+'/'+encodeURIComponent(id)+'/evidence'),
  filePreview:(project:string,thread:string,path:string,sha256:string)=>runtimeRequest<ArtifactPreview>('/projects/'+encodeURIComponent(project)+'/threads/'+encodeURIComponent(thread)+'/artifact-preview',{body:{path,sha256}}),
};
