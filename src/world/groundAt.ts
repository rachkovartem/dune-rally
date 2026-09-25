// src/world/groundAt.ts
import { groundGripFor, type GripOverrides, type GroundGrip } from '../../shared/terrainGrip';
import type { Biome, Cover } from './biome';
import type { Height2D } from './noise';
import { surfaceSampleAt } from './surfaceSample';

/** The cover at a point and what it gives one car's tyres there. */
export interface GroundAtPoint {
  cover: Cover;
  ground: GroundGrip;
}

// The client and the server both read the ground under a car through this one function, so the
// two copies of a car always drive on the same grip.
export function groundAt(
  biome: Pick<Biome, 'coverAt'>,
  heightField: Height2D,
  x: number,
  z: number,
  config: GripOverrides,
): GroundAtPoint {
  const surface = surfaceSampleAt(heightField, x, z);
  const cover = biome.coverAt(x, z, surface.height, surface.slope);
  return { cover, ground: groundGripFor(cover, config) };
}
