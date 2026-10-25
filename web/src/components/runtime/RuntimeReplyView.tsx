import type { RuntimeReply } from '../../lib/runtime';
import { AxisLogo } from '../ui/AxisLogo';
import { Field } from '../ui/Primitives';
import {lazy,Suspense} from 'react';
const SafeMarkdown=lazy(()=>import('../ui/SafeMarkdown').then(module=>({default:module.SafeMarkdown})));
import '../../styles/conversation.css';

export function RuntimeReplyView({reply}:{reply:RuntimeReply}) {
  const pending=reply.status==='QUEUED'||reply.status==='RESPONDING';
  return <article className="runtime-conversation runtime-reply" aria-label="对话消息">
    <section role="group" className="conversation-user" aria-label="你的消息"><p className="conversation-user-bubble">{reply.prompt}</p></section>
    <section role="group" className="conversation-assistant" aria-label="模型回复">
      <header className="conversation-assistant-heading"><AxisLogo size={24}/><strong>AXIS</strong><span className="conversation-model">{reply.profileSnapshot.modelId}</span></header>
      {pending ? <p role="status">正在生成回复…</p> : reply.response ? <Suspense fallback={<div className="assistant-text">{reply.response.text}</div>}><SafeMarkdown text={reply.response.text}/></Suspense> : <div role="alert"><p>{reply.status==='INTERRUPTED'?'回复未能确认完成。':'未能获得有效回复。'}</p><p>没有授权文件操作。检查模型连接后可以重新提问。</p></div>}
      <details className="conversation-disclosure"><summary>回复信息</summary><div className="conversation-disclosure-body">
        <p>模型生成的内容，不构成执行事实或操作批准。</p>
        <Field label="模型配置" value={reply.profileSnapshot.name}/>
        <Field label="配置版本" value={String(reply.profileSnapshot.revision)}/>
        <Field label="请求 SHA-256" value={reply.requestSha256} copy/>
        {reply.response&&<Field label="原文 SHA-256" value={reply.response.sha256} copy/>}
        {reply.errorCode&&<Field label="诊断代码" value={reply.errorCode}/>}
      </div></details>
    </section>
  </article>;
}
