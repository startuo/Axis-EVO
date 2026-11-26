/**
 * Shared motion vocabulary for the Axis-Evo UI (framer-motion 11).
 * Durations/easings mirror styles/tokens.css (--dur-fast/--dur-med/--ease-out)
 * so CSS-animated surfaces (components/ui/animations.css) and framer-driven
 * surfaces feel identical. Every consumer must stay reduced-motion safe:
 * either spread `motionProps(useReducedMotion(), …)` or pass
 * `transition={reduce ? { duration: 0 } : …}` like EffortGauge does.
 */
import type { Transition, Variants } from 'framer-motion';

/** Cubic-bezier tuples (mutable tuple type so framer accepts them directly). */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];
/** Named ease constants — `EASE.out` is the house curve (tokens.css --ease-out). */
export const EASE = { out: EASE_OUT, inOut: EASE_IN_OUT };

/** Seconds, matching tokens.css --dur-fast / --dur-med (+ one slower step). */
export const DURATION = { instant: 0.09, fast: 0.13, med: 0.23, slow: 0.34 };

export const transitionInstant: Transition = { duration: DURATION.instant, ease: EASE_OUT };
export const transitionFast: Transition = { duration: DURATION.fast, ease: EASE_OUT };
export const transitionMed: Transition = { duration: DURATION.med, ease: EASE_OUT };
export const transitionSlow: Transition = { duration: DURATION.slow, ease: EASE_OUT };

/** Spring configs — snappy matches EffortGauge's caret/track spring. */
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.78, restDelta: 0.4, restSpeed: 4 };
export const SPRING_SMOOTH: Transition = { type: 'spring', stiffness: 380, damping: 38, mass: 0.85, restDelta: 0.5, restSpeed: 5 };
export const SPRING_GESTURE: Transition = { type: 'spring', stiffness: 420, damping: 30, mass: 0.72, restDelta: 0.25, restSpeed: 3 };
export const springSnappy = SPRING_SNAPPY;
export const springSoft = SPRING_SMOOTH;
export const springGentle: Transition = { type: 'spring', stiffness: 180, damping: 24 };

/** Plain opacity cross-fade (overlays, tooltips, tab panels). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/** House entrance: subtle rise + fade (cards, messages, list rows). */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

/** Popover/dialog zoom (scale only — composes with Tailwind `translate` utils). */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
};

export const popoverOrigin: Variants = {
  hidden: { opacity: 0, y: 6, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.97 },
};

export const panelReveal: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
};

export const iconSwap: Variants = {
  hidden: { opacity: 0, scale: 0.84 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.84 },
};

/**
 * Side-panel slide. Pass `custom={sideDirection(side)}` on the motion element:
 * -1 slides in from the left, +1 from the right.
 */
export const slideSide: Variants = {
  hidden: (dir: number = 1) => ({ opacity: 0, x: 24 * dir }),
  visible: { opacity: 1, x: 0 },
  exit: (dir: number = 1) => ({ opacity: 0, x: 24 * dir }),
};

/** Map a sheet/drawer side to the `custom` value slideSide expects. */
export function sideDirection(side: 'left' | 'right'): -1 | 1 {
  return side === 'left' ? -1 : 1;
}

/** Layout-list rows: pair with `listContainer` + AnimatePresence + `layout`. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98 },
};

/** Stagger parent for listItem rows. */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
  exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
};

/** Spread-safe motion props returned by {@link motionProps}. */
export interface SafeMotionProps {
  variants: Variants;
  initial: string | false;
  animate: string;
  exit: string;
  transition: Transition;
}

export function reducedTransition(reduce: boolean | null | undefined, transition: Transition = transitionMed): Transition {
  return reduce ? { duration: 0 } : transition;
}

/** Damp travel beyond the end of a drag track. */
export function rubberBand(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const damped = (1 - 1 / ((Math.abs(overshoot) * constant) / dimension + 1)) * dimension;
  return Math.sign(overshoot) * damped;
}

/** Project release velocity onto the track with a bounded stopping distance. */
export function projectMomentum(velocityPerSec: number, factor = 0.055, maxShift = 0.28): number {
  return Math.max(-maxShift, Math.min(maxShift, velocityPerSec * factor));
}

/**
 * useReducedMotion-safe prop bundle: `<motion.div {...motionProps(reduce, scaleIn)} />`.
 * `reduce` accepts the hook's `boolean | null` return. When reduced motion is
 * requested the entrance is skipped (`initial: false`) and exits resolve in 0s,
 * so AnimatePresence still unmounts children immediately.
 */
export function motionProps(
  reduce: boolean | null | undefined,
  variants: Variants = fadeUp,
  transition: Transition = transitionMed,
): SafeMotionProps {
  return { variants, initial: reduce ? false : 'hidden', animate: 'visible', exit: 'exit', transition: reducedTransition(reduce, transition) };
}
