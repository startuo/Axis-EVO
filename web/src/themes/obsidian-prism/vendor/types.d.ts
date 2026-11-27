export interface WaterVialExternalState {
  isDark: boolean;
  lightPreset?: 'crystal' | 'alabaster';
  palette?: 'obsidian' | 'warm';
  accentTone?: 'follow' | 'cobalt' | 'iris' | 'amber' | 'mono';
  camp?: 'gemini' | 'claude';
  critical?: boolean;
  fill: number;
  maxTokens?: number;
  hoveredSlice?: number;
  streaming?: boolean;
  ratios?: [number, number, number];
}

export interface WaterVialController {
  step(dtSeconds: number): boolean;
  isSettled(): boolean;
  setLevel(nextFill: number): void;
  agitate(strength?: number): void;
  impulse(strength?: number): void;
  tilt(angleOrImpulse?: number): void;
  setTheme(isDark: boolean): void;
  wake(): void;
  spawnDroplet(): void;
  dispose(): void;
}

export interface VialCoreModule {
  mountPhysicalWaterVial(
    canvas: HTMLCanvasElement,
    options?: {
      fill?: number;
      isDark?: boolean;
      streaming?: boolean;
      maxTokens?: number;
      reduceMotion?: boolean;
      getState?: () => WaterVialExternalState;
      onWake?: () => void;
    },
  ): WaterVialController;
}

export interface CrystalBarState {
  isDark: boolean;
  prismStrength?: number;
  accent?: string;
  ambientIntensity?: number;
  hideLock?: boolean;
  fillRatio?: number;
}

export interface CrystalBarController {
  step(dtSeconds: number): boolean;
  isIdle(): boolean;
  setReduceMotion(flag: boolean): void;
  invalidate(): void;
  setPointerClient(clientX: number, clientY: number): void;
  wake(): void;
  dispose(): void;
}

export interface CrystalPrismCoreModule {
  mountCrystalPrismBar(
    canvas: HTMLCanvasElement,
    options?: {
      getState?: () => CrystalBarState;
      reduceMotion?: boolean;
      force2D?: boolean;
    },
  ): CrystalBarController | null;
}

export interface DualMascotStageController {
  setState?(patch: Record<string, unknown>): void;
  onUserType?(text: string): void;
  setRimLight?(n: { active: boolean; localX: number; strength: number; toneKey: string; dark: boolean } | null): void;
  park?(on?: boolean): void;
  resume?(): void;
  dispose(): void;
}

export interface DualMascotRigModule {
  mountDualMascotStage(
    hostEl: HTMLElement,
    options?: Record<string, unknown>,
  ): DualMascotStageController | null;
}

declare global {
  interface Window {
    __agVialCore?: VialCoreModule;
    __agCrystalPrismCore?: CrystalPrismCoreModule;
    __agDualMascotRig?: DualMascotRigModule;
  }
}
