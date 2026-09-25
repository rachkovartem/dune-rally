// src/world/borderSafety.ts
// The safety net behind the border ranges (design §2): a car that got well up a face and over its
// crest, or out of the map, is put back on the nearest road, standing, facing into the valley.
// Pure and shared, so the client runs it on its own car and the server on its copy.
import { MAP_SIZE } from './mapLayout';
import { borderDistance, borderFaceDepth, crestFor } from './terrain/border';
import type { Height2D } from './noise';
import { nearestRoad, type SpawnPose } from './worldDef';

/** A car must be this far past the inner foot of the face before the net can catch it. */
export const ESCAPE_FACE_DEPTH = 40;

const CENTRE = MAP_SIZE / 2;

/** The nearest point on a road's centre line, facing along the road the way that leads into the valley. */
export function nearestRoadPose(x: number, z: number): SpawnPose {
  const road = nearestRoad(x, z);
  if (!road) throw new Error(`borderSafety: no road to put a car from (${x}, ${z}) on`);
  const intoValley = road.tangentX * (CENTRE - road.x) + road.tangentZ * (CENTRE - road.z) >= 0 ? 1 : -1;
  return { x: road.x, z: road.z, yaw: Math.atan2(road.tangentX * intoValley, road.tangentZ * intoValley) };
}

/**
 * Where to put a car whose body is at (x, y, z), or null when it may stay. The crest counts as the
 * higher of the ground there and the uncut range, so a car down in the NW gorge is never reset.
 */
export function borderEscapeTarget(x: number, y: number, z: number, height: Height2D): SpawnPose | null {
  if (![x, y, z].every(Number.isFinite)) throw new Error(`borderEscapeTarget: position is not finite: ${x}, ${y}, ${z}`);
  if (borderDistance(x, z) < 0) return nearestRoadPose(x, z);
  if (borderFaceDepth(x, z) <= ESCAPE_FACE_DEPTH) return null;
  const crest = crestFor(x, z);
  if (!crest) throw new Error(`borderEscapeTarget: (${x}, ${z}) is past a face foot but has no crest`);
  const crestHeight = Math.max(crest.height, height(crest.x, crest.z));
  return y > crestHeight ? nearestRoadPose(x, z) : null;
}
