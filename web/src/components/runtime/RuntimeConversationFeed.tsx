import type { ReactNode } from 'react';
import type { RuntimeConversation } from '../../lib/runtime';
import { RuntimeReplyView } from './RuntimeReplyView';

export function RuntimeConversationFeed({conversation,currentTurnId,currentTask,openTurn}:{
  conversation:RuntimeConversation;currentTurnId?:string;currentTask:ReactNode;openTurn:(id:string)=>void;
}) {
  return <div className="runtime-conversation-feed" aria-label="对话历史">
    {conversation.items?.map(item=>{
      if (item.kind==='CHAT') {
        const reply=conversation.replies?.find(r=>r.id===item.sourceId);
        return reply ? <RuntimeReplyView key={reply.id} reply={reply}/> : null;
      }
      const turn=conversation.turns.find(t=>t.id===item.sourceId);
      if (!turn) return null;
      if (turn.id===currentTurnId) return <div key={turn.id}>{currentTask}</div>;
      return <article key={turn.id} className="runtime-conversation" aria-label="历史任务">
        <section className="conversation-user"><p className="conversation-user-bubble">{turn.prompt}</p></section>
        <p>{turn.coreOutcome==='COMPLETED'?'任务已完成':turn.coreOutcome==='FAILED'?'任务未通过验收或执行失败':turn.webStatus==='UNKNOWN'?'执行结果不确定':'任务记录'} <button type="button" className="text-button" onClick={()=>openTurn(turn.id)}>查看操作详情</button></p>
      </article>;
    })}
  </div>;
}
