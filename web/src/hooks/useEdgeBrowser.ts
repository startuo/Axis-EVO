import {useCallback,useEffect,useRef,useState} from 'react';
import {edgeApi,type EdgeBinding,type EdgeObservation,type EdgeOperation,type EdgeProposal,type EdgeStatus,type EdgeTab} from '../lib/browser';
import {RuntimeError} from '../lib/runtime';

const messages:Record<string,string>={EDGE_OFFLINE:'指定的 Edge 实例未连接，请打开扩展重新连接。',EDGE_TAB_CHANGED:'标签页已变化，请重新选择页面。',EDGE_SITE_PERMISSION_REQUIRED:'请在 Edge 扩展中允许访问当前网站。',AXIS_HANDOFF_REQUIRED:'此操作需要你在 Edge 中接管。',EDGE_SCREENSHOT_REQUIRES_ACTIVE_TAB:'先在 Edge 中打开已绑定的标签页，再获取预览。',EDGE_SNAPSHOT_REQUIRED:'请先读取页面，再选择操作。',EDGE_APPROVAL_REJECTED:'操作批准已过期或摘要不一致，请重新审查。',BROWSER_STORAGE_UNPREPARED:'先启用本地 Edge 工作区，再连接浏览器。'};
Object.assign(messages,{
  EDGE_DOCUMENT_TIMEOUT:'Edge 未及时返回页面信息，已停止本次读取；不会自动重试，请在原标签页检查。',
  EDGE_TAB_NOT_READY:'页面已被 Edge 休眠或冻结，请先在 Edge 打开原页，再重新选择。',
  EDGE_CONTENT_SCRIPT_UNAVAILABLE:'Edge 未能加载扩展内的页面脚本，请重新载入完整的 edge-extension 目录。',
  EDGE_SCRIPT_INJECTION_FAILED:'Edge 未能执行页面脚本。此回执不能证明权限不足，请保留记录并在原页面接管。',
  EDGE_DEBUGGER_CONFLICT:'Edge 明确报告调试器占用冲突；请结束该页面的其他调试会话后再关联。',
  EDGE_EXTENSION_UPDATED:'扩展刚刚更新，请重新选择标签页。',
  EDGE_SCREENSHOT_PERMISSION_REQUIRED:'Edge 尚未授予截图权限。请在原标签页打开一次 Axis-Evo 扩展，再返回获取预览。',
  EDGE_SCREENSHOT_RATE_LIMITED:'Edge 已限制本次截图频率。不会自动重试，可在原标签页查看。',
  EDGE_SCREENSHOT_WINDOW_UNAVAILABLE:'原 Edge 窗口已关闭或不可用，请重新选择页面。',
  EDGE_SCREENSHOT_CAPTURE_FAILED:'Edge 截图 API 未返回图像，可通过“在 Edge 打开”查看原页面。',
  EDGE_SCREENSHOT_INVALID_DATA:'Edge 截图回执没有有效图像，已保留失败记录。',
  EDGE_SCREENSHOT_TOO_LARGE:'本次截图超过预览大小限制，可通过“在 Edge 打开”查看原页面。',
  EDGE_SCREENSHOT_IDENTITY_UNCONFIRMED:'截图前后未能核对页面身份，未展示图像；请在原标签页查看。',
});
export function useEdgeBrowser(enabled:boolean) {
  const [status,setStatus]=useState<EdgeStatus|null>(null);
  const [instanceId,setInstanceId]=useState('');
  const [binding,setBinding]=useState<EdgeBinding|null>(null);
  const [tabs,setTabs]=useState<EdgeTab[]>([]);
  const [operation,setOperation]=useState<EdgeOperation|null>(null);
  const [snapshot,setSnapshot]=useState<EdgeObservation|null>(null);
  const [proposal,setProposal]=useState<EdgeProposal|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const lock=useRef(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const report=useCallback((e:unknown)=>setError(e instanceof RuntimeError?(messages[e.code]??e.message):'本次浏览器操作未确认。请查看记录，不会自动重复操作。'),[]);
  useEffect(()=>{
    if(!enabled)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const read=async()=>{try{const result=await edgeApi.status(abort.signal);if(!abort.signal.aborted){setStatus(result);setBinding(current=>{
      if(!current?.active)return current;
      const remote=result.bindings.find(item=>item.id===current.id);
      const connected=result.instances.some(item=>item.id===current.instanceId&&item.connected);
      return remote?.active&&connected?current:{...current,active:false,snapshotId:null};
    });timer=setTimeout(()=>void read(),3500);}}catch(e){if(!abort.signal.aborted)report(e);}};
    void read();return()=>{abort.abort();clearTimeout(timer);};
  },[enabled,report]);
  const run=useCallback(async<T,>(label:string,job:()=>Promise<T>,accept:(result:T)=>void)=>{
    if(lock.current)return;lock.current=true;setBusy(label);setError('');
    try{const result=await job();if(alive.current)accept(result);}catch(e){if(alive.current)report(e);}finally{lock.current=false;if(alive.current)setBusy('');}
  },[report]);
  const accept=useCallback((result:{operation:EdgeOperation;binding:EdgeBinding|null})=>{setOperation(result.operation);setBinding(result.binding);setProposal(null);
    const observed=result.operation.result?.data;
    if(result.operation.result?.ok&&observed?.snapshotId&&observed.snapshotId===result.binding?.snapshotId)setSnapshot(observed);
    if(result.operation.state==='UNKNOWN')setError('执行结果未能确认。已停止继续操作，不会自动重试。');else if(result.operation.result?.ok===false){const code=result.operation.result.error?.code??'';const screenshotUnavailable=result.operation.action==='screenshot'&&code==='EDGE_ACTION_NOT_CONFIRMED';setError(screenshotUnavailable?'本次未取得 Edge 截图，可通过“在 Edge 打开”查看原页面。失败回执已保留；不会自动重试。':messages[code]??'浏览器未完成此操作，请查看证据或接管。');}},[]);
  const connect=()=>run('连接 Edge',edgeApi.connect,setStatus);
  const prepareStorage=()=>run('准备本地工作区',edgeApi.prepareStorage,setStatus);
  const loadTabs=(id:string)=>{setInstanceId(id);setBinding(null);setProposal(null);return run('获取标签页',()=>edgeApi.tabs(id),result=>{setOperation(result);setTabs(result.result?.data?.tabs??[]);});};
  const selectTab=(tabId:number)=>run('关联标签页',()=>edgeApi.bind(instanceId,tabId),accept);
  const observe=(action:'snapshot'|'read'|'screenshot'|'focus')=>binding&&run(action==='screenshot'?'切换原页并获取预览':action==='focus'?'打开 Edge 标签页':'正在读取页面',async()=>{
    if(action==='screenshot'){
      const focused=await edgeApi.observe(binding.id,'focus');
      if(focused.operation.state!=='RESULT'||focused.operation.result?.ok!==true||!focused.binding?.active||focused.binding.id!==binding.id)return focused;
    }
    return edgeApi.observe(binding.id,action);
  },accept);
  const prepareAction=(action:string,params:Record<string,unknown>)=>binding&&run('准备操作',()=>edgeApi.prepareAction(binding.id,action,params),setProposal);
  const currentProposal=binding?.active&&proposal?.request.binding.snapshotId===binding.snapshotId?proposal:null;
  const approve=()=>currentProposal&&run('执行已批准操作',()=>edgeApi.approveAction(currentProposal),accept);
  const handoff=()=>binding&&run('交还控制',()=>edgeApi.handoff(binding.id),result=>{setBinding(result.binding);setProposal(null);});
  return {status,instanceId,binding,tabs,operation,snapshot:binding?.active&&snapshot?.snapshotId===binding.snapshotId?snapshot:null,proposal:currentProposal,busy,error,connect,prepareStorage,loadTabs,selectTab,observe,prepareAction,approve,handoff,setError,setBinding};
}
export type EdgeBrowserController=ReturnType<typeof useEdgeBrowser>;
