/**
 * 按需异步加载上游 Obsidian Prism UMD 核心引擎（GPL-3.0, RMvdesi）。
 * 仅在启用对应挂件后加载引擎。
 */
import type { CrystalPrismCoreModule, DualMascotRigModule, VialCoreModule } from './types';

function unwrapUmd<T>(mod: unknown, globalKey: '__agVialCore' | '__agCrystalPrismCore' | '__agDualMascotRig'): T | null {
  const rec = mod as { default?: unknown } | null;
  const candidate = (rec && rec.default ? rec.default : mod) as T | undefined;
  if (candidate && typeof candidate === 'object' && Object.keys(candidate as object).length > 0) {
    return candidate;
  }
  if (typeof window !== 'undefined' && window[globalKey]) {
    return window[globalKey] as unknown as T;
  }
  return null;
}

export async function loadVialCore(): Promise<VialCoreModule | null> {
  // @ts-expect-error Vendored UMD JavaScript module
  const mod = await import('./vial-core.js');
  return unwrapUmd<VialCoreModule>(mod, '__agVialCore');
}

export async function loadCrystalPrismCore(): Promise<CrystalPrismCoreModule | null> {
  // @ts-expect-error Vendored UMD JavaScript module
  const mod = await import('./crystal-prism-core.js');
  return unwrapUmd<CrystalPrismCoreModule>(mod, '__agCrystalPrismCore');
}

export async function loadDualMascotRig(): Promise<DualMascotRigModule | null> {
  // @ts-expect-error Vendored UMD JavaScript module
  const mod = await import('./dual-mascot-rig.js');
  return unwrapUmd<DualMascotRigModule>(mod, '__agDualMascotRig');
}
