import {runtimeRequest} from './runtime';

export type EdgeBinding = {id:string;instanceId:string;tabId:number;windowId:number;documentId:string;urlSha256:string;url:string;title:string;snapshotId:string|null;active:boolean;snapshotSha256?:string;snapshotOperationId?:string};
export type EdgeInstance = {id:string;label:string;browser:'Microsoft Edge';version:string;extensionId:string;connected:boolean};
export type EdgeTab = {id:number;windowId:number;title:string;url:string;active:boolean};
export type EdgeStatus = {prepared:boolean;running:boolean;port:number;protocol:2;connectionError?:string|null;extensionDirectory:string;instances:EdgeInstance[];bindings:EdgeBinding[];limitations:string[]};
export type EdgeObservation = {tabId?:number;documentId?:string;urlSha256?:string;text?:string;snapshot?:string;snapshotId?:string;image?:string;tabs?:EdgeTab[];businessOutcome?:string;actionIssued?:boolean};
export type EdgeOperation = {id:string;instanceId:string;bindingId:string|null;action:string;request:Record<string,unknown>;requestSha256:string;createdAt:string;state:'QUEUED'|'DISPATCHED'|'RESULT'|'REJECTED'|'UNKNOWN';result:{ok?:boolean;data?:EdgeObservation;error?:{code:string;message?:string;diagnostic?:{stage:string}};code?:string;source?:string}|null;facts:{seq:number;kind:string;payload:Record<string,unknown>;createdAt:string}[]};
export type EdgeProposal = {id:string;request:{action:string;params:Record<string,unknown>;binding:EdgeBinding};approvalSha256:string};
export type EdgeResult = {operation:EdgeOperation;binding:EdgeBinding|null};

const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const tab=(v:unknown)=>object(v)&&Number.isInteger(v.id)&&Number(v.id)>=0&&Number.isInteger(v.windowId)
  &&typeof v.title==='string'&&typeof v.url==='string'&&/^https?:\/\//.test(v.url)&&typeof v.active==='boolean';
const binding=(v:unknown)=>object(v)&&typeof v.id==='string'&&typeof v.instanceId==='string'
  &&Number.isInteger(v.tabId)&&Number(v.tabId)>=0&&Number.isInteger(v.windowId)&&typeof v.documentId==='string'
  &&hash(v.urlSha256)&&(v.snapshotId===null||typeof v.snapshotId==='string')&&typeof v.active==='boolean'
  &&typeof v.title==='string'&&typeof v.url==='string'&&/^https?:\/\//.test(v.url);
function observation(v:unknown):boolean {
  if(!object(v))return false;
  if(['text','snapshot','snapshotId','image','documentId','urlSha256','businessOutcome'].some(key=>v[key]!==undefined&&typeof v[key]!=='string'))return false;
  return v.tabs===undefined||Array.isArray(v.tabs)&&v.tabs.length<=80&&v.tabs.every(tab);
}
function receipt(v:unknown):boolean {
  return v===null||object(v)&&(v.ok===undefined||typeof v.ok==='boolean')
    &&(v.data===undefined||v.data===null||observation(v.data))
    &&(v.error===undefined||v.error===null||object(v.error)&&typeof v.error.code==='string'&&(v.error.message===undefined||typeof v.error.message==='string')
      &&(v.error.diagnostic===undefined||object(v.error.diagnostic)&&Object.keys(v.error.diagnostic).length===1
        &&['before_identity','before_active_tab','capture','image_validation','after_identity','after_active_tab'].includes(String(v.error.diagnostic.stage))));
}
const operation=(v:unknown)=>object(v)&&typeof v.id==='string'&&/^edgeop_[a-f0-9]{32}$/.test(v.id)
  &&typeof v.instanceId==='string'&&(v.bindingId===null||typeof v.bindingId==='string')&&typeof v.action==='string'
  &&object(v.request)&&hash(v.requestSha256)&&typeof v.createdAt==='string'&&receipt(v.result)
  &&['QUEUED','DISPATCHED','RESULT','REJECTED','UNKNOWN'].includes(String(v.state))
  &&Array.isArray(v.facts)&&v.facts.length<=5&&v.facts.every(f=>object(f)&&Number.isInteger(f.seq)&&typeof f.kind==='string'&&object(f.payload)&&typeof f.createdAt==='string');
export function validateBrowserData(path:string,data:unknown):boolean {
  if(!object(data))return false;
  if(path==='/browser/status'||path==='/browser/prepare-storage'||path==='/browser/connect')return typeof data.prepared==='boolean'&&typeof data.running==='boolean'&&data.protocol===2&&typeof data.extensionDirectory==='string'&&Array.isArray(data.instances)&&data.instances.every(i=>object(i)&&i.browser==='Microsoft Edge'&&typeof i.id==='string'&&typeof i.label==='string'&&typeof i.version==='string'&&typeof i.extensionId==='string'&&typeof i.connected==='boolean')&&Array.isArray(data.bindings)&&data.bindings.every(binding);
  if(path==='/browser/tabs'||path.startsWith('/browser/operations/'))return operation(data);
  if(path==='/browser/bind'||path==='/browser/observe'||path==='/browser/approve-action')return operation(data.operation)&&(data.binding===null||binding(data.binding));
  if(path==='/browser/prepare-action')return typeof data.id==='string'&&object(data.request)&&binding(data.request.binding)&&typeof data.approvalSha256==='string'&&/^[a-f0-9]{64}$/.test(data.approvalSha256);
  if(path==='/browser/handoff')return data.handoffRequired===true&&binding(data.binding);
  return false;
}

const post=<T,>(route:string,body:unknown)=>runtimeRequest<T>('/browser/'+route,{body,timeoutMs:35000});
export const edgeApi={
  status:(signal?:AbortSignal)=>runtimeRequest<EdgeStatus>('/browser/status',{signal}),
  prepareStorage:()=>post<EdgeStatus>('prepare-storage',{}),
  connect:()=>post<EdgeStatus>('connect',{}),
  tabs:(instanceId:string)=>post<EdgeOperation>('tabs',{instanceId}),
  bind:(instanceId:string,tabId:number)=>post<EdgeResult>('bind',{instanceId,tabId}),
  observe:(bindingId:string,action:'snapshot'|'read'|'screenshot'|'focus')=>post<EdgeResult>('observe',{bindingId,action}),
  prepareAction:(bindingId:string,action:string,params:Record<string,unknown>)=>post<EdgeProposal>('prepare-action',{bindingId,action,params}),
  approveAction:(proposal:EdgeProposal)=>post<EdgeResult>('approve-action',{proposalId:proposal.id,approvalSha256:proposal.approvalSha256}),
  handoff:(bindingId:string)=>post<{binding:EdgeBinding;handoffRequired:true}>('handoff',{bindingId}),
};
