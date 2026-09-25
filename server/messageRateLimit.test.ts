// server/messageRateLimit.test.ts
// Category 1: the limiter is a pure state machine over the times it is given (release review).
import { describe, it, expect } from 'vitest';
import { MESSAGE_RATE_LIMIT, MessageRateLimiter, type MessageKind, type RateDecision } from './messageRateLimit';

const START_MS = 1000;
const { burst, controlReserve, kickPerSecond, kickBurst } = MESSAGE_RATE_LIMIT;

function sendMany(limiter: MessageRateLimiter, kind: MessageKind, count: number, nowMs: number): RateDecision[] {
  return Array.from({ length: count }, () => limiter.take(kind, nowMs));
}

const count = (decisions: readonly RateDecision[], decision: RateDecision): number =>
  decisions.filter((item) => item === decision).length;

describe('MessageRateLimiter — the burst', () => {
  it('accepts exactly a burst of control messages at once and drops the next one', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    expect(count(sendMany(limiter, 'control', burst, START_MS), 'accept')).toBe(burst);
    expect(limiter.take('control', START_MS)).toBe('drop');
  });

  it('accepts inputs only up to the control reserve and drops the next one', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    expect(count(sendMany(limiter, 'input', burst - controlReserve, START_MS), 'accept')).toBe(burst - controlReserve);
    expect(limiter.take('input', START_MS)).toBe('drop');
  });

  it('still lets the reserved control messages through once the inputs used their share', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'input', burst, START_MS);
    expect(count(sendMany(limiter, 'control', controlReserve, START_MS), 'accept')).toBe(controlReserve);
    expect(limiter.take('control', START_MS)).toBe('drop');
  });
});

describe('MessageRateLimiter — the budget over time', () => {
  it('fills the budget back after a second with no messages', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', burst, START_MS);
    expect(count(sendMany(limiter, 'control', burst, START_MS + 1000), 'accept')).toBe(burst);
  });

  it('gives back part of the budget after part of a second', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', burst, START_MS);
    const accepted = count(sendMany(limiter, 'control', burst, START_MS + 500), 'accept');
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(burst);
  });

  it('never saves up more than one burst over a long quiet spell', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    const later = START_MS + 60_000;
    expect(count(sendMany(limiter, 'control', burst, later), 'accept')).toBe(burst);
    expect(limiter.take('control', later)).toBe('drop');
  });

  it('does not give tokens back for a clock that runs backwards', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', burst, START_MS);
    expect(limiter.take('control', START_MS - 5000)).toBe('drop');
  });
});

/**
 * Sends `perSecond` messages a second, evenly spread, for `seconds`, starting at `fromMs`.
 * Returns when the first kick came, in seconds from `fromMs`, or null when there was none.
 */
function kickTimeAtRate(limiter: MessageRateLimiter, perSecond: number, seconds: number, fromMs = START_MS): number | null {
  const stepMs = 1000 / perSecond;
  const total = Math.round(perSecond * seconds);
  for (let index = 0; index < total; index++) {
    const nowMs = fromMs + index * stepMs;
    if (limiter.take('input', nowMs) === 'kick') return (nowMs - fromMs) / 1000;
  }
  return null;
}

// What a game client sends: `input` at the tick rate with a heartbeat, and a pose ten times a second.
const GAME_CLIENT_PER_SECOND = 45;

// Replacement (review round 2): the flood line is now a bucket of kickBurst messages that refills at
// kickPerSecond, not one second of kickPerSecond messages. It replaces "disconnects on the first
// message past the flood line" and "counts dropped messages toward the flood line".
describe('MessageRateLimiter — the flood line', () => {
  it.each<MessageKind>(['input', 'control'])('does not disconnect for a flood burst of %s messages at once, most of them dropped', (kind) => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    const decisions = sendMany(limiter, kind, kickBurst, START_MS);
    expect(count(decisions, 'kick')).toBe(0);
    expect(count(decisions, 'drop')).toBeGreaterThan(0);
  });

  it.each<MessageKind>(['input', 'control'])('disconnects on the first %s message past the flood burst, dropped ones counted too', (kind) => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, kind, kickBurst, START_MS);
    expect(limiter.take(kind, START_MS)).toBe('kick');
  });

  it('disconnects a client that sends at twice the flood rate once the flood burst is used up, not before', () => {
    const rate = kickPerSecond * 2;
    const expectedSeconds = kickBurst / (rate - kickPerSecond);
    const kickedAfter = kickTimeAtRate(new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS), rate, expectedSeconds * 2);
    expect(kickedAfter).not.toBeNull();
    expect(kickedAfter).toBeGreaterThan(expectedSeconds * 0.95);
    expect(kickedAfter).toBeLessThan(expectedSeconds * 1.05);
  });

  it('never disconnects a client that sends just under the flood rate, over many flood bursts', () => {
    const rate = kickPerSecond * 0.95;
    const seconds = (kickBurst / (kickPerSecond - rate)) * 3;
    expect(kickTimeAtRate(new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS), rate, seconds)).toBeNull();
  });

  it('does not disconnect a game client whose 10 s of messages arrive at once after a network stall', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    const stalled = sendMany(limiter, 'input', GAME_CLIENT_PER_SECOND * 10, START_MS);
    expect(count(stalled, 'kick')).toBe(0);
    expect(kickTimeAtRate(limiter, GAME_CLIENT_PER_SECOND, 60, START_MS + 1)).toBeNull();
  });

  it('fills the flood burst back after a wait long enough to refill it', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', kickBurst, START_MS);
    const later = START_MS + (kickBurst / kickPerSecond) * 1000;
    expect(count(sendMany(limiter, 'control', kickBurst, later), 'kick')).toBe(0);
  });

  it('still disconnects a second flood burst that comes after only half the refill wait', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', kickBurst, START_MS);
    const halfway = START_MS + (kickBurst / kickPerSecond) * 500;
    expect(count(sendMany(limiter, 'control', kickBurst, halfway), 'kick')).toBeGreaterThan(0);
  });
});

describe('MessageRateLimiter — its settings', () => {
  it.each([['equal to the burst', burst], ['above the burst', burst + 1]])('throws for a control reserve %s: inputs would get nothing', (_name, reserve) => {
    expect(() => new MessageRateLimiter({ ...MESSAGE_RATE_LIMIT, controlReserve: reserve }, START_MS)).toThrow('must be below burst');
  });

  it('accepts a control reserve one below the burst, leaving inputs a single message', () => {
    const limiter = new MessageRateLimiter({ ...MESSAGE_RATE_LIMIT, controlReserve: burst - 1 }, START_MS);
    expect(sendMany(limiter, 'input', 2, START_MS)).toEqual(['accept', 'drop']);
  });
});
