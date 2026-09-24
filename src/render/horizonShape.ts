// src/render/horizonShape.ts
// The drawn shape of the world border. Everywhere a car can reach, the drawn ground is exactly the
// collider; the steep face above its foot gets drawn-only lumps, and past the crest the drawn
// ground falls away, so the HDRI mountains show above it as over the drive prototype's open sand.
import { createNoise2D } from 'simplex-noise';
import * as W from '../world/worldDef';
import { mulberry32 } from '../world/rng';

/** Metres outside the playable rectangle where the drawn ground starts to fall away. */
const FALL_START = W.WORLD_BORDER * 0.7;
const FALL_LENGTH = 30;
/** Far enough below the basin that the edge of the streamed terrain never shows against the sky. */
const FAR_FLOOR = W.BASIN_LEVEL - 30;

// Lumps on the steep face and the crest, so the border reads as broken rock and its skyline is
// not a ruler-straight line. They start above the foot, where a car can no longer touch the face.
const ROUGH_FROM = 1.5;
const ROUGH_FULL = 5;
const ROUGH_AMPLITUDE = 2.2;
const CREST_AMPLITUDE = 4;
const roughNoise = createNoise2D(mulberry32(0x6b0d3e));

function borderRoughness(x: number, z: number, outside: number): number {
  const lumps = roughNoise(x * 0.09, z * 0.09) * 0.65 + roughNoise(x * 0.23 + 17, z * 0.23 - 5) * 0.35;
  const crest = Math.max(0, roughNoise(x * 0.025 - 40, z * 0.025 + 11)) * CREST_AMPLITUDE * W.smoothstep(6, 14, outside);
  return W.smoothstep(ROUGH_FROM, ROUGH_FULL, outside) * lumps * ROUGH_AMPLITUDE + crest;
}

/** The drawn height for a ground point whose collider height is `height`. */
export function visualTerrainHeight(height: number, x: number, z: number): number {
  const outside = W.borderDepth(x, z);
  if (outside <= ROUGH_FROM) return height;
  const rough = height + borderRoughness(x, z, outside);
  return W.lerp(rough, FAR_FLOOR, W.smoothstep(FALL_START, FALL_START + FALL_LENGTH, outside));
}
