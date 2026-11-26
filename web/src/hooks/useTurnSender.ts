/**
 * Shared send pipeline for Chat and Work composers: create the session when
 * needed (session.create), append an optimistic user message, then turn.start.
 * Errors surface as toasts; nothing is auto-replayed.
 */
import { useCallback, useRef, useState } from 'react';
import type { Item, PermissionMode, Session } from '@axis/protocol';
import { errorMessage } from '../lib/format';
import type { ImageAttachment } from '../lib/composerImages';
import { useToast } from '../components/Toasts';
import { OPTIMISTIC_PREFIX } from './useConversation';
import { useSocket } from './useSocket';

export type TurnAttachment = { kind: 'file' | 'browser-binding'; value: string } | ImageAttachment;

export interface TurnPrefs {
  mode: PermissionMode;
  profileId: string | null;
  workspaceId: string | null;
}

export interface TurnSenderOpts {
  sessionId: string | null;
  onSessionCreated: (s: Session) => void;
  addOptimistic: (item: Item) => void;
  nextSeq: () => number;
}

export function useTurnSender(opts: TurnSenderOpts) {
  const { request, nativeRuntime } = useSocket();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const send = useCallback(
    async (text: string, attachments: TurnAttachment[], prefs: TurnPrefs): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const o = optsRef.current;
      let sid = o.sessionId;
      if (!sid) {
        if (!prefs.workspaceId) {
          toast.push('warn', '尚未授权工作区，请先在设置中添加工作区');
          return null;
        }
        if (!prefs.profileId) {
          toast.push('warn', '尚未配置模型，请先在设置中添加模型配置');
          return null;
        }
        try {
          const created = await request<Session>('session.create', {
            workspaceId: prefs.workspaceId,
            profileId: prefs.profileId,
            mode: prefs.mode,
            title: trimmed.slice(0, 60),
          });
          sid = created.id;
          if (!nativeRuntime) o.onSessionCreated(created);
        } catch (e) {
          toast.push('error', `创建会话失败：${errorMessage(e)}`);
          return null;
        }
      }
      const sessionId = sid;
      if (!nativeRuntime) {
        o.addOptimistic({
          id: `${OPTIMISTIC_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          sessionId,
          seq: o.nextSeq(),
          kind: 'message',
          role: 'user',
          text: trimmed,
          createdAt: new Date().toISOString(),
        });
      }
      setSending(true);
      try {
        const result = await request<{ session?: Session }>('turn.start', {
          sessionId,
          text: trimmed,
          ...(nativeRuntime && prefs.profileId ? { profileId: prefs.profileId } : {}),
          ...(attachments.length > 0 ? { attachments: attachments.map(attachment => attachment.kind === 'image'
            ? { kind: 'image', data: attachment.data, name: attachment.name, mediaType: attachment.mediaType } : attachment) } : {}),
        });
        if (nativeRuntime && result?.session) {
          if (sessionId !== result.session.id) o.onSessionCreated(result.session);
          return result.session.id;
        }
      } catch (e) {
        toast.push('error', `发送失败：${errorMessage(e)}`);
        if (nativeRuntime) return null;
      } finally {
        setSending(false);
      }
      return sessionId;
    },
    [request, toast, nativeRuntime],
  );

  const cancel = useCallback(() => {
    const sid = optsRef.current.sessionId;
    if (!sid) return;
    request('turn.cancel', { sessionId: sid }).catch((e: unknown) => toast.push('error', errorMessage(e)));
  }, [request, toast]);

  return { send, cancel, sending };
}
