import {runtimeRequest} from './runtime';
import type {FeedbackCase,FeedbackProposal,TaskFeedback} from './feedbackData';
const e=encodeURIComponent;
const base=(p:string)=>`/projects/${e(p)}`;
export const feedbackApi={
  list:(p:string,t:string,signal?:AbortSignal)=>runtimeRequest<{threadId:string;records:TaskFeedback[]}>(`${base(p)}/threads/${e(t)}/feedback`,{signal}),
  submit:(p:string,t:string,body:unknown)=>runtimeRequest<TaskFeedback>(`${base(p)}/threads/${e(t)}/feedback`,{body}),
  prepare:(p:string,id:string)=>runtimeRequest<FeedbackProposal>(`${base(p)}/feedback/${e(id)}/revision-proposals`,{body:{}}),
  authorize:(p:string,proposal:FeedbackProposal,profileId:string,profileRevision:number)=>runtimeRequest<FeedbackCase>(`${base(p)}/feedback-revisions/${e(proposal.id)}/authorize`,{body:{approvedProposalSha256:proposal.sha256,profileId,profileRevision}}),
};
