import {redactCreds} from './vendor/redact.js';

const PROTOCOL = 2;
const READ = new Set(['tabs','bind','snapshot','read','screenshot','focus']);
const WRITE = new Set(['click','type','select','scroll']);
let polling = false;
let receipt = null;
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
const safeUrl = raw => { try {const u=new URL(raw);return ['http:','https:'].includes(u.protocol)?u.origin+u.pathname:'';} catch {return '';} };
const scrub = value => redactCreds(String(value??'').replace(/https?:\/\/[^\s<>"\])]+/g, safeUrl)).text
  .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[^\s]+)/gi,'[凭据已隐去]');
const failure = code => {const error=new Error(code);error.code=code;return error;};

async function request(session, route, body) {
  const headers={'Content-Type':'application/json'};
  if(session.connectionId) headers['X-Axis-Connection']=session.connectionId;
  const response=await fetch(session.bridgeUrl+route,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(18000)});
  const data=await response.json();
  if(!response.ok) throw failure(data.error?.code??'EDGE_BRIDGE_UNAVAILABLE');
  return data;
}

async function metadata(tabId) {
  const tab=await chrome.tabs.get(tabId);
  const url=safeUrl(tab.url);
  if(!url||tab.incognito||/^(?:https?:\/\/127\.0\.0\.1:(?:5173|8765|8767))(?:\/|$)/.test(url)) throw failure('EDGE_PROTECTED_PAGE');
  // The browser enforces optional-site or activeTab permissions at injection.
  let injected;
  try {injected=await chrome.scripting.executeScript({target:{tabId},files:['vendor/content.js']});}
  catch {throw failure('EDGE_SITE_PERMISSION_REQUIRED');}
  const state=await chrome.scripting.executeScript({target:{tabId},func:()=>{
    if(document.title.includes('Axis-Evo')&&document.querySelector('[aria-label="任务输入区"]'))return {protected:true};
    window.__axisEdgeDocumentId??=crypto.randomUUID();
    return {documentId:window.__axisEdgeDocumentId,href:location.href};
  }});
  if(state[0]?.result?.protected)throw failure('EDGE_PROTECTED_PAGE');
  const result=state[0]?.result;
  if(!result||!injected.length)throw failure('EDGE_DOCUMENT_UNAVAILABLE');
  return {tabId,windowId:tab.windowId,url,title:scrub(tab.title).slice(0,200),
    documentId:result.documentId,urlSha256:await sha(result.href)};
}

async function content(tabId, data) {
  const result=await chrome.tabs.sendMessage(tabId,{__hc:data.action,...data});
  if(result?.error)throw failure(result.error.code??'EDGE_CONTENT_REJECTED');
  if(!result?.data)throw failure('EDGE_CONTENT_UNAVAILABLE');
  return result.data;
}

function matching(observed,binding) {
  if(!binding||observed.tabId!==binding.tabId||observed.documentId!==binding.documentId||observed.urlSha256!==binding.urlSha256)
    throw failure('EDGE_TAB_CHANGED');
}

async function perform(command) {
  if(!command||typeof command.id!=='string'||!READ.has(command.action)&&!WRITE.has(command.action))throw failure('EDGE_ACTION_REJECTED');
  const {action,params={},binding}=command;
  const {seenCommands=[]}=await chrome.storage.session.get('seenCommands');
  if(seenCommands.includes(command.id))throw failure('EDGE_COMMAND_ALREADY_SEEN');
  // Persist before any browser interaction. A lost receipt never repeats the action.
  await chrome.storage.session.set({seenCommands:[...seenCommands.slice(-511),command.id]});
  if(action==='tabs') {
    const tabs=await chrome.tabs.query({});
    return {tabs:tabs.filter(t=>safeUrl(t.url)&&!t.incognito).slice(0,80).map(t=>({id:t.id,windowId:t.windowId,title:scrub(t.title).slice(0,200),url:safeUrl(t.url),active:t.active}))};
  }
  if(action==='bind')return await metadata(params.tabId);
  const before=await metadata(binding?.tabId);
  matching(before,binding);
  if(action==='focus') {
    await chrome.tabs.update(binding.tabId,{active:true});
    await chrome.windows.update(before.windowId,{focused:true});
    return {focused:true,tabId:binding.tabId};
  }
  if(action==='screenshot') {
    const active=await chrome.tabs.query({windowId:before.windowId,active:true});
    if(active.length!==1||active[0].id!==binding.tabId)throw failure('EDGE_SCREENSHOT_REQUIRES_ACTIVE_TAB');
    const image=await chrome.tabs.captureVisibleTab(before.windowId,{format:'jpeg',quality:35});
    matching(await metadata(binding.tabId),binding);
    const after=await chrome.tabs.query({windowId:before.windowId,active:true});
    if(after[0]?.id!==binding.tabId||image.length>300000)throw failure('EDGE_SCREENSHOT_NOT_CONFIRMED');
    return {...before,image,source:'EDGE_VISIBLE_TAB_CAPTURE'};
  }
  if(action==='snapshot'||action==='read') {
    const snapshot=await content(binding.tabId,{action:'snapshot'});
    const text=action==='read'?await content(binding.tabId,{action:'read_text',format:'text',scope:'page'}):snapshot;
    matching(await metadata(binding.tabId),binding);
    return {...before,snapshotId:snapshot.snapshotId,text:scrub(text.text).slice(0,16000),snapshot:scrub(snapshot.text).slice(0,24000),untrusted:true};
  }
  if(!binding.snapshotId||params.snapshotId!==binding.snapshotId)throw failure('STALE_SNAPSHOT');
  if(action==='scroll') {
    if(!['up','down'].includes(params.direction))throw failure('EDGE_ARGUMENT_REJECTED');
    command.operationMayHaveIssued=true;
    await content(binding.tabId,{action:'scroll',direction:params.direction,amount:400});
  } else {
    if(!/^e[1-9]\d{0,3}$/.test(params.ref??''))throw failure('EDGE_ARGUMENT_REJECTED');
    if(Object.keys(params).some(k=>!['ref','snapshotId','text','value'].includes(k)))throw failure('EDGE_ARGUMENT_REJECTED');
    const target=await content(binding.tabId,{action:'locate',ref:params.ref,snapshotId:params.snapshotId,forCmd:action});
    if(target.sensitive||target.pay||/password|验证码|支付|付款|发布|删除|提交|批准|授权|subscribe|checkout/i.test(target.name??''))throw failure('AXIS_HANDOFF_REQUIRED');
    if(action==='type'&&(typeof params.text!=='string'||params.text.length>2000||/[\r\n]/.test(params.text)))throw failure('EDGE_ARGUMENT_REJECTED');
    if(action==='select'&&(typeof params.value!=='string'||params.value.length>256))throw failure('EDGE_ARGUMENT_REJECTED');
    command.operationMayHaveIssued=true;
    await content(binding.tabId,{action,ref:params.ref,snapshotId:params.snapshotId,text:params.text,value:params.value});
  }
  // Observe, never infer business success from the click receipt.
  const after=await metadata(binding.tabId);
  matching(after,binding);
  const snapshot=await content(binding.tabId,{action:'snapshot'});
  return {...after,snapshotId:snapshot.snapshotId,snapshot:scrub(snapshot.text).slice(0,24000),untrusted:true,
    actionIssued:true,businessOutcome:'NOT_VERIFIED',source:'ACTION_AND_FRESH_DOM_OBSERVATION'};
}

async function poll() {
  if(polling)return;
  polling=true;
  try {
    for(let round=0;round<10000;round++) {
      const {axisSession:session}=await chrome.storage.session.get('axisSession');
      if(!session)return;
      try {
        if(receipt) {await request(session,'/result',receipt);receipt=null;}
        const packet=await request(session,'/poll',{instanceId:session.instanceId});
        if(packet.command) {
          const command=packet.command;
          let data=null,error=null,ok=false;
          try {data=await perform(command);ok=true;}
          catch(e){error={code:e.code??'EDGE_ACTION_NOT_CONFIRMED',message:'操作未确认，请在工作台查看记录或接管。'};
            if(command.operationMayHaveIssued)data={outcomeUnknown:true,businessOutcome:'UNKNOWN'};}
          receipt={instanceId:session.instanceId,operationId:command.id,ok,data,error};
          await chrome.storage.session.set({pendingReceipt:receipt});
          await request(session,'/result',receipt);receipt=null;
          await chrome.storage.session.remove('pendingReceipt');
        }
        await chrome.storage.session.set({axisConnection:{connected:true,lastSeen:Date.now()}});
      } catch(e) {
        await chrome.storage.session.set({axisConnection:{connected:false,code:e.code??'EDGE_BRIDGE_UNAVAILABLE'}});
        if(e.code==='EDGE_SESSION_REQUIRED') {await chrome.storage.session.remove('axisSession');return;}
        // Retry the connection or the identical receipt only, never the command.
        return;
      }
    }
  } finally {polling=false;}
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return;
  (async()=>{
    if(message?.type==='connect') {
      await chrome.storage.local.remove('axisDisconnected');
      return await resume();
    }
    if(message?.type==='status') {
      const result=await chrome.storage.session.get(['axisSession','axisConnection']);
      void resume();
      return {instanceId:result.axisSession?.instanceId,...result.axisConnection,
        connected:result.axisConnection?.connected===true&&Date.now()-result.axisConnection.lastSeen<30000};
    }
    if(message?.type==='disconnect') {
      const {axisSession:session}=await chrome.storage.session.get('axisSession');
      if(session)await request(session,'/disconnect',{instanceId:session.instanceId}).catch(()=>{});
      await chrome.storage.session.remove(['axisSession','pendingReceipt']);
      await chrome.storage.local.set({axisDisconnected:true});
      return {disconnected:true};
    }
    throw failure('EDGE_MESSAGE_REJECTED');
  })().then(respond,e=>respond({error:{code:e.code??'EDGE_BRIDGE_UNAVAILABLE'}}));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='axis-edge-connection')void resume();});
let connecting=false;
async function resume(){
  if(connecting||polling)return {connecting:true};
  const local=await chrome.storage.local.get(['axisInstanceId','axisDisconnected']);
  if(local.axisDisconnected)return {disconnected:true};
  connecting=true;
  try {
    if(!/\bEdg\/\d+/.test(navigator.userAgent))throw failure('EDGE_REQUIRED');
    const stored=await chrome.storage.session.get(['axisSession','pendingReceipt']);
    receipt=stored.pendingReceipt??receipt;
    let session=stored.axisSession;
    if(session?.protocol!==PROTOCOL)session=null;
    if(!session) {
      const instanceId=local.axisInstanceId??'edge_'+crypto.randomUUID().replaceAll('-','');
      await chrome.storage.local.set({axisInstanceId:instanceId});
      session={bridgeUrl:'http://127.0.0.1:8767',instanceId};
      const result=await request(session,'/connect',{instanceId,extensionId:chrome.runtime.id,label:'我的 Edge',protocol:PROTOCOL});
      session={...session,connectionId:result.connectionId,protocol:PROTOCOL};
      await chrome.storage.session.set({axisSession:session});
    }
    void poll();
    return {connecting:true,instanceId:session.instanceId};
  } catch(e) {
    await chrome.storage.session.set({axisConnection:{connected:false,code:e.code??'EDGE_BRIDGE_UNAVAILABLE'}});
    return {connected:false};
  } finally {connecting=false;}
}
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.create('axis-edge-connection',{periodInMinutes:0.5});});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.create('axis-edge-connection',{periodInMinutes:0.5});});
void chrome.alarms.create('axis-edge-connection',{periodInMinutes:0.5});
void resume();
