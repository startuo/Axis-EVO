/** GFM markdown renderer for assistant messages (token-styled). */
import { isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workspaceFileLink } from '../lib/filePreview';

const FOLD_THRESHOLD = 48;
const COLLAPSED_LINES = 10;

function CodeBlock({ children }: { children: ReactNode }) {
  const code = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children.props : null;
  const raw = typeof code?.children === 'string' ? code.children.replace(/\n$/, '') : '';
  const lines = raw.split('\n');
  const foldable = lines.length >= FOLD_THRESHOLD;
  const [folded, setFolded] = useState(false);
  const [copied, setCopied] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const foldButton = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreScroll = useRef<{ scroller: HTMLElement; top: number } | null>(null);
  const codeId = useId();
  const collapsed = folded && foldable;

  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);

  useLayoutEffect(() => {
    const restore = restoreScroll.current;
    if (collapsed && restore) {
      restore.scroller.scrollTop = restore.top;
      restoreScroll.current = null;
    }
  }, [collapsed]);

  const toggleFold = () => {
    if (!collapsed) {
      const block = blockRef.current;
      const scroller = block?.closest<HTMLElement>('.convo');
      if (block && scroller) {
        const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        if (delta < 0) restoreScroll.current = { scroller, top: Math.max(0, scroller.scrollTop + delta) };
      }
    }
    setFolded(!collapsed);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard permission is optional. */ }
  };

  return <div className={`md-code-block${collapsed ? ' collapsed' : ''}`} ref={blockRef}>
    <div className="md-code-bar">
      <span className="md-code-lang">{code?.className?.match(/\blanguage-(\S+)/)?.[1] ?? '代码'}
        {foldable && <span>{lines.length} 行</span>}
      </span>
      <div className="md-code-actions">
        {foldable && <button type="button" ref={foldButton} aria-expanded={!collapsed} aria-controls={codeId}
          aria-label={collapsed ? `展开全部 ${lines.length} 行代码` : `收起 ${lines.length} 行代码`}
          onClick={toggleFold}>
          {collapsed ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
          {collapsed ? '展开' : '收起'}
        </button>}
        <button type="button" onClick={() => void copyCode()} disabled={!raw}
          aria-label={copied ? '已复制代码' : '复制代码'}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
    <pre id={codeId}><code className={code?.className}>{code ? (collapsed ? lines.slice(0, COLLAPSED_LINES).join('\n') : raw) : children}</code></pre>
    {collapsed && <button type="button" className="md-code-expand" onClick={() => {
      toggleFold();
      foldButton.current?.focus({ preventScroll: true });
    }}>展开剩余代码（共 {lines.length} 行）</button>}
  </div>;
}

export function Markdown({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const path = onOpenFile && workspaceFileLink(href);
            return path ? <button className="workspace-file-link" type="button" onClick={() => onOpenFile?.(path)}>{children}</button>
              : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
          code: ({ children, className }) => {
            const path = onOpenFile && !className && typeof children === 'string' && workspaceFileLink(children);
            return path ? <button className="workspace-file-link" type="button" aria-label={`预览文件 ${path}`}
              onClick={() => onOpenFile?.(path)}><code>{children}</code></button>
              : <code className={className}>{children}</code>;
          },
          img: ({ alt }) => <span>{alt}</span>,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
