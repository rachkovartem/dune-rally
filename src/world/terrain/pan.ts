// src/world/terrain/pan.ts
// The Soutpan: a dead-flat salt floor inside its ellipse, blended into the plain over the last
// metres of the ellipse and a wider band outside it, and the lowest ground of the valley.
import { lerp, smoothstep } from '../blend';
import { SOUTPAN, SOUTPAN_BLEND, SOUTPAN_FLOOR, SOUTPAN_OUTER_BLEND } from '../mapLayout';
import { microRelief, plainHeight } from './basePlain';

/**
 * Metres inside the pan's ellipse (negative outside). A first-order distance: exact on the
 * ellipse, close to the true distance within a few hundred metres of it.
 */
export function panInsideDistance(x: number, z: number): number {
  const dx = (x - SOUTPAN.x) / SOUTPAN.radiusX;
  const dz = (z - SOUTPAN.z) / SOUTPAN.radiusZ;
  const reach = Math.hypot(dx, dz);
  if (reach < 1e-9) return Math.min(SOUTPAN.radiusX, SOUTPAN.radiusZ);
  const gradient = Math.hypot(dx / SOUTPAN.radiusX, dz / SOUTPAN.radiusZ) / reach;
  return (1 - reach) / gradient;
}

const LEVEL_SAMPLE_STEP = 10;
const LEVEL_MARGIN = 0.3;

// Below the lowest natural ground inside the ellipse, so the pan is only ever cut, never filled.
function lowestNaturalInPan(): number {
  let lowest = Infinity;
  for (let x = SOUTPAN.x - SOUTPAN.radiusX; x <= SOUTPAN.x + SOUTPAN.radiusX; x += LEVEL_SAMPLE_STEP) {
    for (let z = SOUTPAN.z - SOUTPAN.radiusZ; z <= SOUTPAN.z + SOUTPAN.radiusZ; z += LEVEL_SAMPLE_STEP) {
      if (panInsideDistance(x, z) < 0) continue;
      lowest = Math.min(lowest, plainHeight(x, z) + microRelief(x, z));
    }
  }
  return lowest;
}

/** Height of the salt floor. */
export const PAN_LEVEL = lowestNaturalInPan() - LEVEL_MARGIN;

/** 1 on the flat salt, falling to 0 at the ellipse. */
export function panWeight(x: number, z: number): number {
  return smoothstep(0, SOUTPAN_BLEND, panInsideDistance(x, z));
}

/** Metres outside the ellipse over which the floor reaches its base height above the pan. */
const FLOOR_EASE = 50;
/** Over the last metres of its reach the floor sinks this far, so it ends without a crease. */
const FLOOR_FADE = { length: 100, drop: 5 };
const FLOOR_SMOOTHING = 0.5;

// Polynomial smooth maximum, so the floor meets the ground without a crease.
function smoothMax(first: number, second: number, width: number): number {
  if (width <= 0) return Math.max(first, second);
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.max(first, second) + (share * share * width) / 4;
}

/** Flattens the pan into a height, and keeps the ground around it above the pan. */
export function applyPan(height: number, x: number, z: number): number {
  const inside = panInsideDistance(x, z);
  const lowered = inside > -SOUTPAN_OUTER_BLEND ? lerp(height, PAN_LEVEL, smoothstep(-SOUTPAN_OUTER_BLEND, SOUTPAN_BLEND, inside)) : height;
  const outside = -inside;
  if (outside <= 0 || outside >= SOUTPAN_FLOOR.reach) return lowered;
  // The floor and its smoothing both start from nothing on the ellipse, so the pan meets it with no step.
  const ease = smoothstep(0, FLOOR_EASE, outside);
  const floor = PAN_LEVEL + SOUTPAN_FLOOR.base * ease
    - FLOOR_FADE.drop * smoothstep(SOUTPAN_FLOOR.reach - FLOOR_FADE.length, SOUTPAN_FLOOR.reach, outside);
  return smoothMax(lowered, floor, FLOOR_SMOOTHING * ease);
}
