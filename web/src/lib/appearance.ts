/**
 * Axis-Evo 外观与模块化交互挂件状态管理：
 * - 界面主题包：`default`（Axis 原版暖曜/暖白 + 积云背景）与 `obsidian-prism`（黑曜棱镜四配色光学切面）
 * - 四个光学/交互挂件（桌面像素伙伴、物理浅水试管、推理切工水晶、输入舱棱镜边框）均支持在两套主题下自由组合开关
 * - 持久化至 localStorage（axis.appearance.v1）并带白名单校验，防止脏缓存引发异常
 */
import type {
  MotionTier, PrismAccent, PrismPalette, Settings, ThemeMode, UiStyle,
} from '@axis/protocol';
import { readSavedTheme, saveTheme } from './themePreference';

export type ResolvedTheme = 'dark' | 'light';
export type PrismDarkPalette = 'obsidian' | 'warm';
export type PrismLightPalette = 'crystal' | 'alabaster';

export interface AppearancePreference {
  uiStyle: UiStyle;
  themeMode: ThemeMode;
  prismDarkPalette: PrismDarkPalette;
  prismLightPalette: PrismLightPalette;
  prismAccent: PrismAccent;
  prismMascots: boolean;
  prismVial: boolean;
  prismCrystal: boolean;
  prismRim: boolean;
  motionTier: MotionTier;
}

export interface AppearanceSnapshot extends AppearancePreference {
  resolvedTheme: ResolvedTheme;
  activePrismPalette: PrismPalette;
}

export const APPEARANCE_STORAGE_KEY = 'axis.appearance.v1';

export const DEFAULT_APPEARANCE: AppearancePreference = {
  uiStyle: 'default',
  themeMode: 'dark',
  prismDarkPalette: 'obsidian',
  prismLightPalette: 'crystal',
  prismAccent: 'default',
  prismMascots: true,
  prismVial: false,
  prismCrystal: false,
  prismRim: false,
  motionTier: 'standard',
};

export interface PrismPaletteMeta {
  id: PrismPalette;
  mode: ResolvedTheme;
  label: string;
  desc: string;
  sidebar: string;
  canvas: string;
  surface: string;
  accent: string;
}

export const OBSIDIAN_PRISM_PALETTES: readonly PrismPaletteMeta[] = [
  {
    id: 'obsidian',
    mode: 'dark',
    label: '深空黑曜',
    desc: '冷调高对比代码配色',
    sidebar: '#09090B',
    canvas: '#0E0E11',
    surface: '#161922',
    accent: '#4285F4',
  },
  {
    id: 'warm',
    mode: 'dark',
    label: '暖炭玄岩',
    desc: '低蓝光夜间沉静配色',
    sidebar: '#10100F',
    canvas: '#141413',
    surface: '#1D1C1A',
    accent: '#D97757',
  },
  {
    id: 'crystal',
    mode: 'light',
    label: '白昼冷晶',
    desc: '冷调浅灰蓝明快工作区',
    sidebar: '#E8EEF6',
    canvas: '#F4F7FB',
    surface: '#FFFFFF',
    accent: '#2563EB',
  },
  {
    id: 'alabaster',
    mode: 'light',
    label: '暖白画册',
    desc: '暖白纸色柔和阅读对比',
    sidebar: '#EBE6DC',
    canvas: '#F6F4EE',
    surface: '#FFFDF8',
    accent: '#C25934',
  },
];

export interface PrismAccentMeta {
  id: PrismAccent;
  label: string;
  swatch: string;
}

export const OBSIDIAN_PRISM_ACCENTS: readonly PrismAccentMeta[] = [
  { id: 'default', label: '棱镜光谱', swatch: 'linear-gradient(135deg, #4285F4, #9B72CB, #EA4335, #FBBC04)' },
  { id: 'cobalt', label: '钴蓝', swatch: '#3186FF' },
  { id: 'iris', label: '鸢尾紫', swatch: '#8B5CF6' },
  { id: 'amber', label: '琥珀金', swatch: '#D97706' },
  { id: 'mono', label: '纯银钛', swatch: '#94A3B8' },
];

const UI_STYLES = new Set<UiStyle>(['default', 'obsidian-prism']);
const THEME_MODES = new Set<ThemeMode>(['dark', 'light', 'system']);
const DARK_PALETTES = new Set<PrismDarkPalette>(['obsidian', 'warm']);
const LIGHT_PALETTES = new Set<PrismLightPalette>(['crystal', 'alabaster']);
const ACCENTS = new Set<PrismAccent>(['default', 'cobalt', 'iris', 'amber', 'mono']);
const MOTION_TIERS = new Set<MotionTier>(['standard', 'focus']);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

export function resolveActivePrismPalette(
  pref: Pick<AppearancePreference, 'prismDarkPalette' | 'prismLightPalette'>,
  resolvedTheme: ResolvedTheme,
): PrismPalette {
  return resolvedTheme === 'light' ? pref.prismLightPalette : pref.prismDarkPalette;
}

export function sanitizeAppearance(raw: unknown): AppearancePreference {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APPEARANCE };
  const rec = raw as Record<string, unknown>;
  const uiStyle: UiStyle = typeof rec.uiStyle === 'string' && UI_STYLES.has(rec.uiStyle as UiStyle)
    ? (rec.uiStyle as UiStyle)
    : DEFAULT_APPEARANCE.uiStyle;
  const themeMode: ThemeMode = typeof rec.themeMode === 'string' && THEME_MODES.has(rec.themeMode as ThemeMode)
    ? (rec.themeMode as ThemeMode)
    : DEFAULT_APPEARANCE.themeMode;
  const prismDarkPalette: PrismDarkPalette =
    typeof rec.prismDarkPalette === 'string' && DARK_PALETTES.has(rec.prismDarkPalette as PrismDarkPalette)
      ? (rec.prismDarkPalette as PrismDarkPalette)
      : rec.prismPalette === 'obsidian' || rec.prismPalette === 'warm'
        ? rec.prismPalette
        : DEFAULT_APPEARANCE.prismDarkPalette;
  const prismLightPalette: PrismLightPalette =
    typeof rec.prismLightPalette === 'string' && LIGHT_PALETTES.has(rec.prismLightPalette as PrismLightPalette)
      ? (rec.prismLightPalette as PrismLightPalette)
      : rec.prismPalette === 'crystal' || rec.prismPalette === 'alabaster'
        ? rec.prismPalette
        : DEFAULT_APPEARANCE.prismLightPalette;
  const prismAccent: PrismAccent = typeof rec.prismAccent === 'string' && ACCENTS.has(rec.prismAccent as PrismAccent)
    ? (rec.prismAccent as PrismAccent)
    : DEFAULT_APPEARANCE.prismAccent;
  const prismMascots = typeof rec.prismMascots === 'boolean' ? rec.prismMascots : DEFAULT_APPEARANCE.prismMascots;
  const defaultOptical = uiStyle === 'obsidian-prism';
  const prismVial = typeof rec.prismVial === 'boolean' ? rec.prismVial : defaultOptical;
  const prismCrystal = typeof rec.prismCrystal === 'boolean' ? rec.prismCrystal : defaultOptical;
  const prismRim = typeof rec.prismRim === 'boolean' ? rec.prismRim : defaultOptical;
  const motionTier: MotionTier = typeof rec.motionTier === 'string' && MOTION_TIERS.has(rec.motionTier as MotionTier)
    ? (rec.motionTier as MotionTier)
    : DEFAULT_APPEARANCE.motionTier;

  return {
    uiStyle,
    themeMode,
    prismDarkPalette,
    prismLightPalette,
    prismAccent,
    prismMascots,
    prismVial,
    prismCrystal,
    prismRim,
    motionTier,
  };
}

export function readStoredAppearance(): AppearancePreference | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? sanitizeAppearance(parsed) : null;
  } catch {
    return null;
  }
}

export function writeStoredAppearance(pref: AppearancePreference): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* 浏览器禁用存储时静默降级，仅保持当前标签页状态 */
  }
}

export function applyAppearanceToDocument(snap: AppearanceSnapshot): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = snap.resolvedTheme;
  root.dataset.uiStyle = snap.uiStyle;
  root.dataset.prismPalette = snap.activePrismPalette;
  root.dataset.prismAccent = snap.prismAccent;
  root.dataset.motionTier = snap.motionTier;
}

function buildSnapshot(pref: AppearancePreference): AppearanceSnapshot {
  const resolvedTheme = resolveThemeMode(pref.themeMode);
  return {
    ...pref,
    resolvedTheme,
    activePrismPalette: resolveActivePrismPalette(pref, resolvedTheme),
  };
}

export function loadAppearancePreference(): AppearancePreference | null {
  const stored = readStoredAppearance();
  if (stored) return stored;
  const legacy = readSavedTheme();
  if (!legacy) return null;
  const migrated = { ...DEFAULT_APPEARANCE, themeMode: legacy };
  writeStoredAppearance(migrated);
  return migrated;
}

const initialPreference = loadAppearancePreference();
let locallySet = initialPreference !== null;
let currentPref: AppearancePreference = initialPreference ?? DEFAULT_APPEARANCE;
let currentSnapshot: AppearanceSnapshot = buildSnapshot(currentPref);
const listeners = new Set<() => void>();
let mediaBound = false;

function emit(): void {
  currentSnapshot = buildSnapshot(currentPref);
  applyAppearanceToDocument(currentSnapshot);
  saveTheme(currentSnapshot.resolvedTheme);
  for (const fn of listeners) fn();
}

function ensureSystemMediaListener(): void {
  if (mediaBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  mediaBound = true;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (currentPref.themeMode === 'system') emit();
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
}

export function getAppearanceSnapshot(): AppearanceSnapshot {
  return currentSnapshot;
}

export function subscribeAppearance(listener: () => void): () => void {
  ensureSystemMediaListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAppearancePreference(patch: Partial<AppearancePreference>): AppearanceSnapshot {
  locallySet = true;
  currentPref = sanitizeAppearance({ ...currentPref, ...patch });
  writeStoredAppearance(currentPref);
  emit();
  return currentSnapshot;
}

export function selectPrismPalette(palette: PrismPalette): AppearanceSnapshot {
  if (palette === 'obsidian' || palette === 'warm') {
    return setAppearancePreference({
      uiStyle: 'obsidian-prism',
      themeMode: 'dark',
      prismDarkPalette: palette,
    });
  }
  return setAppearancePreference({
    uiStyle: 'obsidian-prism',
    themeMode: 'light',
    prismLightPalette: palette,
  });
}

export function toggleResolvedTheme(): AppearanceSnapshot {
  const next: ResolvedTheme = currentSnapshot.resolvedTheme === 'dark' ? 'light' : 'dark';
  return setAppearancePreference({ themeMode: next });
}

export function resetAppearancePreference(): AppearanceSnapshot {
  return setAppearancePreference(DEFAULT_APPEARANCE);
}

/** 启动设置仅在本地没有外观选择时用于初始化。 */
export function hydrateAppearanceFromSettings(settings: Settings | null): AppearanceSnapshot {
  if (!settings || locallySet) return currentSnapshot;
  currentPref = sanitizeAppearance({
    ...settings,
    themeMode: settings.themeMode ?? settings.theme,
  });
  emit();
  return currentSnapshot;
}

/** 构造可向后端 `settings.set` 同步的增量 patch。 */
export function appearanceToSettingsPatch(snap: AppearanceSnapshot): Partial<Settings> {
  return {
    theme: snap.resolvedTheme,
    themeMode: snap.themeMode,
    uiStyle: snap.uiStyle,
    prismDarkPalette: snap.prismDarkPalette,
    prismLightPalette: snap.prismLightPalette,
    prismAccent: snap.prismAccent,
    prismMascots: snap.prismMascots,
    prismVial: snap.prismVial,
    prismCrystal: snap.prismCrystal,
    prismRim: snap.prismRim,
    motionTier: snap.motionTier,
  };
}
