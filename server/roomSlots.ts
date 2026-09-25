// server/roomSlots.ts

/**
 * Counts rooms from the start of their onCreate. The matchmaker counts a room only once onCreate has
 * finished, so many joins at the same moment would all see "below the limit" and each build a world.
 */
export class RoomSlots {
  private used = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`RoomSlots: bad limit ${limit}`);
  }

  tryClaim(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  release(): void {
    if (this.used === 0) throw new Error('RoomSlots: release() without a claimed slot');
    this.used--;
  }

  inUse(): number {
    return this.used;
  }
}
