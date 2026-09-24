// shared/terrainGrip.ts
import type { Cover } from '../src/world/biome';

/** How well a tyre holds on each ground cover, 1 = paved road (the best surface). */
export const BASE_GRIP_BY_COVER: Record<Cover, number> = {
  road: 1.0,
  gravel: 0.9,
  rock: 0.85,
  dirt: 0.8,
  dryGrass: 0.75,
  grass: 0.75,
  forest: 0.75,
  beach: 0.7,
  sand: 0.6,
  snow: 0.6,
  mud: 0.5,
  water: 0.5,
};

/** Rolling resistance coefficient on a paved road. */
export const ROAD_ROLLING_RESISTANCE = 0.015;
// Soft ground both grips less and swallows more energy, so one grip value sets both; a car with
// a sand override (bigger tyres, more clearance) then also rolls easier there. Grip 0.6 → 0.079.
const ROLLING_RESISTANCE_PER_LOST_GRIP = 0.16;

export interface GripOverrides {
  gripOverrides: Partial<Record<Cover, number>>;
}

/** Grip of a car on a cover: the car's own override when it has one, else the base value. */
export function terrainGripFor(cover: Cover, config: GripOverrides): number {
  return config.gripOverrides[cover] ?? BASE_GRIP_BY_COVER[cover];
}

/** Rolling resistance coefficient for a terrain grip value in (0, 1]. */
export function rollingResistanceFor(grip: number): number {
  return ROAD_ROLLING_RESISTANCE + (1 - Math.min(1, grip)) * ROLLING_RESISTANCE_PER_LOST_GRIP;
}
