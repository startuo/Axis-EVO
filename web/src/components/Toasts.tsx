/** Global toast stack (error / warn / success / info) with auto-dismiss. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  push: (kind: ToastKind, text: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: Check,
  warn: TriangleAlert,
  error: CircleAlert,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((cur) => [...cur.slice(-4), { id, kind, text }]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.kind];
            return (
              <motion.div
                key={t.id}
                className={`toast ${t.kind}`}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <Icon size={15} className="toast-icon" aria-hidden />
                <span className="toast-text">{t.text}</span>
                <button
                  className="icon-button toast-close"
                  aria-label="关闭通知"
                  onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
                >
                  <span aria-hidden>×</span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
