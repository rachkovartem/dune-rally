// server/ArenaRoom.test.ts
// Category 2: the room as the matchmaker drives it, with Colyseus' own in-process presence and
// driver (no network, no client). Checks what a join may and may not decide (release review).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { matchMaker, LocalPresence, LocalDriver, type Room } from '@colyseus/core';
import { ArenaRoom } from './ArenaRoom';
import { ARENA_WORLD_SEED, MAX_ARENA_ROOMS } from './config';
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
