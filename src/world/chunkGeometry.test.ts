// src/world/chunkGeometry.test.ts
import { describe, it, expect } from 'vitest';
import { buildChunkGeometry } from './chunkGeometry';
import { VERTS_PER_SIDE } from './heightfieldData';
import { CHUNK_SIZE } from './chunk';

describe('buildChunkGeometry', () => {
  const n = VERTS_PER_SIDE;
  const heights = Float32Array.from({ length: n * n }, (_, i) => i * 0.1);

  it('places world-space positions from origin + grid step', () => {
    const g = buildChunkGeometry(heights, 64, -128);
    expect(g.positions.length).toBe(n * n * 3);
    // vertex (r=0, col=0) is the origin corner
    expect(g.positions[0]).toBe(64);
    expect(g.positions[2]).toBe(-128);
    expect(g.positions[1]).toBeCloseTo(heights[0], 5);
    // last column reaches origin + CHUNK_SIZE in X
    const last = n - 1;
    expect(g.positions[last * 3 + 0]).toBeCloseTo(64 + CHUNK_SIZE, 5);
  });

  it('emits two triangles per cell with in-range indices', () => {
    const g = buildChunkGeometry(heights, 0, 0);
    expect(g.indices.length).toBe((n - 1) * (n - 1) * 6);
    for (const idx of g.indices) expect(idx).toBeLessThan(n * n);
  });

  it('is deterministic', () => {
    const a = buildChunkGeometry(heights, 10, 20);
    const b = buildChunkGeometry(heights, 10, 20);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });
});
