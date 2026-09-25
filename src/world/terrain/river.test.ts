// src/world/terrain/river.test.ts
// Category 1 (pure invariants of the built ground): the Sandrivier (plan v3 S2-2, AC8).
import { describe, it, expect } from 'vitest';
import {
  RIVER_ALONG, RIVER_LENGTH, RIVER_LINE, RIVER_SPANS,
  bankSlopeAt, bedHalfWidthAt, bedHeightAt, riverCurvatureAt,
} from './river';
import { createHeightField } from '../noise';

const height = createHeightField(1);

const inHeadOrDelta = (along: number): boolean =>
  along <= RIVER_SPANS.head.to || along >= RIVER_SPANS.delta.from;

describe('the Sandrivier — a real dry river bed (S2-2, AC8)', () => {
  it('keeps both banks at least 2 m above the bed every 10 m, outside the gorge head and the delta', () => {
    let checked = 0;
    let segment = 0;
    for (let along = 0; along <= RIVER_LENGTH; along += 10) {
      if (inHeadOrDelta(along)) continue;
      while (segment < RIVER_ALONG.length - 2 && RIVER_ALONG[segment + 1] < along) segment++;
      const start = RIVER_LINE[segment];
      const end = RIVER_LINE[segment + 1];
      const length = RIVER_ALONG[segment + 1] - RIVER_ALONG[segment];
      const share = (along - RIVER_ALONG[segment]) / length;
      const point = { x: start.x + (end.x - start.x) * share, z: start.z + (end.z - start.z) * share };
      const acrossX = -(end.z - start.z) / length;
      const acrossZ = (end.x - start.x) / length;
      const bed = height(point.x, point.z);
      const halfWidth = bedHalfWidthAt(along);
      for (const side of [-1, 1]) {
        let bankTop = -Infinity;
        for (let out = halfWidth; out <= halfWidth + 40; out += 1) bankTop = Math.max(bankTop, height(point.x + side * acrossX * out, point.z + side * acrossZ * out));
        expect(bankTop - bed, `${along.toFixed(0)} m along, side ${side}`).toBeGreaterThanOrEqual(2);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('never climbs downstream: over any 50 m the bed rises by 0.3 m at most (no pond)', () => {
    for (let along = 0; along + 50 <= RIVER_LENGTH; along += 5) {
      for (let ahead = 5; ahead <= 50; ahead += 5) expect(bedHeightAt(along + ahead) - bedHeightAt(along)).toBeLessThanOrEqual(0.3);
    }
  });

  it('never climbs downstream on the built ground of its centre line either', () => {
    for (let first = 0; first < RIVER_LINE.length; first += 2) {
      const start = height(RIVER_LINE[first].x, RIVER_LINE[first].z);
      for (let second = first + 1; second < RIVER_LINE.length && RIVER_ALONG[second] - RIVER_ALONG[first] <= 50; second++) {
        expect(height(RIVER_LINE[second].x, RIVER_LINE[second].z) - start).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('cuts a steep outside bank (≥ 0.55) and a gentle inside bank (≤ 0.3) at its three sharpest bends', () => {
    const bends = Array.from(RIVER_ALONG)
      .map((along, index, all) => ({ along, sharpness: Math.abs(riverCurvatureAt(along)), index, all }))
      .filter((bend) => bend.index > 0 && bend.index < bend.all.length - 1
        && bend.sharpness >= Math.abs(riverCurvatureAt(bend.all[bend.index - 1]))
        && bend.sharpness >= Math.abs(riverCurvatureAt(bend.all[bend.index + 1])))
      .sort((first, second) => second.sharpness - first.sharpness)
      .slice(0, 3);
    expect(bends).toHaveLength(3);
    for (const bend of bends) {
      const slopes = [bankSlopeAt(bend.along, 1), bankSlopeAt(bend.along, -1)];
      expect(Math.max(...slopes), `bend at ${bend.along.toFixed(0)} m`).toBeGreaterThanOrEqual(0.55);
      expect(Math.min(...slopes), `bend at ${bend.along.toFixed(0)} m`).toBeLessThanOrEqual(0.3);
    }
  });
});
