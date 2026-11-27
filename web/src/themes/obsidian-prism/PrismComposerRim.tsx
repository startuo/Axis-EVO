/**
 * Obsidian Prism 输入舱棱镜边框流光层：
 * 仅在鼠标靠近输入舱边界或聚焦时在 CSS 变量中更新局部光斑，离开后瞬间回落 0fps。
 */
import { useEffect, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAppearanceState } from '../../hooks/useTheme';
import './prism-widgets.css';

export interface PrismComposerRimProps {
  dockRef: RefObject<HTMLDivElement | null>;
}

export function PrismComposerRim({ dockRef }: PrismComposerRimProps) {
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();
  const active = appearance.prismRim && appearance.motionTier === 'standard' && !reduce;

  useEffect(() => {
    const el = dockRef.current;
    if (!el || !active) {
      if (el) {
        el.style.removeProperty('--prism-rim-x');
        el.style.removeProperty('--prism-rim-y');
        el.style.removeProperty('--prism-rim-o');
      }
      return;
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      const dx = lx < 0 ? -lx : lx > rect.width ? lx - rect.width : 0;
      const dy = ly < 0 ? -ly : ly > rect.height ? ly - rect.height : 0;
      const dist = Math.hypot(dx, dy);
      const radius = 190;
      if (dist > radius) {
        el.style.setProperty('--prism-rim-o', '0');
        return;
      }
      const strength = Math.max(0, 1 - dist / radius);
      el.style.setProperty('--prism-rim-x', `${Math.round(lx)}px`);
      el.style.setProperty('--prism-rim-y', `${Math.round(ly)}px`);
      el.style.setProperty('--prism-rim-o', (strength * strength * 0.92).toFixed(3));
    };

    const onLeave = () => {
      el.style.setProperty('--prism-rim-o', '0');
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      el.style.removeProperty('--prism-rim-x');
      el.style.removeProperty('--prism-rim-y');
      el.style.removeProperty('--prism-rim-o');
    };
  }, [dockRef, active]);

  if (!appearance.prismRim) return null;
  return <div className="prism-composer-rim" aria-hidden="true" />;
}
