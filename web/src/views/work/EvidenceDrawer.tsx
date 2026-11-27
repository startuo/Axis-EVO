import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, FileCheck2, Fingerprint, LoaderCircle, RefreshCw } from 'lucide-react';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';
import { errorMessage } from '../../lib/format';
import './evidence.css';

export interface EvidenceArtifact {
  id: string;
  path: string;
  sha256?: string;
  coreRunId?: string;
  historicalVerified?: boolean;
  verified?: boolean;
  content?: string | null;
}

export interface EvidenceEvent {
  id: string;
  kind: string;
  createdAt?: string;
  payload: Record<string, unknown>;
}

interface EvidenceList {
  artifacts: EvidenceArtifact[];
  events: EvidenceEvent[];
  hooks: EvidenceEvent[];
}

type ReadState<T> = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; value: T };

function LazyEvidence<T>({ label, summary, read, children }: {
  label: string;
  summary: ReactNode;
  read: () => Promise<T>;
  children: (value: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReadState<T>>({ kind: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const toggle = () => {
    setOpen(!open);
    if (open || state.kind === 'loading' || state.kind === 'ready') return;
    setState({ kind: 'loading' });
    void read().then(
      value => { if (mounted.current) setState({ kind: 'ready', value }); },
      error => { if (mounted.current) setState({ kind: 'error', message: errorMessage(error) }); },
    );
  };

  return (
    <article className="evidence-entry">
      <button className="evidence-trigger" type="button" aria-label={label} aria-expanded={open} onClick={toggle}>
        <ChevronRight size={14} className={open ? 'evidence-chevron open' : 'evidence-chevron'} aria-hidden />
        {summary}
      </button>
      {open && state.kind === 'loading' && <p className="evidence-note" role="status">读取回执…</p>}
      {open && state.kind === 'error' && <p className="evidence-note evidence-error" role="alert">{state.message}</p>}
      {open && state.kind === 'ready' && children(state.value)}
    </article>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PASSED: '通过', SUCCESS: '成功', FAILED: '失败', UNKNOWN: '结果未确认',
  CANCELLED: '已取消', TIMED_OUT: '超时', REJECTED: '已拒绝',
};

const EVENT_LABEL: Record<string, string> = {
  tool_intent: '工具派发意图', tool_execution: '工具执行回执', tool_result: '工具结果',
  artifact: '文件保存', file_operation: '文件操作', post_edit_hook: '编辑后检查',
  host_delivery_check: '交付固定检查', circuit_breaker: '自动暂停', terminal: '回合结束',
  context_checkpoint: '上下文检查点', model_usage: '服务商用量',
  task_contract: '任务契约', task_contract_result: '契约核对结果',
};

function textField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

export function EvidenceDrawer({ workspaceId, sessionId }: { workspaceId: string | null; sessionId: string | null }) {
  const { request } = useSocket();
  const [state, setState] = useState<ReadState<EvidenceList>>({ kind: 'idle' });
  const generation = useRef(0);
  const refresh = useCallback(() => {
    if (!workspaceId || !sessionId) return;
    const seq = ++generation.current;
    setState(current => current.kind === 'ready' ? current : { kind: 'loading' });
    void request<EvidenceList>('evidence.list', { workspaceId, sessionId }).then(
      value => { if (generation.current === seq) setState({ kind: 'ready', value }); },
      error => { if (generation.current === seq) setState({ kind: 'error', message: errorMessage(error) }); },
    );
  }, [request, workspaceId, sessionId]);

  useEffect(() => {
    setState({ kind: 'idle' });
    refresh();
    return () => { generation.current += 1; };
  }, [refresh]);
  useSocketEvent(event => {
    if (event.type === 'turn.completed' && event.sessionId === sessionId) refresh();
  });

  if (!workspaceId || !sessionId) {
    return <div className="work-pane-empty" role="tabpanel" aria-label="证据"><Fingerprint size={22} aria-hidden /><p>尚无会话证据</p></div>;
  }

  const evidence = state.kind === 'ready' ? state.value : null;
  const events = evidence?.events.filter(event => event.kind !== 'post_edit_hook') ?? [];

  return (
    <div className="evidence-drawer" role="tabpanel" aria-label="证据">
      <div className="evidence-head">
        <h3>执行证据</h3>
        <button type="button" className="icon-button" aria-label="刷新证据" onClick={refresh}>
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {state.kind === 'loading' && <p className="evidence-note" role="status"><LoaderCircle size={13} className="spin" aria-hidden /> 加载证据…</p>}
      {state.kind === 'error' && <p className="evidence-note evidence-error" role="alert">{state.message}</p>}
      {evidence && evidence.artifacts.length + evidence.hooks.length + events.length === 0 && (
        <p className="evidence-note">当前会话暂无可核对回执。</p>
      )}
      {evidence && evidence.artifacts.length > 0 && (
        <section aria-label="交付物" className="evidence-section">
          <h4>交付物</h4>
          {evidence.artifacts.map(artifact => (
            <LazyEvidence key={artifact.id} label={`核验 ${artifact.path}`}
              summary={<span className="evidence-entry-title"><FileCheck2 size={13} aria-hidden /> {artifact.path}</span>}
              read={() => request<EvidenceArtifact>('artifact.read', { artifactId: artifact.id })}>
              {verified => (
                <div className="evidence-body">
                  <p className="evidence-note">
                    {verified.verified === true ? '留档字节已核验，与工作区一致'
                      : verified.historicalVerified === true ? '留档字节已核验，当前工作区未确认一致' : '尚无字节核验结果'}
                  </p>
                  {typeof verified.content === 'string' && <pre aria-label="已保存文件内容">{verified.content}</pre>}
                </div>
              )}
            </LazyEvidence>
          ))}
          {evidence.artifacts.map(artifact => (
            <dl className="evidence-identity" key={artifact.id} aria-label={`${artifact.path} 的摘要与执行标识`}>
              {artifact.sha256 && <><dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd></>}
              {artifact.coreRunId && <><dt>Core Run ID</dt><dd><code>{artifact.coreRunId}</code></dd></>}
            </dl>
          ))}
        </section>
      )}
      {evidence && evidence.hooks.length > 0 && (
        <section aria-label="编辑后检查" className="evidence-section">
          <h4>编辑后检查</h4>
          {evidence.hooks.map(event => <EventEntry key={event.id} event={event} />)}
        </section>
      )}
      {events.length > 0 && (
        <section aria-label="事件记录" className="evidence-section">
          <h4>事件记录</h4>
          {events.map(event => <EventEntry key={event.id} event={event} />)}
        </section>
      )}
    </div>
  );
}

function EventEntry({ event }: { event: EvidenceEvent }) {
  const { request } = useSocket();
  const label = textField(event.payload, 'checkName') ?? EVENT_LABEL[event.kind] ?? event.kind;
  const status = textField(event.payload, 'status') ?? textField(event.payload, 'validationStatus');
  const snapshot = textField(event.payload, 'snapshotSha256');

  return (
    <LazyEvidence label={`查看 ${label} 的 Event JSON`}
      summary={<><span className="evidence-entry-title">{label}</span>{status && <span className="chip muted">{STATUS_LABEL[status] ?? status}</span>}</>}
      read={() => request<EvidenceEvent>('event.read', { eventId: event.id })}>
      {detail => (
        <div className="evidence-body">
          {snapshot && <p className="evidence-note">快照 SHA-256 <code>{snapshot}</code></p>}
          <pre aria-label="Event JSON">{JSON.stringify(detail, null, 2)}</pre>
        </div>
      )}
    </LazyEvidence>
  );
}
