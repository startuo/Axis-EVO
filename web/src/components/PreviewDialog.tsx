import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function PreviewDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className="preview-dialog" ref={ref} aria-label={title}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <div className="preview-dialog-head">
        <strong title={title}>{title}</strong>
        <button className="icon-button" type="button" onClick={onClose} title="关闭预览" aria-label="关闭预览">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="preview-dialog-body">{children}</div>
    </dialog>
  );
}
