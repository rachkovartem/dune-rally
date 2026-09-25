// src/assets/assetUrls.ts
import { AssetLoadError } from './loadAssets';

/** The upload script's output: logical path (relative to public/) → hashed object key under the asset root. */
export interface AssetManifest {
  version: 1;
  files: Readonly<Record<string, string>>;
}

/** The only manifest format this client can read; a newer upload script must bump it. */
export const ASSET_MANIFEST_VERSION = 1;
/** Folder of this game inside the shared asset bucket. */
export const ASSET_PREFIX = 'dune-rally';
export const ASSET_MANIFEST_FILE = 'assets-manifest.json';

export type AssetResolver = (path: string) => string;

/** The part of `fetch` the manifest loader needs; a port, so the loader runs without a network in tests. */
export type FetchJson = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;

export class AssetManifestError extends Error {
  constructor(message: string) {
    super(`asset manifest: ${message}`);
    this.name = 'AssetManifestError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the JSON of the asset manifest; a bad field throws with its path. */
export function parseAssetManifest(json: unknown): AssetManifest {
  if (!isRecord(json)) throw new AssetManifestError('expected an object with "version" and "files"');
  if (json.version !== ASSET_MANIFEST_VERSION) {
    throw new AssetManifestError(`version must be ${ASSET_MANIFEST_VERSION}, got ${JSON.stringify(json.version)}`);
  }
  const rawFiles = json.files;
  if (!isRecord(rawFiles)) throw new AssetManifestError('files must be an object');
  const files: Record<string, string> = {};
  for (const [path, key] of Object.entries(rawFiles)) {
    if (typeof key !== 'string' || key === '') throw new AssetManifestError(`files["${path}"] must be a non-empty string`);
    files[path] = key;
  }
  if (Object.keys(files).length === 0) throw new AssetManifestError('files is empty');
  return { version: ASSET_MANIFEST_VERSION, files };
}

const withoutLeadingSlashes = (path: string): string => path.replace(/^\/+/, '');
const withoutTrailingSlashes = (url: string): string => url.replace(/\/+$/, '');

/** Where this game's files live under the CDN base URL, with no trailing slash. */
export function assetRootFor(baseUrl: string): string {
  return `${withoutTrailingSlashes(baseUrl)}/${ASSET_PREFIX}`;
}

/**
 * Maps a logical asset path to the URL to load. With no base URL (dev) the path is served from
 * public/ as it is. On the CDN a path the manifest does not list throws: an unhashed URL would
 * point at a file that was never uploaded.
 */
export function createAssetResolver(options: { baseUrl: string | null; files: Readonly<Record<string, string>> }): AssetResolver {
  const { baseUrl, files } = options;
  if (baseUrl === null) return (path) => `/${withoutLeadingSlashes(path)}`;
  const root = withoutTrailingSlashes(baseUrl);
  return (path) => {
    const key = files[withoutLeadingSlashes(path)];
    if (key === undefined) throw new AssetLoadError(path, 'not in the asset manifest', null);
    return `${root}/${withoutLeadingSlashes(key)}`;
  };
}

/** Fetches and parses the manifest; any answer but 200 throws, because without it no file can be found. */
export async function loadAssetManifest(options: { url: string; fetchJson: FetchJson }): Promise<AssetManifest> {
  const { url, fetchJson } = options;
  let response: Awaited<ReturnType<FetchJson>>;
  try {
    response = await fetchJson(url);
  } catch (error) {
    throw new AssetLoadError(url, error instanceof Error ? error.message : String(error), error);
  }
  if (response.status !== 200) throw new AssetLoadError(url, `HTTP ${response.status}`, null);
  return parseAssetManifest(await response.json());
}
