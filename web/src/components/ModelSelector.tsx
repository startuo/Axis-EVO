/**
 * 输入舱模型与推理等级选择器（参考 DSH-Claude-Style-Reasoning-Slider + Codex 桌面双入口）：
 * - 模型菜单：按提供商/端点清晰分组，多模型接入后自动启用即时搜索，底部直达「接入/管理模型」
 * - 推理等级入口：带色阶信号条与高档位流动渐变字效，点击展开 Claude 风格动态玻璃滑块
 * - Esc 逐级收回（有搜索词先清空，再关闭弹层），无模型时引导一键接入
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, CircleAlert, Plus, Search, X } from 'lucide-react';
import type { Profile, ReasoningEffort } from '@axis/protocol';
import { EFFORT_LABEL } from '../lib/format';
import { motionProps, popoverOrigin } from '../lib/motion';
import { defaultProfileEffort, endpointDisplayName, groupProfilesByEndpoint } from '../lib/providers';
import { useClickOutside } from '../hooks/useClickOutside';
import { EffortGauge, EffortSignalIcon } from './ui/effort-gauge';
import './model-selector.css';

export interface ModelSelectorProps {
  profiles: Profile[];
  profileId: string | null;
  onProfileChange: (id: string) => void;
  effort: ReasoningEffort;
  onEffortChange: (e: ReasoningEffort) => void;
  onOpenSettings?: () => void;
}

export function ModelSelector({
  profiles, profileId, onProfileChange, effort, onEffortChange, onOpenSettings,
}: ModelSelectorProps) {
  const [openMenu, setOpenMenu] = useState<'model' | 'effort' | null>(null);
  const [query, setQuery] = useState('');
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const modelOptions = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const effortTrigger = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => {
    setOpenMenu(null);
    setQuery('');
  };

  useClickOutside(ref, closeMenu, openMenu !== null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!openMenu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (openMenu === 'model' && query) {
        setQuery('');
        searchRef.current?.focus();
        return;
      }
      closeMenu();
      (openMenu === 'model' ? modelTrigger : effortTrigger).current?.focus();
      return;
    }
    if (openMenu !== 'model') return;
    const options = Array.from(modelOptions.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const activeIndex = options.findIndex((option) => option === event.target);
    if (activeIndex < 0 && event.target !== searchRef.current && event.target !== modelTrigger.current) return;
    const next = event.key === 'ArrowDown' ? options[Math.min(activeIndex + 1, options.length - 1)]
      : event.key === 'ArrowUp' ? (activeIndex < 0 ? options.at(-1) : options[activeIndex - 1] ?? searchRef.current ?? options[0])
      : event.key === 'Home' && activeIndex >= 0 ? options[0]
      : event.key === 'End' && activeIndex >= 0 ? options.at(-1) : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const showSearch = profiles.length >= 4;
  useEffect(() => {
    if (openMenu === 'model' && showSearch) searchRef.current?.focus();
  }, [openMenu, showSearch]);

  const current = profiles.find((p) => p.id === profileId) ?? null;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? profiles.filter(
        (p) =>
          p.name.toLowerCase().includes(q)
          || p.modelId.toLowerCase().includes(q)
          || p.endpoint.toLowerCase().includes(q)
          || endpointDisplayName(p.endpoint).toLowerCase().includes(q),
      )
      : profiles;
    return groupProfilesByEndpoint(matched);
  }, [profiles, query]);

  return (
    <div className="model-controls" ref={ref} onKeyDown={onKeyDown}>
      <div className="model-select">
        <button
          type="button"
          ref={modelTrigger}
          className={`model-btn${openMenu === 'model' ? ' open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'model'}
          aria-label="选择模型"
          onClick={() => {
            setQuery('');
            setOpenMenu((cur) => (cur === 'model' ? null : 'model'));
          }}
        >
          {current && !current.credentialConfigured && (
            <span className="model-warn-dot" title="该模型尚未配置密钥" aria-hidden />
          )}
          <span className="model-name">{current ? current.name : '未配置模型'}</span>
          <ChevronDown size={13} className={`chev${openMenu === 'model' ? ' open' : ''}`} aria-hidden />
        </button>
        <AnimatePresence>
          {openMenu === 'model' && (
            <motion.div
              className="popover model-pop"
              role="dialog"
              aria-label="选择模型"
              {...motionProps(reduce, popoverOrigin)}
            >
              <div className="model-pop-head">
                <span className="pop-label">已接入模型</span>
                {profiles.length > 0 && <span className="model-pop-count">{profiles.length} 款</span>}
              </div>

              {showSearch && (
                <div className="model-pop-search-wrap">
                  <Search size={13} className="model-pop-search-icon" aria-hidden />
                  <input
                    ref={searchRef}
                    type="text"
                    className="model-pop-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索已接入模型…"
                    aria-label="搜索已接入模型"
                  />
                  {query && (
                    <button
                      type="button"
                      className="icon-button model-pop-search-clear"
                      aria-label="清空搜索"
                      onClick={() => setQuery('')}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </div>
              )}

              {profiles.length === 0 ? (
                <div className="pop-empty">尚未接入模型</div>
              ) : filteredGroups.length === 0 ? (
                <div className="pop-empty">未找到匹配「{query}」的模型</div>
              ) : (
                <div className="model-pop-scroll" role="listbox" aria-label="模型配置" ref={modelOptions}>
                  {filteredGroups.map((group) => (
                    <div key={group.key} className="model-pop-group" role="group" aria-label={group.label}>
                      <div className="model-pop-group-head">
                        <span className="model-pop-group-name" title={group.endpoint}>{group.label}</span>
                        <span className="model-pop-group-count">{group.profiles.length}</span>
                      </div>
                      {group.profiles.map((p) => {
                        const selected = p.id === profileId;
                        const eff = selected ? effort : defaultProfileEffort(p);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`pop-item model-pop-option${selected ? ' selected' : ''}`}
                            onClick={() => {
                              onProfileChange(p.id);
                              closeMenu();
                              modelTrigger.current?.focus();
                            }}
                          >
                            <span className="pop-item-main">
                              <span className="pop-item-title">
                                {!p.credentialConfigured && (
                                  <CircleAlert size={12} className="model-opt-warn" aria-hidden />
                                )}
                                <span>{p.name}</span>
                              </span>
                              {p.modelId !== p.name && (
                                <span className="pop-item-sub">{p.modelId}</span>
                              )}
                            </span>
                            <span className="model-opt-meta">
                              <span className={`model-opt-effort tier-${eff}`} title={`思考强度：${EFFORT_LABEL[eff]}`}>
                                <EffortSignalIcon value={eff} />
                                <span className={`model-effort tier-${eff}`}>{EFFORT_LABEL[eff]}</span>
                              </span>
                              {selected && <Check size={14} className="model-opt-check" aria-hidden />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {onOpenSettings && (
                <div className="model-pop-foot">
                  <button
                    type="button"
                    className="model-pop-manage"
                    onClick={() => { closeMenu(); onOpenSettings(); }}
                  >
                    <Plus size={13} aria-hidden />
                    <span>接入或管理模型</span>
                    <ArrowRight size={12} className="model-pop-manage-arrow" aria-hidden />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="effort-select">
        <button
          type="button"
          ref={effortTrigger}
          className={`effort-pill-btn tier-${effort}${openMenu === 'effort' ? ' open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'effort'}
          aria-label={`思考强度：${EFFORT_LABEL[effort]}`}
          title={current ? '调整思考强度' : '请先配置模型'}
          disabled={!current}
          onClick={() => {
            setQuery('');
            setOpenMenu((cur) => (cur === 'effort' ? null : 'effort'));
          }}
        >
          <EffortSignalIcon value={effort} />
          <span className={`model-effort tier-${effort}`}>{EFFORT_LABEL[effort]}</span>
          <ChevronDown size={11} className={`chev${openMenu === 'effort' ? ' open' : ''}`} aria-hidden />
        </button>
        <AnimatePresence>
          {openMenu === 'effort' && (
            <motion.div
              className="popover effort-pop"
              role="dialog"
              aria-label="思考强度设置"
              {...motionProps(reduce, popoverOrigin)}
            >
              <EffortGauge value={effort} onChange={onEffortChange} label="思考强度" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
