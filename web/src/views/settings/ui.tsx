/** Small shared form primitives for the Settings console (tokens-driven). */
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
export { ConfirmButton } from '../../components/ConfirmButton';

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

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="set-empty">{children}</div>;
}
