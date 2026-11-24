/**
 * Compatibility shim: the conversation transcript now lives in the Work
 * center column (`views/work/ThreadDialog`). Non-owned surfaces (Work activity
 * tab, Agents detail) still import this path; re-export so they keep working
 * until they migrate to ThreadTranscript directly.
 */
export { ThreadTranscript as Conversation } from '../work/ThreadDialog';
export type { ConversationProps } from '../work/ThreadDialog';
