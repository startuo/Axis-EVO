const status=document.querySelector('#status');
const call=async message=>{const result=await chrome.runtime.sendMessage(message);if(result?.error)throw new Error(result.error.code);return result;};
const report=error=>{status.textContent=error.message==='EDGE_REQUIRED'?'请使用 Microsoft Edge。':'正在等待本地 Axis-Evo…';};
const refresh=async()=>{try{const s=await call({type:'status'});status.textContent=s.connected?'已连接 · '+s.instanceId.slice(-8):'正在等待本地 Axis-Evo…';}catch(e){report(e);}};
document.querySelector('#connect').addEventListener('click',async()=>{await call({type:'connect'});await refresh();});
document.querySelector('#disconnect').addEventListener('click',async()=>{await call({type:'disconnect'});await refresh();});
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
let site;
try{const url=new URL(tab?.url);if(!['http:','https:'].includes(url.protocol))throw new Error();site=url.origin;document.querySelector('#site').textContent=site;}catch{document.querySelector('#site').textContent='此页面受浏览器保护，无法读取。';document.querySelector('#grant').disabled=true;}
document.querySelector('#grant').addEventListener('click',async()=>{if(!site)return;try{const granted=await chrome.permissions.request({origins:[site+'/*']});document.querySelector('#site').textContent=granted?'已允许访问 '+site:'未授权，Axis 将安全停止。';}catch{document.querySelector('#site').textContent='权限未确认，请在 Edge 中检查。';}});
await refresh();
setInterval(()=>void refresh(),2000);
