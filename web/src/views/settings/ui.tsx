/** Small shared form primitives for the Settings console (tokens-driven). */
import { useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export function SectionHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <header className="set-section-head">
      <span className="set-section-icon" aria-hidden><Icon size={18} strokeWidth={1.7} /></span>
      <div>
        <h2 className="set-section-title">{title}</h2>
        {description && <p className="set-section-desc">{description}</p>}
      </div>
    </header>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  // The control is wrapped by the label for implicit association (a11y + tests).
  return (
    <div className="set-field">
      <label className="set-field-label">
        <span className="set-field-text">{label}</span>
        <span className="set-field-control">{children}</span>
      </label>
      {hint && <p className="set-field-hint">{hint}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`set-input${props.className ? ` ${props.className}` : ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`set-select${props.className ? ` ${props.className}` : ''}`} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="set-toggle-thumb" aria-hidden />
    </button>
  );
}

/** Two-step destructive button: first click arms, second confirms. */
export function ConfirmButton({ onConfirm, children, confirmLabel = '确认删除', confirmAriaLabel, className = 'button danger', label, disabled }: {
  onConfirm: () => void; children: ReactNode; confirmLabel?: string; confirmAriaLabel?: string;
  className?: string; label?: string; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={armed ? confirmAriaLabel ?? confirmLabel : label}
      className={armed ? 'button danger armed' : className}
      onClick={() => {
        if (armed) { setArmed(false); onConfirm(); }
        else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="set-empty">{children}</div>;
}
