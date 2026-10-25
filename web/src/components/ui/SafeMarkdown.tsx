import Markdown from 'react-markdown';

function safeLink(value:string) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
  } catch { return ''; }
}

export function SafeMarkdown({text}:{text:string}) {
  return <div className="assistant-markdown"><Markdown skipHtml urlTransform={safeLink} components={{
    img:({alt})=><span>{alt?`[图片：${alt}]`:'[图片]'}</span>,
    a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
    h1:({children})=><h2>{children}</h2>,
    h2:({children})=><h3>{children}</h3>,
  }}>{text}</Markdown></div>;
}
