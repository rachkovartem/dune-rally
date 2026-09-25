// src/world/terrain/crests.ts
// Shapes of the authored crests, as pure profiles: J1 in the spine's graded line and the J4
// whoops. Their sizes live in mapLayout; the layers that place them import these profiles.
import { EERSTE_BULT, NURSERY_WHOOPS } from '../mapLayout';

export interface CrestShape {
  height: number;
  /** Radius of the circular arc over the top (and of the hollow at each foot). */
  radius: number;
  /** Steepest grade of the straight ramps between the top arc and the feet. */
  maxGrade: number;
}

/** Half the length of a crest from its top to where it meets the flat, metres. */
export function crestHalfLength(shape: CrestShape): number {
  const angle = Math.atan(shape.maxGrade);
  const arcRun = shape.radius * Math.sin(angle);
  const arcRise = shape.radius * (1 - Math.cos(angle));
  const rampRise = shape.height - 2 * arcRise;
  if (rampRise < 0) throw new Error(`crestHalfLength: a ${shape.height} m crest is too low for radius ${shape.radius} and grade ${shape.maxGrade}`);
  return 2 * arcRun + rampRise / shape.maxGrade;
}

/**
 * Height a crest adds `offset` metres from its top: a circular top arc, straight ramps at
 * `maxGrade`, and a hollow of the same radius at each foot, so the line has no kink anywhere.
 */
export function crestProfile(shape: CrestShape, offset: number): number {
  const angle = Math.atan(shape.maxGrade);
  const arcRun = shape.radius * Math.sin(angle);
  const arcRise = shape.radius * (1 - Math.cos(angle));
  const halfLength = crestHalfLength(shape);
  const distance = Math.abs(offset);
  if (distance >= halfLength) return 0;
  if (distance <= arcRun) return shape.height - (shape.radius - Math.sqrt(shape.radius * shape.radius - distance * distance));
  const rampEnd = halfLength - arcRun;
  if (distance <= rampEnd) return shape.height - arcRise - shape.maxGrade * (distance - arcRun);
  const fromFoot = halfLength - distance;
  return shape.radius - Math.sqrt(shape.radius * shape.radius - fromFoot * fromFoot);
}

export const EERSTE_BULT_SHAPE: CrestShape = { height: EERSTE_BULT.height, radius: EERSTE_BULT.radius, maxGrade: EERSTE_BULT.maxGrade };

/** West and east ends of the whoops lane: troughs, so the lane starts and ends at ground level. */
export const WHOOPS_START_X = NURSERY_WHOOPS.firstCrestX - NURSERY_WHOOPS.spacing / 2;
export const WHOOPS_END_X = WHOOPS_START_X + NURSERY_WHOOPS.count * NURSERY_WHOOPS.spacing;

/** Height of the whoops at `x` along the lane, 0 outside it. Crests sit at firstCrestX + n × spacing. */
export function whoopsProfile(x: number): number {
  if (x <= WHOOPS_START_X || x >= WHOOPS_END_X) return 0;
  const angle = (2 * Math.PI * (x - NURSERY_WHOOPS.firstCrestX)) / NURSERY_WHOOPS.spacing;
  const share = (1 + Math.cos(angle)) / 2;
  return NURSERY_WHOOPS.height * share ** NURSERY_WHOOPS.topExponent;
}

/** Radius of the whoops over each crest, metres. */
export function whoopsCrestRadius(): number {
  const wave = (2 * Math.PI) / NURSERY_WHOOPS.spacing;
  return 1 / ((NURSERY_WHOOPS.height * NURSERY_WHOOPS.topExponent * wave * wave) / 2);
}
