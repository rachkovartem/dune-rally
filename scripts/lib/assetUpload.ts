// scripts/lib/assetUpload.ts
// Publishing public/ to the asset CDN: content-hashed object keys plus one manifest that maps
// logical paths to them. The client side of the same contract lives in src/assets/assetUrls.ts.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ASSET_MANIFEST_FILE, ASSET_MANIFEST_VERSION, parseAssetManifest, type AssetManifest,
} from '../../src/assets/assetUrls';
import { carDefinitionFor } from '../../src/assets/carCatalog';
import { CAR_IDS } from '../../src/vehicle/cars';

export const ASSET_BUCKET = 'coreplex-assets';
export const DEFAULT_ASSET_BASE_URL = 'https://assets.coreplex.cc';
/** The page that loads the assets; the CORS check sends it as the Origin header. */
export const DEFAULT_PAGE_ORIGIN = 'https://rally.coreplex.cc';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const MANIFEST_CACHE_CONTROL = 'no-cache';
export const HASH_LENGTH = 10;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

/** One file from public/: its logical path (as the client asks for it) and its content hash. */
export interface AssetFile {
  path: string;
  absolutePath: string;
  sha256Hex: string;
}

/** A car model that is built on the owner's machine and never committed. */
export interface LocalModel {
  path: string;
  requiredToPlay: boolean;
}

export interface ObjectHeaders {
  contentType: string;
  cacheControl: string;
}

export type FetchedJson =
  | { found: false }
  | { found: true; body: unknown; allowOrigin: string | null };

/** Keys are relative to this game's folder in the bucket. */
export interface ObjectStore {
  exists(key: string): Promise<boolean>;
  putFile(key: string, filePath: string, headers: ObjectHeaders): Promise<void>;
  putJson(key: string, body: unknown, headers: ObjectHeaders): Promise<void>;
  getJson(key: string): Promise<FetchedJson>;
}

export type ReadOnlyObjectStore = Pick<ObjectStore, 'exists' | 'getJson'>;

function extensionOf(path: string): string {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex <= 0 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function withoutLeadingSlashes(path: string): string {
  return path.replace(/^\/+/, '');
}

/** `models/forester-2019.glb` + hash → `models/forester-2019.<first 10 hex>.glb`. */
export function hashedKey(path: string, sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new Error(`not a SHA-256 hex digest for ${path}: "${sha256Hex}"`);
  const extension = extensionOf(path);
  if (extension === '') throw new Error(`asset has no file extension: ${path}`);
  const withoutExtension = path.slice(0, path.length - extension.length);
  return `${withoutExtension}.${sha256Hex.slice(0, HASH_LENGTH)}${path.slice(path.length - extension.length)}`;
}

export function contentTypeFor(path: string): string {
  const contentType = CONTENT_TYPES[extensionOf(path)];
  if (contentType === undefined) {
    throw new Error(`no content type for ${path}: add its extension to CONTENT_TYPES in scripts/lib/assetUpload.ts`);
  }
  return contentType;
}

/** Notes (`*.md`) and hidden files such as `.DS_Store` stay out of the bucket. */
export function isPublishable(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  return !fileName.startsWith('.') && extensionOf(path) !== '.md';
}

export async function sha256OfFile(absolutePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(absolutePath)).digest('hex');
}

/** Every publishable file under `publicDir`, sorted by logical path. */
export async function collectPublicFiles(publicDir: string): Promise<AssetFile[]> {
  const entries = await readdir(publicDir, { recursive: true, withFileTypes: true });
  const files: AssetFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = join(entry.parentPath, entry.name);
    const path = absolutePath.slice(publicDir.length + 1).split(/[\\/]/).join('/');
    if (!isPublishable(path)) continue;
    files.push({ path, absolutePath, sha256Hex: await sha256OfFile(absolutePath) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** The car catalog already knows which models are built locally and which one the game needs. */
export function localModelsFromCatalog(): LocalModel[] {
  return CAR_IDS.flatMap((carId) => {
    const definition = carDefinitionFor(carId);
    if (definition.localModel === null) return [];
    return [{ path: withoutLeadingSlashes(definition.modelUrl), requiredToPlay: definition.localModel.requiredToPlay }];
  });
}

export function buildManifest(files: Readonly<Record<string, string>>): AssetManifest {
  const sorted: Record<string, string> = {};
  for (const path of Object.keys(files).sort()) sorted[path] = files[path];
  return { version: ASSET_MANIFEST_VERSION, files: sorted };
}

export interface UploadPlan {
  files: AssetFile[];
  /** Entries copied from the published manifest for local models this machine does not have. */
  kept: Record<string, string>;
  warnings: string[];
}

/**
 * The manifest is rewritten in full on every run, so a local model missing on this machine
 * would drop out of it. Its previous entry is kept instead, and said out loud.
 */
export function planUpload(options: {
  files: readonly AssetFile[];
  localModels: readonly LocalModel[];
  previous: AssetManifest | null;
}): UploadPlan {
  const { files, localModels, previous } = options;
  const present = new Set(files.map((file) => file.path));
  const kept: Record<string, string> = {};
  const warnings: string[] = [];
  const missingRequired: string[] = [];
  for (const model of localModels) {
    if (present.has(model.path)) continue;
    const previousKey = previous?.files[model.path];
    if (previousKey !== undefined) {
      kept[model.path] = previousKey;
      warnings.push(`${model.path} is not on this machine: keeping the published ${previousKey}`);
    } else if (model.requiredToPlay) {
      missingRequired.push(model.path);
    } else {
      warnings.push(`${model.path} is not on this machine and was never published: this car stays out of the picker`);
    }
  }
  if (missingRequired.length > 0) {
    throw new Error(`required model(s) missing in public/ and never published: ${missingRequired.join(', ')} — build them with scripts/convert-*.ts first`);
  }
  return { files: [...files], kept, warnings };
}

async function runWithLimit<Item>(items: readonly Item[], limit: number, worker: (item: Item) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // After the first failure the other runners stop taking new items instead of uploading on.
    while (!failed && nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await worker(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(runners);
}

export interface UploadResult {
  uploaded: string[];
  skipped: string[];
  manifest: AssetManifest;
}

/**
 * Uploads every file whose hashed key is not in the store yet, then writes the manifest.
 * Any failed upload rejects before the manifest is written, so it never lists a missing object.
 */
export async function uploadSet(options: {
  store: ObjectStore;
  plan: UploadPlan;
  concurrency: number;
  onFile?: (path: string, status: 'uploaded' | 'skipped') => void;
}): Promise<UploadResult> {
  const { store, plan, concurrency, onFile } = options;
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const entries: Record<string, string> = { ...plan.kept };
  await runWithLimit(plan.files, concurrency, async (file) => {
    const key = hashedKey(file.path, file.sha256Hex);
    if (await store.exists(key)) {
      skipped.push(key);
      onFile?.(file.path, 'skipped');
    } else {
      await store.putFile(key, file.absolutePath, { contentType: contentTypeFor(file.path), cacheControl: IMMUTABLE_CACHE_CONTROL });
      uploaded.push(key);
      onFile?.(file.path, 'uploaded');
    }
    entries[file.path] = key;
  });
  const manifest = buildManifest(entries);
  await store.putJson(ASSET_MANIFEST_FILE, manifest, { contentType: contentTypeFor(ASSET_MANIFEST_FILE), cacheControl: MANIFEST_CACHE_CONTROL });
  return { uploaded: uploaded.sort(), skipped: skipped.sort(), manifest };
}

/** Reads the published manifest; not published yet → null, anything else broken → throws. */
export async function readPublishedManifest(store: ReadOnlyObjectStore): Promise<AssetManifest | null> {
  const fetched = await store.getJson(ASSET_MANIFEST_FILE);
  return fetched.found ? parseAssetManifest(fetched.body) : null;
}

export interface VerifyResult {
  errors: string[];
  warnings: string[];
}

/**
 * The release gate: the published manifest must list every committed file at the key its
 * current bytes hash to, and every listed object that the game needs must be reachable.
 */
export async function verifyPublished(options: {
  store: ReadOnlyObjectStore;
  committedFiles: readonly AssetFile[];
  localModels: readonly LocalModel[];
  pageOrigin: string;
  concurrency: number;
}): Promise<VerifyResult> {
  const { store, committedFiles, localModels, pageOrigin, concurrency } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  const fetched = await store.getJson(ASSET_MANIFEST_FILE);
  if (!fetched.found) {
    return { errors: [`${ASSET_MANIFEST_FILE} is not published — run npm run assets:upload`], warnings };
  }
  if (fetched.allowOrigin !== '*' && fetched.allowOrigin !== pageOrigin) {
    errors.push(`CORS: the manifest answers ${pageOrigin} with Access-Control-Allow-Origin ${fetched.allowOrigin ?? '(none)'} — set the bucket CORS policy`);
  }
  let manifest: AssetManifest;
  try {
    manifest = parseAssetManifest(fetched.body);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { errors, warnings };
  }

  const toCheck: { key: string; required: boolean }[] = [];
  for (const file of committedFiles) {
    const expectedKey = hashedKey(file.path, file.sha256Hex);
    const publishedKey = manifest.files[file.path];
    if (publishedKey === undefined) {
      errors.push(`${file.path} is not in the manifest — run npm run assets:upload`);
    } else if (publishedKey !== expectedKey) {
      errors.push(`${file.path} changed since the last upload (manifest has ${publishedKey}, expected ${expectedKey}) — run npm run assets:upload`);
    } else {
      toCheck.push({ key: expectedKey, required: true });
    }
  }
  for (const model of localModels) {
    const publishedKey = manifest.files[model.path];
    if (publishedKey !== undefined) {
      toCheck.push({ key: publishedKey, required: model.requiredToPlay });
    } else if (model.requiredToPlay) {
      errors.push(`${model.path} is required to play but is not in the manifest — build it and run npm run assets:upload`);
    } else {
      warnings.push(`${model.path} is not in the manifest: this car will not be in the picker`);
    }
  }

  await runWithLimit(toCheck, concurrency, async ({ key, required }) => {
    if (await store.exists(key)) return;
    const message = `${key} is listed in the manifest but the object is missing`;
    if (required) errors.push(message);
    else warnings.push(message);
  });
  return { errors: errors.sort(), warnings: warnings.sort() };
}

/** An https URL from the environment, or the default; trailing slashes are dropped. */
export function readHttpsUrl(env: Readonly<Record<string, string | undefined>>, name: string, fallback: string): string {
  const raw = env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}"`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must be an https URL, got "${value}"`);
  return value.replace(/\/+$/, '');
}
