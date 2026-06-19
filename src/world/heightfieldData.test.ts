// src/world/heightfieldData.test.ts
import { describe, it, expect } from 'vitest';
import { generateChunkHeights, VERTS_PER_SIDE } from './heightfieldData';
import { CHUNK_SIZE, CHUNK_RES, chunkOrigin } from './chunk';
import { createHeightField } from './noise';

describe('generateChunkHeights', () => {
  const h = createHeightField(123);

  it('returns a full grid', () => {
    const grid = generateChunkHeights(h, { cx: 0, cz: 0 });
    expect(grid).toBeInstanceOf(Float32Array);
    expect(grid.length).toBe(VERTS_PER_SIDE * VERTS_PER_SIDE);
  });

  it('samples the height field at grid points (row=z, col=x)', () => {
    const c = { cx: 2, cz: -1 };
    const grid = generateChunkHeights(h, c);
    const origin = chunkOrigin(c);
    const step = CHUNK_SIZE / CHUNK_RES;
    const r = 5, col = 7;
    const expected = h(origin.x + col * step, origin.z + r * step);
    expect(grid[r * VERTS_PER_SIDE + col]).toBeCloseTo(expected, 5);
  });

  it('is deterministic', () => {
    const a = generateChunkHeights(h, { cx: 3, cz: 3 });
    const b = generateChunkHeights(createHeightField(123), { cx: 3, cz: 3 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
