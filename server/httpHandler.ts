// server/httpHandler.ts
// Plain HTTP routes next to Colyseus: the health probe and the built client shell.
// Colyseus answers every URL that contains "/matchmake" before this handler is called.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sep } from 'node:path';
import serveStatic from 'serve-static';

export interface ServerStats {
  rooms: number;
  clients: number;
}

export interface RequestHandlerOptions {
  /** Absolute path of the built client, or null in dev where Vite serves it. */
  distDir: string | null;
  stats: () => ServerStats;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

export const HEALTH_PATH = '/health';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE_CONTROL = 'no-cache';

type ErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'INTERNAL_ERROR';

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(payload);
}

function sendError(response: ServerResponse, status: number, code: ErrorCode, headers: Record<string, string> = {}): void {
  sendJson(response, status, { error: code }, headers);
}

/** The path of the request, or null when the request line holds no valid URL (a throw here would stop the process). */
function pathnameOf(request: IncomingMessage): string | null {
  const url = request.url ?? '/';
  return URL.canParse(url, 'http://localhost') ? new URL(url, 'http://localhost').pathname : null;
}

export function createRequestHandler(options: RequestHandlerOptions): RequestHandler {
  const { distDir, stats } = options;
  const assetsDirPrefix = distDir === null ? null : `${distDir}${sep}assets${sep}`;
  const serveClient = distDir === null
    ? null
    : serveStatic(distDir, {
      index: ['index.html'],
      fallthrough: true,
      redirect: false,
      // Hashed bundle files never change under one name; everything else must be checked on each visit.
      setHeaders(response, filePath) {
        const isHashedAsset = assetsDirPrefix !== null && filePath.startsWith(assetsDirPrefix);
        response.setHeader('Cache-Control', isHashedAsset ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL);
      },
    });

  return (request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendError(response, 405, 'METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD' });
      return;
    }

    const pathname = pathnameOf(request);
    if (pathname === null) {
      sendError(response, 400, 'BAD_REQUEST');
      return;
    }

    if (pathname === HEALTH_PATH) {
      const current = stats();
      sendJson(response, 200, { ok: true, rooms: current.rooms, clients: current.clients });
      return;
    }

    if (serveClient === null) {
      sendError(response, 404, 'NOT_FOUND');
      return;
    }

    serveClient(request, response, (error?: unknown) => {
      if (error === undefined || error === null) {
        sendError(response, 404, 'NOT_FOUND');
        return;
      }
      // Only file system failures reach here (fallthrough turns 4xx into a plain "not found").
      console.error('static file error:', error instanceof Error ? error.message : String(error));
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(response, 500, 'INTERNAL_ERROR');
    });
  };
}
