/**
 * Codex 桌面端风格双入口控件：左侧「模型选择」+ 右侧紧邻独立「推理强度」小胶囊。
 * 点击推理强度直接弹出可拖拽离散刻度滑轨，互不干扰。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import type { Profile, ReasoningEffort } from '@axis/protocol';
import { EFFORT_LABEL } from '../lib/format';
import { useClickOutside } from '../hooks/useClickOutside';
import { EffortGauge, EffortSignalIcon } from './ui/effort-gauge';

export interface ModelSelectorProps {
  profiles: Profile[];
  profileId: string | null;
  onProfileChange: (id: string) => void;
  effort: ReasoningEffort;
  onEffortChange: (e: ReasoningEffort) => void;
}

export function ModelSelector({ profiles, profileId, onProfileChange, effort, onEffortChange }: ModelSelectorProps) {
  const [openMenu, setOpenMenu] = useState<'model' | 'effort' | null>(null);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpenMenu(null), openMenu !== null);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMenu]);

  const current = profiles.find((p) => p.id === profileId) ?? null;

  return (
    <div className="model-controls" ref={ref}>
      <div className="model-select">
        <button
          type="button"
          className={`model-btn${openMenu === 'model' ? ' open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={openMenu === 'model'}
          aria-label="选择模型"
          onClick={() => setOpenMenu((cur) => (cur === 'model' ? null : 'model'))}
        >
          <span className="model-name">{current ? current.name : '未配置模型'}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
        <AnimatePresence>
          {openMenu === 'model' && (
            <motion.div
              className="popover model-pop"
              role="listbox"
              aria-label="模型配置"
              initial={reduce ? false : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: reduce ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="pop-label">模型配置</div>
              {profiles.length === 0 && <div className="pop-empty">暂无模型配置，请在设置中添加</div>}
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === profileId}
                  className={`pop-item${p.id === profileId ? ' selected' : ''}`}
                  onClick={() => {
                    onProfileChange(p.id);
                    setOpenMenu(null);
                  }}
                >
                  <span className="pop-item-main">
                    <span className="pop-item-title">{p.name}</span>
                    <span className="pop-item-sub">{p.modelId}</span>
                  </span>
                  {p.id === profileId && <Check size={14} aria-hidden />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="effort-select">
        <button
          type="button"
          className={`effort-pill-btn${openMenu === 'effort' ? ' open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'effort'}
          aria-label={`思考强度：${EFFORT_LABEL[effort]}`}
          title={current ? '调整思考强度' : '请先配置模型'}
          disabled={!current}
          onClick={() => setOpenMenu((cur) => (cur === 'effort' ? null : 'effort'))}
        >
          <EffortSignalIcon value={effort} />
          <span className="model-effort">{EFFORT_LABEL[effort]}</span>
          <ChevronDown size={11} aria-hidden />
        </button>
        <AnimatePresence>
          {openMenu === 'effort' && (
            <motion.div
              className="popover effort-pop"
              role="dialog"
              aria-label="思考强度设置"
              initial={reduce ? false : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: reduce ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              <EffortGauge value={effort} onChange={onEffortChange} label="思考强度" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
