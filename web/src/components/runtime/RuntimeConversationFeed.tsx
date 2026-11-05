import {useLayoutEffect,useRef,type ReactNode} from 'react';
import type { RuntimeConversation } from '../../lib/runtime';
import { RuntimeReplyView } from './RuntimeReplyView';
import type {WorkspaceDraft} from '../../lib/workspace';
import {WorkspaceTaskActivity} from './WorkspaceTaskActivity';

export function RuntimeConversationFeed({conversation,currentTurnId,currentTask,openTurn,drafts=[],openDraft}:{
  conversation:RuntimeConversation;currentTurnId?:string;currentTask:ReactNode;openTurn:(id:string)=>void;drafts?:WorkspaceDraft[];openDraft?:(id:string)=>void;
}) {
  const feed=useRef<HTMLDivElement>(null);
  const follow=useRef(true);
  const previous=useRef({id:conversation.id,count:0});
  useLayoutEffect(()=>{
    const count=conversation.items?.length??0;
    if(previous.current.id!==conversation.id||previous.current.count!==count)follow.current=true;
    previous.current={id:conversation.id,count};
    if(feed.current&&follow.current)feed.current.scrollTop=feed.current.scrollHeight;
  },[conversation.id,conversation.items,conversation.replies,drafts]);
  return <div ref={feed} className="runtime-conversation-feed" aria-label="对话历史" tabIndex={0} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.clientHeight-node.scrollTop<72;}}>
    {conversation.items?.map(item=>{
      if (item.kind==='CHAT') {
        const reply=conversation.replies?.find(r=>r.id===item.sourceId);
        const draft=drafts.find(value=>value.replyId===reply?.id);
        return reply ? <RuntimeReplyView key={reply.id} reply={reply} displayPrompt={draft?.prompt} artifact={draft?<WorkspaceTaskActivity draft={draft} open={()=>openDraft?.(draft.id)}/>:undefined}/> : null;
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
