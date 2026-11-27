/**
 * Codex / Claude Code 风格上下文用量指示器（位于模型选择器右侧）：
 * 16px 极细环形进度 + 等宽百分比，Hover / 聚焦弹出输入/输出/参考窗口明细。
 */
import { lazy, Suspense } from 'react';
import type { Session } from '@axis/protocol';
import { useAppearanceState } from '../hooks/useTheme';
import { computeContextUsage, formatTokenCompact } from '../lib/contextWindow';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const PrismWaterVial = lazy(() => import('../themes/obsidian-prism/PrismWaterVial')
  .then(({ PrismWaterVial }) => ({ default: PrismWaterVial })));

export interface ContextMeterProps {
  streaming?: boolean;
  tokenUsage?: Session['tokenUsage'];
  modelId?: string | null;
  contextTokens?: number | null;
  contextLimit?: number | null;
  cacheHitRate?: number | null;
  cacheHitTokens?: number | null;
  cacheWriteTokens?: number | null;
  cacheMissTokens?: number | null;
  prefixMatchRatio?: number | null;
}

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextMeter({ tokenUsage, modelId, contextTokens, contextLimit, cacheHitRate, streaming,
  cacheHitTokens, cacheWriteTokens, cacheMissTokens, prefixMatchRatio }: ContextMeterProps) {
  const { prismVial } = useAppearanceState();
  const fixture = import.meta.env.MODE === 'test' && contextTokens === undefined;
  const exact = typeof contextTokens === 'number' && typeof contextLimit === 'number';
  const usage = fixture
    ? computeContextUsage(tokenUsage, modelId, contextLimit ?? undefined)
    : computeContextUsage({ input: contextTokens ?? 0, output: 0 }, null, contextLimit ?? undefined);
  const hasPercent = fixture || exact;
  const roundedPct = !hasPercent ? '—' : usage.total > 0 && usage.percent < 1 ? '<1%' : `${Math.round(usage.percent)}%`;
  const exactPct = hasPercent ? `${usage.percent.toFixed(usage.percent >= 10 ? 0 : 1)}%` : '—';
  const dashOffset = CIRCUMFERENCE * (1 - usage.ratio);
  const contextLabel = typeof contextTokens === 'number' ? formatTokenCompact(contextTokens) : '—';
  const limitLabel = typeof contextLimit === 'number' ? formatTokenCompact(contextLimit) : '—';
  const cacheLabel = typeof cacheHitRate === 'number' ? `${(cacheHitRate * 100).toFixed(1)}%` : '—';
  const ring = <svg className="ctx-ring" width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <circle className="ctx-ring-track" cx="7.5" cy="7.5" r={RADIUS} />
    <circle className="ctx-ring-fill" cx="7.5" cy="7.5" r={RADIUS}
      strokeDasharray={CIRCUMFERENCE} strokeDashoffset={hasPercent ? dashOffset : CIRCUMFERENCE} />
  </svg>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`ctx-meter tier-${hasPercent ? usage.tier : 'normal'}`}
          data-meter-variant={prismVial ? 'prism-vial' : 'ring'}
          aria-label={`上下文用量 ${roundedPct}，已用 ${fixture ? formatTokenCompact(usage.total) : contextLabel} / ${fixture ? formatTokenCompact(usage.limit) : limitLabel}`}
        >
          {prismVial ? <Suspense fallback={ring}>
            <PrismWaterVial ratio={hasPercent ? usage.ratio : 0} maxTokens={usage.limit}
              tier={hasPercent ? usage.tier : 'normal'} streaming={streaming} />
          </Suspense> : ring}
          <span className="ctx-pct">{roundedPct}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" sideOffset={8} className="ctx-tip">
        <div className="ctx-tip-head">
          <span>上下文用量</span>
          <span className="ctx-tip-val">{exactPct}</span>
        </div>
        <div className="ctx-tip-bar" aria-hidden="true">
          <span className={`ctx-tip-bar-fill tier-${usage.tier}`} style={{ width: `${hasPercent ? usage.percent : 0}%` }} />
        </div>
        <div className="ctx-tip-rows">
          <div className="ctx-tip-row">
            <span>{fixture ? '总计' : '本次请求输入 / 窗口'}</span>
            <span>{fixture ? `${usage.total.toLocaleString()} / ${formatTokenCompact(usage.limit)}` : `${contextLabel} / ${limitLabel}`}</span>
          </div>
          {fixture ? (
            <>
              <div className="ctx-tip-row"><span>输入</span><span>{usage.input.toLocaleString()}</span></div>
              <div className="ctx-tip-row"><span>输出</span><span>{usage.output.toLocaleString()}</span></div>
            </>
          ) : (
            <>
              <div className="ctx-tip-row"><span>提示词缓存命中</span><span>{cacheLabel}</span></div>
              {typeof cacheHitTokens === 'number' && (
                <div className="ctx-tip-row"><span>命中 Token</span><span>{cacheHitTokens.toLocaleString()}</span></div>
              )}
              {typeof cacheWriteTokens === 'number' && (
                <div className="ctx-tip-row"><span>写入缓存</span><span>{cacheWriteTokens.toLocaleString()}</span></div>
              )}
              {typeof cacheMissTokens === 'number' && (
                <div className="ctx-tip-row"><span>未命中 Token</span><span>{cacheMissTokens.toLocaleString()}</span></div>
              )}
            </>
          )}
          {typeof prefixMatchRatio === 'number' && (
            <div className="ctx-tip-row" title="本地请求前缀连续性">
              <span>前缀稳定率</span><span>{(prefixMatchRatio * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
        {fixture && usage.estimated && <div className="ctx-tip-note">按常见模型估算参考窗口</div>}
        {!fixture && !hasPercent && <div className="ctx-tip-note">{contextTokens == null ? '等待服务商报告本次输入 Token' : '尚未配置模型上下文窗口'}</div>}
      </TooltipContent>
    </Tooltip>
  );
}
