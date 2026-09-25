// server/state.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaState, PlayerState } from './state';

function replicated(state: ArenaState): ArenaState {
  const copy = new ArenaState();
  copy.decode(state.encodeAll());
  return copy;
}

describe('schema', () => {
  it('holds players in a map and round-trips fields', () => {
    const state = new ArenaState();
    state.seed = 123;
    const player = new PlayerState();
    player.name = 'rider';
    player.x = 1; player.y = 2; player.z = 3; player.qw = 1;
    state.players.set('abc', player);

    expect(state.seed).toBe(123);
    expect(state.players.get('abc')?.name).toBe('rider');
    expect(state.players.get('abc')?.y).toBe(2);
  });

  it('replicates each player\'s car id to the clients (R128)', () => {
    // Every other tab draws a remote player with the model named here; a field missing from the
    // schema would decode as '' and every remote car would fall back to the default model.
    const state = new ArenaState();
    const pajeroDriver = new PlayerState();
    pajeroDriver.carId = 'pajero';
    const foresterDriver = new PlayerState();
    foresterDriver.carId = 'forester';
    state.players.set('p1', pajeroDriver);
    state.players.set('p2', foresterDriver);

    const clientCopy = replicated(state);

    expect(clientCopy.players.get('p1')?.carId).toBe('pajero');
    expect(clientCopy.players.get('p2')?.carId).toBe('forester');
  });

  it('replicates a car change made after the first full sync', () => {
    const state = new ArenaState();
    const player = new PlayerState();
    player.carId = 'forester';
    state.players.set('p1', player);
    const clientCopy = replicated(state);

    player.carId = 'pajero';
    clientCopy.decode(state.encode());

    expect(clientCopy.players.get('p1')?.carId).toBe('pajero');
  });

  it('replicates each player\'s spawn slot, and -1 before the server gave one (S1-2)', () => {
    // The client builds its own car at spawnPoseFor(spawnSlot); a slot lost on the wire would put
    // every second tab on top of the first car.
    const state = new ArenaState();
    const seated = new PlayerState();
    seated.spawnSlot = 7;
    state.players.set('seated', seated);
    state.players.set('waiting', new PlayerState());

    const clientCopy = replicated(state);

    expect(clientCopy.players.get('seated')?.spawnSlot).toBe(7);
    expect(clientCopy.players.get('waiting')?.spawnSlot).toBe(-1);
  });
});
