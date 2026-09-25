// src/net/serverUrl.ts
import { SERVER_PORT } from '../../shared/protocol';

export interface PageLocation {
  protocol: string;
  host: string;
  hostname: string;
}

/**
 * The game server's WebSocket URL. In dev the server runs on its own port next to Vite; in
 * production it sits behind the page's own host under /ws, so TLS and the origin are shared.
 */
export function gameServerUrl(location: PageLocation, options: { dev: boolean; override: string | undefined }): string {
  if (options.override !== undefined && options.override !== '') return options.override;
  if (options.dev) return `ws://${location.hostname}:${SERVER_PORT}`;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}
