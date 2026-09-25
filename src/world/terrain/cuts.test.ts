// src/world/terrain/cuts.test.ts
// Category 1 (pure invariants of the built ground): the Klipspringer Poort and the Gruisgat quarry
// (plan v3 S3-1, J7, J8).
import { describe, it, expect } from 'vitest';
import {
  HEAP_LANDINGS, POORT_LENGTH, POORT_STEPS, QUARRY_FLOOR, QUARRY_FLOOR_LEVEL,
  distanceOutsideQuarryFloor, poortHalfWidthAt, poortSampleAt,
} from './cuts';
import { TRACK_LINES, type TrackLine } from './tracks';
import { createHeightField } from '../noise';
import { nearestOnPolyline } from '../polyline';
import { GRUISGAT, KLIPSPRINGER_POORT, type CompassDirection } from '../mapLayout';

const height = createHeightField(1);

function trackPointAt(line: TrackLine, distance: number): { x: number; z: number; tangentX: number; tangentZ: number } {
  let segment = 0;
  while (segment < line.along.length - 2 && line.along[segment + 1] < distance) segment++;
  const start = line.points[segment];
  const end = line.points[segment + 1];
  const length = line.along[segment + 1] - line.along[segment];
  const share = (distance - line.along[segment]) / length;
  return { x: start.x + (end.x - start.x) * share, z: start.z + (end.z - start.z) * share, tangentX: (end.x - start.x) / length, tangentZ: (end.z - start.z) / length };
}

function alongTrack(line: TrackLine, point: { x: number; z: number }): number {
  const hit = nearestOnPolyline(line.points, line.points.slice(0, -1).map((_point, index) => index), point.x, point.z);
  if (!hit) throw new Error(`no point of ${line.name} near (${point.x}, ${point.z})`);
  return line.along[hit.segmentIndex] + hit.t * (line.along[hit.segmentIndex + 1] - line.along[hit.segmentIndex]);
}

const POORT_TRACK = TRACK_LINES.find((line) => line.name === 'Klipspringer Poort');
if (!POORT_TRACK) throw new Error('the poort track is missing');
const poortTrack: TrackLine = POORT_TRACK;
const groundAlong = (distance: number): number => {
  const point = trackPointAt(poortTrack, distance);
  return height(point.x, point.z);
};

describe('the Klipspringer Poort — a canyon through the dolerite ridge (S3-1)', () => {
  it('is 12 ± 1 m wide on the built ground where it is tightest', () => {
    let tightest = 0;
    let narrowest = Infinity;
    for (let along = 0; along <= POORT_LENGTH; along += 1) {
      const width = 2 * poortHalfWidthAt(along);
      if (width < narrowest) {
        narrowest = width;
        tightest = along;
      }
    }
    // The track point nearest that spot of the canyon, on its centre line.
    let centre: ReturnType<typeof trackPointAt> | null = null;
    let error = Infinity;
    for (let distance = 0; distance <= poortTrack.along[poortTrack.along.length - 1]; distance += 0.5) {
      const point = trackPointAt(poortTrack, distance);
      const sample = poortSampleAt(point.x, point.z);
      if (sample && sample.distance < 1 && Math.abs(sample.along - tightest) < error) {
        error = Math.abs(sample.along - tightest);
        centre = point;
      }
    }
    if (!centre) throw new Error('the canyon has no centre point');
    const floor = height(centre.x, centre.z);
    const acrossX = -centre.tangentZ;
    const acrossZ = centre.tangentX;
    const wallAt = (side: number): number => {
      for (let out = 0; out < 30; out += 0.1) if (height(centre.x + side * acrossX * out, centre.z + side * acrossZ * out) > floor + 0.3) return out;
      return Infinity;
    };
    const width = wallAt(1) + wallAt(-1);
    expect(width).toBeGreaterThanOrEqual(KLIPSPRINGER_POORT.width.narrowest - 1);
    expect(width).toBeLessThanOrEqual(KLIPSPRINGER_POORT.width.narrowest + 1);
  });

  it('drops the floor down three rock steps of 0.5–0.8 m going south, each higher than the one before (J8)', () => {
    const drops = POORT_STEPS.map((step) => {
      const at = alongTrack(poortTrack, step.point);
      // The step's drop over 6 m, minus the drop of the plain floor over the 6 m before it.
      return (groundAlong(at - 3) - groundAlong(at + 3)) - (groundAlong(at - 9) - groundAlong(at - 3));
    });
    for (const drop of drops) {
      expect(drop).toBeGreaterThanOrEqual(0.5 - 0.02);
      expect(drop).toBeLessThanOrEqual(0.8 + 0.02);
    }
    expect(drops[1]).toBeGreaterThan(drops[0]);
    expect(drops[2]).toBeGreaterThan(drops[1]);
  });
});

// A 1 m grid over the pit and its rim; a cell is passable when its slope is at most 0.3.
const QUARRY_GRID = (() => {
  const minX = GRUISGAT.x - 110;
  const minZ = GRUISGAT.z - 90;
  const width = 221;
  const depth = 181;
  const heights = new Float64Array(width * depth);
  for (let row = 0; row < depth; row++) for (let column = 0; column < width; column++) heights[row * width + column] = height(minX + column, minZ + row);
  return { minX, minZ, width, depth, heights };
})();

/** Groups of rim cells a car reaches from the pit floor without passing a slope over `limit`. */
function quarryExits(limit: number): { x: number; z: number }[][] {
  const { minX, minZ, width, depth, heights } = QUARRY_GRID;
  const rimReach = GRUISGAT.wallWidth;
  const slopeAt = (cell: number): number =>
    Math.hypot(heights[cell + 1] - heights[cell - 1], heights[cell + width] - heights[cell - width]) / 2;
  const seen = new Uint8Array(width * depth);
  const start = (GRUISGAT.z - minZ) * width + (GRUISGAT.x - minX);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const cell = queue.pop() ?? start;
    const column = cell % width;
    const row = (cell - column) / width;
    for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextColumn = column + stepColumn;
      const nextRow = row + stepRow;
      if (nextColumn < 1 || nextRow < 1 || nextColumn >= width - 1 || nextRow >= depth - 1) continue;
      const next = nextRow * width + nextColumn;
      if (seen[next] || slopeAt(next) > limit) continue;
      if (distanceOutsideQuarryFloor(minX + nextColumn, minZ + nextRow) > rimReach + 1) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  const rimCells: { x: number; z: number }[] = [];
  for (let row = 0; row < depth; row++) {
    for (let column = 0; column < width; column++) {
      if (!seen[row * width + column]) continue;
      const outside = distanceOutsideQuarryFloor(minX + column, minZ + row);
      if (outside >= rimReach && outside <= rimReach + 1) rimCells.push({ x: minX + column, z: minZ + row });
    }
  }
  const groups: { x: number; z: number }[][] = [];
  for (const cell of rimCells) {
    const group = groups.find((members) => members.some((member) => Math.hypot(member.x - cell.x, member.z - cell.z) < 4));
    if (group) group.push(cell);
    else groups.push([cell]);
  }
  return groups;
}

const LAUNCH: Readonly<Record<CompassDirection, { x: number; z: number }>> = {
  north: { x: 0, z: -1 }, east: { x: 1, z: 0 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 },
};

describe('the Gruisgat — the quarry stunt park (S3-1, J7)', () => {
  it('has exactly two ways out of the pit no steeper than 0.3, at its two ramps; its walls hold everywhere else', () => {
    const exits = quarryExits(0.3);
    expect(exits).toHaveLength(2);
    const sides = exits.map((cells) => {
      const meanX = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
      return meanX < GRUISGAT.x ? 'west' : 'east';
    });
    expect(sides.sort()).toEqual(['east', 'west']);
  });

  it('lays a flat floor at the pit depth below the plain', () => {
    const centre = height(GRUISGAT.x, (QUARRY_FLOOR.minZ + QUARRY_FLOOR.maxZ) / 2 + 20);
    expect(Math.abs(centre - QUARRY_FLOOR_LEVEL)).toBeLessThan(0.05);
  });

  it.each(HEAP_LANDINGS.map((landing) => [landing.heap.height, landing] as const))('gives the %s m heap at least 55 m of flat floor straight ahead of its lip', (_height, landing) => {
    const direction = LAUNCH[landing.heap.launch];
    let flatFrom = -1;
    let flatLength = 0;
    for (let ahead = 0; ahead < 200; ahead += 0.5) {
      const ground = height(landing.heap.lip.x + direction.x * ahead, landing.heap.lip.z + direction.z * ahead);
      const flat = Math.abs(ground - QUARRY_FLOOR_LEVEL) < 0.05;
      if (flat && flatFrom < 0) flatFrom = ahead;
      if (flatFrom >= 0 && !flat) {
        flatLength = ahead - flatFrom;
        break;
      }
    }
    expect(flatLength).toBeGreaterThanOrEqual(GRUISGAT.minLanding);
  });
});
