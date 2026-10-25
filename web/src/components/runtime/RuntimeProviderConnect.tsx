import {useEffect,useRef,useState} from 'react';
import {runtimeApi,type RuntimeProfiles,type RuntimeProfile,type ProviderTestResult} from '../../lib/runtime';

export function RuntimeProviderConnect({data,token,reload,reportError,onChat}:{
  data:RuntimeProfiles;token:string;reload:()=>void;reportError:(error:unknown)=>void;onChat?:(profile:RuntimeProfile)=>void;
}) {
  const enrollment=data.credentialEnrollment;
  const preset=enrollment?.presets[0];
  const [key,setKey]=useState('');
  const [model,setModel]=useState(preset?.models[0]??'');
  const [profile,setProfile]=useState<RuntimeProfile|null>(null);
  const [result,setResult]=useState<ProviderTestResult|null>(null);
  const [busy,setBusy]=useState(false);
  const pending=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const configured=!!preset&&data.credentialRefs.some(ref=>ref.id===preset.credentialRef&&ref.configured);
  const connected=result?.testStatus==='CONNECTED'&&profile?.modelId===model;
  async function connect(){
    if(pending.current||!preset||!model||!configured&&!key)return;
    pending.current=true;setBusy(true);setResult(null);
    const submitted=key;setKey('');
    try{
      if(submitted){await runtimeApi.enrollCredential(preset.id,submitted,token);if(mounted.current)reload();}
      const input={name:preset.name,protocol:preset.protocol,endpoint:preset.endpoint,modelId:model,
        credentialRef:preset.credentialRef,timeout:30};
      const saved=profile?.modelId===model?profile:await runtimeApi.saveProfile(input,token,profile?.id);
      if(mounted.current)setProfile(saved);
      const tested=await runtimeApi.testProfile(saved,token);
      if(mounted.current){setResult(tested);reload();}
    }catch(error){if(mounted.current)reportError(error);}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  async function chat(){
    if(pending.current||!profile||!connected)return;
    pending.current=true;setBusy(true);
    try{
      await runtimeApi.activateProfile(profile.id,token);
      if(mounted.current){reload();onChat?.(profile);}
    }catch(error){if(mounted.current)reportError(error);}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  if(!preset||!enrollment)return <p>当前没有可自助连接的官方服务。已有模型仍可使用；其它连接由管理员配置。</p>;
  return <section className="provider-connect" aria-label="连接模型">
    <h2>连接模型</h2>
    <label>服务<select aria-label="模型服务" value={preset.id} disabled><option value={preset.id}>{preset.name}</option></select></label>
    <form onSubmit={event=>{event.preventDefault();void connect();}}>
      <label>API Key<input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={4096} disabled={busy||!enrollment.available}
        placeholder={configured?'已安全保存，无需再次输入':'输入此服务的 API Key'} onChange={event=>{setKey(event.target.value);setResult(null);}}/></label>
      <p className="caption">仅保存到当前 Windows 用户的凭据管理器，界面无法读回密钥。</p>
      {!enrollment.available&&<p role="status">安全凭据存储不可用。已有后端凭据可继续使用；新录入需要 Windows 凭据管理器及 Web 依赖。</p>}
      <button type="submit" className="button primary" disabled={busy||!configured&&(!key.trim()||!enrollment.available)}>{busy?'正在连接…':'测试连接'}</button>
    </form>
    {result&&<div className="provider-connection-result" role="status"><p>{result.testStatus==='CONNECTED'?'连接已通过':'连接未通过，请检查 API Key 与网络设置。'}</p>
      <details><summary>连接详情</summary><p>{result.category}{result.httpStatus!==null?` (HTTP ${result.httpStatus})`:''}</p><p>本次测试模型：{profile?.modelId}。任务操作仍需单独审阅。</p></details>
    </div>}
    {(result||profile)&&<label>模型<select aria-label="选择模型" value={model} disabled={busy} onChange={event=>{setModel(event.target.value);setResult(null);}}>{preset.models.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
    {connected&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void chat()}>开始对话</button>}
  </section>;
}
