// src/world/jumps.ts
// The authored jumps of Klipfontein and the two formulas behind their numbers at real gravity
// (plan v3 S2-1): where a convex crest lifts the wheels, and how far a car flies off a lip.
import type { Point2 } from './polyline';
import { DIE_SPRONG, EERSTE_BULT, NURSERY_WHOOPS, SANDRIVIER, WIT_DUINE, type JumpId } from './mapLayout';
import { whoopsCrestRadius } from './terrain/crests';

/** Speed (m/s) at which a car on a convex crest of `radius` metres goes light: v = √(g·R). */
export function crestLiftSpeed(radius: number, gravity: number): number {
  if (!(radius >= 0) || !(gravity > 0)) throw new Error(`crestLiftSpeed: bad radius ${radius} or gravity ${gravity}`);
  return Math.sqrt(gravity * radius);
}

/**
 * Horizontal distance (m) a body flies when it leaves a lip at `speed` m/s, `angle` radians above
 * flat, and lands `launchHeight` metres below the lip. A lip below the landing gives 0 when the
 * body never gets that high.
 */
export function ballisticRange(speed: number, angle: number, launchHeight: number, gravity: number): number {
  if (!(speed >= 0) || !(gravity > 0) || !Number.isFinite(angle) || !Number.isFinite(launchHeight)) {
    throw new Error(`ballisticRange: bad input speed ${speed}, angle ${angle}, height ${launchHeight}, gravity ${gravity}`);
  }
  const along = speed * Math.cos(angle);
  const up = speed * Math.sin(angle);
  const discriminant = up * up + 2 * gravity * launchHeight;
  if (discriminant < 0) return 0;
  const flightTime = (up + Math.sqrt(discriminant)) / gravity;
  return Math.max(0, along * flightTime);
}

export type JumpKind = 'roadCrest' | 'driftEdge' | 'whoops' | 'duneBrink' | 'gapJump';

export interface JumpDef {
  id: JumpId;
  kind: JumpKind;
  position: Point2;
  /** Radius of the convex crest a car goes over, metres; null where the jump is a lip, not a crest. */
  radius: number | null;
  /** Straight, clear ground past the jump, metres. */
  landingLength: number;
}

// The drift banks are rounded to this radius at their edge (design §9 J2).
const DRIFT_EDGE_RADIUS = 30;
const DRIFT_LANDING = 30;
const WHOOPS_LANDING = 60;
const BRINK_LANDING = 40;

/** The jumps built so far (J3, J7 and J8 come with the dam, the quarry and the poort). */
export const JUMPS: readonly JumpDef[] = [
  { id: 'J1', kind: 'roadCrest', position: { x: EERSTE_BULT.x, z: EERSTE_BULT.z }, radius: EERSTE_BULT.radius, landingLength: EERSTE_BULT.landingLength },
  ...SANDRIVIER.drifts.map((drift): JumpDef => ({ id: 'J2', kind: 'driftEdge', position: drift, radius: DRIFT_EDGE_RADIUS, landingLength: DRIFT_LANDING })),
  {
    id: 'J4',
    kind: 'whoops',
    position: { x: (NURSERY_WHOOPS.lane.minX + NURSERY_WHOOPS.lane.maxX) / 2, z: (NURSERY_WHOOPS.lane.minZ + NURSERY_WHOOPS.lane.maxZ) / 2 },
    radius: whoopsCrestRadius(),
    landingLength: WHOOPS_LANDING,
  },
  { id: 'J5', kind: 'duneBrink', position: { x: WIT_DUINE.bigDaddy.x, z: WIT_DUINE.bigDaddy.z }, radius: WIT_DUINE.brinkRadius, landingLength: BRINK_LANDING },
  { id: 'J6', kind: 'gapJump', position: { x: DIE_SPRONG.x, z: DIE_SPRONG.z }, radius: null, landingLength: DIE_SPRONG.landingLength },
];
