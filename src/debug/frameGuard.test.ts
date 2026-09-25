// src/debug/frameGuard.test.ts
// The black-screen fix: one subsystem throwing must not stop the frame loop, and the same error
// must not flood the report every frame.
import { describe, it, expect } from 'vitest';
import { createFrameGuard, errorMessageOf } from './frameGuard';

function recordingGuard() {
  const reports: string[] = [];
  const guard = createFrameGuard((subsystem, message) => reports.push(`${subsystem}: ${message}`));
  return { guard, reports };
}

const failWith = (message: string) => (): void => { throw new Error(message); };

describe('createFrameGuard', () => {
  it('keeps running the rest of the frame after one subsystem throws', () => {
    const { guard } = recordingGuard();
    const ran: string[] = [];
    guard.run('audio', failWith('AudioParam.setTargetAtTime: non-finite value'));
    guard.run('render', () => ran.push('render'));
    expect(ran).toEqual(['render']);
  });

  it('reports the same error only once while it repeats every frame', () => {
    const { guard, reports } = recordingGuard();
    for (let frame = 0; frame < 5; frame++) guard.run('audio', failWith('bad value'));
    expect(reports).toEqual(['audio: bad value']);
  });

  it('reports again when the message changes', () => {
    const { guard, reports } = recordingGuard();
    guard.run('audio', failWith('first'));
    guard.run('audio', failWith('second'));
    expect(reports).toEqual(['audio: first', 'audio: second']);
  });

  it('reports again when the error comes back after a clean frame', () => {
    const { guard, reports } = recordingGuard();
    guard.run('audio', failWith('bad value'));
    guard.run('audio', () => {});
    guard.run('audio', failWith('bad value'));
    expect(reports).toEqual(['audio: bad value', 'audio: bad value']);
  });

  it('keeps each subsystem\'s errors apart', () => {
    const { guard, reports } = recordingGuard();
    guard.run('audio', failWith('same text'));
    guard.run('tracks', failWith('same text'));
    expect(reports).toEqual(['audio: same text', 'tracks: same text']);
  });

  it('reports nothing for a subsystem that works', () => {
    const { guard, reports } = recordingGuard();
    guard.run('render', () => {});
    expect(reports).toEqual([]);
  });
});

describe('errorMessageOf', () => {
  it('reads an Error\'s message and turns anything else thrown into text', () => {
    expect(errorMessageOf(new TypeError('x is undefined'))).toBe('x is undefined');
    expect(errorMessageOf('plain string')).toBe('plain string');
    expect(errorMessageOf(42)).toBe('42');
  });
});
