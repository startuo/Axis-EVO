/**
 * 终端 tab: a REAL streaming terminal. Opens a persistent backend shell
 * (terminal.open), renders it with xterm.js + fit addon, forwards keystrokes
 * via terminal.input and paints terminal.output events live. Colors are read
 * from the design tokens at runtime so the terminal follows the theme.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { LoaderCircle, RefreshCw, TerminalSquare } from 'lucide-react';
import { errorMessage } from '../../lib/format';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';

export interface TerminalTabProps {
  workspaceId: string | null;
  workspacePath: string | null;
  active: boolean;
}

type TermStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const STATUS_LABEL: Record<TermStatus, string> = {
  idle: '等待', connecting: '连接中', open: '已连接', closed: '已关闭', error: '错误',
};
const STATUS_CHIP: Record<TermStatus, string> = {
  idle: 'muted', connecting: 'info', open: 'success', closed: 'muted', error: 'danger',
};

/** Build the xterm theme from the design tokens (tokens.css is the color source). */
function readTerminalTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg-code', '#1a1a1a'),
    foreground: v('--text-secondary', '#b4b4b4'),
    cursor: v('--accent-brand', '#ff5fa2'),
    cursorAccent: v('--bg-code', '#1a1a1a'),
    selectionBackground: v('--bg-active', '#3a3a3a'),
    black: v('--bg-rail', '#0a0a0a'),
    red: v('--accent-danger', '#e5534b'),
    green: v('--accent-success', '#4caf7d'),
    yellow: v('--accent-warn', '#e8a33d'),
    blue: v('--accent-info', '#58a6ff'),
    magenta: v('--accent-brand', '#ff5fa2'),
    cyan: v('--accent-info', '#58a6ff'),
    white: v('--text-primary', '#ececec'),
    brightBlack: v('--text-faint', '#6b6b6b'),
    brightRed: v('--accent-danger', '#e5534b'),
    brightGreen: v('--accent-success', '#4caf7d'),
    brightYellow: v('--accent-warn', '#e8a33d'),
    brightBlue: v('--accent-info', '#58a6ff'),
    brightMagenta: v('--accent-brand', '#ff5fa2'),
    brightCyan: v('--accent-info', '#58a6ff'),
    brightWhite: v('--text-primary', '#ececec'),
  };
}

function readFontFamily(): string {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return font || 'Consolas, "Courier New", monospace';
}

export function TerminalTab({ workspaceId, workspacePath, active }: TerminalTabProps) {
  const { request } = useSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<TermStatus>('idle');
  const [shell, setShell] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Live output → xterm. useSocketEvent keeps the handler fresh without resubscribing.
  useSocketEvent((e) => {
    if (e.type === 'terminal.output' && e.terminalId === terminalIdRef.current) {
      termRef.current?.write(e.data);
    }
  });

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
    } catch {
      /* container hidden or detached; fit again when visible */
    }
  }, []);

  // Open / dispose the backend shell + xterm instance.
  useEffect(() => {
    if (!workspaceId) return;
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;
    let term: Terminal | null = null;
    let openedId: string | null = null;
    setStatus('connecting');
    setError(null);

    const start = async () => {
      try {
        const opened = await request<{ terminalId: string; shell: string; buffer: string }>('terminal.open', { workspaceId });
        if (disposed) {
          void request('terminal.close', { terminalId: opened.terminalId }).catch(() => undefined);
          return;
        }
        openedId = opened.terminalId;
        terminalIdRef.current = opened.terminalId;
        setShell(opened.shell);

        term = new Terminal({
          fontFamily: readFontFamily(),
          fontSize: 13,
          lineHeight: 1.4,
          cursorBlink: true,
          cursorStyle: 'bar',
          scrollback: 5000,
          convertEol: true,
          theme: readTerminalTheme(),
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(el);
        termRef.current = term;
        fitRef.current = fitAddon;
        fit();
        if (opened.buffer) term.write(opened.buffer);

        term.onData((data) => {
          const id = terminalIdRef.current;
          if (!id) return;
          void request('terminal.input', { terminalId: id, data }).catch((e: unknown) => {
            const code = (e as { code?: string }).code;
            if (code === 'NOT_FOUND') setStatus('closed');
          });
        });
        setStatus('open');
      } catch (e) {
        if (!disposed) {
          setStatus('error');
          setError(errorMessage(e));
        }
      }
    };
    void start();

    return () => {
      disposed = true;
      terminalIdRef.current = null;
      if (openedId) void request('terminal.close', { terminalId: openedId }).catch(() => undefined);
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [workspaceId, request, nonce]);

  // Re-fit when the tab becomes visible and on container resize.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(fit, 0);
    return () => clearTimeout(t);
  }, [active, fit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (active) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, fit]);

  // Follow dark ↔ light theme switches live: tokens.css is the color source,
  // so re-read the computed variables whenever data-theme changes.
  useEffect(() => {
    const applyTheme = () => {
      const t = termRef.current;
      // The test double has no `options`; the real Terminal always does.
      if (t && t.options) t.options.theme = readTerminalTheme();
    };
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  if (!workspaceId) {
    return (
      <div className="work-pane-empty" role="tabpanel" aria-label="终端">
        <TerminalSquare size={22} strokeWidth={1.6} aria-hidden />
        <p>工作区未授权</p>
        <span>该任务的工作区尚未授权，无法打开终端。请在设置中添加工作区。</span>
      </div>
    );
  }

  return (
    <div className={`work-terminal${active ? '' : ' hidden'}`} role="tabpanel" aria-label="终端" aria-hidden={!active}>
      <div className="term-bar">
        <TerminalSquare size={14} className="term-bar-icon" aria-hidden />
        <span className="term-shell">{shell || 'shell'}</span>
        <span className={`chip ${STATUS_CHIP[status]}`}>
          {status === 'connecting' && <LoaderCircle size={11} className="spin" aria-hidden />}
          {status === 'open' && <span className="pulse-dot" aria-hidden />}
          {STATUS_LABEL[status]}
        </span>
        <span className="term-path" title={workspacePath ?? ''}>{workspacePath}</span>
        <div className="composer-spacer" />
        {status === 'error' && (
          <button className="text-button" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={13} aria-hidden /> 重试
          </button>
        )}
      </div>
      {error && <div className="error-card term-error">{error}</div>}
      <div className="term-host" ref={containerRef} />
    </div>
  );
}
