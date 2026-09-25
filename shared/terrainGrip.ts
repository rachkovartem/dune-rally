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
  salt: 0.9,
};

/** Rolling resistance coefficient on a paved road. */
export const ROAD_ROLLING_RESISTANCE = 0.015;
// Soft ground both grips less and swallows more energy, so one grip value sets both; a car with
// a sand override (bigger tyres, more clearance) then also rolls easier there. Grip 0.6 → 0.079.
const ROLLING_RESISTANCE_PER_LOST_GRIP = 0.16;

export interface GripOverrides {
  gripOverrides: Partial<Record<Cover, number>>;
}

/**
 * What the ground under a car gives its tyres. `grip` and `rollingResistance` set the drive, the
 * brakes and the resistance; the other three shape the side grip, the wheelspin and the sinkage.
 */
export interface SurfaceGround {
  grip: number;
  rollingResistance: number;
  /** Share of `grip` the tyre has sideways: loose stones roll away under a sliding tyre. */
  lateralFactor: number;
  /** 0 firm (road) .. 1 loose (sand): the side grip peaks earlier and the tail steps out. */
  looseness: number;
  /** 0 firm .. 1 deep dune sand: how fast a spinning wheel digs itself in. */
  softness: number;
}

/** @deprecated The old name of SurfaceGround; kept so callers can move one at a time. */
export type GroundGrip = SurfaceGround;

/** Rolling resistance coefficient for a terrain grip value in (0, 1]. */
export function rollingResistanceFor(grip: number): number {
  return ROAD_ROLLING_RESISTANCE + (1 - Math.min(1, grip)) * ROLLING_RESISTANCE_PER_LOST_GRIP;
}

// A hard salt crust rolls like a road while it grips like gravel, so both cars are fastest on it.
const HARD_COVERS: ReadonlySet<Cover> = new Set<Cover>(['salt']);

/** How each cover behaves sideways; it depends on the cover only, not on the car or the place. */
export const SURFACE_BY_COVER: Readonly<Record<Cover, { looseness: number; lateralFactor: number }>> = {
  road: { looseness: 0, lateralFactor: 1 },
  salt: { looseness: 0.15, lateralFactor: 1 },
  rock: { looseness: 0.1, lateralFactor: 1 },
  gravel: { looseness: 0.6, lateralFactor: 0.75 },
  dirt: { looseness: 0.5, lateralFactor: 0.8 },
  dryGrass: { looseness: 0.45, lateralFactor: 0.85 },
  grass: { looseness: 0.45, lateralFactor: 0.85 },
  forest: { looseness: 0.45, lateralFactor: 0.85 },
  sand: { looseness: 1, lateralFactor: 1 },
  mud: { looseness: 0.8, lateralFactor: 0.9 },
  beach: { looseness: 0.8, lateralFactor: 1 },
  snow: { looseness: 0.8, lateralFactor: 1 },
  water: { looseness: 0.8, lateralFactor: 1 },
};

// Owner decision (2026-09-25): the open plain is firmer than the dunes, so a road car still moves
// there and getting stuck belongs to the dunes and the river bed.
export const FIRM_SAND = { maxSoftness: 0.2, gripFactor: 1.25 } as const;

function surfaceWith(cover: Cover, grip: number, softness: number): SurfaceGround {
  const { looseness, lateralFactor } = SURFACE_BY_COVER[cover];
  return {
    grip,
    rollingResistance: HARD_COVERS.has(cover) ? ROAD_ROLLING_RESISTANCE : rollingResistanceFor(grip),
    lateralFactor,
    looseness,
    softness,
  };
}

/**
 * The cover on its own, with no sinkage: the car's own grip override when it has one, else the
 * base grip. For the bench and every caller that does not know the place.
 */
export function groundGripFor(cover: Cover, config: GripOverrides): SurfaceGround {
  return surfaceWith(cover, config.gripOverrides[cover] ?? BASE_GRIP_BY_COVER[cover], 0);
}

/** The ground at a place: the cover with the softness of that place (0..1). */
export function groundFor(cover: Cover, softness: number, config: GripOverrides): SurfaceGround {
  if (!(softness >= 0 && softness <= 1)) throw new Error(`groundFor: softness ${softness} is outside 0..1`);
  const coverGrip = config.gripOverrides[cover] ?? BASE_GRIP_BY_COVER[cover];
  const firmSand = cover === 'sand' && softness <= FIRM_SAND.maxSoftness;
  return surfaceWith(cover, firmSand ? Math.min(1, coverGrip * FIRM_SAND.gripFactor) : coverGrip, softness);
}

/** Full grip on a paved road: the ground of the flat test bench. */
export const FULL_GRIP: SurfaceGround = {
  grip: 1,
  rollingResistance: ROAD_ROLLING_RESISTANCE,
  lateralFactor: 1,
  looseness: 0,
  softness: 0,
};
