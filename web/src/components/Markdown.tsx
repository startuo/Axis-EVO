/** GFM markdown renderer for assistant messages (token-styled). */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workspaceFileLink } from '../lib/filePreview';

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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
