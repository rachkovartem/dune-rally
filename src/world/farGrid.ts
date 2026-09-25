// src/world/farGrid.ts
// A coarse grid of the whole map plus a margin around it, for the far terrain layer: the same
// height function and covers as the near chunks, sampled every `step` metres.
import { coverIndex, type Biome } from './biome';
import type { Height2D } from './noise';
import { WORLD_SIZE } from './worldDef';

export interface FarGrid {
  /** World position of the grid's first vertex (its north-west corner). */
  originX: number;
  originZ: number;
  step: number;
  verticesPerSide: number;
  /** Row-major, row = z: the value at (col, row) is at index `row * verticesPerSide + col`. */
  heights: Float32Array;
  /** Same layout as `heights`; each value is a `coverIndex`. */
  covers: Uint8Array;
}

export function generateFarGrid(height: Height2D, biome: Biome, options: { step: number; margin: number }): FarGrid {
  const { step, margin } = options;
  if (!(step > 0) || !(margin >= 0)) throw new Error(`generateFarGrid: bad step ${step} or margin ${margin}`);
  const span = WORLD_SIZE + 2 * margin;
  const cells = span / step;
  if (!Number.isInteger(cells)) throw new Error(`generateFarGrid: the span ${span} m is not a whole number of ${step} m steps`);
  const verticesPerSide = cells + 1;
  const originX = -margin;
  const originZ = -margin;

  const heights = new Float32Array(verticesPerSide * verticesPerSide);
  for (let row = 0; row < verticesPerSide; row++) {
    const z = originZ + row * step;
    for (let col = 0; col < verticesPerSide; col++) heights[row * verticesPerSide + col] = height(originX + col * step, z);
  }

  // Slope by central differences on the grid itself (one-sided at the grid's own edge).
  const heightAt = (col: number, row: number): number => heights[row * verticesPerSide + col];
  const last = verticesPerSide - 1;
  const covers = new Uint8Array(verticesPerSide * verticesPerSide);
  for (let row = 0; row < verticesPerSide; row++) {
    const rowBefore = Math.max(0, row - 1);
    const rowAfter = Math.min(last, row + 1);
    for (let col = 0; col < verticesPerSide; col++) {
      const colBefore = Math.max(0, col - 1);
      const colAfter = Math.min(last, col + 1);
      const slope = Math.hypot(
        (heightAt(colAfter, row) - heightAt(colBefore, row)) / ((colAfter - colBefore) * step),
        (heightAt(col, rowAfter) - heightAt(col, rowBefore)) / ((rowAfter - rowBefore) * step),
      );
      const index = row * verticesPerSide + col;
      covers[index] = coverIndex(biome.coverAt(originX + col * step, originZ + row * step, heights[index], slope));
    }
  }
  return { originX, originZ, step, verticesPerSide, heights, covers };
}
