// src/world/farGrid.test.ts
import { describe, it, expect } from 'vitest';
import { generateFarGrid } from './farGrid';
import { coverFromIndex, createBiome } from './biome';
import { createHeightField } from './noise';
import { WORLD_SIZE } from './worldDef';

const height = createHeightField(1);
const biome = createBiome(1);

describe('generateFarGrid — the whole map, coarse, for the far layer (S1-1)', () => {
  const step = 64;
  const margin = 128;
  const grid = generateFarGrid(height, biome, { step, margin });

  it('covers the map plus the margin on every side, one vertex per step', () => {
    expect(grid.verticesPerSide).toBe((WORLD_SIZE + 2 * margin) / step + 1);
    expect(grid.originX).toBe(-margin);
    expect(grid.originZ).toBe(-margin);
    expect(grid.heights).toHaveLength(grid.verticesPerSide ** 2);
    expect(grid.covers).toHaveLength(grid.verticesPerSide ** 2);
  });

  it('holds the world height at every grid point, row by row along z', () => {
    for (let row = 0; row < grid.verticesPerSide; row += 7) {
      for (let column = 0; column < grid.verticesPerSide; column += 5) {
        const expected = Math.fround(height(grid.originX + column * step, grid.originZ + row * step));
        expect(grid.heights[row * grid.verticesPerSide + column]).toBe(expected);
      }
    }
  });

  it('paints the border ranges rock and the open valley in its own covers', () => {
    const coverAt = (x: number, z: number): string => {
      const column = (x - grid.originX) / step;
      const row = (z - grid.originZ) / step;
      return coverFromIndex(grid.covers[row * grid.verticesPerSide + column]);
    };
    expect(coverAt(1536, 64)).toBe('rock');
    expect(coverAt(1536, 1536)).not.toBe('rock');
  });

  it.each<[string, { step: number; margin: number }]>([
    ['a step that does not divide the span', { step: 100, margin: 0 }],
    ['a zero step', { step: 0, margin: 0 }],
    ['a negative margin', { step: 64, margin: -64 }],
  ])('throws for %s', (_name, options) => {
    expect(() => generateFarGrid(height, biome, options)).toThrow('generateFarGrid');
  });
});
