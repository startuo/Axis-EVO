import {useCallback,useEffect,useRef,useState} from 'react';
import {workspaceApi,type DeliveryEvidence,type DeliveryProposal,type WorkspaceDraft} from '../lib/workspace';
import type {RuntimeProfile} from '../lib/runtime';

export function useWorkspace(project:string,conversation:string|null,enabled:boolean) {
  const [drafts,setDrafts]=useState<WorkspaceDraft[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [proposal,setProposal]=useState<DeliveryProposal|null>(null);
  const [evidence,setEvidence]=useState<DeliveryEvidence|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const alive=useRef(true);
  const lock=useRef(false);
  const epoch=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{epoch.current++;setSelectedId('');setProposal(null);setEvidence(null);setDrafts([]);},[project,conversation]);
  useEffect(()=>{
    if(!enabled||!project||!conversation)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const read=async()=>{try{const rows=await workspaceApi.list(project,conversation,abort.signal);if(!abort.signal.aborted){setDrafts(rows);setSelectedId(current=>rows.some(d=>d.id===current)?current:rows.at(-1)?.id??'');timer=setTimeout(()=>void read(),rows.some(d=>['QUEUED','RESPONDING'].includes(d.modelStatus)||d.delivery?.state==='EXECUTING')?1000:5000);}}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'交付记录暂不可用。');}};
    void read();return()=>{abort.abort();clearTimeout(timer);};
  },[project,conversation,enabled,revision]);
  const run=useCallback(async<T,>(label:string,job:()=>Promise<T>,accept:(result:T)=>void)=>{
    if(lock.current)return;const requested=epoch.current;lock.current=true;setBusy(label);setError('');
    try{const result=await job();if(alive.current&&epoch.current===requested){accept(result);return result;}}catch(e){if(alive.current&&epoch.current===requested)setError(e instanceof Error?e.message:'操作未确认，请重新查看记录。');}finally{lock.current=false;if(alive.current)setBusy('');}
  },[]);
  const selected=drafts.find(d=>d.id===selectedId)??null;
  const send=(prompt:string,profile:RuntimeProfile,context:{bindingId:string}|{parentDraftId:string})=>run('读取材料并提交整理任务',()=>workspaceApi.create(project,{prompt,profileId:profile.id,profileRevision:profile.revision,messageId:'msg_'+crypto.randomUUID().replaceAll('-',''),shareContent:true,conversationId:conversation,...context}),result=>{setDrafts(current=>[...current.filter(d=>d.id!==result.id),result]);setSelectedId(result.id);setRevision(r=>r+1);});
  const prepare=(filename:string)=>selected&&run('准备保存',()=>workspaceApi.prepare(project,selected.id,filename),setProposal);
  const approve=()=>selected&&proposal&&run('保存已批准的文档',()=>workspaceApi.approve(project,selected.id,proposal),result=>{setProposal(null);setDrafts(rows=>rows.map(d=>d.id===result.id?result:d));setRevision(r=>r+1);});
  const inspect=()=>selected&&run('读取交付证据',()=>workspaceApi.evidence(project,selected.id),setEvidence);
  const select=(id:string)=>{setSelectedId(id);setProposal(null);setEvidence(null);};
  return {drafts,selected,selectedId,proposal,evidence,busy,error,send,prepare,approve,inspect,select,setError};
}
export type WorkspaceController=ReturnType<typeof useWorkspace>;
