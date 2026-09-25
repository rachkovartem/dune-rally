// server/arenaSim.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ArenaSim, lowestFreeSlot, POSE_SNAP_ANGLE, POSE_SNAP_DISTANCE, releasedInput, SIM_STEP_SECONDS, type PlayerTransform,
} from './arenaSim';
import { forwardAxisOf, RESET_LIFT, upAxisOf } from '../shared/vehiclePhysics';
import { INPUT_TIMEOUT_SECONDS, type InputMsg, type PoseMsg } from '../shared/protocol';
import { SPAWN_SLOT_COUNT, spawnPoseFor } from '../src/world/worldDef';
import { borderFaceDepth } from '../src/world/terrain/border';
import { createHeightField } from '../src/world/noise';
import { terrainSurfaceHeight } from '../src/world/chunkGeometry';
import { createBiome } from '../src/world/biome';
import { propPlacementsInChunk, type PropPlacement } from '../src/world/propPlacement';
import { propColliderBox } from '../src/world/propColliders';

const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };
const HEIGHT = createHeightField(123);

function stepFor(sim: ArenaSim, id: string, input: InputMsg, steps: number): void {
  for (let step = 0; step < steps; step++) {
    sim.setInput(id, input);
    sim.step();
  }
}

function transformOf(sim: ArenaSim, id: string): PlayerTransform {
  const transform = sim.transform(id);
  if (!transform) throw new Error(`no transform for ${id}`);
  return transform;
}

describe('ArenaSim', () => {
  let sim: ArenaSim;
  beforeEach(async () => {
    sim = await ArenaSim.create(123);
  });

  it('spawns a player that rests on terrain and drives under throttle', () => {
    sim.addPlayer('driver', 'forester', 0);
    stepFor(sim, 'driver', IDLE, 120);
    const rest = transformOf(sim, 'driver');
    // Replacement (S0-2): the spawn ground is built in create(), so the car stands on it, not in a fall.
    const ground = terrainSurfaceHeight(HEIGHT, rest.x, rest.z);
    expect(rest.y - ground).toBeGreaterThan(0);
    expect(rest.y - ground).toBeLessThan(2);
    stepFor(sim, 'driver', IDLE, 30);
    expect(Math.abs(transformOf(sim, 'driver').y - rest.y)).toBeLessThan(0.01);

    stepFor(sim, 'driver', { throttle: 1, brake: 0, steer: 0 }, 180);
    const moved = transformOf(sim, 'driver');
    expect(Math.hypot(moved.x - rest.x, moved.z - rest.z)).toBeGreaterThan(1);
  });

  it('tracks and drops players', () => {
    sim.addPlayer('a', 'forester', 0);
    sim.addPlayer('b', 'pajero', 1);
    expect(sim.playerIds()).toEqual(expect.arrayContaining(['a', 'b']));
    sim.removePlayer('a');
    expect(sim.playerIds()).not.toContain('a');
    expect(sim.playerIds()).toContain('b');
    expect(sim.transform('a')).toBeUndefined();
    expect(sim.carIdOf('a')).toBeUndefined();
  });

  it('remembers the car each player joined with (R125)', () => {
    sim.addPlayer('forester-player', 'forester', 0);
    sim.addPlayer('pajero-player', 'pajero', 1);
    expect(sim.carIdOf('forester-player')).toBe('forester');
    expect(sim.carIdOf('pajero-player')).toBe('pajero');
  });

  it('swaps a player\'s car in place: same pose, new car id (R126)', () => {
    sim.addPlayer('swapper', 'forester', 0);
    stepFor(sim, 'swapper', IDLE, 90);
    const before = transformOf(sim, 'swapper');

    sim.setPlayerCar('swapper', 'pajero');

    const after = transformOf(sim, 'swapper');
    expect(sim.carIdOf('swapper')).toBe('pajero');
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-4);
    expect(Math.abs(after.qx * before.qx + after.qy * before.qy + after.qz * before.qz + after.qw * before.qw)).toBeCloseTo(1, 6);
  });

  it('keeps the swapped car driveable, and keeps no second copy of the player (R126, R127)', () => {
    sim.addPlayer('swap-and-drive', 'pajero', 0);
    stepFor(sim, 'swap-and-drive', IDLE, 60);
    sim.setPlayerCar('swap-and-drive', 'forester');
    stepFor(sim, 'swap-and-drive', IDLE, 60);
    const rest = transformOf(sim, 'swap-and-drive');
    stepFor(sim, 'swap-and-drive', { throttle: 1, brake: 0, steer: 0 }, 120);
    const moved = transformOf(sim, 'swap-and-drive');
    expect(Math.hypot(moved.x - rest.x, moved.z - rest.z)).toBeGreaterThan(1);
    expect(sim.playerIds().filter((id) => id === 'swap-and-drive')).toHaveLength(1);

    sim.removePlayer('swap-and-drive');
    expect(sim.transform('swap-and-drive')).toBeUndefined();
    expect(sim.carIdOf('swap-and-drive')).toBeUndefined();
  });

  it('leaves the pose untouched when the player picks the car they already drive', () => {
    sim.addPlayer('same-car', 'pajero', 0);
    stepFor(sim, 'same-car', IDLE, 30);
    const before = transformOf(sim, 'same-car');
    sim.setPlayerCar('same-car', 'pajero');
    expect(transformOf(sim, 'same-car')).toEqual(before);
  });

  it('ignores a car swap and a reset for a player that is not in the arena', () => {
    const playersBefore = sim.playerIds();
    sim.setPlayerCar('ghost', 'pajero');
    sim.resetPlayer('ghost');
    expect(sim.playerIds()).toEqual(playersBefore);
    expect(sim.carIdOf('ghost')).toBeUndefined();
  });

  it('resets a player the same way the client R does: lifted, upright, standing still', () => {
    sim.addPlayer('resetter', 'forester', 0);
    stepFor(sim, 'resetter', IDLE, 60);
    stepFor(sim, 'resetter', { throttle: 1, brake: 0, steer: 1 }, 90);
    const before = transformOf(sim, 'resetter');

    sim.resetPlayer('resetter');

    const after = transformOf(sim, 'resetter');
    expect(after.y - before.y).toBeCloseTo(RESET_LIFT, 5);
    expect(upAxisOf({ x: after.qx, y: after.qy, z: after.qz, w: after.qw }).y).toBeCloseTo(1, 6);
    stepFor(sim, 'resetter', IDLE, 1);
    const oneStepLater = transformOf(sim, 'resetter');
    expect(Math.hypot(oneStepLater.x - after.x, oneStepLater.z - after.z)).toBeLessThan(0.01);
  });
});

function poseFrom(transform: PlayerTransform, change: Partial<PoseMsg> = {}): PoseMsg {
  return { x: transform.x, y: transform.y, z: transform.z, qx: transform.qx, qy: transform.qy, qz: transform.qz, qw: transform.qw, vx: 0, vy: 0, vz: 0, ...change };
}

/** The upright rotation of a car that faces `degrees` away from its current yaw. */
function turnedBy(transform: PlayerTransform, degrees: number): Pick<PoseMsg, 'qx' | 'qy' | 'qz' | 'qw'> {
  const half = (degrees * Math.PI) / 360;
  const turn = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
  const { qx, qy, qz, qw } = transform;
  return {
    qx: turn.w * qx + turn.x * qw + turn.y * qz - turn.z * qy,
    qy: turn.w * qy - turn.x * qz + turn.y * qw + turn.z * qx,
    qz: turn.w * qz + turn.x * qy - turn.y * qx + turn.z * qw,
    qw: turn.w * qw - turn.x * qx - turn.y * qy - turn.z * qz,
  };
}

describe('lowestFreeSlot (S1-2)', () => {
  it('gives slot 0 to the first player', () => {
    expect(lowestFreeSlot(new Set(), SPAWN_SLOT_COUNT)).toBe(0);
  });

  it('fills the lowest gap left by a player who went away', () => {
    expect(lowestFreeSlot(new Set([0, 1, 3]), SPAWN_SLOT_COUNT)).toBe(2);
  });

  it('still gives a slot in range when every slot is taken', () => {
    const everySlot = new Set(Array.from({ length: SPAWN_SLOT_COUNT }, (_unused, slot) => slot));
    const slot = lowestFreeSlot(everySlot, SPAWN_SLOT_COUNT);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(SPAWN_SLOT_COUNT);
  });

  it('throws for a room with no slots', () => {
    expect(() => lowestFreeSlot(new Set(), 0)).toThrow('bad slot count');
  });
});

describe('ArenaSim — spawn slots, streaming and the border net (S0-2, S1-2)', () => {
  let sim: ArenaSim;
  beforeEach(async () => {
    sim = await ArenaSim.create(123);
  });

  it('starts two players in different slots, both facing north', () => {
    const first = sim.nextFreeSpawnSlot();
    sim.addPlayer('first', 'forester', first);
    const second = sim.nextFreeSpawnSlot();
    sim.addPlayer('second', 'pajero', second);

    expect(second).not.toBe(first);
    const a = transformOf(sim, 'first');
    const b = transformOf(sim, 'second');
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4);
    for (const transform of [a, b]) {
      expect(forwardAxisOf({ x: transform.qx, y: transform.qy, z: transform.qz, w: transform.qw }).z).toBeLessThan(-0.99);
    }
    expect(a.x).toBeCloseTo(spawnPoseFor(first).x, 3);
    expect(a.z).toBeCloseTo(spawnPoseFor(first).z, 3);
  });

  it('gives a freed slot to the next player who joins', () => {
    sim.addPlayer('a', 'forester', sim.nextFreeSpawnSlot());
    sim.addPlayer('b', 'forester', sim.nextFreeSpawnSlot());
    const slotOfA = sim.spawnSlotOf('a');
    sim.removePlayer('a');
    expect(sim.nextFreeSpawnSlot()).toBe(slotOfA);
  });

  it('builds the ground around the spawn before anyone joins', () => {
    expect(sim.builtChunkCount()).toBeGreaterThanOrEqual(9);
  });

  it('keeps a car on solid ground after it is moved 1 km away from the built area', () => {
    sim.addPlayer('traveller', 'forester', 0);
    const builtBefore = sim.builtChunkCount();
    const start = spawnPoseFor(0);
    sim.teleportPlayer('traveller', start.x, start.z - 1000, 1, { vx: 0, vz: 0 });

    stepFor(sim, 'traveller', IDLE, 120);

    const after = transformOf(sim, 'traveller');
    expect(sim.builtChunkCount()).toBeGreaterThan(builtBefore);
    expect(after.y).toBeGreaterThan(terrainSurfaceHeight(HEIGHT, after.x, after.z) - 0.5);
  });

  it('puts a car that got above the border crest back in the valley within one step', () => {
    sim.addPlayer('climber', 'forester', 0);
    // 20 m inside the north edge: far past the face foot, higher than the crest.
    sim.teleportPlayer('climber', 1500, 20, 5, { vx: 0, vz: 0 });
    expect(borderFaceDepth(1500, 20)).toBeGreaterThan(40);

    sim.step();

    const after = transformOf(sim, 'climber');
    expect(borderFaceDepth(after.x, after.z)).toBeLessThan(0);
    expect(upAxisOf({ x: after.qx, y: after.qy, z: after.qz, w: after.qw }).y).toBeGreaterThan(0.99);
  });

  it('leaves a car alone that drives on the open plain', () => {
    sim.addPlayer('plain', 'forester', 0);
    stepFor(sim, 'plain', IDLE, 30);
    const before = transformOf(sim, 'plain');
    sim.step();
    const after = transformOf(sim, 'plain');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);
  });
});

describe('ArenaSim.applyClientPose — the driver corrects the server copy (S1-X)', () => {
  let sim: ArenaSim;
  let rest: PlayerTransform;
  beforeEach(async () => {
    sim = await ArenaSim.create(123);
    sim.addPlayer('driver', 'forester', 0);
    stepFor(sim, 'driver', IDLE, 60);
    rest = transformOf(sim, 'driver');
  });

  it('keeps its own physics when the client is just under the distance limit', () => {
    const moved = sim.applyClientPose('driver', poseFrom(rest, { x: rest.x + POSE_SNAP_DISTANCE - 0.01 }));
    expect(moved).toBe(false);
    expect(transformOf(sim, 'driver')).toEqual(rest);
  });

  it('moves to the client pose when it is just over the distance limit', () => {
    const target = poseFrom(rest, { x: rest.x + POSE_SNAP_DISTANCE + 0.01 });
    expect(sim.applyClientPose('driver', target)).toBe(true);
    expect(transformOf(sim, 'driver').x).toBeCloseTo(target.x, 3);
  });

  it('snaps a copy that is 3 m off and leaves one that is 1 m off', () => {
    expect(sim.applyClientPose('driver', poseFrom(rest, { z: rest.z + 1 }))).toBe(false);
    expect(transformOf(sim, 'driver').z).toBeCloseTo(rest.z, 6);
    expect(sim.applyClientPose('driver', poseFrom(rest, { z: rest.z + 3 }))).toBe(true);
    expect(transformOf(sim, 'driver').z).toBeCloseTo(rest.z + 3, 3);
  });

  it('keeps its heading when the client is turned just under the angle limit', () => {
    const limitDegrees = (POSE_SNAP_ANGLE * 180) / Math.PI;
    expect(sim.applyClientPose('driver', poseFrom(rest, turnedBy(rest, limitDegrees - 1)))).toBe(false);
    expect(transformOf(sim, 'driver')).toEqual(rest);
  });

  it('takes the client heading when it is turned just over the angle limit', () => {
    const limitDegrees = (POSE_SNAP_ANGLE * 180) / Math.PI;
    const target = poseFrom(rest, turnedBy(rest, limitDegrees + 1));
    expect(sim.applyClientPose('driver', target)).toBe(true);
    const after = transformOf(sim, 'driver');
    const dot = Math.abs(after.qx * target.qx + after.qy * target.qy + after.qz * target.qz + after.qw * target.qw);
    expect(dot).toBeCloseTo(1, 5);
  });

  it('ignores a pose for a player that is not in the arena', () => {
    expect(sim.applyClientPose('ghost', poseFrom(rest, { x: rest.x + 50 }))).toBe(false);
    expect(transformOf(sim, 'driver')).toEqual(rest);
  });
});

describe('ArenaSim.applyClientPose — the surface state comes with a snap (SH-5)', () => {
  const DUG_IN = { spin: 0, sink: [0.2, 0.2, 0.2, 0.2], digDirection: [1, 1, 1, 1] as (1 | -1)[] };

  async function snappedHeight(surface: PoseMsg['surface']): Promise<number> {
    const sim = await ArenaSim.create(123);
    sim.addPlayer('driver', 'forester', 0);
    stepFor(sim, 'driver', IDLE, 90);
    const rest = transformOf(sim, 'driver');
    const pose = poseFrom(rest, { x: rest.x + 3 });
    expect(sim.applyClientPose('driver', surface ? { ...pose, surface } : pose)).toBe(true);
    stepFor(sim, 'driver', IDLE, 6);
    return transformOf(sim, 'driver').y;
  }

  it('sits a copy snapped with the driver\'s dug-in wheels lower than one snapped without them', async () => {
    // Regression: without the copied state the server copy is not dug in where the driver's car is.
    const plain = await snappedHeight(undefined);
    const dugIn = await snappedHeight(DUG_IN);
    expect(dugIn).toBeLessThan(plain - 0.03);
  });

  it('leaves the surface state alone when the copy does not snap', async () => {
    const sim = await ArenaSim.create(123);
    sim.addPlayer('driver', 'forester', 0);
    stepFor(sim, 'driver', IDLE, 90);
    const rest = transformOf(sim, 'driver');
    expect(sim.applyClientPose('driver', { ...poseFrom(rest, { x: rest.x + 1 }), surface: DUG_IN })).toBe(false);
    stepFor(sim, 'driver', IDLE, 6);
    expect(transformOf(sim, 'driver').y).toBeCloseTo(rest.y, 2);
  });
});

describe('ArenaSim — the server sees the shared boulders (S3-2)', () => {
  const height = createHeightField(123);
  const biome = createBiome(123);

  /** A big solid boulder on the open plain with 45 m of flat, free ground to its south. */
  function openPlainBoulder(): PropPlacement {
    const placements: PropPlacement[] = [];
    for (let cx = 17; cx < 23; cx++) {
      for (let cz = 21; cz < 27; cz++) placements.push(...propPlacementsInChunk({ cx, cz, seed: 123, height, biome, drawnHeight: (ground) => ground }));
    }
    const found = placements.find((placement) => {
      if (!placement.solid || placement.layer !== 'base' || placement.modelId !== 'namaqualand_boulder_03' || placement.scale < 1.3) return false;
      const clear = placements.every((other) => other === placement || !other.solid || Math.abs(other.x - placement.x) > 5 || other.z < placement.z || other.z > placement.z + 45);
      let steepest = 0;
      for (let ahead = 0; ahead < 40; ahead += 2) steepest = Math.max(steepest, Math.abs(height(placement.x, placement.z + ahead + 2) - height(placement.x, placement.z + ahead)) / 2);
      return clear && steepest < 0.05;
    });
    if (!found) throw new Error('no free boulder on the sampled plain');
    return found;
  }

  it('stops a car driven north at a boulder short of the boulder\'s south face', async () => {
    const boulder = openPlainBoulder();
    const box = propColliderBox(boulder);
    if (!box) throw new Error('the boulder has no box');
    // The box is turned; its farthest reach south is the most the car's centre could ever pass.
    const southReach = box.z + Math.abs(box.halfX * Math.sin(box.yaw)) + Math.abs(box.halfZ * Math.cos(box.yaw));
    const sim = await ArenaSim.create(123);
    sim.addPlayer('driver', 'forester', 0);
    sim.teleportPlayer('driver', box.x, box.z + 30, 1.5, { vx: 0, vz: 0 });
    stepFor(sim, 'driver', IDLE, 30);
    let closest = Infinity;
    for (let step = 0; step < 30 * 8; step++) {
      stepFor(sim, 'driver', { throttle: 1, brake: 0, steer: 0 }, 1);
      closest = Math.min(closest, transformOf(sim, 'driver').z);
    }
    // Facing north (−z), the car's centre stays south of the boulder's far side, and got close to it.
    expect(closest).toBeGreaterThan(southReach);
    expect(closest).toBeLessThan(southReach + 6);
  });
});

describe('releasedInput — the pedals of a client that went silent (release review)', () => {
  it('lets go of the pedals and the steering but keeps traction control and the drive mode', () => {
    const last: InputMsg = { throttle: 1, brake: 0.5, steer: -0.7, tractionControl: false, driveMode: '4LLc' };
    expect(releasedInput(last)).toStrictEqual({ throttle: 0, brake: 0, steer: 0, tractionControl: false, driveMode: '4LLc' });
  });

  it('leaves traction control and the drive mode unset when the last input had none', () => {
    expect(releasedInput({ throttle: 1, brake: 0, steer: 1 })).toStrictEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it('does not change the input it was given', () => {
    const last: InputMsg = { throttle: 1, brake: 0, steer: 1 };
    releasedInput(last);
    expect(last).toStrictEqual({ throttle: 1, brake: 0, steer: 1 });
  });
});

describe('ArenaSim — a client that stops sending input (release review)', () => {
  const FULL_THROTTLE: InputMsg = { throttle: 1, brake: 0, steer: 0 };
  // The steps a copy still drives on its last input; from the next one on its pedals are released.
  const TIMEOUT_STEPS = Math.round(INPUT_TIMEOUT_SECONDS / SIM_STEP_SECONDS);
  const WINDOW_STEPS = 30;

  function silentSteps(sim: ArenaSim, steps: number): void {
    for (let step = 0; step < steps; step++) sim.step();
  }

  /** Flat speed over the next `steps` steps: with `input` sent every step, or with no input at all when it is null. */
  function flatSpeedOver(sim: ArenaSim, steps: number, input: InputMsg | null): number {
    const from = transformOf(sim, 'driver');
    if (input === null) silentSteps(sim, steps);
    else stepFor(sim, 'driver', input, steps);
    const to = transformOf(sim, 'driver');
    return Math.hypot(to.x - from.x, to.z - from.z) / (steps * SIM_STEP_SECONDS);
  }

  /** A car that drove 2 s at full throttle, and whose client then sent its last input. */
  async function movingCar(): Promise<ArenaSim> {
    const sim = await ArenaSim.create(123);
    sim.addPlayer('driver', 'forester', 0);
    stepFor(sim, 'driver', IDLE, 60);
    stepFor(sim, 'driver', FULL_THROTTLE, 120);
    return sim;
  }

  it('keeps driving on the last input until the timeout, exactly like a client that keeps sending it', async () => {
    const silent = await movingCar();
    const sending = await movingCar();
    silentSteps(silent, TIMEOUT_STEPS - 1);
    stepFor(sending, 'driver', FULL_THROTTLE, TIMEOUT_STEPS - 1);
    expect(transformOf(silent, 'driver')).toEqual(transformOf(sending, 'driver'));
  });

  it('lets go of the pedals on the first step past the timeout', async () => {
    const silent = await movingCar();
    const sending = await movingCar();
    silentSteps(silent, TIMEOUT_STEPS);
    stepFor(sending, 'driver', FULL_THROTTLE, TIMEOUT_STEPS);
    expect(transformOf(silent, 'driver')).not.toEqual(transformOf(sending, 'driver'));
  });

  it('stops gaining speed after the timeout and slows down, while a car still getting input speeds on', async () => {
    const silent = await movingCar();
    const sending = await movingCar();
    silentSteps(silent, TIMEOUT_STEPS);
    stepFor(sending, 'driver', FULL_THROTTLE, TIMEOUT_STEPS);

    const silentFirst = flatSpeedOver(silent, WINDOW_STEPS, null);
    silentSteps(silent, WINDOW_STEPS);
    const silentLater = flatSpeedOver(silent, WINDOW_STEPS, null);

    const sendingFirst = flatSpeedOver(sending, WINDOW_STEPS, FULL_THROTTLE);
    stepFor(sending, 'driver', FULL_THROTTLE, WINDOW_STEPS);
    const sendingLater = flatSpeedOver(sending, WINDOW_STEPS, FULL_THROTTLE);

    expect(silentLater).toBeLessThan(silentFirst);
    expect(sendingLater).toBeGreaterThan(sendingFirst);
    expect(silentLater).toBeLessThan(sendingLater);
  });

  it('starts the timeout again with a fresh input: the car speeds up again on it', async () => {
    const sim = await movingCar();
    silentSteps(sim, TIMEOUT_STEPS + 60);
    const coasting = flatSpeedOver(sim, WINDOW_STEPS, null);

    sim.setInput('driver', FULL_THROTTLE);
    const afterFreshInput = flatSpeedOver(sim, TIMEOUT_STEPS - 1, null);

    expect(afterFreshInput).toBeGreaterThan(coasting);
  });
});
