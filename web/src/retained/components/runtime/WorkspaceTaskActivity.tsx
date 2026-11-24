import {Check,FileText,Globe2,LoaderCircle,TriangleAlert} from 'lucide-react';
import type {WorkspaceDraft} from '../../lib/workspace';

export function WorkspaceTaskActivity({draft,open}:{draft:WorkspaceDraft;open:()=>void}) {
  const pending=['QUEUED','RESPONDING'].includes(draft.modelStatus);
  const saving=draft.delivery?.state==='EXECUTING';
  const saved=draft.delivery?.state==='COMPLETED';
  const uncertain=draft.delivery?.state==='UNKNOWN';
  const failed=['FAILED','INTERRUPTED'].includes(draft.modelStatus)||['FAILED','REJECTED'].includes(draft.delivery?.state??'');
  const label=uncertain?'保存结果需要核对':failed?'这次工作尚未完成':saving?'正在保存已批准的文档':saved?(draft.delivery?.currentBytesVerified?'文档已保存，字节验收通过':'保存有记录，现场文件已变化'):pending?'正在整理材料':'文档草稿已准备好';
  const Icon=uncertain||failed?TriangleAlert:pending||saving?LoaderCircle:Check;
  return <div className="next-workspace-activity"><div className="next-activity-heading" role="status"><Icon size={16} className={pending||saving?'loader':''}/><span>{label}</span></div><p><Globe2 size={12}/>{draft.source.kind==='EDGE_PAGE'?'已读取所选 Edge 网页':'沿用已选文档版本'}<span aria-hidden="true">·</span>版本 {draft.version}</p>{draft.source.contextTruncated===true&&<p>材料较长，本次仅使用截取片段。</p>}{!pending&&draft.content&&<button className="next-artifact-message" onClick={open}><span className="next-artifact-type"><FileText size={20}/></span><span><strong>{draft.delivery?.filename??'Markdown 文档草稿'}</strong><small>{saved?'已保存版本':saving?'保存进行中':'预览并保存到本地'}</small></span><span className="next-artifact-open">打开</span></button>}{uncertain&&<p className="next-activity-warning">不会重复保存。请先查看交付证据。</p>}</div>;
}
