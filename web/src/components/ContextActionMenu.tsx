/**
 * 零悬停干扰的右键轻菜单（用于文件产物卡片）：
 * - 平时不弹出悬停浮窗；右键呼出，自动做视口边界防溢出，Esc 或外部点击收回
 */
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export interface ContextActionMenuProps {
  position: { x: number; y: number } | null;
  actions: readonly ContextMenuAction[];
  onClose: () => void;
}

export function ContextActionMenu({ position, actions, onClose }: ContextActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!position) return;
    const menu = menuRef.current;
    if (!menu) return;
    const previousFocus = document.activeElement;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    items[0]?.focus({ preventScroll: true });
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (previousFocus instanceof HTMLElement) previousFocus.focus();
        }
        onClose();
      } else if (index >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
          : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onClose, { capture: true, passive: true });
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [position, onClose]);

  if (!position || typeof document === 'undefined') return null;

  const estW = 200;
  const estH = actions.length * 36 + 14;
  const maxX = Math.max(8, (window.innerWidth || 1024) - estW - 8);
  const maxY = Math.max(8, (window.innerHeight || 768) - estH - 8);
  const left = Math.min(Math.max(8, position.x), maxX);
  const top = Math.min(Math.max(8, position.y), maxY);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="快捷操作菜单"
      className="axis-ctx-menu"
      style={{ left, top }}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className="axis-ctx-menu-item"
            onClick={() => {
              onClose();
              action.onSelect();
            }}
          >
            <Icon size={13} aria-hidden />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
