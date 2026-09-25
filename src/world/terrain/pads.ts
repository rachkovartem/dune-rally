// src/world/terrain/pads.ts
// Level flats (spawn top, dorp yard, overlook, pan start line). A pad stands on the higher part
// of the ground under it (max of the mean and the 80th percentile, plus its rise), so a car on a
// pad is never in a pit, and blends back into the ground around it.
import { lerp, smoothstep } from '../blend';
import { PAD_PERCENTILE, PADS, type PadDef, type PadShape } from '../mapLayout';
import type { Bounds } from '../featureIndex';
import { baseGroundHeight } from './baseGround';

export interface Pad {
  def: PadDef;
  level: number;
  /** The pad and its blend. */
  bounds: Bounds;
}

/** Metres outside the pad's own shape; 0 on the pad. */
export function distanceOutsidePad(shape: PadShape, x: number, z: number): number {
  if (shape.kind === 'circle') return Math.max(0, Math.hypot(x - shape.x, z - shape.z) - shape.radius);
  const dx = Math.max(0, Math.abs(x - shape.x) - shape.width / 2);
  const dz = Math.max(0, Math.abs(z - shape.z) - shape.depth / 2);
  return Math.hypot(dx, dz);
}

function shapeBounds(shape: PadShape, margin: number): Bounds {
  const halfX = shape.kind === 'circle' ? shape.radius : shape.width / 2;
  const halfZ = shape.kind === 'circle' ? shape.radius : shape.depth / 2;
  return { minX: shape.x - halfX - margin, minZ: shape.z - halfZ - margin, maxX: shape.x + halfX + margin, maxZ: shape.z + halfZ + margin };
}

const LEVEL_SAMPLE_STEP = 2;

function padLevel(def: PadDef): number {
  const bounds = shapeBounds(def.shape, 0);
  const samples: number[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += LEVEL_SAMPLE_STEP) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += LEVEL_SAMPLE_STEP) {
      if (distanceOutsidePad(def.shape, x, z) > 0) continue;
      samples.push(baseGroundHeight(x, z));
    }
  }
  if (samples.length === 0) throw new Error(`pads: "${def.name}" covers no ground sample`);
  samples.sort((first, second) => first - second);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const percentile = samples[Math.min(samples.length - 1, Math.floor(PAD_PERCENTILE * samples.length))];
  return Math.max(mean, percentile) + def.rise;
}

export const BUILT_PADS: readonly Pad[] = PADS.map((def) => ({ def, level: padLevel(def), bounds: shapeBounds(def.shape, def.blend) }));

const inside = (bounds: Bounds, x: number, z: number): boolean =>
  x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

/** 1 on the pad, falling to 0 at the end of its blend. */
export function padWeight(pad: Pad, x: number, z: number): number {
  if (!inside(pad.bounds, x, z)) return 0;
  return 1 - smoothstep(0, pad.def.blend, distanceOutsidePad(pad.def.shape, x, z));
}

/** The largest weight any pad has at (x, z): 1 on a pad, 0 away from every pad. */
export function padWeightAt(x: number, z: number): number {
  let weight = 0;
  for (const pad of BUILT_PADS) weight = Math.max(weight, padWeight(pad, x, z));
  return weight;
}

/** Levels every pad near (x, z) into a height. */
export function applyPads(height: number, x: number, z: number): number {
  let result = height;
  for (const pad of BUILT_PADS) {
    const weight = padWeight(pad, x, z);
    if (weight > 0) result = lerp(result, pad.level, weight);
  }
  return result;
}

/** The pad whose flat top (x, z) is on, or null. */
export function padAt(x: number, z: number): Pad | null {
  for (const pad of BUILT_PADS) {
    if (inside(pad.bounds, x, z) && distanceOutsidePad(pad.def.shape, x, z) === 0) return pad;
  }
  return null;
}
