/**
 * Obsidian Prism 物理浅水上下文试管适配器：
 * 懒加载上游 `vial-core.js`（mountPhysicalWaterVial），将 Axis-Evo 的实时
 * 上下文比例、深浅色板与强调色映射到 24 节点浅水波阻尼试管，静止自动降回 0fps。
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAppearanceState } from '../../hooks/useTheme';
import { loadVialCore } from './vendor/loaders';
import type { WaterVialController } from './vendor/types';
import './prism-widgets.css';

export interface PrismWaterVialProps {
  ratio: number;
  maxTokens: number;
  tier: 'normal' | 'warn' | 'danger';
  streaming?: boolean;
  /** 紧凑尺寸（输入舱内嵌入）或详情尺寸 */
  compact?: boolean;
}

export function PrismWaterVial({ ratio, maxTokens, tier, streaming = false, compact = true }: PrismWaterVialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<WaterVialController | null>(null);
  const rafRef = useRef<number | null>(null);
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();
  const quiet = Boolean(reduce) || appearance.motionTier === 'focus';

  const stateRef = useRef({
    ratio,
    maxTokens,
    tier,
    streaming,
    uiStyle: appearance.uiStyle,
    resolvedTheme: appearance.resolvedTheme,
    activePrismPalette: appearance.activePrismPalette,
    prismAccent: appearance.prismAccent,
    quiet,
  });
  stateRef.current = {
    ratio,
    maxTokens,
    tier,
    streaming,
    uiStyle: appearance.uiStyle,
    resolvedTheme: appearance.resolvedTheme,
    activePrismPalette: appearance.activePrismPalette,
    prismAccent: appearance.prismAccent,
    quiet,
  };

  useEffect(() => {
    let alive = true;
    let lastTs = performance.now();

    const stopLoop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const startLoop = () => {
      if (!alive || rafRef.current !== null) return;
      lastTs = performance.now();
      const frame = (now: number) => {
        rafRef.current = null;
        if (!alive || !ctrlRef.current) return;
        const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
        lastTs = now;
        ctrlRef.current.step(dt);
        if (!stateRef.current.quiet && (!ctrlRef.current.isSettled() || stateRef.current.streaming)) {
          rafRef.current = requestAnimationFrame(frame);
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    void loadVialCore().then((mod) => {
      if (!alive || !mod || !canvasRef.current) return;
      const s = stateRef.current;
      const ctrl = mod.mountPhysicalWaterVial(canvasRef.current, {
        fill: Math.max(0.06, Math.min(0.95, s.ratio)),
        isDark: s.resolvedTheme === 'dark',
        streaming: s.streaming && !s.quiet,
        maxTokens: s.maxTokens,
        reduceMotion: s.quiet,
        onWake: startLoop,
        getState: () => {
          const cur = stateRef.current;
          const isAxisDefault = cur.uiStyle === 'default';
          const darkPal = isAxisDefault || cur.activePrismPalette === 'warm' ? 'warm' : 'obsidian';
          const lightPal = isAxisDefault || cur.activePrismPalette === 'alabaster' ? 'alabaster' : 'crystal';
          return {
            isDark: cur.resolvedTheme === 'dark',
            palette: darkPal,
            lightPreset: lightPal,
            accentTone: isAxisDefault ? 'amber' : (cur.prismAccent === 'default' ? 'follow' : cur.prismAccent),
            camp: darkPal === 'warm' ? 'claude' : 'gemini',
            critical: cur.tier === 'danger',
            fill: Math.max(0.06, Math.min(0.95, cur.ratio)),
            maxTokens: cur.maxTokens,
            streaming: cur.streaming && !cur.quiet,
          };
        },
      });
      ctrlRef.current = ctrl;
      ctrl.step(0.016);
      if (!s.quiet) startLoop();
    });

    return () => {
      alive = false;
      stopLoop();
      ctrlRef.current?.dispose();
      ctrlRef.current = null;
    };
  }, [quiet]);

  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    ctrl.setTheme(appearance.resolvedTheme === 'dark');
    ctrl.setLevel(Math.max(0.06, Math.min(0.95, ratio)));
    if (!quiet) ctrl.agitate(0.85);
    else ctrl.step(0.016);
  }, [ratio, appearance.resolvedTheme, appearance.activePrismPalette, appearance.prismAccent, streaming, quiet]);

  return (
    <span className={`prism-vial-wrap${compact ? ' compact' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="prism-vial-canvas" />
    </span>
  );
}
