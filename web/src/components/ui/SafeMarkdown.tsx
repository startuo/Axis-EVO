import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeLink(value:string) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
  } catch { return ''; }
}

export function SafeMarkdown({text}:{text:string}) {
  return <div className="assistant-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={safeLink} components={{
    img:({alt})=><span>{alt?`[图片：${alt}]`:'[图片]'}</span>,
    a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
    h1:({children})=><h2>{children}</h2>,
    h2:({children})=><h3>{children}</h3>,
    table:({children})=><div className="markdown-table-scroll" role="region" aria-label="文档表格" tabIndex={0}><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
