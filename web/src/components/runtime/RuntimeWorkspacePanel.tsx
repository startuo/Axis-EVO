import type {ReactNode} from 'react';
import {FileCheck2,FileText,Globe2,ListChecks,PanelRightClose} from 'lucide-react';
import type {RuntimeThread} from '../../lib/runtime';
import type {EdgeBrowserController} from '../../hooks/useEdgeBrowser';
import {RuntimeProposalReview} from './RuntimeProposal';
import {EdgeBrowserPanel} from './EdgeBrowserPanel';

export type WorkspacePanelTab='browser'|'artifacts'|'plan'|'evidence';
const tabs=[{id:'browser',label:'网页',Icon:Globe2},{id:'artifacts',label:'交付物',Icon:FileText},{id:'plan',label:'计划',Icon:ListChecks},{id:'evidence',label:'证据',Icon:FileCheck2}] as const;
export function RuntimeWorkspacePanel({tab,selectTab,close,edge,thread,approve,busy,canAct,evidence,artifacts,onAttach}:{tab:WorkspacePanelTab;selectTab:(tab:WorkspacePanelTab)=>void;close:()=>void;edge:EdgeBrowserController;thread:RuntimeThread|null;approve:()=>void;busy:boolean;canAct:boolean;evidence:ReactNode;artifacts?:ReactNode;onAttach?:()=>void}) {
  return <div className="next-work-panel"><header className="next-work-panel-heading"><span>工作面板</span><button className="icon-button" aria-label="关闭工作面板" onClick={close}><PanelRightClose size={17}/></button></header><div className="next-work-tabs" role="tablist" aria-label="工作面板内容">{tabs.map(({id,label,Icon},index)=><button key={id} role="tab" id={'workspace-'+id} aria-selected={tab===id} aria-controls="workspace-panel" tabIndex={tab===id?0:-1} onClick={()=>selectTab(id)} onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=tabs[(index+(event.key==='ArrowRight'?1:3))%4];selectTab(next.id);requestAnimationFrame(()=>document.getElementById('workspace-'+next.id)?.focus());}}}><Icon size={14}/>{label}{id==='plan'&&thread?.status==='AWAITING_APPROVAL'&&<span className="next-attention-dot"/>}</button>)}</div><section className="next-work-body" id="workspace-panel" role="tabpanel" aria-labelledby={'workspace-'+tab} tabIndex={0}>
    {tab==='browser'?<EdgeBrowserPanel edge={edge} onAttach={onAttach}/>:tab==='plan'?thread?.proposal?<div className="next-plan-panel"><span className="next-eyebrow">{thread.status==='AWAITING_APPROVAL'?'等待你的批准':'本轮固定计划'}</span><h2>准备完成这些操作</h2><p>核对修改内容和影响范围，再决定是否执行。</p><RuntimeProposalReview thread={thread} busy={busy} canAct={canAct} onApprove={approve}/></div>:<div className="next-panel-empty"><ListChecks size={28}/><h3>计划会显示在这里</h3><p>文件修改与网页交互需要相应的明确批准。</p></div>:tab==='artifacts'?artifacts??<div className="next-panel-empty"><FileText size={28}/><h3>成果，放在一起</h3><p>已生成的文档、文件预览和修改差异会显示在这里。</p></div>:<div className="next-deep-evidence">{evidence}</div>}
  </section></div>;
}
