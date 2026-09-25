// server/ArenaRoom.test.ts
// Category 2: the room as the matchmaker drives it, with Colyseus' own in-process presence and
// driver (no network, no client). Checks what a join may and may not decide (release review).
// A test client joins the way the WebSocket transport joins one: a seat reservation, then
// `_onJoin`, then the bytes of each message as a `message` event on the client's socket.
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  matchMaker, LocalPresence, LocalDriver, ClientState, getMessageBytes, Protocol, type Client, type Room,
} from '@colyseus/core';
import { ArenaRoom } from './ArenaRoom';
import { ArenaSim } from './arenaSim';
import { ARENA_WORLD_SEED, MAX_ARENA_ROOMS } from './config';
import { MESSAGE_RATE_LIMIT } from './messageRateLimit';
import { ROOM_BROKEN_CLOSE_CODE, TICK_HZ, type InputMsg } from '../shared/protocol';
import type { ArenaState } from './state';

const ROOM_NAME = 'arena';

beforeAll(async () => {
  await matchMaker.setup(new LocalPresence(), new LocalDriver());
  matchMaker.defineRoomType(ROOM_NAME, ArenaRoom);
});

afterEach(async () => {
  const listings = await matchMaker.query({ name: ROOM_NAME });
  await Promise.all(listings.map((listing) => matchMaker.getRoomById(listing.roomId)?.disconnect()));
  vi.restoreAllMocks();
});

async function createArena(options: Record<string, unknown>): Promise<Room<ArenaState>> {
  const listing = await matchMaker.createRoom(ROOM_NAME, options);
  return matchMaker.getRoomById(listing.roomId);
}

async function openRooms(): Promise<number> {
  return (await matchMaker.query({ name: ROOM_NAME })).length;
}

describe('ArenaRoom — the world seed', () => {
  it('runs the shared world when the join asks for another seed', async () => {
    const room = await createArena({ seed: 7 });
    expect(room.state.seed).toBe(ARENA_WORLD_SEED);
  });

  it.each<[string, Record<string, unknown>]>([
    ['no options', {}],
    ['a seed of 0', { seed: 0 }],
    ['a seed as text', { seed: '12345' }],
    ['a name and a car', { name: 'Ann', carId: 'pajero' }],
  ])('gives every room the same world, whatever the join carries (%s)', async (_name, options) => {
    const first = await createArena({ seed: 999 });
    const second = await createArena(options);
    expect(second.state.seed).toBe(first.state.seed);
  });
});

describe('ArenaRoom — the room limit of one process', () => {
  it('refuses to open a room past the limit, and opens one again after a room closes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rooms: Room<ArenaState>[] = [];
    for (let index = 0; index < MAX_ARENA_ROOMS; index++) rooms.push(await createArena({}));

    await expect(createArena({})).rejects.toThrow();
    expect(await openRooms()).toBe(MAX_ARENA_ROOMS);

    await rooms[0].disconnect();
    await expect(createArena({})).resolves.toBeDefined();
    expect(await openRooms()).toBe(MAX_ARENA_ROOMS);
  });

  it('gives every slot back once all rooms are closed: the full limit opens again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let index = 0; index < MAX_ARENA_ROOMS; index++) await createArena({});
    const listings = await matchMaker.query({ name: ROOM_NAME });
    await Promise.all(listings.map((listing) => matchMaker.getRoomById(listing.roomId).disconnect()));

    for (let index = 0; index < MAX_ARENA_ROOMS; index++) await createArena({});
    expect(await openRooms()).toBe(MAX_ARENA_ROOMS);
    await expect(createArena({})).rejects.toThrow();
  });
});

/** The server side of one player's connection, with no socket behind it. */
class TestClient implements Client {
  readonly ref = new EventEmitter();
  readonly id: string;
  readonly sessionId: string;
  state = ClientState.JOINING;
  readyState: number = WebSocket.OPEN;
  _reconnectionToken = '';
  _enqueuedMessages: unknown[] = [];
  _afterNextPatchQueue: Array<[string | Client, IArguments]> = [];
  /** The close code of every time the server closed this connection. */
  readonly closeCodes: number[] = [];

  constructor(sessionId: string) {
    this.id = sessionId;
    this.sessionId = sessionId;
  }

  sendInput(input: InputMsg): void {
    this.ref.emit('message', getMessageBytes.raw(Protocol.ROOM_DATA, 'input', input));
  }

  raw(): void {}
  enqueueRaw(): void {}
  send(): void {}
  sendBytes(): void {}
  error(): void {}

  leave(code = 1000): void {
    this.closeCodes.push(code);
    this.readyState = WebSocket.CLOSED;
    this.ref.emit('close');
  }

  close(code?: number): void {
    this.leave(code);
  }
}

const TICK_MS = 1000 / TICK_HZ;
const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };
const FULL_THROTTLE: InputMsg = { throttle: 1, brake: 0, steer: 0 };
// The inputs the budget accepts at once; every one past them is dropped.
const ACCEPTED_AT_ONCE = MESSAGE_RATE_LIMIT.burst - MESSAGE_RATE_LIMIT.controlReserve;

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function joinArena(room: Room<ArenaState>): Promise<TestClient> {
  const listing = await matchMaker.query({ roomId: room.roomId });
  const reservation = await matchMaker.reserveSeatFor(listing[0], {});
  const client = new TestClient(reservation.sessionId);
  await room._onJoin(client);
  return client;
}

/** Where the player's car is in the room state, on the ground plane. */
function flatPositionOf(room: Room<ArenaState>, client: TestClient): { x: number; z: number } {
  const player = room.state.players.get(client.sessionId);
  if (!player) throw new Error(`no player ${client.sessionId} in the room state`);
  return { x: player.x, z: player.z };
}

interface SettledCar {
  room: Room<ArenaState>;
  client: TestClient;
  start: { x: number; z: number };
  /** Moves the limiter's clock forward; it stands still otherwise, so a burst is one instant. */
  advanceClock(milliseconds: number): void;
}

/** A car that stood still in its room long enough to settle on the ground. */
async function settledCar(): Promise<SettledCar> {
  const room = await createArena({});
  const client = await joinArena(room);
  await wait(TICK_MS * 15);
  let clockMs = performance.now();
  vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
  return {
    room,
    client,
    start: flatPositionOf(room, client),
    advanceClock: (milliseconds) => { clockMs += milliseconds; },
  };
}

function flatDistance(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** Sends `count` inputs at one instant, then `last`: the budget accepts the first ones and drops the rest. */
function queuedBurst(client: TestClient, input: InputMsg, count: number, last: InputMsg): void {
  for (let index = 0; index < count; index++) client.sendInput(input);
  client.sendInput(last);
}

// A car that got no pedals moves less than this; one that got full throttle for a few ticks moves more.
const STANDING_STILL_METRES = 0.02;
const DRIVING_METRES = 0.2;

describe('ArenaRoom — inputs the budget drops (release review)', () => {
  it('ends a queued burst on its newest input: full throttle accepted first, idle dropped last, the car stays', async () => {
    const { room, client, start } = await settledCar();
    queuedBurst(client, FULL_THROTTLE, ACCEPTED_AT_ONCE + 5, IDLE);
    await wait(TICK_MS * 12);
    expect(flatDistance(start, flatPositionOf(room, client))).toBeLessThan(STANDING_STILL_METRES);
  });

  it('applies the newest dropped input once: the car drives on it, then coasts after the input timeout', async () => {
    const { room, client, start } = await settledCar();
    queuedBurst(client, IDLE, ACCEPTED_AT_ONCE + 5, FULL_THROTTLE);
    await wait(600);
    const atEarlyWindowStart = flatDistance(start, flatPositionOf(room, client));
    await wait(300);
    const earlyWindow = flatDistance(start, flatPositionOf(room, client)) - atEarlyWindowStart;
    await wait(600);
    const atLateWindowStart = flatDistance(start, flatPositionOf(room, client));
    await wait(300);
    const lateWindow = flatDistance(start, flatPositionOf(room, client)) - atLateWindowStart;

    expect(atEarlyWindowStart).toBeGreaterThan(DRIVING_METRES);
    // Applied on every tick, the dropped throttle would never time out and the car would speed up.
    expect(lateWindow).toBeLessThan(earlyWindow);
  }, 10_000);

  it('forgets a dropped input once a newer input is accepted', async () => {
    const { room, client, start, advanceClock } = await settledCar();
    queuedBurst(client, IDLE, ACCEPTED_AT_ONCE, FULL_THROTTLE);
    advanceClock(1000);
    client.sendInput(IDLE);
    await wait(TICK_MS * 12);
    expect(flatDistance(start, flatPositionOf(room, client))).toBeLessThan(STANDING_STILL_METRES);
  });
});

describe('ArenaRoom — a tick that throws (release review)', () => {
  /** Every physics world the rooms build from now on, in the order they were built. */
  function captureWorlds(): ArenaSim[] {
    const worlds: ArenaSim[] = [];
    const buildWorld = ArenaSim.create.bind(ArenaSim);
    vi.spyOn(ArenaSim, 'create').mockImplementation(async (seed) => {
      const world = await buildWorld(seed);
      worlds.push(world);
      return world;
    });
    return worlds;
  }

  /** From now on the world fails on every step, the way a Rapier WASM panic does. */
  function breakWorld(world: ArenaSim): void {
    vi.spyOn(world, 'step').mockImplementation(() => { throw new Error('unreachable executed'); });
  }

  it('closes the room with the broken-room code for every player, logs the failure once over several ticks, and removes the room', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const worlds = captureWorlds();
    const room = await createArena({});
    const first = await joinArena(room);
    const second = await joinArena(room);
    breakWorld(worlds[0]);

    await wait(TICK_MS * 6);

    expect(first.closeCodes).toEqual([ROOM_BROKEN_CLOSE_CODE]);
    expect(second.closeCodes).toEqual([ROOM_BROKEN_CLOSE_CODE]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(await openRooms()).toBe(0);
  });

  it('gives its room slot back: with every slot taken, a broken room lets a new room open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const worlds = captureWorlds();
    for (let index = 0; index < MAX_ARENA_ROOMS; index++) await createArena({});
    breakWorld(worlds[0]);

    await wait(TICK_MS * 4);

    expect(await openRooms()).toBe(MAX_ARENA_ROOMS - 1);
    await expect(createArena({})).resolves.toBeDefined();
  });
});
