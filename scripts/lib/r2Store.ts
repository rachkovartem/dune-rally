// scripts/lib/r2Store.ts
// The ObjectStore over Cloudflare R2. Writes go through the wrangler CLI with the owner's own
// `wrangler login`, so no R2 credentials exist anywhere; reads use the public HTTPS domain.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FetchedJson, ObjectHeaders, ObjectStore } from './assetUpload';

const HTTP_TIMEOUT_MS = 20_000;
const WRANGLER_TIMEOUT_MS = 180_000;

export interface R2StoreOptions {
  bucket: string;
  /** Folder of this game inside the bucket, no slashes around it. */
  prefix: string;
  /** Public URL of the same folder, for example https://assets.coreplex.cc/dune-rally. */
  publicRoot: string;
  /** Sent as Origin on manifest reads, so the answer shows the CORS header the browser will get. */
  pageOrigin: string;
}

function wranglerEntry(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
}

// Cloudflare may keep a short-lived cached 404 for a key that was uploaded a moment ago;
// a unique query string makes each check reach R2 itself.
function uncachedUrl(publicRoot: string, key: string): string {
  return `${publicRoot}/${key}?check=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Node's fetch reports every network problem as "fetch failed"; the real reason is in `cause`.
async function fetchOrExplain(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    throw new Error(`${init.method ?? 'GET'} ${url.slice(0, url.indexOf('?'))} failed: ${cause}`);
  }
}

function runWrangler(args: readonly string[]): Promise<void> {
  const entry = wranglerEntry();
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [entry, ...args], { timeout: WRANGLER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      const details = stderr.trim().split('\n').slice(-15).join('\n');
      reject(new Error(
        `wrangler ${args.slice(0, 4).join(' ')} failed:\n${details}\n`
        + 'Hint: run "npx wrangler login" once; with several Cloudflare accounts also set CLOUDFLARE_ACCOUNT_ID.',
      ));
    });
  });
}

export function createR2Store(options: R2StoreOptions): ObjectStore {
  const { bucket, prefix, publicRoot, pageOrigin } = options;

  const putFile = async (key: string, filePath: string, headers: ObjectHeaders): Promise<void> => {
    await runWrangler([
      'r2', 'object', 'put', `${bucket}/${prefix}/${key}`,
      '--file', filePath,
      '--content-type', headers.contentType,
      '--cache-control', headers.cacheControl,
      '--remote',
    ]);
  };

  return {
    async exists(key) {
      const url = uncachedUrl(publicRoot, key);
      const response = await fetchOrExplain(url, { method: 'HEAD', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (response.status === 200) return true;
      if (response.status === 404) return false;
      throw new Error(`HEAD ${publicRoot}/${key}: HTTP ${response.status}`);
    },

    putFile,

    async putJson(key, body, headers) {
      const directory = await mkdtemp(join(tmpdir(), 'dune-rally-assets-'));
      try {
        const filePath = join(directory, 'body.json');
        await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`);
        await putFile(key, filePath, headers);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },

    async getJson(key): Promise<FetchedJson> {
      const url = uncachedUrl(publicRoot, key);
      const response = await fetchOrExplain(url, {
        headers: { Origin: pageOrigin },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (response.status === 404) return { found: false };
      if (response.status !== 200) throw new Error(`GET ${publicRoot}/${key}: HTTP ${response.status}`);
      const body: unknown = await response.json();
      return { found: true, body, allowOrigin: response.headers.get('access-control-allow-origin') };
    },
  };
}
