// shared/duelTracks.test.ts
import { describe, it, expect } from 'vitest';
import { DUEL_TRACKS, duelTrackById, isDuelTrackId, isPointInsideCheckpoint } from './duelTracks';

describe('duelTracks — authored multiplayer tracks', () => {
  it('defines 3 distinct duel tracks', () => {
    expect(DUEL_TRACKS).toHaveLength(3);
    expect(DUEL_TRACKS.map((t) => t.id)).toEqual(['die_myl', 'dune_raid', 'ooslus']);
  });

  it('each track has 2 distinct start slots and valid checkpoints', () => {
    for (const track of DUEL_TRACKS) {
      expect(track.startSlots).toHaveLength(2);
      const [slotA, slotB] = track.startSlots;
      // Start slots should not overlap
      const dist = Math.hypot(slotA.x - slotB.x, slotA.z - slotB.z);
      expect(dist).toBeGreaterThan(4);
      expect(dist).toBeLessThan(30);

      // Must have at least 2 checkpoints and 1 finish
      expect(track.checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(track.finish.radius).toBeGreaterThan(15);
    }
  });

  it('duelTrackById looks up existing tracks and undefined for invalid', () => {
    expect(duelTrackById('die_myl')?.name).toContain('Драг');
    expect(duelTrackById('invalid_id')).toBeUndefined();
  });

  it('isDuelTrackId type guard validates track IDs', () => {
    expect(isDuelTrackId('die_myl')).toBe(true);
    expect(isDuelTrackId('dune_raid')).toBe(true);
    expect(isDuelTrackId('ooslus')).toBe(true);
    expect(isDuelTrackId('mars_circuit')).toBe(false);
    expect(isDuelTrackId(null)).toBe(false);
  });

  it('isPointInsideCheckpoint checks 2D horizontal radius', () => {
    const cp = { x: 100, z: 200, radius: 20 };
    expect(isPointInsideCheckpoint({ x: 100, z: 200 }, cp)).toBe(true);
    expect(isPointInsideCheckpoint({ x: 110, z: 210 }, cp)).toBe(true);
    expect(isPointInsideCheckpoint({ x: 130, z: 200 }, cp)).toBe(false);
  });
});
