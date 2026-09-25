// src/world/terrain/border.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { borderAt, borderDistance, borderFaceDepth, crestFor } from './border';
import { plainHeight } from './basePlain';
import { createHeightField } from '../noise';
import { BORDER, MAP_SIZE, VIEWPOINTS, type MapSide } from '../mapLayout';
import { CHUNK_SIZE, chunkOrigin, worldToChunk, chunksInRadius } from '../chunk';
import { generateChunkHeights } from '../heightfieldData';
import { rotationForYaw } from '../worldDef';
import { addChunkCollider } from '../../physics/physicsWorld';
import { createVehiclePhysics } from '../../../shared/vehiclePhysics';
import { stepBenchCar, type BenchCar } from '../../../shared/carBench';
import { WORLD_GRAVITY } from '../../../shared/drivetrain';
import { FULL_GRIP } from '../../../shared/terrainGrip';
import { vehicleConfigFor } from '../../vehicle/vehicleConfig';
import type { CarId } from '../../vehicle/cars';

const height = createHeightField(1);

interface SideRay {
  side: MapSide;
  /** The ground point `distance` metres inside the edge on this side, at position `along` it. */
  at(along: number, distance: number): { x: number; z: number };
  /** Heading (yaw) of a car driving straight at this side's edge. */
  outwardYaw: number;
}

const SIDES: readonly SideRay[] = [
  { side: 'north', at: (along, distance) => ({ x: along, z: distance }), outwardYaw: Math.PI },
  { side: 'south', at: (along, distance) => ({ x: along, z: MAP_SIZE - distance }), outwardYaw: 0 },
  { side: 'west', at: (along, distance) => ({ x: distance, z: along }), outwardYaw: -Math.PI / 2 },
  { side: 'east', at: (along, distance) => ({ x: MAP_SIZE - distance, z: along }), outwardYaw: Math.PI / 2 },
];

// Near a corner the neighbouring side's range stands over this one, so the per-side promises are
// read away from the corners.
const CORNER_CLEARANCE = 200;
/** The NW gorge cuts down into the west range between these positions along it (design §2). */
const GORGE_ALONG = { from: 560, to: 800 };

function alongPositions(step: number): number[] {
  const positions: number[] = [];
  for (let along = CORNER_CLEARANCE; along <= MAP_SIZE - CORNER_CLEARANCE; along += step) positions.push(along);
  return positions;
}

/** Height of the range at the map edge above the plain it stands on. */
function edgeRise(ray: SideRay, along: number): number {
  const edge = ray.at(along, 0);
  const apron = ray.at(along, BORDER.apronStart);
  return height(edge.x, edge.z) - plainHeight(apron.x, apron.z);
}

describe('the border ranges — shape promises (S1-1, AC5, AC6)', () => {
  it.each(SIDES)('never goes down along an inward ray past the face foot on the $side side (no shelf to land on)', (ray) => {
    for (const along of alongPositions(32)) {
      if (ray.side === 'west' && along >= GORGE_ALONG.from && along <= GORGE_ALONG.to) continue;
      let previous = -Infinity;
      for (let distance = 450; distance >= 0; distance -= 1) {
        const point = ray.at(along, distance);
        if (borderFaceDepth(point.x, point.z) <= 0) continue;
        const ground = height(point.x, point.z);
        expect(ground, `${ray.side} along ${along}, ${distance} m inside the edge`).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = ground;
      }
    }
  });

  it('cuts the NW gorge down into the west range: its floor is lower than the range beside it', () => {
    const gorgeRay = SIDES.find((ray) => ray.side === 'west');
    if (!gorgeRay) throw new Error('no west side');
    const inGorge = gorgeRay.at(670, 250);
    const depth = borderFaceDepth(inGorge.x, inGorge.z);
    // The same distance past the face foot, on a part of the west range with no gorge.
    const besideGorge = gorgeRay.at(1100, BORDER.faceFoot - depth);
    expect(depth).toBeGreaterThan(20);
    expect(borderFaceDepth(besideGorge.x, besideGorge.z)).toBeCloseTo(depth, 6);
    expect(height(inGorge.x, inGorge.z)).toBeLessThan(height(besideGorge.x, besideGorge.z) - 10);
  });

  it.each(SIDES.filter((ray) => ray.side !== 'north'))('keeps the $side range top inside the design band', (ray) => {
    const band = BORDER.crest[ray.side];
    for (const along of alongPositions(16)) {
      const rise = edgeRise(ray, along);
      expect(rise, `${ray.side} along ${along}`).toBeGreaterThanOrEqual(band.min);
      expect(rise, `${ray.side} along ${along}`).toBeLessThanOrEqual(band.max);
    }
  });

  it('keeps the north range top under its band, and no lower than the east and west bands', () => {
    // Replacement (S1 deviation 2): the view rule caps the north crest where it faces the dorp
    // (measured 49–67 m), so its low end is the side bands' low end, not the design's 55 m.
    for (const along of alongPositions(16)) {
      const rise = edgeRise(SIDES[0], along);
      expect(rise, `north along ${along}`).toBeGreaterThanOrEqual(BORDER.crest.west.min);
      expect(rise, `north along ${along}`).toBeLessThanOrEqual(BORDER.crest.north.max);
    }
  });

  it.each(SIDES)('lets the $side range top wander by at least 3 m, so it is never one even wall', (ray) => {
    const rises = alongPositions(8).map((along) => edgeRise(ray, along));
    const mean = rises.reduce((sum, rise) => sum + rise, 0) / rises.length;
    const deviation = Math.sqrt(rises.reduce((sum, rise) => sum + (rise - mean) ** 2, 0) / rises.length);
    expect(deviation).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(VIEWPOINTS))('keeps every part of the range within 2.5° above the eye at the %s (AC5)', (_name, viewpoint) => {
    // The HDRI mountains must show above the crest; eye height 1.5 m above the ground.
    const eye = height(viewpoint.x, viewpoint.z) + 1.5;
    let steepest = -Infinity;
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const directionX = Math.cos((degrees * Math.PI) / 180);
      const directionZ = Math.sin((degrees * Math.PI) / 180);
      for (let distance = 20; ; distance += 4) {
        const x = viewpoint.x + directionX * distance;
        const z = viewpoint.z + directionZ * distance;
        if (borderDistance(x, z) < 0) break;
        if (borderFaceDepth(x, z) <= 0) continue;
        steepest = Math.max(steepest, (Math.atan2(height(x, z) - eye, distance) * 180) / Math.PI);
      }
    }
    expect(steepest).toBeGreaterThan(0);
    expect(steepest).toBeLessThanOrEqual(2.5);
  });

  it('reports no range for a point in the middle of the valley', () => {
    expect(borderAt(MAP_SIZE / 2, MAP_SIZE / 2).surface).toBeNull();
    expect(crestFor(MAP_SIZE / 2, MAP_SIZE / 2)).toBeNull();
  });
});

describe('borderDistance — metres inside the nearest map edge', () => {
  it.each([
    ['the centre', MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE / 2],
    ['a point on the west edge', 0, 900, 0],
    ['a point near the south-east corner', MAP_SIZE - 5, MAP_SIZE - 12, 5],
    ['a point 30 m past the north edge', 800, -30, -30],
  ])('reads %s', (_name, x, z, expected) => {
    expect(borderDistance(x, z)).toBe(expected);
  });
});

describe('the border holds a car driven straight at it (AC6, real Rapier on heightfield chunks)', () => {
  const START_SPEED = 150 / 3.6;
  const SECONDS = 10;
  /** Places on each side clear of the corners, the gorge and the later dunes, pan and river. */
  const PLACES: readonly { ray: SideRay; along: number }[] = [
    { ray: SIDES[0], along: 1000 },
    { ray: SIDES[1], along: 2200 },
    { ray: SIDES[2], along: 1800 },
    { ray: SIDES[3], along: 2400 },
  ];

  beforeAll(async () => {
    await RAPIER.init();
  });

  /** Drives a car at full throttle from 150 km/h at the face, with road grip everywhere (the hardest case); returns how far past the face foot it got. */
  function driveAtBorder(carId: CarId, ray: SideRay, along: number): { deepest: number; crestDepth: number } {
    const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    world.timestep = 1 / 60;
    const start = ray.at(along, BORDER.faceFoot + 150);
    const edge = ray.at(along, 0);
    const built = new Set<string>();
    for (let distance = BORDER.faceFoot + 200; distance >= -CHUNK_SIZE; distance -= CHUNK_SIZE / 2) {
      const point = ray.at(along, distance);
      for (const chunk of chunksInRadius(worldToChunk(point.x, point.z), 1)) {
        const key = `${chunk.cx},${chunk.cz}`;
        if (built.has(key)) continue;
        built.add(key);
        const origin = chunkOrigin(chunk);
        addChunkCollider(world, generateChunkHeights(height, chunk), origin.x, origin.z);
      }
    }
    const vehicle = createVehiclePhysics(world, { x: start.x, y: height(start.x, start.z) + 1.2, z: start.z }, vehicleConfigFor(carId));
    vehicle.body.setRotation(rotationForYaw(ray.outwardYaw), true);
    const car: BenchCar = { world, vehicle, time: 0 };
    for (let step = 0; step < 30; step++) stepBenchCar(car, { throttle: 0, brake: 0, steer: 0 }, FULL_GRIP);
    const outward = { x: Math.sin(ray.outwardYaw), z: Math.cos(ray.outwardYaw) };
    vehicle.body.setLinvel({ x: outward.x * START_SPEED, y: 0, z: outward.z * START_SPEED }, true);
    let deepest = -Infinity;
    while (car.time < SECONDS) {
      stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, FULL_GRIP);
      const position = vehicle.body.translation();
      deepest = Math.max(deepest, borderFaceDepth(position.x, position.z));
    }
    const crest = crestFor(edge.x, edge.z);
    if (!crest) throw new Error('no crest at the edge');
    return { deepest, crestDepth: borderFaceDepth(crest.x, crest.z) };
  }

  it.each<CarId>(['forester', 'pajero', 'elantra'])('stops the %s on the face in all four places, well short of the crest', (carId) => {
    for (const { ray, along } of PLACES) {
      const { deepest, crestDepth } = driveAtBorder(carId, ray, along);
      // Its centre got within a car length of the face foot, so the face is what stopped it.
      expect(deepest, `${carId} at the ${ray.side} side`).toBeGreaterThan(-5);
      expect(deepest, `${carId} at the ${ray.side} side`).toBeLessThan(crestDepth / 2);
    }
  });
});
