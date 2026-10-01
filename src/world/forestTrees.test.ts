// src/world/forestTrees.test.ts
import { describe, it, expect } from 'vitest';
import { treesInChunk } from './forestTrees';
import { worldToChunk } from './chunk';
import { BOSVELD } from './mapLayout';

describe('forestTrees in Bosveld', () => {
  it('generates trees inside the forest biome', () => {
    const chunk = worldToChunk(BOSVELD.x, BOSVELD.z);
    const trees = treesInChunk(chunk.cx, chunk.cz);
    expect(trees.length).toBeGreaterThan(0);

    const solidTrees = trees.filter((t) => t.solid);
    const knockableTrees = trees.filter((t) => t.knockable);
    expect(solidTrees.length).toBeGreaterThan(0);
    expect(knockableTrees.length).toBeGreaterThan(0);

    for (const tree of solidTrees) {
      expect(tree.trunkRadius).toBeGreaterThanOrEqual(0.4);
      expect(tree.knockable).toBe(false);
    }
    for (const tree of knockableTrees) {
      expect(tree.trunkRadius).toBeLessThanOrEqual(0.25);
      expect(tree.solid).toBe(false);
    }
  });

  it('generates no trees outside the forest (e.g. at spawn)', () => {
    const chunk = worldToChunk(1560, 2000);
    const trees = treesInChunk(chunk.cx, chunk.cz);
    expect(trees).toHaveLength(0);
  });
});
