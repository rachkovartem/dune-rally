// server/state.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaState, PlayerState } from './state';

describe('schema', () => {
  it('holds players in a map and round-trips fields', () => {
    const state = new ArenaState();
    state.seed = 123;
    const p = new PlayerState();
    p.name = 'rider';
    p.x = 1; p.y = 2; p.z = 3; p.qw = 1;
    state.players.set('abc', p);

    expect(state.seed).toBe(123);
    expect(state.players.get('abc')!.name).toBe('rider');
    expect(state.players.get('abc')!.y).toBe(2);
  });
});
