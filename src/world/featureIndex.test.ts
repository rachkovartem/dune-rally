// src/world/featureIndex.test.ts
import { describe, it, expect } from 'vitest';
import { createFeatureIndex, type Bounds, type FeatureIndex } from './featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2, type SegmentHit } from './polyline';
import { ROUTES } from './mapLayout';
import { GRADED_ROADS, nearestRoad } from './worldDef';
import { mulberry32 } from './rng';

interface Item {
  name: string;
  bounds: Bounds;
}

const itemsOf = (items: readonly Item[]): FeatureIndex<Item> =>
  createFeatureIndex(items, (item) => item.bounds, 10);
const namesAt = (index: FeatureIndex<Item>, x: number, z: number): string[] =>
  index.query(x, z).map((item) => item.name);

describe('createFeatureIndex — items listed in every cell they touch (S0-3)', () => {
  it('finds an item that spans four cells from each of them', () => {
    const index = itemsOf([{ name: 'wide', bounds: { minX: 5, minZ: 5, maxX: 15, maxZ: 15 } }]);
    for (const [x, z] of [[6, 6], [14, 6], [6, 14], [14, 14]]) expect(namesAt(index, x, z)).toEqual(['wide']);
  });

  it('finds an item whose bounds end exactly on a cell line from both sides of it', () => {
    const index = itemsOf([{ name: 'edge', bounds: { minX: 2, minZ: 2, maxX: 10, maxZ: 8 } }]);
    expect(namesAt(index, 9.999, 5)).toEqual(['edge']);
    expect(namesAt(index, 10.001, 5)).toEqual(['edge']);
  });

  it('answers an empty list for a point in no cell, and for a cell no item touches', () => {
    const index = itemsOf([{ name: 'small', bounds: { minX: 22, minZ: 22, maxX: 28, maxZ: 28 } }]);
    expect(namesAt(index, 500, -500)).toEqual([]);
    expect(namesAt(index, 45, 25)).toEqual([]);
    expect(itemsOf([]).query(0, 0)).toEqual([]);
  });

  it('keeps the order the items were given in', () => {
    const index = itemsOf([
      { name: 'first', bounds: { minX: 1, minZ: 1, maxX: 9, maxZ: 9 } },
      { name: 'second', bounds: { minX: 2, minZ: 2, maxX: 8, maxZ: 8 } },
    ]);
    expect(namesAt(index, 5, 5)).toEqual(['first', 'second']);
  });

  it('works for items at negative coordinates', () => {
    const index = itemsOf([{ name: 'west', bounds: { minX: -25, minZ: -5, maxX: -15, maxZ: 5 } }]);
    expect(namesAt(index, -20, 0)).toEqual(['west']);
  });

  it('throws for a query point that is not a number instead of answering "nothing here"', () => {
    const index = itemsOf([{ name: 'any', bounds: { minX: 0, minZ: 0, maxX: 5, maxZ: 5 } }]);
    expect(() => index.query(Number.NaN, 0)).toThrow('not finite');
  });

  it('throws for inside-out bounds and for a cell size that is not positive', () => {
    expect(() => itemsOf([{ name: 'bad', bounds: { minX: 5, minZ: 0, maxX: 1, maxZ: 5 } }])).toThrow('bad bounds');
    expect(() => createFeatureIndex([], () => ({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 }), 0)).toThrow('cell size must be positive');
  });
});

describe('the index gives the same nearest line point as a full scan (S0-3 regression)', () => {
  const REACH = 15;
  const LINES: Point2[][] = ROUTES.map((route) => smoothPolyline(route.points, 8));
  const segments = LINES.flatMap((line, lineIndex) => line.slice(0, -1).map((_point, segmentIndex) => ({ lineIndex, segmentIndex })));
  const index = createFeatureIndex(segments, ({ lineIndex, segmentIndex }) => {
    const a = LINES[lineIndex][segmentIndex];
    const b = LINES[lineIndex][segmentIndex + 1];
    return { minX: Math.min(a.x, b.x) - REACH, minZ: Math.min(a.z, b.z) - REACH, maxX: Math.max(a.x, b.x) + REACH, maxZ: Math.max(a.z, b.z) + REACH };
  }, 64);

  /** The closest of the hits; the first one wins a tie, as in a full scan. */
  const nearestOf = (hits: readonly (SegmentHit | null)[]): SegmentHit | null => {
    let best: SegmentHit | null = null;
    for (const hit of hits) if (hit && (!best || hit.distance < best.distance)) best = hit;
    return best;
  };

  it('agrees exactly for 5000 points within reach of a line', () => {
    const random = mulberry32(0x5eed);
    let checked = 0;
    while (checked < 5000) {
      // Points near a random line point, so most of them are within reach.
      const line = LINES[Math.floor(random() * LINES.length)];
      const anchor = line[Math.floor(random() * line.length)];
      const x = anchor.x + (random() - 0.5) * 2 * REACH;
      const z = anchor.z + (random() - 0.5) * 2 * REACH;
      const full = nearestOf(LINES.map((points) => nearestOnPolyline(points, points.slice(0, -1).map((_point, segmentIndex) => segmentIndex), x, z)));
      if (!full || full.distance > REACH) continue;
      const candidates = LINES.map((): number[] => []);
      for (const segment of index.query(x, z)) candidates[segment.lineIndex].push(segment.segmentIndex);
      const indexed = nearestOf(LINES.map((points, lineIndex) => nearestOnPolyline(points, candidates[lineIndex], x, z)));
      expect(indexed).toEqual(full);
      checked++;
    }
  });
});

describe('nearestRoad through the index equals a full scan of the graded roads (S0-3)', () => {
  function fullScan(x: number, z: number): { dist: number; x: number; z: number } | null {
    let best: { dist: number; x: number; z: number } | null = null;
    for (const road of GRADED_ROADS) {
      const hit = nearestOnPolyline(road, road.slice(0, -1).map((_point, segmentIndex) => segmentIndex), x, z);
      if (hit && (!best || hit.distance < best.dist)) best = { dist: hit.distance, x: hit.x, z: hit.z };
    }
    return best;
  }

  it('agrees on 5000 points across the map, near and far from any road', () => {
    const random = mulberry32(0xa11);
    for (let sample = 0; sample < 5000; sample++) {
      const x = random() * 3072;
      const z = random() * 3072;
      const expected = fullScan(x, z);
      const actual = nearestRoad(x, z);
      if (expected === null) {
        expect(actual).toBeNull();
      } else {
        expect(actual).toMatchObject(expected);
      }
    }
  });

  it('answers null past the asked distance instead of a far-away road', () => {
    const random = mulberry32(0xa12);
    for (let sample = 0; sample < 500; sample++) {
      const x = random() * 3072;
      const z = random() * 3072;
      const expected = fullScan(x, z);
      const actual = nearestRoad(x, z, 5);
      if (expected === null || expected.dist > 5) expect(actual).toBeNull();
      else expect(actual?.dist).toBe(expected.dist);
    }
  });
});
