import {useCallback,useEffect,useRef,useState} from 'react';
import {edgeApi,type EdgeBinding,type EdgeOperation,type EdgeProposal,type EdgeStatus,type EdgeTab} from '../lib/browser';
import {RuntimeError} from '../lib/runtime';

const messages:Record<string,string>={EDGE_OFFLINE:'指定的 Edge 实例未连接，请打开扩展重新连接。',EDGE_TAB_CHANGED:'标签页已变化，请重新选择页面。',EDGE_SITE_PERMISSION_REQUIRED:'请在 Edge 扩展中允许访问当前网站。',AXIS_HANDOFF_REQUIRED:'此操作需要你在 Edge 中接管。',EDGE_SCREENSHOT_REQUIRES_ACTIVE_TAB:'先在 Edge 中打开已绑定的标签页，再获取预览。',EDGE_SNAPSHOT_REQUIRED:'请先读取页面，再选择操作。',EDGE_APPROVAL_REJECTED:'操作批准已过期或摘要不一致，请重新审查。',BROWSER_STORAGE_UNPREPARED:'先启用本地 Edge 工作区，再连接浏览器。'};
export function useEdgeBrowser(enabled:boolean) {
  const [status,setStatus]=useState<EdgeStatus|null>(null);
  const [instanceId,setInstanceId]=useState('');
  const [binding,setBinding]=useState<EdgeBinding|null>(null);
  const [tabs,setTabs]=useState<EdgeTab[]>([]);
  const [operation,setOperation]=useState<EdgeOperation|null>(null);
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
    const read=async()=>{try{const result=await edgeApi.status(abort.signal);if(!abort.signal.aborted){setStatus(result);timer=setTimeout(()=>void read(),3500);}}catch(e){if(!abort.signal.aborted)report(e);}};
    void read();return()=>{abort.abort();clearTimeout(timer);};
  },[enabled,report]);
  const run=useCallback(async<T,>(label:string,job:()=>Promise<T>,accept:(result:T)=>void)=>{
    if(lock.current)return;lock.current=true;setBusy(label);setError('');
    try{const result=await job();if(alive.current)accept(result);}catch(e){if(alive.current)report(e);}finally{lock.current=false;if(alive.current)setBusy('');}
  },[report]);
  const accept=useCallback((result:{operation:EdgeOperation;binding:EdgeBinding|null})=>{setOperation(result.operation);setBinding(result.binding);setProposal(null);if(result.operation.state==='UNKNOWN')setError('执行结果未能确认。已停止继续操作，不会自动重试。');else if(result.operation.result?.ok===false){const code=result.operation.result.error?.code??'';const screenshotUnavailable=result.operation.action==='screenshot'&&code==='EDGE_ACTION_NOT_CONFIRMED';setError(screenshotUnavailable?'本次未取得 Edge 截图，可通过“在 Edge 打开”查看原页面。失败回执已保留；不会自动重试。':messages[code]??'浏览器未完成此操作，请查看证据或接管。');}},[]);
  const connect=()=>run('连接 Edge',edgeApi.connect,setStatus);
  const prepareStorage=()=>run('准备本地工作区',edgeApi.prepareStorage,setStatus);
  const loadTabs=(id:string)=>{setInstanceId(id);setBinding(null);setProposal(null);return run('获取标签页',()=>edgeApi.tabs(id),result=>{setOperation(result);setTabs(result.result?.data?.tabs??[]);});};
  const selectTab=(tabId:number)=>run('关联标签页',()=>edgeApi.bind(instanceId,tabId),accept);
  const observe=(action:'snapshot'|'read'|'screenshot'|'focus')=>binding&&run(action==='screenshot'?'获取页面预览':action==='focus'?'打开 Edge 标签页':'正在读取页面',()=>edgeApi.observe(binding.id,action),accept);
  const prepareAction=(action:string,params:Record<string,unknown>)=>binding&&run('准备操作',()=>edgeApi.prepareAction(binding.id,action,params),setProposal);
  const approve=()=>proposal&&run('执行已批准操作',()=>edgeApi.approveAction(proposal),accept);
  const handoff=()=>binding&&run('交还控制',()=>edgeApi.handoff(binding.id),result=>{setBinding(result.binding);setProposal(null);});
  return {status,instanceId,binding,tabs,operation,proposal,busy,error,connect,prepareStorage,loadTabs,selectTab,observe,prepareAction,approve,handoff,setError,setBinding};
}
export type EdgeBrowserController=ReturnType<typeof useEdgeBrowser>;
