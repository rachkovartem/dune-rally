// server/messageRateLimit.test.ts
// Category 1: the limiter is a pure state machine over the times it is given (release review).
import { describe, it, expect } from 'vitest';
import { MESSAGE_RATE_LIMIT, MessageRateLimiter, type MessageKind, type RateDecision } from './messageRateLimit';

const START_MS = 1000;
const { burst, controlReserve, kickPerSecond } = MESSAGE_RATE_LIMIT;

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

describe('MessageRateLimiter — the flood line', () => {
  it('drops, but does not disconnect, at exactly the flood line', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    const decisions = sendMany(limiter, 'input', kickPerSecond, START_MS);
    expect(count(decisions, 'kick')).toBe(0);
  });

  it('disconnects on the first message past the flood line', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'input', kickPerSecond, START_MS);
    expect(limiter.take('input', START_MS)).toBe('kick');
  });

  it('counts dropped messages toward the flood line, not only the accepted ones', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    sendMany(limiter, 'control', kickPerSecond, START_MS);
    expect(limiter.take('control', START_MS)).toBe('kick');
  });

  it('does not disconnect a client that sends at the flood rate spread over time', () => {
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, START_MS);
    const stepMs = 1000 / (kickPerSecond / 2);
    const decisions = Array.from({ length: kickPerSecond * 3 }, (_unused, index) => limiter.take('input', START_MS + index * stepMs));
    expect(count(decisions, 'kick')).toBe(0);
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
