// src/world/terrain/roads.test.ts
// Category 1 (pure invariants of the built ground): the graded roads (plan v3 S2-1). Every row
// samples the final height field, the ground a car really drives on.
import { describe, it, expect } from 'vitest';
import { ROAD_LINES, roadProfileAt, type RoadLine } from './roads';
import { padWeightAt } from './pads';
import { bedHalfWidthAt, riverSampleAt } from './river';
import { createHeightField } from '../noise';
import { nearestOnPolyline } from '../polyline';
import { EERSTE_BULT, ROAD_GRADING } from '../mapLayout';

const height = createHeightField(1);
const STEP = 4;

interface RoadPoint {
  line: RoadLine;
  distance: number;
  x: number;
  z: number;
  /** Unit vector across the road. */
  acrossX: number;
  acrossZ: number;
}

function pointsAlong(line: RoadLine, step: number): RoadPoint[] {
  const total = line.along[line.along.length - 1];
  const points: RoadPoint[] = [];
  let segment = 0;
  for (let distance = 0; distance <= total; distance += step) {
    while (segment < line.along.length - 2 && line.along[segment + 1] < distance) segment++;
    const start = line.points[segment];
    const end = line.points[segment + 1];
    const length = line.along[segment + 1] - line.along[segment];
    const share = (distance - line.along[segment]) / length;
    const tangentX = (end.x - start.x) / length;
    const tangentZ = (end.z - start.z) / length;
    points.push({ line, distance, x: start.x + (end.x - start.x) * share, z: start.z + (end.z - start.z) * share, acrossX: -tangentZ, acrossZ: tangentX });
  }
  return points;
}

const ALL_POINTS: readonly RoadPoint[] = ROAD_LINES.flatMap((line) => pointsAlong(line, STEP));

/** The drifts go down into the river bed and Die Sprong sits beside it: the road rules stop there. */
function nearRiver(point: { x: number; z: number }): boolean {
  const river = riverSampleAt(point.x, point.z);
  return river !== null && river.distance <= bedHalfWidthAt(river.along) + 40;
}

/** Where another road joins, "across" this road is "along" the other one. */
function nearAnotherRoad(point: RoadPoint, reach: number): boolean {
  return ROAD_LINES.some((other) => {
    if (other === point.line) return false;
    const hit = nearestOnPolyline(other.points, other.points.slice(0, -1).map((_point, index) => index), point.x, point.z);
    return hit !== null && hit.distance < reach;
  });
}

const where = (point: RoadPoint): string => `${point.line.name} at (${point.x.toFixed(0)}, ${point.z.toFixed(0)})`;

describe('the graded roads — a car on a road is never in a pit (S2-1)', () => {
  it('never has the ground 5.5 m to either side more than 1 m above the road centre (regression: the pit on the spine)', () => {
    for (const point of ALL_POINTS) {
      if (nearRiver(point)) continue;
      const centre = height(point.x, point.z);
      const beside = Math.max(
        height(point.x + point.acrossX * ROAD_GRADING.sideProbe, point.z + point.acrossZ * ROAD_GRADING.sideProbe),
        height(point.x - point.acrossX * ROAD_GRADING.sideProbe, point.z - point.acrossZ * ROAD_GRADING.sideProbe),
      );
      expect(beside - centre, where(point)).toBeLessThanOrEqual(ROAD_GRADING.maxBelowGround);
    }
  });

  it.each(ROAD_LINES.map((line) => [line.name, line] as const))('keeps the grade of the %s line at 8 % or less', (_name, line) => {
    const total = line.along[line.along.length - 1];
    for (let distance = STEP; distance <= total; distance += STEP) {
      expect(Math.abs(roadProfileAt(line, distance) - roadProfileAt(line, distance - STEP)) / STEP).toBeLessThanOrEqual(0.08 + 1e-9);
    }
  });

  it('keeps the grade of the built ground along every road centre at 8 % or less, away from the river', () => {
    for (const line of ROAD_LINES) {
      const points = pointsAlong(line, STEP);
      for (let index = 1; index < points.length; index++) {
        if (nearRiver(points[index]) || nearRiver(points[index - 1])) continue;
        const grade = Math.abs(height(points[index].x, points[index].z) - height(points[index - 1].x, points[index - 1].z)) / STEP;
        expect(grade, where(points[index])).toBeLessThanOrEqual(0.08 + 1e-6);
      }
    }
  });

  it('tilts the running surface across by at most 3 %, away from junctions and the river', () => {
    const edge = 3.5;
    for (const point of ALL_POINTS) {
      if (nearRiver(point) || nearAnotherRoad(point, 20)) continue;
      const centre = height(point.x, point.z);
      const left = height(point.x + point.acrossX * edge, point.z + point.acrossZ * edge);
      const right = height(point.x - point.acrossX * edge, point.z - point.acrossZ * edge);
      expect(Math.max(Math.abs(left - centre), Math.abs(right - centre)) / edge, where(point)).toBeLessThanOrEqual(0.03);
    }
  });

  it('rounds every crest of the road lines to at least R 300, away from Eerste Bult, the pads and the junctions', () => {
    // A sharper crest lifts the wheels below top speed at real gravity (√(g·R): R 300 → 195 km/h).
    const baseline = 8;
    for (const line of ROAD_LINES) {
      const total = line.along[line.along.length - 1];
      for (const point of pointsAlong(line, 2)) {
        if (point.distance < baseline || point.distance > total - baseline) continue;
        if (Math.hypot(point.x - EERSTE_BULT.x, point.z - EERSTE_BULT.z) < 70 || padWeightAt(point.x, point.z) > 0 || nearAnotherRoad(point, 60)) continue;
        const bend = (roadProfileAt(line, point.distance + baseline) - 2 * roadProfileAt(line, point.distance) + roadProfileAt(line, point.distance - baseline)) / (baseline * baseline);
        if (bend < 0) expect(1 / -bend, where(point)).toBeGreaterThanOrEqual(ROAD_GRADING.minCrestRadius);
      }
    }
  });

  it('builds Eerste Bult (J1) into the spine as a crest of about R 100, the radius the jump table is made for', () => {
    const baseline = 6;
    const bend = (height(EERSTE_BULT.x, EERSTE_BULT.z - baseline) - 2 * height(EERSTE_BULT.x, EERSTE_BULT.z) + height(EERSTE_BULT.x, EERSTE_BULT.z + baseline)) / (baseline * baseline);
    expect(bend).toBeLessThan(0);
    expect(1 / -bend).toBeGreaterThan(90);
    expect(1 / -bend).toBeLessThan(115);
  });
});
