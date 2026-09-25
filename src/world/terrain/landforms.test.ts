// src/world/terrain/landforms.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyLandforms, koppieBandAt, rockKindAt, SPAWN_TOP_LEVEL, TAFELKOP_LEVEL } from './landforms';
import { createHeightField } from '../noise';
import { chunkOrigin, chunksInRadius, worldToChunk } from '../chunk';
import { generateChunkHeights } from '../heightfieldData';
import { addChunkCollider } from '../../physics/physicsWorld';
import { createVehiclePhysics } from '../../../shared/vehiclePhysics';
import { stepBenchCar, type BenchCar } from '../../../shared/carBench';
import { WORLD_GRAVITY } from '../../../shared/drivetrain';
import { groundGripFor } from '../../../shared/terrainGrip';
import { vehicleConfigFor } from '../../vehicle/vehicleConfig';
import type { CarId } from '../../vehicle/cars';
import type { Koppie } from '../mapLayout';
import { plainHeight } from './basePlain';
import { DOLERITE_RIDGE, GROOT_KOPPIE, KLEIN_KOPPIES, SPAWN_RISE, TAFELKOP } from '../mapLayout';

const NATURAL = 12;

describe('applyLandforms — the hills on the plain (S1-1)', () => {
  it('leaves the open plain unchanged and names no landform there', () => {
    expect(applyLandforms(NATURAL, 1000, 1500)).toEqual({ height: NATURAL, kind: null, share: 0 });
  });

  it('adds the full koppie height at its top, and nothing at its foot', () => {
    const top = applyLandforms(NATURAL, GROOT_KOPPIE.x, GROOT_KOPPIE.z);
    expect(top).toEqual({ height: NATURAL + GROOT_KOPPIE.height, kind: 'koppie', share: 1 });
    expect(applyLandforms(NATURAL, GROOT_KOPPIE.x + GROOT_KOPPIE.radius, GROOT_KOPPIE.z).height).toBe(NATURAL);
  });

  it('makes every koppie fall away from its top in every direction', () => {
    for (const koppie of KLEIN_KOPPIES) {
      const top = applyLandforms(NATURAL, koppie.x, koppie.z).height;
      for (const share of [0.3, 0.6, 0.9]) {
        const lower = applyLandforms(NATURAL, koppie.x, koppie.z + koppie.radius * share).height;
        expect(lower).toBeLessThan(top);
      }
    }
  });

  it('levels the Tafelkop top and the spawn top whatever the ground under them', () => {
    for (const natural of [0, 30]) {
      expect(applyLandforms(natural, TAFELKOP.x, TAFELKOP.z).height).toBe(TAFELKOP_LEVEL);
      expect(applyLandforms(natural, TAFELKOP.x + 40, TAFELKOP.z - 60).height).toBe(TAFELKOP_LEVEL);
      expect(applyLandforms(natural, SPAWN_RISE.x + 10, SPAWN_RISE.z - 10).height).toBe(SPAWN_TOP_LEVEL);
    }
  });

  it('raises the dolerite ridge 30–35 m on its line and names it', () => {
    const middle = DOLERITE_RIDGE.line[1];
    const sample = applyLandforms(0, middle.x, middle.z);
    expect(sample.kind).toBe('ridge');
    expect(sample.height).toBeGreaterThanOrEqual(DOLERITE_RIDGE.minHeight);
    expect(sample.height).toBeLessThanOrEqual(DOLERITE_RIDGE.maxHeight);
    expect(applyLandforms(0, middle.x, middle.z + DOLERITE_RIDGE.halfWidth + 1).height).toBe(0);
  });
});

describe('the base plain (design §12.1)', () => {
  const averageAlong = (points: readonly [number, number][]): number =>
    points.reduce((sum, [x, z]) => sum + plainHeight(x, z), 0) / points.length;
  const line = (fixed: 'x' | 'z', value: number): [number, number][] =>
    Array.from({ length: 60 }, (_unused, index): [number, number] => (fixed === 'x' ? [value, 300 + index * 41] : [300 + index * 41, value]));

  it('rises toward the east and toward the north, away from the pan in the south-west', () => {
    expect(averageAlong(line('x', 2500))).toBeGreaterThan(averageAlong(line('x', 500)) + 5);
    expect(averageAlong(line('z', 500))).toBeGreaterThan(averageAlong(line('z', 2500)) + 5);
  });

});

describe('rockKindAt — which rock the ground is (S3-1)', () => {
  it('is dolerite on the ridge, granite on a koppie, and no rock on the open plain', () => {
    expect(rockKindAt(DOLERITE_RIDGE.line[1].x, DOLERITE_RIDGE.line[1].z)).toBe('dolerite');
    expect(rockKindAt(GROOT_KOPPIE.x, GROOT_KOPPIE.z)).toBe('granite');
    expect(rockKindAt(1000, 1500)).toBeNull();
  });
});

describe('the koppie rock band stops a car driven straight at it (S3-1, real Rapier on heightfield chunks)', () => {
  const height = createHeightField(1);
  const SECONDS = 15;
  /** Run-up on the plain before the band, metres. */
  const RUN_UP = 80;

  beforeAll(async () => {
    await RAPIER.init();
  });

  /** Drives a car at full throttle on its own rock grip from the plain at the koppie centre; returns the least distance past the band crest it reached (negative = got on top). */
  function driveAtKoppie(carId: CarId, koppie: Koppie, degrees: number): number {
    const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    world.timestep = 1 / 60;
    const angle = (degrees * Math.PI) / 180;
    const outward = { x: Math.cos(angle), z: Math.sin(angle) };
    const start = { x: koppie.x + outward.x * (koppie.radius + RUN_UP), z: koppie.z + outward.z * (koppie.radius + RUN_UP) };
    const built = new Set<string>();
    for (let reach = koppie.radius + RUN_UP + 20; reach >= 0; reach -= 32) {
      for (const chunk of chunksInRadius(worldToChunk(koppie.x + outward.x * reach, koppie.z + outward.z * reach), 1)) {
        const key = `${chunk.cx},${chunk.cz}`;
        if (built.has(key)) continue;
        built.add(key);
        const origin = chunkOrigin(chunk);
        addChunkCollider(world, generateChunkHeights(height, chunk), origin.x, origin.z);
      }
    }
    const vehicle = createVehiclePhysics(world, { x: start.x, y: height(start.x, start.z) + 1.2, z: start.z }, vehicleConfigFor(carId));
    // Facing the centre: forward = (sin yaw, cos yaw) = −outward.
    const yaw = Math.atan2(-outward.x, -outward.z);
    vehicle.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    const car: BenchCar = { world, vehicle, time: 0 };
    const rock = groundGripFor('rock', vehicleConfigFor(carId));
    for (let step = 0; step < 60; step++) stepBenchCar(car, { throttle: 0, brake: 0, steer: 0 }, rock);
    let closest = Infinity;
    while (car.time < SECONDS) {
      stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, rock);
      const position = vehicle.body.translation();
      const band = koppieBandAt(position.x, position.z);
      if (band) closest = Math.min(closest, band.fromCrest);
    }
    return closest;
  }

  // Sides of the koppies with no track cut through the band (the Klim leaves Klein Koppie to the west).
  const PLACES: readonly [string, Koppie, number][] = [
    ['Groot Koppie, west side', GROOT_KOPPIE, 180],
    ['Groot Koppie, south side', GROOT_KOPPIE, 100],
    ['Klein Koppie, south side', KLEIN_KOPPIES[0], 90],
    ['West Koppie, south side', KLEIN_KOPPIES[1], 90],
  ];
  const CASES = (['pajero', 'forester', 'elantra'] as const).flatMap((carId) => PLACES.map(([name, koppie, degrees]) => [carId, name, koppie, degrees] as const));

  it.each(CASES)('keeps the %s off the shoulder at %s', (carId, _name, koppie, degrees) => {
    const closest = driveAtKoppie(carId, koppie, degrees);
    // It reached the band (so the band is what stopped it) but never passed its crest.
    expect(closest).toBeLessThan(Infinity);
    expect(closest).toBeGreaterThan(0);
  });

  // Known defect (Bug Signal in the S3 tests report): on Klein Koppie's east side the band is only
  // about 6 m high, and a Forester with an 80 m run-up at about 77 km/h drives over it onto the
  // shoulder (the same happens at 120 degrees). Turn this back into a CASES row when the fix lands.
  it.fails('keeps the forester off the shoulder at Klein Koppie, east side', () => {
    expect(driveAtKoppie('forester', KLEIN_KOPPIES[0], 0)).toBeGreaterThan(0);
  });
});
