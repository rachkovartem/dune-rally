// src/world/terrainSelection.test.ts
import { describe, it, expect } from 'vitest';
import { diffChunks } from './terrainSelection';
import { chunkKey } from './chunk';

describe('diffChunks', () => {
  it('loads the full radius when nothing is loaded', () => {
    const d = diffChunks(new Set(), { cx: 0, cz: 0 }, 1);
    expect(d.toLoad).toHaveLength(9);
    expect(d.toUnload).toHaveLength(0);
  });

  it('unloads chunks that fell out of radius', () => {
    const loaded = new Set([chunkKey({ cx: 5, cz: 5 }), chunkKey({ cx: 0, cz: 0 })]);
    const d = diffChunks(loaded, { cx: 0, cz: 0 }, 1);
    expect(d.toUnload).toEqual([chunkKey({ cx: 5, cz: 5 })]);
    expect(d.toLoad).not.toContainEqual({ cx: 0, cz: 0 });
  });

  it('is a no-op when already covering the radius', () => {
    const loaded = new Set([chunkKey({ cx: 0, cz: 0 })]);
    const d = diffChunks(loaded, { cx: 0, cz: 0 }, 0);
    expect(d.toLoad).toHaveLength(0);
    expect(d.toUnload).toHaveLength(0);
  });
});
