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
  /** A client above this many messages per second (measured over about one second) is disconnected. */
  kickPerSecond: number;
}

// The client sends `input` once per animation frame: about 154 messages a second on a 144 Hz screen
// and 370 on a 360 Hz one. The room ticks at 30 Hz, so the extra inputs above the budget are dropped
// with no loss, and the kick line sits above what any real screen sends.
export const MESSAGE_RATE_LIMIT: MessageRateLimitOptions = {
  sustainedPerSecond: 60,
  burst: 60,
  controlReserve: 10,
  kickPerSecond: 400,
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
    this.flood = new TokenBucket(options.kickPerSecond, options.kickPerSecond, nowMs);
  }

  take(kind: MessageKind, nowMs: number): RateDecision {
    if (!this.flood.take(nowMs)) return 'kick';
    const keep = kind === 'input' ? this.options.controlReserve : 0;
    return this.budget.take(nowMs, keep) ? 'accept' : 'drop';
  }
}
