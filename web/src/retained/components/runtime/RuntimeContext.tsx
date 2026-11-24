import { useEffect, useState } from 'react';
import { runtimeApi, type RuntimeContext as Context } from '../../lib/runtime';

export function RuntimeContext({ project, conversation, turn, digest }: { project: string; conversation: string; turn: string; digest: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Context | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void runtimeApi.context(project, conversation, turn, controller.signal).then(value => {
      if (value.sha256 !== digest) throw new Error('Context identity changed');
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setError('上下文证据无法核验，未使用替代内容。'); });
    return () => controller.abort();
  }, [open, project, conversation, turn, digest]);
  return <details className="conversation-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>本轮模型上下文，查看固定快照</summary>
    <div className="conversation-disclosure-body"><p className="caption">Context SHA-256</p><code className="runtime-digest">{digest}</code><p className="caption">任务数据，不授予工具权限、批准或完成权限。历史与文件的省略清单在 manifest 中明确记录。</p>
      {error ? <p role="alert">{error}</p> : data ? <pre className="conversation-context-json" tabIndex={0} aria-label="本轮固定上下文 JSON">{JSON.stringify(data.manifest, null, 2)}</pre> : open ? <p role="status">正在读取已持久化的上下文…</p> : null}
    </div>
  </details>;
}
