// server/arenaSim.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaSim } from './arenaSim';

describe('ArenaSim', () => {
  it('spawns a player that rests on terrain and drives under throttle', async () => {
    const sim = await ArenaSim.create(123);
    sim.addPlayer('p1');

    // settle
    for (let i = 0; i < 120; i++) { sim.setInput('p1', { throttle: 0, brake: 0, steer: 0 }); sim.step(); }
    const rest = sim.transform('p1')!;
    expect(Number.isFinite(rest.y)).toBe(true);

    // drive
    for (let i = 0; i < 180; i++) { sim.setInput('p1', { throttle: 1, brake: 0, steer: 0 }); sim.step(); }
    const moved = sim.transform('p1')!;
    const dist = Math.hypot(moved.x - rest.x, moved.z - rest.z);
    expect(dist).toBeGreaterThan(1);
  });

  it('tracks and drops players', async () => {
    const sim = await ArenaSim.create(7);
    sim.addPlayer('a'); sim.addPlayer('b');
    expect(sim.playerIds().sort()).toEqual(['a', 'b']);
    sim.removePlayer('a');
    expect(sim.playerIds()).toEqual(['b']);
    expect(sim.transform('a')).toBeUndefined();
  });
});
