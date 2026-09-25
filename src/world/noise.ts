// src/world/noise.ts
import { baseGroundHeight } from './terrain/baseGround';
import { applyPads } from './terrain/pads';
import { applyRoads } from './terrain/roads';
import { applyTracks } from './terrain/tracks';
import { applyDieSprong, carveRiver } from './terrain/river';

export type Height2D = (x: number, z: number) => number;

/**
 * Klipfontein's ground height, the same on every client, worker and the server. In the design's
 * order: base ground, pads, the roads graded from them, the tracks graded onto the roads they start
 * from, the river cut, the Die Sprong fills.
 */
export function klipfonteinHeight(x: number, z: number): number {
  const ground = applyPads(baseGroundHeight(x, z), x, z);
  return applyDieSprong(carveRiver(applyTracks(applyRoads(ground, x, z), x, z), x, z), x, z);
}

/**
 * The world's height field. The seed argument is ignored for the shape: the world is the same
 * place for everyone, and the signature stays so every caller keeps working.
 */
export function createHeightField(_seed: number): Height2D {
  return klipfonteinHeight;
}
