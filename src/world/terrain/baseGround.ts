// src/world/terrain/baseGround.ts
// The ground before any flats are graded into it: the plain, the hills and dunes on it, the salt
// pan, the border ranges, the NW gorge, the poort canyon and the quarry. Roads, tracks and pads are
// graded from this ground, and the river's bed is measured from it.
import { lerp, smoothstep } from '../blend';
import { microRelief, plainHeight } from './basePlain';
import { applyLandforms, koppieLumps } from './landforms';
import { borderAt, carveGorge } from './border';
import { duneRise } from './dunes';
import { applyPan } from './pan';
import { applyQuarry, carvePoort } from './cuts';

/** Metres past the face foot over which the range stops following the plain's relief. */
const FACE_BASIS_BLEND = 12;
/** Metres before the face foot over which landforms fade out. */
const LANDFORM_FADE = 80;

/**
 * Past the foot of a face the range stands on one plain level per inward ray, so the plain's
 * relief never makes a dip in it.
 */
export function baseGroundHeight(x: number, z: number): number {
  const natural = plainHeight(x, z) + microRelief(x, z);
  const border = borderAt(x, z);
  // A landform that reaches the ranges sinks into the apron, so it never makes a dip on the face.
  const landformFade = 1 - smoothstep(-LANDFORM_FADE, 0, border.faceDepth);
  const raised = applyLandforms(natural, x, z).height + koppieLumps(x, z) + duneRise(x, z);
  let height = applyPan(natural + (raised - natural) * landformFade, x, z);
  if (border.surface !== null) {
    if (border.faceDepth > 0) {
      const basis = lerp(natural, border.basis, smoothstep(0, FACE_BASIS_BLEND, border.faceDepth));
      height = Math.max(basis + height - natural, border.surface);
    } else {
      height = Math.max(height, border.surface);
    }
  }
  return applyQuarry(carvePoort(carveGorge(height, x, z), x, z), x, z);
}
