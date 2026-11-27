/**
 * 桌面像素伙伴舞台适配器（Axis 默认与 Obsidian Prism 两套主题通用）：
 * 懒加载 `dual-mascot-rig.js`，在输入舱顶沿呈现 Clawd、小紫猫与迷你蟹叠叠乐；
 * Axis 默认下自动采用暖色阵营配色与暖曜/暖白编辑风融合，专注省电或隐藏时自动休眠。
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAppearanceState } from '../../hooks/useTheme';
import { loadDualMascotRig } from './vendor/loaders';
import type { DualMascotStageController } from './vendor/types';
import './prism-widgets.css';

export interface PrismMascotDockProps {
  running?: boolean;
  draftText?: string;
}

export function PrismMascotDock({ running = false, draftText = '' }: PrismMascotDockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<DualMascotStageController | null>(null);
  const prevLenRef = useRef(0);
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();

  const enabled = appearance.prismMascots && appearance.motionTier !== 'focus';

  const camp =
    appearance.uiStyle === 'default' ||
    appearance.activePrismPalette === 'warm' ||
    appearance.activePrismPalette === 'alabaster'
      ? 'claude'
      : 'gemini';

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const host = hostRef.current;
    if (!host) return;

    void loadDualMascotRig().then((mod) => {
      if (!alive || !mod || !hostRef.current) return;
      const stage = mod.mountDualMascotStage(hostRef.current, {
        camp,
        streaming: running,
        reducedMotion: Boolean(reduce),
      });
      stageRef.current = stage;
    });

    return () => {
      alive = false;
      stageRef.current?.dispose();
      stageRef.current = null;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reduce]);

  useEffect(() => {
    stageRef.current?.setState?.({
      camp,
      streaming: running,
      reducedMotion: Boolean(reduce),
    });
  }, [camp, running, reduce]);

  useEffect(() => {
    const len = draftText.length;
    if (len > prevLenRef.current && stageRef.current?.onUserType) {
      stageRef.current.onUserType(draftText);
    }
    prevLenRef.current = len;
  }, [draftText]);

  if (!enabled) return null;
  return <div ref={hostRef} className="ag-cs-dual-stage prism-mascot-stage" aria-hidden="true" />;
}
