// src/assets/meshCleanup.test.ts
import { describe, it, expect } from 'vitest';
import { boxProjectedUv, connectedComponents, type TriangleSoup } from './meshCleanup';

const soup = (positions: number[], indices: number[]): TriangleSoup => ({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });

describe('connectedComponents — one piece of a raw part, such as a badge (E1)', () => {
  it('joins two triangles that share an edge into one component', () => {
    const split = connectedComponents(soup([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 1, 3, 2]));
    expect(split.components).toHaveLength(1);
    expect(split.components[0].triangles).toBe(2);
  });

  it('joins two triangles that touch only through a repeated position under another index', () => {
    // The source often repeats a vertex; a badge split on that seam would leave half of it behind.
    const split = connectedComponents(soup([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 1, 0], [0, 1, 2, 3, 4, 5]));
    expect(split.components).toHaveLength(1);
  });

  it('keeps two separate triangles apart and reports each one\'s bounds and triangle list', () => {
    const split = connectedComponents(soup([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 7, 5], [0, 1, 2, 3, 4, 5]));
    expect(split.components).toHaveLength(2);
    expect([...split.componentOfTriangle]).toEqual([0, 1]);
    expect(split.components[1].min).toEqual([5, 5, 5]);
    expect(split.components[1].max).toEqual([6, 7, 5]);
  });

  it('answers no components for an empty mesh', () => {
    expect(connectedComponents(soup([], [])).components).toEqual([]);
  });
});

describe('boxProjectedUv — the paint flake map on a model with no UVs (E1)', () => {
  it('maps a face turned up by its x and z, times the repeats per metre', () => {
    const uv = boxProjectedUv(soup([0, 1, 0, 0, 1, 2, 3, 1, 0], [0, 1, 2]), 2);
    expect([...uv]).toEqual([0, 0, 0, 4, 6, 0]);
  });

  it('maps a face turned sideways (along x) by its z and y', () => {
    const uv = boxProjectedUv(soup([1, 0, 0, 1, 2, 0, 1, 0, 3], [0, 1, 2]), 1);
    expect([...uv]).toEqual([0, 0, 0, 2, 3, 0]);
  });

  it('maps a face turned forward (along z) by its x and y', () => {
    const uv = boxProjectedUv(soup([0, 0, 1, 2, 0, 1, 0, 3, 1], [0, 1, 2]), 1);
    expect([...uv]).toEqual([0, 0, 2, 0, 0, 3]);
  });

  it.each([0, -1, Number.NaN])('throws for %s repeats per metre', (repeats) => {
    expect(() => boxProjectedUv(soup([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), repeats)).toThrow('repeatsPerMetre');
  });
});
