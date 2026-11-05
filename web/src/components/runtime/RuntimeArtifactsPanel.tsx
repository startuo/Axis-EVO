import {lazy,Suspense,useEffect,useState} from 'react';
import {Check,Download,FileCode2,FileText,GitCompareArrows,History,MessageSquarePlus} from 'lucide-react';
import type {WorkspaceController} from '../../hooks/useWorkspace';
import type {RuntimeThread} from '../../lib/runtime';
import {workspaceApi,type ArtifactPreview,type WorkspaceDraft} from '../../lib/workspace';
const SafeMarkdown=lazy(()=>import('../ui/SafeMarkdown').then(module=>({default:module.SafeMarkdown})));

function download(name:string,content:string){const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function changedRegion(before:string,after:string){const a=before.split('\n'),b=after.split('\n');let start=0,end=0;while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;return {removed:a.slice(start,a.length-end).join('\n'),added:b.slice(start,b.length-end).join('\n'),same:start===a.length&&start===b.length};}
function Changes({before,after}:{before:string;after:string}){const change=changedRegion(before,after);return change.same?<p className="caption">内容一致。</p>:<div className="next-change-region" aria-label="变化区间"><div><span>原内容</span><pre>{change.removed||'（无）'}</pre></div><div><span>新内容</span><pre>{change.added||'（无）'}</pre></div><p>只展示共同前后缀之间的变化区间。</p></div>;}

export function RuntimeArtifactsPanel({workspace,thread,mode,setMode,onContinue}:{workspace:WorkspaceController;thread:RuntimeThread|null;mode:'drafts'|'files';setMode:(mode:'drafts'|'files')=>void;onContinue:(draft:WorkspaceDraft)=>void}) {
  const selected=workspace.selected;
  const [filename,setFilename]=useState('网页整理.md');
  const [view,setView]=useState<'preview'|'changes'|'source'>('preview');
  const [file,setFile]=useState<ArtifactPreview|null>(null);
  const [fileBusy,setFileBusy]=useState(false);
  const [fileError,setFileError]=useState('');
  useEffect(()=>{setFilename(selected?.delivery?.filename??'网页整理.md');setView('preview');},[selected?.id,selected?.delivery?.filename]);
  useEffect(()=>{setFile(null);setFileError('');},[thread?.id]);
  const files=Array.from(new Map((thread?.run?.files??[]).map(item=>[item.path,item])).values()).filter(item=>item.exists&&item.sha256);
  const showFiles=mode==='files'||!workspace.drafts.length&&files.length>0;
  const openFile=async(path:string,sha256:string)=>{if(!thread)return;setFileBusy(true);setFileError('');try{setFile(await workspaceApi.filePreview(thread.projectId,thread.id,path,sha256));}catch(error){setFileError(error instanceof Error?error.message:'文件暂不可用。');}finally{setFileBusy(false);}};
  const currentFile=file?.threadId===thread?.id?file:null;
  const parent=workspace.drafts.find(d=>d.id===selected?.parentId);
  const statusText = selected?.delivery
    ? ({COMPLETED:selected.delivery.currentBytesVerified?'已保存，现场字节与批准内容一致':'保存记录仍在；现场文件已变化',
        EXECUTING:'正在保存已批准的内容', FAILED:'文件保存未通过验收，请查看执行证据',
        REJECTED:'本次保存已拒绝，没有确认交付文件', UNKNOWN:'保存结果未知；不会自动重试'}[selected.delivery.state])
    : selected?.modelStatus==='FAILED'?'文档生成失败，请查看对话中的记录'
    : selected?.modelStatus==='INTERRUPTED'?'文档生成已中断，请查看对话中的记录'
    : selected?.content?'由模型生成，保存前可核对内容':'正在等待完整模型回复';
  return <div className="next-artifacts-panel">
    {!!workspace.drafts.length&&!!files.length&&<div className="next-view-switch" role="group" aria-label="交付物来源"><button aria-pressed={!showFiles} onClick={()=>setMode('drafts')}>协作文档</button><button aria-pressed={showFiles} onClick={()=>setMode('files')}>任务文件</button></div>}
    {workspace.error&&<p className="next-inline-notice" role="alert">{workspace.error}</p>}
    {workspace.busy&&<p className="next-live-state" role="status"><span className="next-state-orbit"/>{workspace.busy}</p>}
    {showFiles?<><div className="next-panel-intro"><FileCode2 size={21}/><div><h2>本轮任务文件</h2><p>内容与持久化摘要一致后才展示</p></div></div><div className="next-file-list">{files.map(item=><button key={item.path} disabled={fileBusy} onClick={()=>void openFile(item.path,item.sha256!)}><FileText size={15}/><span>{item.path}</span><small>{item.sizeBytes} B</small></button>)}</div>{fileError&&<p className="next-inline-notice" role="alert">{fileError}</p>}{currentFile&&<><div className="next-artifact-title"><h2>{currentFile.path}</h2><span><Check size={12}/>字节已核对</span></div><div className="next-view-switch" role="group" aria-label="文件查看方式"><button aria-pressed={view!=='changes'} onClick={()=>setView('source')}>文件内容</button><button aria-pressed={view==='changes'} onClick={()=>setView('changes')}><GitCompareArrows size={13}/>修改差异</button></div>{view==='changes'?<Changes before={currentFile.before??''} after={currentFile.content}/>:<pre className="next-artifact-source">{currentFile.content}</pre>}<button className="button secondary" onClick={()=>download(currentFile.path.split('/').at(-1)??'文件.txt',currentFile.content)}><Download size={14}/>下载已核对的版本</button><p className="caption">文件内容不替代任务验收或工具因果记录。</p></>}</>:selected?<>
      <label className="field-label next-version-selector"><History size={13}/>文档版本<select aria-label="文档版本" value={selected.id} onChange={event=>workspace.select(event.target.value)}>{workspace.drafts.map(draft=><option key={draft.id} value={draft.id}>版本 {draft.version} · {draft.prompt.slice(0,35)}</option>)}</select></label>
      <div className="next-artifact-title"><span className="next-eyebrow">MARKDOWN · v{selected.version}</span><h2>{selected.delivery?.filename??'文档草稿'}</h2><p role="status">{statusText}</p></div>
      {selected.content&&<><div className="next-view-switch" role="group" aria-label="文档查看方式"><button aria-pressed={view==='preview'} onClick={()=>setView('preview')}>预览</button><button aria-pressed={view==='source'} onClick={()=>setView('source')}>Markdown</button>{parent&&<button aria-pressed={view==='changes'} onClick={()=>setView('changes')}>版本差异</button>}</div><div className="next-document-preview">{view==='changes'&&parent?<Changes before={parent.content} after={selected.content}/>:view==='source'?<pre className="next-artifact-source">{selected.content}</pre>:<Suspense fallback={<pre className="next-artifact-source">{selected.content}</pre>}><SafeMarkdown text={selected.content}/></Suspense>}</div>
      <div className="next-artifact-actions"><button className="button secondary" disabled={!!workspace.busy} onClick={()=>onContinue(selected)}><MessageSquarePlus size={14}/>继续修改</button>{selected.delivery?.state==='COMPLETED'&&selected.delivery.currentBytesVerified&&<button className="button secondary" onClick={()=>download(selected.delivery!.filename,selected.content)}><Download size={14}/>下载</button>}</div>
      {!selected.delivery&&<section className="next-save-document"><label className="field-label">保存文件名<input aria-label="Markdown 文件名" value={filename} maxLength={80} onChange={event=>setFilename(event.target.value)}/></label>{!workspace.proposal?<button className="button primary" disabled={!!workspace.busy} onClick={()=>void workspace.prepare(filename)}>准备保存到本地</button>:<div className="next-action-approval"><span className="next-eyebrow">等待你的批准</span><h3>保存 {workspace.proposal.request.filename}</h3><p>将当前版本写入独立交付目录，验收精确 UTF-8 字节；保留所有旧版本。</p><button className="button primary" disabled={!!workspace.busy} onClick={()=>void workspace.approve()}>批准并保存</button><details><summary>内容与批准摘要</summary><code>{workspace.proposal.request.contentSha256}</code><code>{workspace.proposal.approvalSha256}</code></details></div>}</section>}
      {selected.delivery&&<details className="next-artifact-location"><summary>{selected.delivery.state==='COMPLETED'?'本地文件位置':'预定文件位置'}</summary><code>{selected.delivery.path}</code></details>}
      <details className="next-artifact-evidence"><summary onClick={()=>{if(!workspace.evidence)void workspace.inspect();}}>来源与执行证据</summary>{workspace.evidence?<pre>{JSON.stringify(workspace.evidence,null,2)}</pre>:<p className="caption">读取证据中…</p>}</details></>}
    </>:<div className="next-panel-empty"><FileText size={28}/><h3>成果，放在一起</h3><p>关联一个网页交付整理任务，或完成一次文件任务。生成的文档、版本差异和本地文件会显示在这里。</p></div>}
  </div>;
}
