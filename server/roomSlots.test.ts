// server/roomSlots.test.ts
// Category 1 in spirit (in-memory counter, no I/O): the per-process room limit (release review).
import { describe, it, expect } from 'vitest';
import { RoomSlots } from './roomSlots';

function claimAll(slots: RoomSlots, count: number): boolean[] {
  return Array.from({ length: count }, () => slots.tryClaim());
}

describe('RoomSlots — how many rooms one process may run', () => {
  it('gives out exactly the limit and refuses the next claim', () => {
    const slots = new RoomSlots(3);
    expect(claimAll(slots, 4)).toEqual([true, true, true, false]);
    expect(slots.inUse()).toBe(3);
  });

  it('keeps refusing while every slot is held', () => {
    const slots = new RoomSlots(1);
    slots.tryClaim();
    expect(claimAll(slots, 3)).toEqual([false, false, false]);
    expect(slots.inUse()).toBe(1);
  });

  it('gives a released slot to the next claim, and only one', () => {
    const slots = new RoomSlots(2);
    claimAll(slots, 2);
    slots.release();
    expect(claimAll(slots, 2)).toEqual([true, false]);
  });

  it('starts with no slot in use', () => {
    expect(new RoomSlots(4).inUse()).toBe(0);
  });

  it('throws for a release with no claimed slot, so a double release cannot raise the limit', () => {
    const slots = new RoomSlots(2);
    expect(() => slots.release()).toThrow('without a claimed slot');
    slots.tryClaim();
    slots.release();
    expect(() => slots.release()).toThrow('without a claimed slot');
    expect(claimAll(slots, 3)).toEqual([true, true, false]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws for the limit %s', (limit) => {
    expect(() => new RoomSlots(limit)).toThrow('bad limit');
  });
});
