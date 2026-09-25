// src/world/borderSafety.ts
// The safety net behind the border ranges (design §2): a car that got well up a face and over its
// crest, or out of the map, is put back in the valley, standing, facing inward. Pure and shared, so
// the client runs it on its own car and the server on its copy with the same answer.
import { MAP_SIZE } from './mapLayout';
import { borderDistance, borderFaceDepth, crestFor } from './terrain/border';
import type { Height2D } from './noise';
import type { SpawnPose } from './worldDef';

/** A car must be this far past the inner foot of the face before the net can catch it. */
export const ESCAPE_FACE_DEPTH = 40;

// Open, level plain about 300 m inside each side, clear of the landforms and the NW gorge.
const SAFE_SPOTS: readonly { x: number; z: number }[] = [
  { x: 600, z: 300 }, { x: 1500, z: 300 }, { x: 2100, z: 300 },
  { x: 600, z: 2772 }, { x: 1500, z: 2772 }, { x: 2400, z: 2772 },
  { x: 300, z: 1100 }, { x: 300, z: 1700 }, { x: 300, z: 2400 },
  { x: 2772, z: 600 }, { x: 2772, z: 2450 },
];

const CENTRE = MAP_SIZE / 2;

/** The reset targets until roads exist (plan v3 step S2 switches to the nearest road point). */
export const SAFE_POINTS: readonly SpawnPose[] = SAFE_SPOTS.map((spot) => ({
  x: spot.x,
  z: spot.z,
  yaw: Math.atan2(CENTRE - spot.x, CENTRE - spot.z),
}));

function nearestSafePoint(x: number, z: number): SpawnPose {
  let best = SAFE_POINTS[0];
  let bestDistance = Infinity;
  for (const point of SAFE_POINTS) {
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where to put a car whose body is at (x, y, z), or null when it may stay. The crest counts as the
 * higher of the ground there and the uncut range, so a car down in the NW gorge is never reset.
 */
export function borderEscapeTarget(x: number, y: number, z: number, height: Height2D): SpawnPose | null {
  if (![x, y, z].every(Number.isFinite)) throw new Error(`borderEscapeTarget: position is not finite: ${x}, ${y}, ${z}`);
  if (borderDistance(x, z) < 0) return nearestSafePoint(x, z);
  if (borderFaceDepth(x, z) <= ESCAPE_FACE_DEPTH) return null;
  const crest = crestFor(x, z);
  if (!crest) throw new Error(`borderEscapeTarget: (${x}, ${z}) is past a face foot but has no crest`);
  const crestHeight = Math.max(crest.height, height(crest.x, crest.z));
  return y > crestHeight ? nearestSafePoint(x, z) : null;
}
