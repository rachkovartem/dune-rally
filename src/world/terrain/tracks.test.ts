// src/world/terrain/tracks.test.ts
// Category 1 (pure invariants of the built ground): the rock tracks (plan v3 S3-1).
import { describe, it, expect } from 'vitest';
import { TRACK_LINES, nearestTrack, type TrackLine } from './tracks';
import { createHeightField } from '../noise';
import { nearestOnPolyline } from '../polyline';
import { ROUTES } from '../mapLayout';

const height = createHeightField(1);

function trackNamed(name: string): TrackLine {
  const line = TRACK_LINES.find((candidate) => candidate.name === name);
  if (!line) throw new Error(`the track "${name}" is missing`);
  return line;
}

function groundAlong(line: TrackLine, distance: number): number {
  let segment = 0;
  while (segment < line.along.length - 2 && line.along[segment + 1] < distance) segment++;
  const start = line.points[segment];
  const end = line.points[segment + 1];
  const share = (distance - line.along[segment]) / (line.along[segment + 1] - line.along[segment]);
  return height(start.x + (end.x - start.x) * share, start.z + (end.z - start.z) * share);
}

function alongOf(line: TrackLine, point: { x: number; z: number }): number {
  const hit = nearestOnPolyline(line.points, line.points.slice(0, -1).map((_point, index) => index), point.x, point.z);
  if (!hit) throw new Error(`no point of ${line.name} near (${point.x}, ${point.z})`);
  return line.along[hit.segmentIndex] + hit.t * (line.along[hit.segmentIndex + 1] - line.along[hit.segmentIndex]);
}

const lengthOf = (line: TrackLine): number => line.along[line.along.length - 1];

describe('the Koppie Klim — rock and gravel up to the saddle (S3-1)', () => {
  const klim = trackNamed('Koppie Klim');

  it('is no steeper than 0.35 anywhere along its line over the length of a car (4 m), rock steps included', () => {
    for (let distance = 4; distance <= lengthOf(klim); distance += 0.5) {
      expect(Math.abs(groundAlong(klim, distance) - groundAlong(klim, distance - 4)) / 4, `${distance} m along`).toBeLessThanOrEqual(0.35);
    }
  });

  it('has rock steps, and none of them stands more than 0.8 m above the grade around it', () => {
    expect(klim.stepsAt.length).toBeGreaterThan(0);
    for (const at of klim.stepsAt) {
      const step = (groundAlong(klim, at + 2) - groundAlong(klim, at - 2)) - (groundAlong(klim, at - 2) - groundAlong(klim, at - 6));
      expect(Math.abs(step), `step at ${at.toFixed(0)} m`).toBeLessThanOrEqual(0.8);
      expect(Math.abs(step), `step at ${at.toFixed(0)} m`).toBeGreaterThan(0.1);
    }
  });
});

describe('the Tafelkop Pas — hairpins up the talus (S3-1)', () => {
  const pas = trackNamed('Tafelkop Pas');
  const route = ROUTES.find((candidate) => candidate.name === 'Tafelkop Pas');
  if (!route) throw new Error('the Tafelkop Pas route is missing');
  const grading = pas.grading;

  it('climbs at 10–15 % over every 10 m of its steady climb, and gains more than 35 m', () => {
    if (!grading.steadyClimb) throw new Error('the Pas has no steady climb');
    const from = alongOf(pas, route.points[grading.steadyClimb.from]);
    const to = alongOf(pas, route.points[grading.steadyClimb.to]);
    for (let distance = from; distance + 10 <= to; distance += 10) {
      const grade = (groundAlong(pas, distance + 10) - groundAlong(pas, distance)) / 10;
      expect(grade, `${distance.toFixed(0)} m along`).toBeGreaterThanOrEqual(0.1);
      expect(grade, `${distance.toFixed(0)} m along`).toBeLessThanOrEqual(0.15);
    }
    expect(groundAlong(pas, to) - groundAlong(pas, from)).toBeGreaterThan(35);
  });

  it('widens its running surface to at least 12 m at each of its three hairpins', () => {
    expect(grading.hairpins).toHaveLength(3);
    for (const waypoint of grading.hairpins) {
      const hit = nearestTrack(route.points[waypoint].x, route.points[waypoint].z, 0);
      expect(hit?.line.name).toBe('Tafelkop Pas');
      expect(2 * (hit?.halfWidth ?? 0)).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('nearestTrack — which track a point is on', () => {
  it('finds no track on the open plain', () => {
    expect(nearestTrack(1300, 1600, 2)).toBeNull();
  });

  it('finds the Koppie Klim on its own centre line, with the point inside its running surface', () => {
    const klim = trackNamed('Koppie Klim');
    const middle = klim.points[Math.floor(klim.points.length / 2)];
    const hit = nearestTrack(middle.x, middle.z, 0);
    expect(hit?.line.name).toBe('Koppie Klim');
    expect(hit?.distance ?? Infinity).toBeLessThanOrEqual(hit?.halfWidth ?? 0);
  });
});
