/** Centered hero empty state with optional interactive jiggle Axis emblem + animated greeting. */
import { useState, type MouseEvent, type ReactNode } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  hero?: string;
  icon?: LucideIcon;
  description?: string;
  badge?: ReactNode;
  brandTheme?: 'dark' | 'light';
  onBrandClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}

export function EmptyState({
  hero,
  icon: Icon,
  description,
  badge,
  brandTheme,
  onBrandClick,
  children,
}: EmptyStateProps) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();
  const [rippleSeq, setRippleSeq] = useState(0);

  const handleEmblemClick = (e: MouseEvent<HTMLButtonElement>) => {
    setRippleSeq((s) => s + 1);
    if (!reduce) {
      void controls.start({
        rotate: [0, -16, 14, -10, 6, -2, 0],
        scale: [1, 1.16, 0.91, 1.07, 0.97, 1.02, 1],
        y: [0, -4, 2, -1.5, 0],
        transition: { duration: 0.56, ease: [0.22, 1, 0.36, 1] },
      });
    }
    onBrandClick?.(e);
  };

  const emblemSrc = brandTheme === 'dark' ? '/axis-mark-dark.png' : '/axis-mark-light.png';

  return (
    <div className="empty-state">
      {Icon && (
        <div className="placeholder-icon">
          <Icon size={24} strokeWidth={1.6} aria-hidden />
        </div>
      )}
      {hero && (
        <div className="hero-row">
          {brandTheme && (
            <motion.button
              type="button"
              className="hero-emblem-btn"
              aria-label="Axis 标志，点击切换欢迎语"
              title="点一下试试"
              animate={controls}
              whileHover={reduce ? undefined : { scale: 1.07, rotate: -5 }}
              onClick={handleEmblemClick}
            >
              {rippleSeq > 0 && !reduce && (
                <motion.span
                  key={rippleSeq}
                  className="hero-emblem-ring"
                  aria-hidden="true"
                  initial={{ opacity: 0.55, scale: 0.72 }}
                  animate={{ opacity: 0, scale: 1.85 }}
                  transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              <img src={emblemSrc} alt="" aria-hidden="true" className="hero-emblem-img" />
            </motion.button>
          )}
          <motion.h1
            key={hero}
            className="hero"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {hero}
          </motion.h1>
        </div>
      )}
      {description && <p className="empty-desc">{description}</p>}
      {badge}
      {children}
    </div>
  );
}
