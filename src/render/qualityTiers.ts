// src/render/qualityTiers.ts
// The drive prototype's two quality tiers, value for value. "medium" is the prototype's v2 look;
// "high" spends the headroom of a real laptop GPU and is the default.

export type QualityName = 'high' | 'medium';

export interface QualityTier {
  pixelRatio: number;
  shadowMapSize: number;
  /** Half the side of the square sun-shadow box around the player, in metres. */
  shadowHalfExtent: number;
  fogDensity: number;
  cameraFar: number;
  ambientOcclusion: boolean;
  /** Grass is drawn inside this distance from the camera and fades out toward it. */
  grassRadius: number;
  /** Share of each grass block's tufts that is drawn, 0..1. */
  grassDensity: number;
  /** Inside this distance a grass block uses the detailed clump; 0 = always the detailed clump. */
  grassDetailDistance: number;
  /** Extra non-solid props (bushes, stones) that only this tier draws. */
  extraProps: boolean;
}

const PROTOTYPE_PIXEL_RATIO_CAP = 2;

export const QUALITY_TIERS: Record<QualityName, QualityTier> = {
  high: {
    pixelRatio: Math.min(window.devicePixelRatio, PROTOTYPE_PIXEL_RATIO_CAP),
    shadowMapSize: 4096,
    shadowHalfExtent: 90,
    fogDensity: 0.0005,
    cameraFar: 6000,
    ambientOcclusion: true,
    grassRadius: 180,
    grassDensity: 1,
    grassDetailDistance: 35,
    extraProps: true,
  },
  medium: {
    pixelRatio: 1,
    shadowMapSize: 2048,
    shadowHalfExtent: 50,
    fogDensity: 0.0008,
    cameraFar: 3000,
    ambientOcclusion: false,
    grassRadius: 120,
    // The prototype's medium drew 11 000 tufts in 120 m against high's 30 000 in 180 m: the same
    // tufts per square metre as 11000 / (pi * 120^2) against 30000 / (pi * 180^2).
    grassDensity: (11000 / (120 * 120)) / (30000 / (180 * 180)),
    grassDetailDistance: 0,
    extraProps: false,
  },
};

export const DEFAULT_QUALITY: QualityName = 'high';

export function otherQuality(name: QualityName): QualityName {
  return name === 'high' ? 'medium' : 'high';
}
