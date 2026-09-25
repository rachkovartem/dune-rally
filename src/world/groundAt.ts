// src/world/groundAt.ts
import { groundFor, type GripOverrides, type SurfaceGround } from '../../shared/terrainGrip';
import type { Biome, Cover } from './biome';
import { groundSoftnessAt } from './groundSoftness';
import type { Height2D } from './noise';
import { surfaceSampleAt } from './surfaceSample';

/** The cover at a point, how soft the ground is there, and what it gives one car's tyres. */
export interface GroundAtPoint {
  cover: Cover;
  softness: number;
  ground: SurfaceGround;
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
  const softness = groundSoftnessAt(x, z, cover);
  return { cover, softness, ground: groundFor(cover, softness, config) };
}
