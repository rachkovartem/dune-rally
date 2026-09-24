// src/render/quality.ts
import type { BackendKind } from './backend';

export type AntialiasMode = 'traa' | 'fxaa';

export interface QualityTier {
  pixelRatio: number;
  antialias: AntialiasMode;
  aoResolutionScale: number;
  csmCascades: number;
  shadowMapSize: number;
  bloom: boolean;
}

const WEBGPU_PIXEL_RATIO_CAP = 1.5;

/**
 * Picks render settings for the backend three.js actually landed on. WebGL2 is the slower
 * fallback tier: fixed pixel ratio, fewer shadow cascades, cheaper AA — see the plan's
 * Performance Budget for the per-item cost this is meant to stay under.
 */
export function selectQuality(backendKind: BackendKind, devicePixelRatio: number): QualityTier {
  if (backendKind === 'webgpu') {
    return {
      pixelRatio: Math.min(devicePixelRatio, WEBGPU_PIXEL_RATIO_CAP),
      antialias: 'traa',
      aoResolutionScale: 0.5,
      csmCascades: 3,
      shadowMapSize: 2048,
      bloom: true,
    };
  }
  return {
    pixelRatio: 1.0,
    antialias: 'fxaa',
    aoResolutionScale: 0.5,
    csmCascades: 2,
    shadowMapSize: 1024,
    bloom: true,
  };
}
