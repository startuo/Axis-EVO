/** Renders one transcript item by kind: messages, reasoning, tools, diffs, plans, errors. */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Brain, Check, ChevronRight } from 'lucide-react';
import type { Item, TurnImage } from '@axis/protocol';
import { extractArtifacts } from '../lib/artifacts';
import { turnImageUrl } from '../lib/composerImages';
import { truncate } from '../lib/format';
import { ApprovalCard } from './ApprovalCard';
import { ArtifactCard } from './ArtifactCard';
import { DiffCard } from './DiffCard';
import { Markdown } from './Markdown';
import { PlanCard } from './PlanCard';
import { PreviewDialog } from './PreviewDialog';
import { ToolCard } from './ToolCard';
import { TurnError } from './TurnError';

export function ReasoningBlock({ item }: { item: Item }) {
  const reduce = useReducedMotion();
  const userToggledRef = useRef(false);
  const [open, setOpen] = useState(Boolean(item.streaming));

  useEffect(() => {
    if (userToggledRef.current) return;
    setOpen(Boolean(item.streaming));
  }, [item.streaming]);

  return (
    <div className={`reasoning-wrap${item.streaming ? ' streaming' : ''}`}>
      <button
        type="button"
        className="reasoning-toggle"
        aria-expanded={open}
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
      >
        <Brain size={13} className="reasoning-icon" aria-hidden />
        <span className={item.streaming ? 'shimmer-text' : undefined}>{item.streaming ? '思考中…' : '思考过程'}</span>
        <ChevronRight size={12} className={`act-chev${open ? ' open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="reasoning"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {item.text ?? ''}
            {item.streaming && <span className="stream-cursor" aria-hidden />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultCard({ item }: { item: Item }) {
  if (item.error) {
    return <TurnError error={item.error} />;
  }
  const json = item.data === undefined ? '' : truncate(JSON.stringify(item.data, null, 2) ?? '', 1600);
  return (
    <div className="card result-card">
      <div className="tool-head result-head">
        <Check size={14} className="tool-icon" aria-hidden />
        <span className="tool-name">工具结果</span>
      </div>
      {json && <pre className="result-pre">{json}</pre>}
    </div>
  );
}

function UserMessage({ item }: { item: Item }) {
  const [expanded, setExpanded] = useState<TurnImage | null>(null);
  const { command, images } = item.metadata ?? {};
  return (
    <div className="msg-user">
      <div className="msg-user-bubble">
        {command && <span className="chip muted user-command">{command.toUpperCase()}</span>}
        <span>{item.text ?? ''}</span>
        {!!images?.length && <div className="sent-image-list">
          {images.map((image, index) => <button className="sent-image" type="button" key={`${image.sha256}-${index}`}
            onClick={() => setExpanded(image)} aria-label={`放大 ${image.name}`} title={`${image.name} / ${image.width} × ${image.height}`}>
            <img src={turnImageUrl(image)} alt={image.name} loading="lazy" />
          </button>)}
        </div>}
        {expanded && <PreviewDialog title={expanded.name} onClose={() => setExpanded(null)}>
          <img className="message-expanded-image" src={turnImageUrl(expanded)} alt={expanded.name} />
        </PreviewDialog>}
      </div>
    </div>
  );
}

export function MessageView({ item, onOpenFile }: { item: Item; onOpenFile?: (path: string) => void }) {
  switch (item.kind) {
    case 'message':
      if (item.role === 'user') {
        return <UserMessage item={item} />;
      }
      return (
        <div className="msg-assistant">
          <Markdown text={item.text ?? ''} onOpenFile={onOpenFile} />
          {item.streaming && <span className="stream-cursor" aria-hidden />}
        </div>
      );
    case 'reasoning':
      return <ReasoningBlock item={item} />;
    case 'tool_call':
      return <ToolCard item={item} />;
    case 'tool_result': {
      const artifacts = extractArtifacts(item.data);
      if (artifacts.length > 0) {
        return (
          <>
            {artifacts.map((a) => (
              <ArtifactCard key={a.path} artifact={a} onOpenFile={onOpenFile} />
            ))}
          </>
        );
      }
      return <ResultCard item={item} />;
    }
    case 'diff':
      return <DiffCard item={item} />;
    case 'plan':
      return <PlanCard item={item} />;
    case 'error':
      return <TurnError error={item.error ?? item.text} />;
    default:
      return null;
  }
}

export { ApprovalCard };
