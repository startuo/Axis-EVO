/** Collapsible unified diff preview card (token-colored add/del lines). */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, FileDiff } from 'lucide-react';
import type { Item } from '@axis/protocol';
import { diffLines } from '../lib/diff';

const MAX_RENDER = 240;

export function DiffCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => diffLines(item.before ?? '', item.after ?? ''), [item.before, item.after]);
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  const visible = lines.slice(0, MAX_RENDER);

  return (
    <div className="card diff-card">
      <button className="tool-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FileDiff size={15} className="tool-icon" aria-hidden />
        <span className="tool-name diff-path">{item.path ?? 'diff'}</span>
        <span className="chip success">+{added}</span>
        <span className="chip danger">−{removed}</span>
        <ChevronDown size={14} className={`chev${open ? ' open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="diff-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="diff-lines" role="table" aria-label={`差异预览 ${item.path ?? ''}`}>
              {visible.map((l, i) => (
                <div key={i} className={`diff-line ${l.type}`} role="row">
                  <span className="diff-sign" aria-hidden>
                    {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}
                  </span>
                  <span className="diff-text">{l.text || ' '}</span>
                </div>
              ))}
            </div>
            {lines.length > MAX_RENDER && <div className="tool-trunc">差异过长，仅显示前 {MAX_RENDER} 行</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
