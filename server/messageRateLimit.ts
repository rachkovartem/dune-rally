// server/messageRateLimit.ts

/** `input` is sent every frame and only the latest one counts; every other message must arrive. */
export type MessageKind = 'input' | 'control';

export type RateDecision = 'accept' | 'drop' | 'kick';

export interface MessageRateLimitOptions {
  /** Messages per second a client may send over time; above that the extra ones are dropped. */
  sustainedPerSecond: number;
  /** Messages a client may send at once after a quiet spell. */
  burst: number;
  /** Part of the budget that `input` cannot use, so a pose or an R still gets through at full input rate. */
  controlReserve: number;
  /** A client that sends above this many messages per second for longer than `kickBurst` allows is disconnected. */
  kickPerSecond: number;
  /** Messages a client may send at once, above `kickPerSecond`, before it is disconnected. */
  kickBurst: number;
}

// A game client sends about 45 messages a second (`input` at the tick rate plus a heartbeat, `pose` at
// 10 Hz). After a network stall TCP delivers all queued messages at once, so the kick burst holds over
// 20 s of that traffic, while a flood of a few thousand a second empties it in under half a second.
export const MESSAGE_RATE_LIMIT: MessageRateLimitOptions = {
  sustainedPerSecond: 60,
  burst: 60,
  controlReserve: 10,
  kickPerSecond: 200,
  kickBurst: 1000,
};

class TokenBucket {
  private tokens: number;
  private refilledAtMs: number;

  constructor(private readonly capacity: number, private readonly perSecond: number, nowMs: number) {
    this.tokens = capacity;
    this.refilledAtMs = nowMs;
  }

  /** Takes one token when more than `keep` are left. */
  take(nowMs: number, keep = 0): boolean {
    const elapsedSeconds = Math.max(0, nowMs - this.refilledAtMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.perSecond);
    this.refilledAtMs = nowMs;
    if (this.tokens - 1 < keep) return false;
    this.tokens -= 1;
    return true;
  }
}

/** One per client: says for each message whether to handle it, drop it, or disconnect the client. */
export class MessageRateLimiter {
  private readonly budget: TokenBucket;
  private readonly flood: TokenBucket;

  constructor(private readonly options: MessageRateLimitOptions, nowMs: number) {
    if (options.controlReserve >= options.burst) {
      throw new Error(`MessageRateLimiter: controlReserve ${options.controlReserve} must be below burst ${options.burst}`);
    }
    this.budget = new TokenBucket(options.burst, options.sustainedPerSecond, nowMs);
    this.flood = new TokenBucket(options.kickBurst, options.kickPerSecond, nowMs);
  }

  take(kind: MessageKind, nowMs: number): RateDecision {
    if (!this.flood.take(nowMs)) return 'kick';
    const keep = kind === 'input' ? this.options.controlReserve : 0;
    return this.budget.take(nowMs, keep) ? 'accept' : 'drop';
  }
}
