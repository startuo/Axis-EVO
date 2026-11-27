/**
 * Obsidian Prism 切工水晶光学条适配器：
 * 懒加载上游 `crystal-prism-core.js`（mountCrystalPrismBar），叠加于推理滑块轨道，
 * 跟随鼠标近场激活色散高光，离开后自动收敛至 0fps。
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAppearanceState } from '../../hooks/useTheme';
import { loadCrystalPrismCore } from './vendor/loaders';
import type { CrystalBarController } from './vendor/types';
import './prism-widgets.css';

export interface PrismCrystalBarProps {
  fillRatio: number;
  pointerClient?: { x: number; y: number } | null;
}

export function PrismCrystalBar({ fillRatio, pointerClient }: PrismCrystalBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<CrystalBarController | null>(null);
  const rafRef = useRef<number | null>(null);
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();
  const quiet = Boolean(reduce) || appearance.motionTier === 'focus';

  const resolvedAccent =
    appearance.uiStyle === 'default'
      ? 'warm'
      : appearance.prismAccent === 'default' && appearance.activePrismPalette === 'warm'
        ? 'warm'
        : appearance.prismAccent;

  const stateRef = useRef({
    fillRatio,
    isDark: appearance.resolvedTheme === 'dark',
    accent: resolvedAccent,
    quiet,
  });
  stateRef.current = {
    fillRatio,
    isDark: appearance.resolvedTheme === 'dark',
    accent: resolvedAccent,
    quiet,
  };

  const pump = () => {
    if (rafRef.current !== null || !ctrlRef.current) return;
    let lastTs = performance.now();
    const tick = (now: number) => {
      rafRef.current = null;
      const ctrl = ctrlRef.current;
      if (!ctrl) return;
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;
      ctrl.step(dt);
      if (!ctrl.isIdle() && !stateRef.current.quiet) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    let alive = true;
    void loadCrystalPrismCore().then((mod) => {
      if (!alive || !mod || !canvasRef.current) return;
      const ctrl = mod.mountCrystalPrismBar(canvasRef.current, {
        reduceMotion: stateRef.current.quiet,
        getState: () => ({
          isDark: stateRef.current.isDark,
          prismStrength: stateRef.current.quiet ? 0.35 : 1,
          accent: stateRef.current.accent,
          ambientIntensity: stateRef.current.quiet ? 0 : 0.85,
          hideLock: true,
          fillRatio: Math.max(0, Math.min(1, stateRef.current.fillRatio)),
        }),
      });
      if (!ctrl) return;
      ctrlRef.current = ctrl;
      if (!stateRef.current.quiet) ctrl.wake();
      ctrl.step(0.016);
      pump();
    });

    return () => {
      alive = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      ctrlRef.current?.dispose();
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    ctrl.setReduceMotion(quiet);
    ctrl.invalidate();
    ctrl.step(0.016);
    if (!quiet) pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillRatio, appearance.resolvedTheme, appearance.prismAccent, appearance.activePrismPalette, quiet]);

  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (pointerClient) {
      ctrl.setPointerClient(pointerClient.x, pointerClient.y);
      if (!quiet) pump();
    } else {
      ctrl.setPointerClient(-9999, -9999);
      if (!quiet) pump();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerClient, quiet]);

  return <canvas ref={canvasRef} className="prism-crystal-canvas" aria-hidden="true" />;
}
