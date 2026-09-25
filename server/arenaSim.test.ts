// server/arenaSim.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ArenaSim, type PlayerTransform } from './arenaSim';
import { RESET_LIFT, upAxisOf } from '../shared/vehiclePhysics';
import type { InputMsg } from '../shared/protocol';

const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };

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
    sim.addPlayer('driver', 'forester');
    stepFor(sim, 'driver', IDLE, 120);
    const rest = transformOf(sim, 'driver');
    expect(Number.isFinite(rest.y)).toBe(true);

    stepFor(sim, 'driver', { throttle: 1, brake: 0, steer: 0 }, 180);
    const moved = transformOf(sim, 'driver');
    expect(Math.hypot(moved.x - rest.x, moved.z - rest.z)).toBeGreaterThan(1);
  });

  it('tracks and drops players', () => {
    sim.addPlayer('a', 'forester');
    sim.addPlayer('b', 'pajero');
    expect(sim.playerIds()).toEqual(expect.arrayContaining(['a', 'b']));
    sim.removePlayer('a');
    expect(sim.playerIds()).not.toContain('a');
    expect(sim.playerIds()).toContain('b');
    expect(sim.transform('a')).toBeUndefined();
    expect(sim.carIdOf('a')).toBeUndefined();
  });

  it('remembers the car each player joined with (R125)', () => {
    sim.addPlayer('forester-player', 'forester');
    sim.addPlayer('pajero-player', 'pajero');
    expect(sim.carIdOf('forester-player')).toBe('forester');
    expect(sim.carIdOf('pajero-player')).toBe('pajero');
  });

  it('swaps a player\'s car in place: same pose, new car id (R126)', () => {
    sim.addPlayer('swapper', 'forester');
    stepFor(sim, 'swapper', IDLE, 90);
    const before = transformOf(sim, 'swapper');

    sim.setPlayerCar('swapper', 'pajero');

    const after = transformOf(sim, 'swapper');
    expect(sim.carIdOf('swapper')).toBe('pajero');
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-4);
    expect(Math.abs(after.qx * before.qx + after.qy * before.qy + after.qz * before.qz + after.qw * before.qw)).toBeCloseTo(1, 6);
  });

  it('keeps the swapped car driveable, and keeps no second copy of the player (R126, R127)', () => {
    sim.addPlayer('swap-and-drive', 'pajero');
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
    sim.addPlayer('same-car', 'pajero');
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
    sim.addPlayer('resetter', 'forester');
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
