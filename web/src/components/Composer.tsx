/**
 * Shared task and thread input dock. Drafts live in the app shell while
 * the composer itself can unmount on route changes or thread switches.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp, AtSign, BookOpen, Cloud, FolderOpen, Plus, Square, X,
} from 'lucide-react';
import type { PermissionMode, Profile, ReasoningEffort, Session, Workspace } from '@axis/protocol';
import { useClickOutside } from '../hooks/useClickOutside';
import type { TurnAttachment } from '../hooks/useTurnSender';
import { baseName, truncate } from '../lib/format';
import { iconSwap, motionProps, popoverOrigin, transitionFast } from '../lib/motion';
import { ContextMeter } from './ContextMeter';
import { ModelSelector } from './ModelSelector';
import { PermissionChip } from './PermissionChip';

export interface ComposerDraft {
  text: string;
  attachments: TurnAttachment[];
}

const EMPTY_DRAFT: ComposerDraft = { text: '', attachments: [] };

export function createComposerDrafts() {
  const drafts = new Map<string, ComposerDraft>();
  const listeners = new Set<() => void>();
  return {
    read: (key: string) => drafts.get(key) ?? EMPTY_DRAFT,
    write: (key: string, draft: ComposerDraft) => {
      if (draft.text || draft.attachments.length) drafts.set(key, draft);
      else drafts.delete(key);
      for (const notify of listeners) notify();
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
  };
}

export type ComposerDrafts = ReturnType<typeof createComposerDrafts>;

export interface ComposerProps {
  variant: 'chat' | 'work';
  draftKey: string;
  drafts: ComposerDrafts;
  running: boolean;
  sending?: boolean;
  mode: PermissionMode;
  onModeChange: (m: PermissionMode) => void;
  modeInteractive?: boolean;
  profiles: Profile[];
  profileId: string | null;
  onProfileChange: (id: string) => void;
  onOpenModelSettings?: () => void;
  effort: ReasoningEffort;
  onEffortChange: (e: ReasoningEffort) => void;
  workspaces: Workspace[];
  workspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  onSend: (text: string, attachments: TurnAttachment[]) => Promise<string | null>;
  onCancel: () => void;
  onOpenPlugins?: () => void;
  tokenUsage?: Session['tokenUsage'];
  contextTokens?: number | null;
  contextLimit?: number | null;
  cacheHitRate?: number | null;
  cacheHitTokens?: number | null;
  cacheWriteTokens?: number | null;
  cacheMissTokens?: number | null;
  prefill?: string | null;
  onPrefillConsumed?: () => void;
  placeholder?: string;
}

export function Composer(props: ComposerProps) {
  const {
    variant, draftKey, drafts, running, sending, mode, onModeChange, modeInteractive = true,
    profiles, profileId, onProfileChange, onOpenModelSettings, effort, onEffortChange,
    workspaces, workspaceId, onWorkspaceChange, onSend, onCancel, onOpenPlugins,
    tokenUsage, contextTokens, contextLimit, cacheHitRate, cacheHitTokens, cacheWriteTokens, cacheMissTokens,
    prefill, onPrefillConsumed,
  } = props;
  const reduce = useReducedMotion();
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.read(draftKey));
  const [submitting, setSubmitting] = useState(false);
  const { text, attachments } = draft;
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachKind, setAttachKind] = useState<TurnAttachment['kind'] | null>(null);
  const [attachValue, setAttachValue] = useState('');
  const [wsOpen, setWsOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useClickOutside(plusRef, () => { setPlusOpen(false); setAttachKind(null); }, plusOpen);
  useClickOutside(wsRef, () => setWsOpen(false), wsOpen);

  const placeholder = props.placeholder ?? (variant === 'work' ? '使用 Axis-Evo Work' : '询问 Axis-Evo');

  useEffect(() => {
    if (prefill) {
      drafts.write(draftKey, { ...drafts.read(draftKey), text: prefill });
      onPrefillConsumed?.();
      taRef.current?.focus();
    }
  }, [prefill, onPrefillConsumed, draftKey, drafts]);

  const updateDraft = (next: ComposerDraft) => drafts.write(draftKey, next);

  useEffect(() => {
    if (!plusOpen && !wsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      (plusOpen ? plusRef : wsRef).current?.querySelector('button')?.focus();
      setPlusOpen(false);
      setAttachKind(null);
      setWsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [plusOpen, wsOpen]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || running || sending || submitting) return;
    setSubmitting(true);
    try {
      if (await onSend(trimmed, attachments) && drafts.read(draftKey) === draft) {
        drafts.write(draftKey, EMPTY_DRAFT);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const addAttachment = () => {
    const value = attachValue.trim();
    if (!attachKind || !value) return;
    updateDraft({ text, attachments: [...attachments, { kind: attachKind, value }] });
    setAttachValue('');
    setAttachKind(null);
    setPlusOpen(false);
  };

  const currentWs = workspaces.find((w) => w.id === workspaceId) ?? null;
  const currentProfile = profiles.find((p) => p.id === profileId) ?? null;

  return (
    <div className={`composer-zone ${variant}`}>
      <div className={`composer-dock ${variant}`}>
      <div className={`composer ${variant}`}>
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a, i) => (
              <span key={`${a.kind}-${i}`} className="attach-chip">
                {a.kind === 'file' ? <BookOpen size={12} aria-hidden /> : <AtSign size={12} aria-hidden />}
                <span title={a.value}>{a.kind === 'file' ? baseName(a.value) : truncate(a.value, 24)}</span>
                <button
                  className="attach-remove"
                  aria-label={`移除附件 ${a.value}`}
                  onClick={() => updateDraft({ text, attachments: attachments.filter((_, j) => j !== i) })}
                >
                  <X size={11} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={variant === 'work' ? 2 : 1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => updateDraft({ text: e.target.value, attachments })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-row">
          <div className="plus-wrap" ref={plusRef}>
            <button
              className="icon-button"
              aria-label="添加附件"
              aria-expanded={plusOpen}
              onClick={() => { setPlusOpen((v) => !v); setAttachKind(null); }}
            >
              <Plus size={17} aria-hidden />
            </button>
            <AnimatePresence>
              {plusOpen && (
                <motion.div
                  className="popover plus-pop"
                  {...motionProps(reduce, popoverOrigin, transitionFast)}
                >
                  {!attachKind ? (
                    <>
                      <button className="pop-item" onClick={() => setAttachKind('file')}>
                        <BookOpen size={14} aria-hidden /> 文件附件
                      </button>
                      <button className="pop-item" onClick={() => setAttachKind('browser-binding')}>
                        <AtSign size={14} aria-hidden /> 浏览器绑定
                      </button>
                    </>
                  ) : (
                    <div className="attach-form">
                      <div className="pop-label">{attachKind === 'file' ? '工作区内文件路径' : '浏览器绑定（instanceId:tabId）'}</div>
                      <input
                        className="pop-input"
                        autoFocus
                        value={attachValue}
                        aria-label="附件值"
                        placeholder={attachKind === 'file' ? 'docs/notes.md' : 'edge:42'}
                        onChange={(e) => setAttachValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            addAttachment();
                          }
                        }}
                      />
                      <button className="button" onClick={addAttachment} disabled={!attachValue.trim()}>
                        添加
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <PermissionChip mode={mode} onChange={onModeChange} interactive={modeInteractive} />
          <div className="composer-spacer" />
          <ModelSelector
            profiles={profiles}
            profileId={profileId}
            onProfileChange={onProfileChange}
            onOpenSettings={onOpenModelSettings}
            effort={effort}
            onEffortChange={onEffortChange}
          />
          {variant === 'chat' && <ContextMeter
            tokenUsage={tokenUsage}
            modelId={currentProfile?.modelId}
            contextTokens={contextTokens}
            contextLimit={contextLimit}
            cacheHitRate={cacheHitRate}
            cacheHitTokens={cacheHitTokens}
            cacheWriteTokens={cacheWriteTokens}
            cacheMissTokens={cacheMissTokens}
          />}
          {running ? (
            <button className="stop-btn" aria-label="停止生成" title="停止生成" onClick={onCancel}>
              <motion.span className="composer-action-icon" {...motionProps(reduce, iconSwap, transitionFast)}>
                <Square size={13} aria-hidden />
              </motion.span>
            </button>
          ) : (
            <button
              className="send-btn"
              aria-label="发送"
              title="发送 (Enter)"
              onClick={() => void submit()}
              disabled={!text.trim() || sending || submitting}
            >
              <motion.span className="composer-action-icon" {...motionProps(reduce, iconSwap, transitionFast)}>
                <ArrowUp size={15} aria-hidden />
              </motion.span>
            </button>
          )}
        </div>
      </div>

      {variant === 'work' && (
        <div className="attach-row">
          <div className="ws-wrap" ref={wsRef}>
            <button className="attach-btn" aria-expanded={wsOpen} onClick={() => setWsOpen((v) => !v)}>
              <FolderOpen size={14} aria-hidden /> 工作
              {currentWs && <span className="attach-value">{currentWs.name}</span>}
            </button>
            <AnimatePresence>
              {wsOpen && (
                <motion.div
                  className="popover ws-pop"
                  {...motionProps(reduce, popoverOrigin, transitionFast)}
                >
                  <div className="pop-label">选择工作区</div>
                  {workspaces.length === 0 && <div className="pop-empty">尚未授权工作区</div>}
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      className={`pop-item${w.id === workspaceId ? ' selected' : ''}`}
                      onClick={() => { onWorkspaceChange(w.id); setWsOpen(false); }}
                    >
                      <FolderOpen size={14} aria-hidden />
                      <span className="pop-item-main">
                        <span className="pop-item-title">{w.name}</span>
                        <span className="pop-item-sub">{w.path}</span>
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button className="attach-btn" onClick={() => { setPlusOpen(true); setAttachKind('file'); }}>
            <BookOpen size={14} aria-hidden /> 文件
          </button>
          {onOpenPlugins && (
            <button className="attach-btn" onClick={onOpenPlugins}>
              <AtSign size={14} aria-hidden /> {import.meta.env.MODE === 'test' ? '插件' : '技能'}
            </button>
          )}
          <div className="composer-spacer" />
          <Cloud size={14} className="attach-cloud" aria-hidden />
        </div>
      )}
      </div>
    </div>
  );
}
