// src/render/groundDecals.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TireTracks, type WheelContact } from './groundDecals';
import { createBiome } from '../world/biome';
import type { TerrainTextureSet } from './terrainMaterial';

const GROUND = 2;
const flatGround = (): number => GROUND;
const SAND: TerrainTextureSet = { color: new THREE.Texture(), normal: new THREE.Texture(), arm: new THREE.Texture() };
const TYRE_WIDTH = 0.25;
// Open sand far from the town, the roads and the lake.
const START = { x: 420, z: 250 };

function tracksWith(wheelCount: number): { tracks: TireTracks; ribbons: THREE.Mesh[] } {
  const scene = new THREE.Scene();
  const tracks = new TireTracks(scene, flatGround, createBiome(1), SAND, wheelCount);
  const ribbons = scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  return { tracks, ribbons };
}

/** Rut points written into a ribbon (unused slots stay at the origin). */
function writtenPoints(ribbon: THREE.Mesh): THREE.Vector3[] {
  const position = ribbon.geometry.getAttribute('position');
  const points: THREE.Vector3[] = [];
  for (let vertex = 0; vertex < position.count; vertex++) {
    const point = new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    if (point.lengthSq() > 0) points.push(point);
  }
  return points;
}

/** Each written rut segment as the centre of its start edge and of its end edge. */
function segments(ribbon: THREE.Mesh): { from: THREE.Vector3; to: THREE.Vector3 }[] {
  const position = ribbon.geometry.getAttribute('position');
  const vertex = (index: number): THREE.Vector3 => new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
  const found: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  for (let base = 0; base < position.count; base += 4) {
    if (vertex(base).lengthSq() === 0) continue;
    found.push({
      from: vertex(base).add(vertex(base + 1)).multiplyScalar(0.5),
      to: vertex(base + 2).add(vertex(base + 3)).multiplyScalar(0.5),
    });
  }
  return found;
}

/** Drives the car along +Z in 0.5 m steps, each wheel given by `contactAt`. */
function driveAlong(tracks: TireTracks, steps: number, contactAt: (wheel: number, z: number) => WheelContact | null, wheelCount: number, fromZ = START.z): void {
  for (let step = 0; step < steps; step++) {
    const z = fromZ + step * 0.5;
    tracks.update(Array.from({ length: wheelCount }, (_, wheel) => contactAt(wheel, z)), START.x, z, 0, TYRE_WIDTH);
  }
}

const onGround = (wheel: number, z: number): WheelContact => ({ x: START.x + wheel, y: GROUND, z });

describe('TireTracks — ruts only where a wheel touches the sand', () => {
  it('lays a rut on the ground under a rolling wheel', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 10, onGround, 1);
    const points = writtenPoints(ribbons[0]);
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.y).toBeGreaterThan(GROUND);
      expect(point.y).toBeLessThan(GROUND + 0.05);
      expect(Math.abs(point.x - START.x)).toBeLessThanOrEqual(TYRE_WIDTH);
    }
  });

  it('lays nothing for a wheel in the air', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 10, () => null, 1);
    expect(writtenPoints(ribbons[0])).toHaveLength(0);
  });

  it('lays nothing for a wheel rolling on something above the sand (a ramp, a rock)', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 10, (_wheel, z) => ({ x: START.x, y: GROUND + 0.5, z }), 1);
    expect(writtenPoints(ribbons[0])).toHaveLength(0);
  });

  it('still lays a rut for a wheel sunk slightly into soft ground', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 10, (_wheel, z) => ({ x: START.x, y: GROUND - 0.2, z }), 1);
    expect(writtenPoints(ribbons[0]).length).toBeGreaterThan(0);
  });

  it('keeps each wheel on its own ribbon: one wheel on the ramp leaves no rut, the others do', () => {
    const { tracks, ribbons } = tracksWith(4);
    driveAlong(tracks, 10, (wheel, z) => (wheel === 2 ? { x: START.x + wheel, y: GROUND + 1, z } : onGround(wheel, z)), 4);
    expect(writtenPoints(ribbons[0]).length).toBeGreaterThan(0);
    expect(writtenPoints(ribbons[1]).length).toBeGreaterThan(0);
    expect(writtenPoints(ribbons[2])).toHaveLength(0);
    expect(writtenPoints(ribbons[3]).length).toBeGreaterThan(0);
  });

  it('does not join a rut across a jump or a teleport', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 4, onGround, 1);
    driveAlong(tracks, 6, onGround, 1, START.z + 60);
    const written = segments(ribbons[0]);
    expect(written.some((segment) => segment.from.z > START.z + 50)).toBe(true);
    for (const segment of written) expect(segment.from.distanceTo(segment.to)).toBeLessThan(1);
  });

  it('does not join the old rut to the new spot after a reset, even a short way off', () => {
    const { tracks, ribbons } = tracksWith(1);
    driveAlong(tracks, 4, onGround, 1);
    tracks.breakChains();
    driveAlong(tracks, 4, (_wheel, z) => ({ x: START.x + 1.5, y: GROUND, z }), 1, START.z + 1.5);
    const written = segments(ribbons[0]);
    expect(written.some((segment) => segment.from.x > START.x + 1)).toBe(true);
    for (const segment of written) expect(Math.abs(segment.to.x - segment.from.x)).toBeLessThan(0.01);
  });

  it('throws when the number of wheel contacts does not match the ribbons', () => {
    const { tracks } = tracksWith(4);
    expect(() => tracks.update([null, null], START.x, START.z, 0, TYRE_WIDTH)).toThrow('expected 4 wheel contacts, got 2');
  });
});
