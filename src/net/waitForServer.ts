// src/net/waitForServer.ts

/** Pauses between probes while the game server restarts; the last one repeats. */
export const SERVER_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * Resolves once `probe` answers true. A rejected probe counts as "not up yet": while the server
 * restarts, a refused connection is the normal answer.
 */
export async function waitForServer(options: {
  probe: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  delaysMs: readonly number[];
}): Promise<void> {
  const { probe, sleep, delaysMs } = options;
  if (delaysMs.length === 0) throw new Error('waitForServer needs at least one delay');
  for (let attempt = 0; ; attempt++) {
    const ready = await probe().catch(() => false);
    if (ready) return;
    await sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)]);
  }
}
