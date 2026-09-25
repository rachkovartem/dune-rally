// src/net/inputSendPolicy.ts
import { TICK_HZ, type InputMsg } from '../../shared/protocol';
import { INPUT_TIMEOUT_SECONDS } from '../../server/arenaSim';

/** The server reads input once per tick, so sending faster only fills the socket. */
export const MIN_INPUT_INTERVAL_MS = 1000 / TICK_HZ;

// Well under the server timeout: the send waits for the next frame, and even two late or lost
// heartbeats in a row still arrive before the server releases the pedals.
export const INPUT_HEARTBEAT_MS = (INPUT_TIMEOUT_SECONDS * 1000) * 0.3;

export interface SentInput {
  atMs: number;
  input: InputMsg;
}

function sameInput(first: InputMsg, second: InputMsg): boolean {
  return first.throttle === second.throttle
    && first.brake === second.brake
    && first.steer === second.steer
    && first.tractionControl === second.tractionControl
    && first.driveMode === second.driveMode;
}

/** Send a changed input at once, an unchanged one only as a heartbeat, and never faster than the server tick. */
export function shouldSendInput(nowMs: number, lastSent: SentInput | null, current: InputMsg): boolean {
  if (lastSent === null) return true;
  const elapsedMs = nowMs - lastSent.atMs;
  if (elapsedMs < MIN_INPUT_INTERVAL_MS) return false;
  return !sameInput(lastSent.input, current) || elapsedMs >= INPUT_HEARTBEAT_MS;
}
