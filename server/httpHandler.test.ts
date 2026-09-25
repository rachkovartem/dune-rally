// server/httpHandler.test.ts
// Category 4 (wraps HTTP and the file system): the plain routes next to Colyseus, run against a
// real http.Server on port 0 and a temporary built client (deploy T3).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestHandler, HEALTH_PATH, IMMUTABLE_CACHE_CONTROL, REVALIDATE_CACHE_CONTROL, type ServerStats } from './httpHandler';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so a path like "/../x" reaches the server as written. */
function send(server: Server, method: string, path: string): Promise<Reply> {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the test server is not listening on a port');
  const { port } = address;
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path }, (incoming) => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const STATS: ServerStats = { rooms: 3, clients: 7 };
let root = '';
let production: Server;
let development: Server;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'dune-rally-http-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  writeFileSync(join(dist, 'assets', 'main-abc123.js'), 'console.log(1);');
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
  // A file next to dist: a path that climbs out of dist must never reach it.
  writeFileSync(join(root, 'secret.txt'), 'outside the client');
  production = createServer(createRequestHandler({ distDir: dist, stats: () => STATS }));
  development = createServer(createRequestHandler({ distDir: null, stats: () => STATS }));
  await listen(production);
  await listen(development);
});

afterAll(async () => {
  await close(production);
  await close(development);
  rmSync(root, { recursive: true, force: true });
});

describe('createRequestHandler — /health (deploy T3)', () => {
  it('answers 200 with the live room and player counts, never cached', async () => {
    const reply = await send(production, 'GET', HEALTH_PATH);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true, rooms: 3, clients: 7 });
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('answers in dev too, where there is no built client', async () => {
    expect((await send(development, 'GET', HEALTH_PATH)).status).toBe(200);
  });

  it('ignores a query string on the probe', async () => {
    expect((await send(production, 'GET', `${HEALTH_PATH}?from=docker`)).status).toBe(200);
  });
});

describe('createRequestHandler — the built client (deploy T3)', () => {
  it('serves index.html at / and asks the browser to check it on every visit', async () => {
    const reply = await send(production, 'GET', '/');
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('<title>shell</title>');
    expect(reply.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it('serves a hashed bundle file under /assets/ as cached for good', async () => {
    const reply = await send(production, 'GET', '/assets/main-abc123.js');
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('console.log(1);');
    expect(reply.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it('does not cache for good a file outside /assets/ (its name has no hash)', async () => {
    const reply = await send(production, 'GET', '/favicon.svg');
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it('answers HEAD like GET, without a body', async () => {
    const reply = await send(production, 'HEAD', '/');
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('');
  });

  it('answers a missing file with a JSON 404', async () => {
    const reply = await send(production, 'GET', '/assets/missing.js');
    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.body)).toEqual({ error: 'NOT_FOUND' });
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt'])('never serves a file outside the client for %s', async (path) => {
    const reply = await send(production, 'GET', path);
    expect(reply.status).not.toBe(200);
    expect(reply.body).not.toContain('outside the client');
  });

  it('answers everything but /health with 404 in dev, where Vite serves the client', async () => {
    expect((await send(development, 'GET', '/')).status).toBe(404);
    expect((await send(development, 'GET', '/assets/main-abc123.js')).status).toBe(404);
  });

  it.each(['POST', 'PUT', 'DELETE'])('refuses %s with 405 and names the allowed methods', async (method) => {
    const reply = await send(production, method, '/');
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe('GET, HEAD');
    expect(JSON.parse(reply.body)).toEqual({ error: 'METHOD_NOT_ALLOWED' });
  });
});

describe('createRequestHandler — a request line with no valid URL (release review)', () => {
  // "//[bad/" reads as a host part with a broken IPv6 address, which the URL parser cannot take.
  const MALFORMED_PATH = '//[bad/';

  it.each([['production', () => production], ['dev', () => development]])('answers a malformed URL with a JSON 400 in %s', async (_name, server) => {
    const reply = await send(server(), 'GET', MALFORMED_PATH);
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)).toEqual({ error: 'BAD_REQUEST' });
  });

  it('keeps serving after a malformed URL: the next request still gets its answer', async () => {
    await send(production, 'GET', MALFORMED_PATH);
    const reply = await send(production, 'GET', HEALTH_PATH);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true, rooms: 3, clients: 7 });
  });
});
