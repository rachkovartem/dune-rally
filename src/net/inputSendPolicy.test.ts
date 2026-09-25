// src/net/inputSendPolicy.test.ts
// Category 1: a pure rule over the time and the inputs it is given (review round 2).
import { describe, it, expect } from 'vitest';
import { INPUT_HEARTBEAT_MS, MIN_INPUT_INTERVAL_MS, shouldSendInput, type SentInput } from './inputSendPolicy';
import { INPUT_TIMEOUT_SECONDS, POSE_HZ, TICK_HZ, type InputMsg } from '../../shared/protocol';
import { MESSAGE_RATE_LIMIT, MessageRateLimiter } from '../../server/messageRateLimit';

const HELD: InputMsg = { throttle: 0.5, brake: 0, steer: 0.25, tractionControl: true, driveMode: '4H' };
// Sent at 0, so the elapsed time equals `nowMs` exactly and the boundaries are not blurred by rounding.
const SENT_AT_ZERO: SentInput = { atMs: 0, input: HELD };

interface Frame {
  atMs: number;
  input: InputMsg;
}

/** Runs frames through the rule the way the game loop does, and returns the times it sent at. */
function sendTimes(frames: readonly Frame[]): number[] {
  let lastSent: SentInput | null = null;
  const sent: number[] = [];
  for (const frame of frames) {
    if (!shouldSendInput(frame.atMs, lastSent, frame.input)) continue;
    lastSent = { atMs: frame.atMs, input: frame.input };
    sent.push(frame.atMs);
  }
  return sent;
}

function framesAt(hertz: number, seconds: number, inputAt: (index: number) => InputMsg): Frame[] {
  return Array.from({ length: Math.round(hertz * seconds) }, (_unused, index) => ({ atMs: (index * 1000) / hertz, input: inputAt(index) }));
}

describe('shouldSendInput — the first input and the tick interval', () => {
  it('sends the first input at once', () => {
    expect(shouldSendInput(0, null, HELD)).toBe(true);
  });

  it('holds back a changed input just under the minimum send interval', () => {
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS - 0.01, SENT_AT_ZERO, { ...HELD, throttle: 1 })).toBe(false);
  });

  it('sends a changed input at exactly the minimum send interval', () => {
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS, SENT_AT_ZERO, { ...HELD, throttle: 1 })).toBe(true);
  });

  it('sends a held-back change on the first call after the interval, even with no newer change', () => {
    const changed: InputMsg = { ...HELD, steer: -1 };
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS / 3, SENT_AT_ZERO, changed)).toBe(false);
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS + 1, SENT_AT_ZERO, changed)).toBe(true);
  });
});

describe('shouldSendInput — the heartbeat of an unchanged input', () => {
  it('does not send an unchanged input just under the heartbeat interval', () => {
    expect(shouldSendInput(INPUT_HEARTBEAT_MS - 0.01, SENT_AT_ZERO, { ...HELD })).toBe(false);
  });

  it('sends an unchanged input at exactly the heartbeat interval', () => {
    expect(shouldSendInput(INPUT_HEARTBEAT_MS, SENT_AT_ZERO, { ...HELD })).toBe(true);
  });

  it('treats an equal copy of the input as unchanged, not only the same object', () => {
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS, SENT_AT_ZERO, { ...HELD })).toBe(false);
  });
});

describe('shouldSendInput — every field of the input counts as a change', () => {
  const { tractionControl: _tractionControl, ...withoutTractionControl } = HELD;
  const { driveMode: _driveMode, ...withoutDriveMode } = HELD;

  it.each<[string, InputMsg, InputMsg]>([
    ['the throttle', HELD, { ...HELD, throttle: 0.75 }],
    ['the brake', HELD, { ...HELD, brake: 0.1 }],
    ['the steering', HELD, { ...HELD, steer: -0.25 }],
    ['traction control switched off', HELD, { ...HELD, tractionControl: false }],
    ['traction control set where it was unset', withoutTractionControl, HELD],
    ['another drive mode', HELD, { ...HELD, driveMode: '4LLc' }],
    ['a drive mode where there was none', withoutDriveMode, HELD],
    ['a drive mode dropped', HELD, withoutDriveMode],
  ])('sends a change of %s at the minimum send interval, long before the heartbeat', (_name, sent, current) => {
    expect(shouldSendInput(MIN_INPUT_INTERVAL_MS, { atMs: 0, input: sent }, current)).toBe(true);
  });
});

describe('shouldSendInput — over a stream of frames', () => {
  const FAST_SCREEN_HZ = 240;
  const frameMs = 1000 / FAST_SCREEN_HZ;
  // A new steering value on every frame, never one seen before, so no frame repeats the last input sent.
  const changingEveryFrame = (index: number): InputMsg => ({ ...HELD, steer: -1 + index / 1000 });

  // Replacement (review round 3): "at most one input per server tick" is not true on a 100 or 165 Hz
  // screen once the send gap is a little under one tick. The real promise is that a game client
  // never loses an input to the server's message budget.
  it.each([60, 100, 144, 165, 240])('never has an input dropped by the server budget, with the pose sent too, on a %i Hz screen', (screenHz) => {
    const seconds = 10;
    const limiter = new MessageRateLimiter(MESSAGE_RATE_LIMIT, 0);
    const inputs = sendTimes(framesAt(screenHz, seconds, changingEveryFrame)).map((atMs) => ({ atMs, kind: 'input' as const }));
    const poses = Array.from({ length: POSE_HZ * seconds }, (_unused, index) => ({ atMs: (index * 1000) / POSE_HZ, kind: 'control' as const }));
    const messages = [...inputs, ...poses].sort((first, second) => first.atMs - second.atMs);

    const decisions = messages.map((message) => limiter.take(message.kind, message.atMs));

    expect(decisions.filter((decision) => decision !== 'accept')).toEqual([]);
  });

  it('sends close to one input per server tick on a 60 Hz screen whose frames jitter around 16.7 ms', () => {
    // Two frames in a row add up to a hair under one tick; the input changes on every frame.
    const frames: Frame[] = [];
    let atMs = 0;
    for (let index = 0; atMs < 1000; index++) {
      frames.push({ atMs, input: changingEveryFrame(index) });
      atMs += index % 2 === 0 ? 16.4 : 16.9;
    }
    expect(sendTimes(frames).length).toBeGreaterThanOrEqual(TICK_HZ - 1);
  });

  it('never keeps a change waiting longer than the minimum send interval and one frame', () => {
    const sent = sendTimes(framesAt(FAST_SCREEN_HZ, 1, changingEveryFrame));
    const gaps = sent.slice(1).map((atMs, index) => atMs - sent[index]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MIN_INPUT_INTERVAL_MS + frameMs);
  });

  it('keeps the server driving through one lost heartbeat, even on a slow 30 Hz screen', () => {
    const sent = sendTimes(framesAt(30, 3, () => HELD));
    const gapsOverOneLost = sent.slice(2).map((atMs, index) => atMs - sent[index]);
    expect(gapsOverOneLost.length).toBeGreaterThan(0);
    expect(Math.max(...gapsOverOneLost)).toBeLessThan(INPUT_TIMEOUT_SECONDS * 1000);
  });
});
