// src/net/waitForServer.test.ts
// Category 2: the wait for a restarting game server, with a scripted probe and a sleep that only
// records its delays (deploy T2).
import { describe, it, expect } from 'vitest';
import { waitForServer } from './waitForServer';

/** A probe that answers from a script, then true for good; `'reject'` fails like a refused connection. */
function scriptedProbe(answers: readonly (boolean | 'reject')[]): { probe: () => Promise<boolean>; calls: () => number } {
  let calls = 0;
  return {
    probe: async () => {
      const answer = answers[calls] ?? true;
      calls++;
      if (answer === 'reject') throw new Error('ECONNREFUSED');
      return answer;
    },
    calls: () => calls,
  };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
  const slept: number[] = [];
  return { sleep: async (ms) => { slept.push(ms); }, slept };
}

describe('waitForServer — back in the game once the server answers (deploy T2)', () => {
  const DELAYS = [1000, 2000, 4000, 8000];

  it('does not wait at all when the first probe answers', async () => {
    const { probe, calls } = scriptedProbe([true]);
    const { sleep, slept } = recordingSleep();
    await waitForServer({ probe, sleep, delaysMs: DELAYS });
    expect(slept).toEqual([]);
    expect(calls()).toBe(1);
  });

  it('waits by the next delay after each failed probe', async () => {
    const { probe } = scriptedProbe([false, false, true]);
    const { sleep, slept } = recordingSleep();
    await waitForServer({ probe, sleep, delaysMs: DELAYS });
    expect(slept).toEqual([1000, 2000]);
  });

  it('repeats the last delay once the list runs out', async () => {
    const { probe } = scriptedProbe([false, false, false, false, false, false, true]);
    const { sleep, slept } = recordingSleep();
    await waitForServer({ probe, sleep, delaysMs: DELAYS });
    expect(slept).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('counts a rejected probe as "not up yet" and keeps waiting', async () => {
    const { probe } = scriptedProbe(['reject', 'reject', true]);
    const { sleep, slept } = recordingSleep();
    await expect(waitForServer({ probe, sleep, delaysMs: DELAYS })).resolves.toBeUndefined();
    expect(slept).toEqual([1000, 2000]);
  });

  it('throws for an empty delay list instead of probing in a tight loop', async () => {
    const { probe } = scriptedProbe([false]);
    await expect(waitForServer({ probe, sleep: recordingSleep().sleep, delaysMs: [] })).rejects.toThrow('at least one delay');
  });
});
