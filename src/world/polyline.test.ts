// src/world/polyline.test.ts
import { describe, it, expect } from 'vitest';
import { nearestOnPolyline, smoothPolyline, type Point2 } from './polyline';

const allSegments = (points: readonly Point2[]): number[] => points.slice(0, -1).map((_point, index) => index);
const gapsOf = (points: readonly Point2[]): number[] =>
  points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.z - points[index].z));

describe('smoothPolyline — a smooth curve through the waypoints (S0-3)', () => {
  const BEND: Point2[] = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 140, z: 90 }, { x: 60, z: 200 }];

  it('starts and ends exactly on the first and last waypoints', () => {
    const curve = smoothPolyline(BEND, 8);
    expect(curve[0]).toEqual(BEND[0]);
    expect(curve[curve.length - 1]).toEqual(BEND[BEND.length - 1]);
  });

  it('spaces the output points within 10 % of the asked spacing', () => {
    for (const gap of gapsOf(smoothPolyline(BEND, 8))) {
      expect(gap).toBeGreaterThan(8 * 0.9);
      expect(gap).toBeLessThan(8 * 1.1);
    }
  });

  it('keeps a straight line straight', () => {
    const curve = smoothPolyline([{ x: 0, z: 5 }, { x: 50, z: 5 }, { x: 130, z: 5 }], 10);
    for (const point of curve) expect(point.z).toBeCloseTo(5, 9);
  });

  it('resamples two points as a straight, evenly spaced line', () => {
    const curve = smoothPolyline([{ x: 0, z: 0 }, { x: 30, z: 40 }], 5);
    expect(curve).toHaveLength(11);
    for (const point of curve) expect(point.z).toBeCloseTo((point.x * 4) / 3, 9);
  });

  it('passes close to every middle waypoint', () => {
    const curve = smoothPolyline(BEND, 4);
    for (const waypoint of BEND.slice(1, -1)) {
      const nearest = Math.min(...curve.map((point) => Math.hypot(point.x - waypoint.x, point.z - waypoint.z)));
      expect(nearest).toBeLessThan(4);
    }
  });

  it('drops repeated waypoints instead of making a zero-length span', () => {
    const curve = smoothPolyline([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 40, z: 0 }], 10);
    expect(curve).toHaveLength(5);
  });

  it('returns a single waypoint and an empty list unchanged', () => {
    expect(smoothPolyline([{ x: 3, z: 4 }], 5)).toEqual([{ x: 3, z: 4 }]);
    expect(smoothPolyline([], 5)).toEqual([]);
  });

  it.each([0, -1, Number.NaN])('throws for spacing %s', (spacing) => {
    expect(() => smoothPolyline(BEND, spacing)).toThrow('spacing must be positive');
  });
});

describe('nearestOnPolyline — the closest point on a line (S0-3)', () => {
  const EAST: Point2[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }];

  it('flips the side when the point crosses the line', () => {
    expect(nearestOnPolyline(EAST, allSegments(EAST), 5, 3)?.side).toBe(1);
    expect(nearestOnPolyline(EAST, allSegments(EAST), 5, -3)?.side).toBe(-1);
  });

  it('gives t 0 before the start and 1 past the end, and the end point as the closest point', () => {
    const before = nearestOnPolyline(EAST, [0], -4, 0);
    expect(before).toMatchObject({ t: 0, x: 0, z: 0, distance: 4 });
    const past = nearestOnPolyline(EAST, [1], 26, 0);
    expect(past).toMatchObject({ t: 1, x: 20, z: 0, distance: 6 });
  });

  it('reports the segment and where on it the closest point lies', () => {
    expect(nearestOnPolyline(EAST, allSegments(EAST), 12.5, 2)).toMatchObject({ segmentIndex: 1, t: 0.25, x: 12.5, z: 0, distance: 2 });
  });

  it('keeps the segment listed first on a tie', () => {
    // (10, 3) is 3 m from both segments, which meet at (10, 0).
    expect(nearestOnPolyline(EAST, [0, 1], 10, 3)?.segmentIndex).toBe(0);
    expect(nearestOnPolyline(EAST, [1, 0], 10, 3)?.segmentIndex).toBe(1);
  });

  it('answers null for an empty segment list, never a fake far-away hit', () => {
    expect(nearestOnPolyline(EAST, [], 5, 5)).toBeNull();
  });

  it.each([-1, 2, 0.5])('throws for segment index %s that the line does not have', (segmentIndex) => {
    expect(() => nearestOnPolyline(EAST, [segmentIndex], 0, 0)).toThrow('no segment');
  });
});
