// src/world/noise.ts
import { baseGroundHeight } from './terrain/baseGround';
import { applyPads } from './terrain/pads';
import { applyRoads } from './terrain/roads';
import { applyDieSprong, carveRiver } from './terrain/river';

export type Height2D = (x: number, z: number) => number;

/**
 * Klipfontein's ground height, the same on every client, worker and the server. The layers go in
 * the design's order: the base ground, the pads, the roads graded from them (a road lies flush
 * with a pad it crosses), the river cut, and the Die Sprong fills.
 */
export function klipfonteinHeight(x: number, z: number): number {
  const ground = applyPads(baseGroundHeight(x, z), x, z);
  return applyDieSprong(carveRiver(applyRoads(ground, x, z), x, z), x, z);
}

/**
 * The world's height field. The seed argument is ignored for the shape: the world is the same
 * place for everyone, and the signature stays so every caller keeps working.
 */
export function createHeightField(_seed: number): Height2D {
  return klipfonteinHeight;
}
