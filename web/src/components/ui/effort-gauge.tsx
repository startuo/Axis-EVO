/**
 * EffortGauge — 参考 DSH-Claude-Style-Reasoning-Slider 打造的 Claude 风格动画推理强度滑块：
 * - 玻璃凹槽轨道 + SVG 分形细噪 + 鼠标靠近动态光场（内光斑 / 玻璃边缘高光 / 拇指光晕）
 * - 连续磁吸拖拽（接近档位产生磁吸阻尼）+ 边缘橡皮筋阻力 + 松手速度动量预判与弹簧吸附
 * - 圆角方帽 sculpted 玻璃拇指（悬停/拖拽浮现双抓握竖纹）+ 方向性模糊滑动档位标签
 * - Canvas 粒子/像素场：中档为蓝紫稀疏点阵水波纹前奏，高档为流动紫色像素场 + 多彩渐变字效
 * - 严格兼容深浅双主题、键盘无障碍（方向键/Home/End/PageUp/PageDown）与 prefers-reduced-motion
 */
import {
  useCallback, useEffect, useId, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import type { ReasoningEffort } from '@axis/protocol';
import { EFFORT_LABEL, EFFORT_ORDER } from '../../lib/format';
import {
  DURATION, EASE_OUT, projectMomentum, reducedTransition, rubberBand, SPRING_GESTURE,
} from '../../lib/motion';
import { cn } from '../../lib/utils';
import './effort-gauge.css';

const LEVEL_BARS: Record<ReasoningEffort, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const TIER_TAG: Record<ReasoningEffort, string> = {
  off: '直出',
  low: '轻量',
  medium: '均衡',
  high: '深度',
};

const DESCRIPTION: Record<ReasoningEffort, string> = {
  off: '关闭扩展思考，直接给出回答，响应最快',
  low: '轻量推理，适合明确简短的日常问题',
  medium: '均衡模式，兼顾响应速度与多步分析质量',
  high: '深度推演，投入最长思考时间处理复杂架构与调试',
};

const HELP_TIP = '推理等级越高，模型在回答前投入的思考时间越长；高档位适合复杂推理、多步编码与根因排查。';

const LAST = EFFORT_ORDER.length - 1;
const MAX_OVERSHOOT = 0.04;

type PixelCell = {
  x: number;
  y: number;
  row: number;
  column: number;
  nX: number;
  base: number;
  tempo: number;
  phase: number;
  chroma: number;
  purple: number;
  intensity: number;
  depth: number;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): string {
  return `rgb(${Math.round(mix(a[0], b[0], t))} ${Math.round(mix(a[1], b[1], t))} ${Math.round(mix(a[2], b[2], t))})`;
}

/** 连续拖拽磁吸阻尼（参考 DSH-Claude-Style-Reasoning-Slider `_applyMagnet`）：靠近刻度时产生轻度吸附感。 */
function applyMagnet(continuousIndex: number): number {
  const nearest = Math.round(continuousIndex);
  const delta = continuousIndex - nearest;
  const dist = Math.abs(delta);
  const radius = 0.42;
  if (dist < 0.001 || dist > radius) return continuousIndex;
  const t = 1 - dist / radius;
  const strength = 0.56 + 0.34 * t;
  return continuousIndex - delta * strength * t * t;
}

/** 根据画布尺寸预计算静态像素格属性，确保每帧仅做轻量时间运算。 */
function buildPixelGrid(width: number, height: number): { cells: PixelCell[]; cell: number; gap: number } {
  const cell = width < 260 ? 5 : 6;
  const gap = 1.1;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: PixelCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const x = column * cell;
      const y = row * cell;
      const nX = (x + cell * 0.5) / Math.max(1, width);
      cells.push({
        x,
        y,
        row,
        column,
        nX,
        base: Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1,
        tempo: Math.abs(Math.sin(column * 7.13 + row * 19.41) * 19341.731) % 1,
        phase: Math.abs(Math.sin(column * 31.17 + row * 11.93) * 28437.123) % 1,
        chroma: Math.abs(Math.sin(column * 9.47 + row * 67.13) * 15823.917) % 1,
        purple: smoothstep(0.08, 0.88, nX),
        intensity: smoothstep(0.03, 0.36, nX),
        depth: smoothstep(0.32, 0.95, nX),
      });
    }
  }
  return { cells, cell, gap };
}

/** 渲染中档位蓝紫稀疏点阵 + 明暗水波纹（高档像素场的克制前奏）。 */
function drawRippleField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  grid: { cells: PixelCell[]; cell: number; gap: number },
  progress: number,
  elapsedMs: number,
) {
  const thumbW = 24;
  const originX = clamp((width - thumbW) * progress + thumbW * 0.5, 4, width - 4);
  const color: readonly [number, number, number] = [130, 172, 255];
  const reveal = smoothstep(0, 1, elapsedMs / 860);
  const waveCount = 3;
  const ripplePhase = (elapsedMs % 1500) / 1500;

  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, width, height, 10);
  else ctx.rect(0, 0, width, height);
  ctx.clip();

  const { cells, cell, gap } = grid;
  for (const c of cells) {
    const dx = Math.abs(c.x - originX) / Math.max(1, width * 0.55);
    if (dx > 1) continue;
    const near = clamp(1 - dx * 1.1, 0, 1);
    if (c.base > 0.58 - near * 0.46) continue;

    const flicker = 0.5 + 0.5 * Math.sin(elapsedMs * 0.014 + c.tempo * Math.PI * 2 + c.phase * 6.28);
    const wave = 0.5 + 0.5 * Math.sin((dx * waveCount - ripplePhase) * Math.PI * 2);
    const revealAlpha = smoothstep(0, 1, reveal * (1 - dx * 0.85) + dx * 0.15);
    const alpha = clamp((0.14 + 0.42 * flicker + near * (0.48 + near * 0.28)) * (0.14 + 0.86 * wave) * revealAlpha, 0, 0.92);

    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
    ctx.fillRect(c.x + gap * 0.5, c.y + gap * 0.5, cell - gap, cell - gap);
  }
  ctx.restore();
}

const MAX_LEFT: readonly [number, number, number] = [210, 206, 216];
const MAX_HIGHLIGHT: readonly [number, number, number] = [202, 188, 232];
const MAX_PEAK: readonly [number, number, number] = [224, 212, 246];
const MAX_TONES: ReadonlyArray<readonly [number, number, number]> = [
  [148, 94, 208],
  [154, 112, 204],
  [164, 134, 210],
  [172, 152, 212],
  [184, 168, 214],
  [194, 182, 216],
];

/** 渲染高档位 Claude / DSH 流动紫色像素场（自右向左扫光显现 + 闪烁星簇）。 */
function drawMaxPixelField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  grid: { cells: PixelCell[]; cell: number; gap: number },
  elapsedMs: number,
) {
  const reveal = smoothstep(0, 1, elapsedMs / 920);
  const frontier = 1 - reveal;
  const flowDuration = 4000;
  const rawFlow = elapsedMs / flowDuration;
  const flowCycle = Math.floor(rawFlow);
  const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);

  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, width, height, 10);
  else ctx.rect(0, 0, width, height);
  ctx.clip();

  const { cells, cell, gap } = grid;
  for (const c of cells) {
    const revealAlpha = smoothstep(frontier - 0.1, frontier + 0.07, c.nX);
    if (revealAlpha <= 0.002) continue;

    const period = 520 + c.tempo * 1450;
    const localTime = elapsedMs + c.phase * period;
    const cycle = Math.floor(localTime / period);
    const cycleProgress = (localTime % period) / period;
    const cycleHash = Math.abs(Math.sin(c.column * 17.17 + c.row * 41.73 + cycle * 13.11) * 24634.6345) % 1;
    const widthHash = Math.abs(Math.sin(c.column * 5.37 + c.row * 29.11 + cycle * 7.43) * 17391.443) % 1;

    const pulseCenter = 0.2 + cycleHash * 0.55;
    const pulseWidth = 0.09 + widthHash * 0.08;
    const pulseDist = (cycleProgress - pulseCenter) / pulseWidth;
    const irregularFlicker = Math.exp(-pulseDist * pulseDist * 1.45) * (cycleHash > 0.12 ? 1 : 0.26);

    const flowCoord = (c.nX + easedFlow) * 9;
    const flowIdx = Math.floor(flowCoord);
    const flowProg = smoothstep(0, 1, flowCoord - flowIdx);
    const flowHashA = Math.abs(Math.sin(flowIdx * 18.31 + c.row * 37.17) * 19283.173) % 1;
    const flowHashB = Math.abs(Math.sin((flowIdx + 1) * 18.31 + c.row * 37.17) * 19283.173) % 1;
    const clusterGate = smoothstep(0.46, 0.84, mix(flowHashA, flowHashB, flowProg));
    const wavePhase = (c.nX + easedFlow + c.row * 0.06 + c.base * 0.02) * Math.PI * 2;
    const directionalWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
    const directionalFlow = Math.max(clusterGate, directionalWave * 0.62);
    const flowingFlicker = Math.max(
      irregularFlicker * (0.48 + directionalFlow * 0.58),
      directionalFlow * (0.38 + c.base * 0.28),
    );

    const revealGlow = reveal < 0.995
      ? Math.exp(-((c.nX - frontier) ** 2) / 0.012) * (1 - smoothstep(0.7, 1, reveal))
      : 0;
    const lightAmount = Math.max(flowingFlicker, revealGlow * (0.4 + c.base * 0.4));

    const peakHighlight = lightAmount > 0.42 && irregularFlicker > 0.16 && cycleHash > 0.26 && clusterGate > 0.04;
    const hottestHighlight = lightAmount > 0.68 && irregularFlicker > 0.3 && cycleHash > 0.48 && clusterGate > 0.12;
    const highlightAmount = peakHighlight ? 0.96 : clamp(lightAmount * (0.42 + cycleHash * 0.3), 0, 0.64);

    const toneDrift = c.base * 0.28 + c.depth * 0.28 + cycleProgress * 0.36 + easedFlow * 0.18 + cycleHash * 0.2;
    const tonePos = (((toneDrift % 1) + 1) % 1) * MAX_TONES.length;
    const toneIdx = Math.floor(tonePos);
    const toneMix = tonePos - toneIdx;
    const toneA = MAX_TONES[toneIdx]!;
    const toneB = MAX_TONES[(toneIdx + 1) % MAX_TONES.length]!;
    const chromaNudge = (c.chroma - 0.5) * 10 + c.depth * 12;
    const varied: readonly [number, number, number] = [
      clamp(mix(toneA[0], toneB[0], toneMix) + chromaNudge * 0.35 - c.depth * 8, 138, 198),
      clamp(mix(toneA[1], toneB[1], toneMix) - c.depth * 16 + (c.base - 0.5) * 8, 100, 170),
      clamp(mix(toneA[2], toneB[2], toneMix) + c.depth * 6 + (cycleHash - 0.5) * 6, 184, 220),
    ];
    const baseRgb: readonly [number, number, number] = [
      mix(MAX_LEFT[0], varied[0], c.purple),
      mix(MAX_LEFT[1], varied[1], c.purple),
      mix(MAX_LEFT[2], varied[2], c.purple),
    ];

    ctx.fillStyle = hottestHighlight
      ? mixRgb(baseRgb, MAX_PEAK, 0.95)
      : mixRgb(baseRgb, MAX_HIGHLIGHT, highlightAmount);
    ctx.globalAlpha = peakHighlight || hottestHighlight
      ? revealAlpha * c.intensity
      : revealAlpha * c.intensity * clamp(0.72 + c.base * 0.18 + flowingFlicker * 0.12, 0, 1);
    ctx.fillRect(c.x + gap * 0.5, c.y + gap * 0.5, cell - gap, cell - gap);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

export function EffortSignalIcon({ value, className }: { value: ReasoningEffort; className?: string }) {
  const activeBars = LEVEL_BARS[value];
  return (
    <svg
      width="13"
      height="12"
      viewBox="0 0 13 12"
      fill="none"
      className={cn('eg-signal', `eg-tier-${value}`, value === 'off' && 'is-off', className)}
      aria-hidden="true"
    >
      <rect x="1" y="7.5" width="2.4" height="3.5" rx="0.9" className={activeBars >= 1 ? 'bar-on' : 'bar-dim'} />
      <rect x="5.3" y="4.5" width="2.4" height="6.5" rx="0.9" className={activeBars >= 2 ? 'bar-on' : 'bar-dim'} />
      <rect x="9.6" y="1.5" width="2.4" height="9.5" rx="0.9" className={activeBars >= 3 ? 'bar-on' : 'bar-dim'} />
    </svg>
  );
}

export interface EffortGaugeProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  label?: string;
  disabled?: boolean;
  /** 是否显示紧凑帮助按钮与轴线（默认开启）。 */
  compact?: boolean;
}

export function EffortGauge({
  value, onChange, label = '思考强度', disabled = false, compact = false,
}: EffortGaugeProps) {
  const id = useId();
  const tipId = useId();
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<number>(0);

  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [hoverStop, setHoverStop] = useState<number | null>(null);
  const dragPointer = useRef<number | null>(null);
  const sampleRef = useRef<{ ratio: number; time: number; velocity: number }>({ ratio: 0, time: 0, velocity: 0 });

  const currentIndex = EFFORT_ORDER.indexOf(value);
  const activeRatio = dragRatio ?? currentIndex / LAST;
  const clampedRatio = clamp(activeRatio, 0, 1);
  const index = Math.round(clampedRatio * LAST);
  const displayValue = EFFORT_ORDER[index] ?? value;
  const prevIndexRef = useRef(index);
  const direction = index >= prevIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevIndexRef.current = index;
  }, [index]);

  progressRef.current = clampedRatio;

  const setIndex = useCallback((next: number) => {
    if (disabled) return;
    const clamped = clamp(next, 0, LAST);
    const effort = EFFORT_ORDER[clamped];
    if (effort && effort !== value) onChange(effort);
  }, [disabled, onChange, value]);

  // 鼠标光场：靠近玻璃轨道 72px 内照亮内光斑与外轮廓边缘高光
  const updateLightField = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track || reduce || disabled) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const lx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ly = clamp((clientY - rect.top) / rect.height, 0, 1);
    const dist = Math.max(
      clientY < rect.top ? rect.top - clientY : Math.max(0, clientY - rect.bottom),
      clientX < rect.left ? rect.left - clientX : Math.max(0, clientX - rect.right),
    );
    const strength = clamp(1 - dist / 72, 0, 1);
    root.style.setProperty('--eg-light-x', `${(lx * 100).toFixed(1)}%`);
    root.style.setProperty('--eg-light-y', `${(ly * 100).toFixed(1)}%`);
    root.style.setProperty('--eg-light-strength', strength.toFixed(3));
  }, [disabled, reduce]);

  const clearLightField = useCallback(() => {
    rootRef.current?.style.setProperty('--eg-light-strength', '0');
    setHoverStop(null);
  }, []);

  // Canvas 像素/水波纹场：仅在 medium（蓝紫稀疏水波纹）与 high（紫色流动像素场）激活
  const fieldMode = displayValue === 'high' ? 'max' : displayValue === 'medium' ? 'ripple' : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track || !fieldMode || reduce) return;
    let grid: ReturnType<typeof buildPixelGrid> | null = null;
    let cssWidth = 0;
    let cssHeight = 0;
    let pixelRatio = 1;
    const started = performance.now();

    const resize = () => {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pixelRatio = Math.min(window.devicePixelRatio, 2);
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.round(cssWidth * pixelRatio);
      canvas.height = Math.round(cssHeight * pixelRatio);
      grid = buildPixelGrid(cssWidth, cssHeight);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(track);
    let context: CanvasRenderingContext2D | null | undefined;
    let frame = 0;
    let lastDraw = 0;
    const loop = (now: number) => {
      if (grid && now - lastDraw >= 33) {
        if (context === undefined) context = canvas.getContext('2d');
        if (!context) return;
        lastDraw = now;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);
        const elapsed = Math.max(0, now - started);
        if (fieldMode === 'max') drawMaxPixelField(context, cssWidth, cssHeight, grid, elapsed);
        else drawRippleField(context, cssWidth, cssHeight, grid, progressRef.current, elapsed);
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      ro?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [fieldMode, reduce]);

  /** 将指针 clientX 映射为轨道归一化比例（含磁吸与边界橡皮筋阻尼）。 */
  const pointerToRatio = (clientX: number, withMagnet: boolean): { clamped: number; visual: number } => {
    const el = railRef.current;
    if (!el) return { clamped: index / LAST, visual: index / LAST };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return { clamped: index / LAST, visual: index / LAST };
    // 拇指中心行程扣去左右半宽，保证指针始终对齐方帽拇指中心
    const pad = 14;
    const usable = Math.max(1, rect.width - pad * 2);
    const raw = (clientX - (rect.left + pad)) / usable;
    const clamped = clamp(raw, 0, 1);
    if (reduce) return { clamped, visual: clamped };
    if (raw < 0) {
      return { clamped: 0, visual: Math.max(-MAX_OVERSHOOT, rubberBand(raw, 0.14, 0.45)) };
    }
    if (raw > 1) {
      return { clamped: 1, visual: 1 + Math.min(MAX_OVERSHOOT, rubberBand(raw - 1, 0.14, 0.45)) };
    }
    const visual = withMagnet ? applyMagnet(raw * LAST) / LAST : raw;
    return { clamped, visual };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || dragPointer.current !== null) return;
    const el = railRef.current;
    el?.setPointerCapture?.(e.pointerId);
    dragPointer.current = e.pointerId;
    const { clamped, visual } = pointerToRatio(e.clientX, true);
    sampleRef.current = { ratio: clamped, time: e.timeStamp, velocity: 0 };
    setDragRatio(visual);
    el?.focus();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current === null) {
      const { clamped } = pointerToRatio(e.clientX, false);
      setHoverStop(Math.round(clamped * LAST));
      return;
    }
    if (disabled || e.pointerId !== dragPointer.current) return;
    const { clamped, visual } = pointerToRatio(e.clientX, true);
    const now = e.timeStamp;
    const dt = (now - sampleRef.current.time) / 1000;
    if (dt > 0.004) {
      const instVel = (clamped - sampleRef.current.ratio) / dt;
      const smoothed = sampleRef.current.velocity * 0.45 + instVel * 0.55;
      sampleRef.current = { ratio: clamped, time: now, velocity: smoothed };
    }
    setDragRatio(visual);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (dragPointer.current !== e.pointerId) return;
    dragPointer.current = null;
    if (commit) {
      const { clamped } = pointerToRatio(e.clientX, false);
      const { time, velocity } = sampleRef.current;
      const momentum = !reduce && e.timeStamp - time < 100 && Math.abs(velocity) > 0.45
        ? projectMomentum(velocity, 0.055, 0.24) : 0;
      // The live preview follows the pointer. Save only the final snapped level.
      setIndex(Math.round(clamp(clamped + momentum, 0, 1) * LAST));
    }
    setDragRatio(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        setIndex(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'PageDown':
        e.preventDefault();
        setIndex(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        setIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setIndex(LAST);
        break;
      default:
    }
  };

  const isDragging = dragRatio !== null;
  const thumbSpring = isDragging ? { duration: 0 } : reducedTransition(reduce, SPRING_GESTURE);
  const textTransition = { duration: reduce ? 0 : DURATION.fast, ease: EASE_OUT };

  return (
    <div
      ref={rootRef}
      className={cn('eg', `eg-tier-${displayValue}`, disabled && 'eg-disabled', isDragging && 'eg-dragging')}
      data-level={displayValue}
      onPointerMove={(e) => updateLightField(e.clientX, e.clientY)}
      onPointerLeave={clearLightField}
      style={{
        '--eg-progress': activeRatio,
        '--eg-fill-x': `${(clampedRatio * 100).toFixed(1)}%`,
      } as CSSProperties}
    >
      <div className="eg-head">
        <div className="eg-title-group">
          <span id={id} className="eg-label">{label}</span>
          <span className="eg-level-stage" aria-live="polite" aria-atomic="true">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={displayValue}
                className={cn('eg-level-word', `eg-tier-${displayValue}`)}
                initial={reduce ? false : { opacity: 0, y: direction * 4, filter: 'blur(2px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -direction * 4, filter: 'blur(2px)' }}
                transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
              >
                {EFFORT_LABEL[displayValue]}
              </motion.span>
            </AnimatePresence>
          </span>
          <motion.span
            key={`tag-${displayValue}`}
            className={cn('eg-tier-tag', `eg-tier-${displayValue}`)}
            initial={reduce ? false : { opacity: 0.45, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={textTransition}
          >
            {TIER_TAG[displayValue]}
          </motion.span>
        </div>

        <div className="eg-head-right">
          <EffortSignalIcon value={displayValue} />
          {!compact && (
            <div className="eg-help-wrap" data-tip-open={tipOpen ? 'true' : undefined}>
              <button
                type="button"
                className="eg-help-btn"
                aria-label="关于推理强度"
                aria-describedby={tipId}
                aria-expanded={tipOpen}
                disabled={disabled}
                onClick={() => setTipOpen((v) => !v)}
                onBlur={() => setTipOpen(false)}
              >
                <HelpCircle size={14} aria-hidden />
              </button>
              <div id={tipId} role="tooltip" className="eg-tooltip">
                {HELP_TIP}
              </div>
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="eg-axis" aria-hidden="true">
          <span>更快</span>
          <span>更聪明</span>
        </div>
      )}

      <div className="eg-slider-box">
        <div
          ref={railRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={id}
          aria-valuemin={0}
          aria-valuemax={LAST}
          aria-valuenow={index}
          aria-valuetext={EFFORT_LABEL[displayValue]}
          aria-disabled={disabled}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endDrag(event, true)}
          onPointerCancel={(event) => endDrag(event, false)}
          onLostPointerCapture={(event) => endDrag(event, false)}
          className={cn('eg-rail-hit', isDragging && 'dragging')}
        >
          <div ref={trackRef} className="eg-track" aria-hidden="true">
            <motion.div
              className="eg-track-fill"
              initial={false}
              animate={{ width: `calc((100% - 28px) * ${clampedRatio} + 14px)` }}
              transition={thumbSpring}
            />
            <div className="eg-max-fallback" />
            <canvas ref={canvasRef} className="eg-pixel-field" />

            <div className="eg-ticks">
              {EFFORT_ORDER.map((stop, i) => {
                const frac = i / LAST;
                return (
                  <span
                    key={stop}
                    className={cn('eg-notch', i <= index && 'reached', i === index && 'current')}
                    style={{ '--tick-frac': frac } as CSSProperties}
                  />
                );
              })}
            </div>

            <div className="eg-track-light" />
            <div className="eg-thumb-light" />

            <motion.div
              className="eg-handle"
              initial={false}
              animate={{
                left: `calc((100% - var(--eg-thumb-w) - var(--eg-thumb-inset) * 2) * ${activeRatio} + var(--eg-thumb-inset))`,
              }}
              transition={thumbSpring}
            >
              <span className="eg-handle-grip" />
            </motion.div>
          </div>
          <div className="eg-track-outline" aria-hidden="true" />
        </div>

        <div className="eg-stops" role="group" aria-label={`${label}档位`}>
          {EFFORT_ORDER.map((stop, i) => {
            const active = i === index;
            const hovered = hoverStop === i && !active;
            const frac = i / LAST;
            return (
              <button
                key={stop}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => setIndex(i)}
                style={{ '--stop-frac': frac } as CSSProperties}
                className={cn('eg-stop', active && 'active', hovered && 'hovered')}
              >
                {EFFORT_LABEL[stop]}
              </button>
            );
          })}
        </div>
      </div>

      <motion.p
        key={`desc-${displayValue}`}
        className="eg-desc"
        aria-live="polite"
        initial={reduce ? false : { opacity: 0.45 }}
        animate={{ opacity: 1 }}
        transition={textTransition}
      >
        {DESCRIPTION[displayValue]}
      </motion.p>
    </div>
  );
}
