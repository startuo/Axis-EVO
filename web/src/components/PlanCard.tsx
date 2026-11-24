/** Plan item card: step list with live status icons. */
import { CheckCircle2, Circle, ListTodo, LoaderCircle, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { Item, PlanStep } from '@axis/protocol';

const STEP_ICON: Record<PlanStep['status'], { icon: LucideIcon; cls: string }> = {
  pending: { icon: Circle, cls: 'step-pending' },
  running: { icon: LoaderCircle, cls: 'step-running' },
  done: { icon: CheckCircle2, cls: 'step-done' },
  failed: { icon: XCircle, cls: 'step-failed' },
  skipped: { icon: MinusCircle, cls: 'step-skipped' },
};

export function PlanCard({ item }: { item: Item }) {
  const steps = item.steps ?? [];
  const done = steps.filter((s) => s.status === 'done').length;
  return (
    <div className="card plan-card">
      <div className="tool-head plan-head">
        <ListTodo size={15} className="tool-icon" aria-hidden />
        <span className="tool-name">计划</span>
        <span className="chip muted">
          {done}/{steps.length}
        </span>
      </div>
      <div className="plan-steps">
        {steps.map((s) => {
          const meta = STEP_ICON[s.status];
          const Icon = meta.icon;
          return (
            <div key={s.id} className={`plan-step ${meta.cls}`}>
              <Icon size={14} className={s.status === 'running' ? 'spin' : undefined} aria-hidden />
              <span>{s.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
