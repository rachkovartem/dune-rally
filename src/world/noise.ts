// src/world/noise.ts
import { lerp, smoothstep } from './blend';
import { microRelief, plainHeight } from './terrain/basePlain';
import { applyLandforms } from './terrain/landforms';
import { borderAt, carveGorge } from './terrain/border';

export type Height2D = (x: number, z: number) => number;

/** Metres past the face foot over which the range stops following the plain's relief. */
const FACE_BASIS_BLEND = 12;
/** Metres before the face foot over which landforms fade out. */
const LANDFORM_FADE = 80;

/**
 * Klipfontein's ground height, the same on every client, worker and the server. Past the foot of a
 * face the range stands on one plain level per inward ray, so the plain's relief never makes a dip.
 */
export function klipfonteinHeight(x: number, z: number): number {
  const natural = plainHeight(x, z) + microRelief(x, z);
  const border = borderAt(x, z);
  // A landform that reaches the ranges sinks into the apron, so it never makes a dip on the face.
  const landformFade = 1 - smoothstep(-LANDFORM_FADE, 0, border.faceDepth);
  let height = natural + (applyLandforms(natural, x, z).height - natural) * landformFade;
  if (border.surface !== null) {
    if (border.faceDepth > 0) {
      const basis = lerp(natural, border.basis, smoothstep(0, FACE_BASIS_BLEND, border.faceDepth));
      height = Math.max(basis + height - natural, border.surface);
    } else {
      height = Math.max(height, border.surface);
    }
  }
  return carveGorge(height, x, z);
}

/**
 * The world's height field. The seed argument is ignored for the shape: the world is the same
 * place for everyone, and the signature stays so every caller keeps working.
 */
export function createHeightField(_seed: number): Height2D {
  return klipfonteinHeight;
}
