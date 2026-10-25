import {useEffect,useState} from 'react';
import {runtimeApi,type RuntimeInvocation,type RuntimeThread} from '../../lib/runtime';

const labels:Record<string,string>={path:'文件',content:'写入内容',old:'查找文本',new:'替换为'};
export function RuntimeInvocationDetail({thread,callId,open}:{thread:RuntimeThread;callId:string;open:boolean}) {
  const [detail,setDetail]=useState<RuntimeInvocation|null>(null);
  const [error,setError]=useState('');
  const evidenceVersion=thread.run?.events.length??0;
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    runtimeApi.invocation(thread.projectId,thread.id,callId,controller.signal).then(value=>{if(!controller.signal.aborted){setDetail(value);setError('');}}).catch(()=>{
      if(!controller.signal.aborted)setError('调用详情未能读取，请在证据面板核对。');
    });
    return()=>controller.abort();
  },[open,thread.id,thread.projectId,callId,evidenceVersion]);
  if(error)return <p role="status">{error}</p>;
  if(!detail)return <p role="status">正在读取已记录的调用…</p>;
  return <div className="tool-readable-detail">
    <dl>{Object.entries(detail.arguments).map(([name,value])=><div key={name}><dt>{labels[name]??name}</dt><dd><pre>{typeof value==='string'?value:JSON.stringify(value)}</pre></dd></div>)}</dl>
    {detail.result?<><p>{detail.result.status==='SUCCESS'?'工具返回成功':detail.result.status==='TIMEOUT'?'工具超时':'工具返回失败'}：{detail.result.message}</p>{typeof detail.result.data.content==='string'&&<><p className="caption">读取内容</p><pre>{detail.result.data.content}</pre></>}</>:<p>尚无工具结果，不能确认执行结果。</p>}
    <p className="caption">来自已保存的工具记录；工具成功不代表任务通过独立验收。</p>
  </div>;
}
