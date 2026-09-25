// server/config.ts
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SERVER_PORT } from '../shared/protocol';

/** One Rapier world per room: past this many players the 30 Hz tick starts to slip for everyone. */
export const ROOM_MAX_CLIENTS = 16;

export type ServerEnv = Readonly<Record<string, string | undefined>>;

/** `PORT` from the environment; unset or empty means the dev port. A bad value stops the start. */
export function readPort(env: ServerEnv): number {
  const raw = env.PORT;
  if (raw === undefined || raw.trim() === '') return SERVER_PORT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${raw}"`);
  }
  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${raw}"`);
  }
  return port;
}

/**
 * `CLIENT_DIST_DIR` from the environment: unset means dev (Vite serves the client itself).
 * When it is set, it must hold a built client, so a wrong path fails at start and not per request.
 */
export function readClientDistDir(env: ServerEnv): string | null {
  const raw = env.CLIENT_DIST_DIR;
  if (raw === undefined || raw.trim() === '') return null;
  const distDir = resolve(raw.trim());
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`CLIENT_DIST_DIR is not a directory: ${distDir}`);
  }
  if (!existsSync(resolve(distDir, 'index.html'))) {
    throw new Error(`CLIENT_DIST_DIR has no index.html (run npm run build first): ${distDir}`);
  }
  return distDir;
}
