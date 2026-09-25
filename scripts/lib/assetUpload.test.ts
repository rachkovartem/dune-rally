// scripts/lib/assetUpload.test.ts
// Publishing public/ to the asset CDN (deploy T5). The key, type and manifest rules are category 1;
// uploadSet and verifyPublished are category 2 with an in-memory ObjectStore fake.
import { describe, it, expect } from 'vitest';
import {
  IMMUTABLE_CACHE_CONTROL, MANIFEST_CACHE_CONTROL, buildManifest, contentTypeFor, hashedKey, isPublishable, planUpload,
  readHttpsUrl, readPublishedManifest, uploadSet, verifyPublished, withManifestText,
  type AssetFile, type FetchedJson, type LocalModel, type ObjectHeaders, type ObjectStore,
} from './assetUpload';
import { ASSET_MANIFEST_FILE, parseAssetManifest, type AssetManifest } from '../../src/assets/assetUrls';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = '0123456789abcdef'.repeat(4);

const file = (path: string, sha256Hex: string): AssetFile => ({ path, absolutePath: `/public/${path}`, sha256Hex });
const FORESTER: LocalModel = { path: 'models/forester-2019.glb', requiredToPlay: true };
const ELANTRA: LocalModel = { path: 'models/elantra-2016.glb', requiredToPlay: false };

describe('hashedKey — a content-hashed object key (deploy T5)', () => {
  it.each<[string, string, string]>([
    ['models/forester-2019.glb', HASH_C, 'models/forester-2019.0123456789.glb'],
    ['sky/goegap.2k.hdr', HASH_A, 'sky/goegap.2k.aaaaaaaaaa.hdr'],
    ['textures/sand/color.webp', HASH_B, 'textures/sand/color.bbbbbbbbbb.webp'],
    ['sound/manifest.json', HASH_A, 'sound/manifest.aaaaaaaaaa.json'],
  ])('%s → %s', (path, hash, expected) => {
    expect(hashedKey(path, hash)).toBe(expected);
  });

  it('gives changed bytes a new key, so a cached old file is never served for the new one', () => {
    expect(hashedKey('models/a.glb', HASH_A)).not.toBe(hashedKey('models/a.glb', HASH_B));
  });

  it.each(['', 'abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63)])('throws for "%s", which is not a SHA-256 hex digest', (hash) => {
    expect(() => hashedKey('models/a.glb', hash)).toThrow('not a SHA-256 hex digest');
  });

  it.each(['models/README', 'sound/.hidden', 'a.b/noext'])('throws for %s, which has no file extension', (path) => {
    expect(() => hashedKey(path, HASH_A)).toThrow('no file extension');
  });
});

describe('contentTypeFor — the type the CDN sends (deploy T5)', () => {
  it('knows every kind of file the game loads, whatever the case of the extension', () => {
    for (const path of ['models/a.glb', 'models/B.GLB', 'sky/a.hdr', 'textures/a.webp', 'sound/a.wav', 'sound/manifest.json']) {
      expect(contentTypeFor(path)).not.toBe('');
    }
    expect(contentTypeFor('models/B.GLB')).toBe(contentTypeFor('models/a.glb'));
  });

  it.each(['notes/a.txt', 'models/a.fbx', 'models/noext'])('throws for %s instead of uploading it with a guessed type', (path) => {
    expect(() => contentTypeFor(path)).toThrow('no content type');
  });
});

describe('isPublishable — what goes to the bucket (deploy T5)', () => {
  it.each<[string, boolean]>([
    ['models/forester-2019.glb', true],
    ['textures/sand/color.webp', true],
    ['models/SOURCE.md', false],
    ['props/NOTES.MD', false],
    ['.DS_Store', false],
    ['textures/sand/.DS_Store', false],
  ])('%s → %s', (path, expected) => {
    expect(isPublishable(path)).toBe(expected);
  });
});

describe('buildManifest — the manifest the client reads (deploy T5)', () => {
  it('lists the files sorted by path, in the format the client parses', () => {
    const manifest = buildManifest({ 'sky/b.hdr': 'sky/b.1.hdr', 'models/a.glb': 'models/a.2.glb' });
    expect(Object.keys(manifest.files)).toEqual(['models/a.glb', 'sky/b.hdr']);
    expect(parseAssetManifest(manifest)).toEqual(manifest);
  });

  it('builds an empty manifest from no files (the client then refuses it)', () => {
    expect(buildManifest({}).files).toEqual({});
    expect(() => parseAssetManifest(buildManifest({}))).toThrow('files is empty');
  });
});

describe('planUpload — local car models this machine may not have (deploy T5)', () => {
  const previous: AssetManifest = buildManifest({ [FORESTER.path]: 'models/forester-2019.old.glb', [ELANTRA.path]: 'models/elantra-2016.old.glb' });

  it('uploads what is here and keeps nothing extra when every local model is present', () => {
    const files = [file(FORESTER.path, HASH_A), file(ELANTRA.path, HASH_B)];
    const plan = planUpload({ files, localModels: [FORESTER, ELANTRA], previous });
    expect(plan.files).toEqual(files);
    expect(plan.kept).toEqual({});
    expect(plan.warnings).toEqual([]);
  });

  it('keeps the published entry of a model missing here, and says so', () => {
    const plan = planUpload({ files: [file(FORESTER.path, HASH_A)], localModels: [FORESTER, ELANTRA], previous });
    expect(plan.kept).toEqual({ [ELANTRA.path]: 'models/elantra-2016.old.glb' });
    expect(plan.warnings.join('\n')).toContain(ELANTRA.path);
  });

  it('warns about an optional model that was never published, and keeps no entry for it', () => {
    const plan = planUpload({ files: [file(FORESTER.path, HASH_A)], localModels: [FORESTER, ELANTRA], previous: null });
    expect(plan.kept).toEqual({});
    expect(plan.warnings.join('\n')).toContain('stays out of the picker');
  });

  it('keeps the published required model when it is missing here', () => {
    expect(planUpload({ files: [], localModels: [FORESTER], previous }).kept).toEqual({ [FORESTER.path]: 'models/forester-2019.old.glb' });
  });

  it('throws, naming it, for a required model that is missing here and was never published', () => {
    expect(() => planUpload({ files: [], localModels: [FORESTER, ELANTRA], previous: null })).toThrow(FORESTER.path);
  });
});

/** An in-memory bucket that records the order of writes; `failOn` makes one key's upload fail. */
function memoryStore(options: { objects?: Iterable<string>; failOn?: string } = {}): ObjectStore & {
  objects: Map<string, ObjectHeaders>;
  writes: string[];
  manifest: () => unknown;
} {
  const objects = new Map<string, ObjectHeaders>();
  for (const key of options.objects ?? []) objects.set(key, { contentType: 'x', cacheControl: IMMUTABLE_CACHE_CONTROL });
  const writes: string[] = [];
  let manifest: unknown = null;
  return {
    objects,
    writes,
    manifest: () => manifest,
    exists: async (key) => objects.has(key),
    putFile: async (key, _filePath, headers) => {
      if (key === options.failOn) throw new Error(`upload of ${key} failed`);
      objects.set(key, headers);
      writes.push(key);
    },
    putJson: async (key, body, headers) => {
      objects.set(key, headers);
      writes.push(key);
      manifest = body;
    },
    getJson: async (key): Promise<FetchedJson> => (key === ASSET_MANIFEST_FILE && manifest !== null ? { found: true, body: manifest, allowOrigin: '*' } : { found: false }),
  };
}

const FILES = [file('models/a.glb', HASH_A), file('sky/b.hdr', HASH_B), file('sound/c.wav', HASH_C)];
const planOf = (files: readonly AssetFile[], kept: Record<string, string> = {}) => ({ files: [...files], kept, warnings: [] });

describe('uploadSet — files first, the manifest last (deploy T5)', () => {
  it('uploads every file under its hashed key as immutable, then writes the manifest that lists them, as no-cache', async () => {
    const store = memoryStore();
    const result = await uploadSet({ store, plan: planOf(FILES), concurrency: 2 });
    expect(result.uploaded).toEqual(FILES.map((entry) => hashedKey(entry.path, entry.sha256Hex)).sort());
    expect(store.writes[store.writes.length - 1]).toBe(ASSET_MANIFEST_FILE);
    expect(store.objects.get(ASSET_MANIFEST_FILE)?.cacheControl).toBe(MANIFEST_CACHE_CONTROL);
    expect(store.objects.get(hashedKey('models/a.glb', HASH_A))?.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(parseAssetManifest(store.manifest()).files['sky/b.hdr']).toBe(hashedKey('sky/b.hdr', HASH_B));
  });

  it('uploads nothing on a second run with the same bytes, and still writes the manifest', async () => {
    const store = memoryStore();
    await uploadSet({ store, plan: planOf(FILES), concurrency: 2 });
    store.writes.length = 0;
    const again = await uploadSet({ store, plan: planOf(FILES), concurrency: 2 });
    expect(again.uploaded).toEqual([]);
    expect(again.skipped).toHaveLength(FILES.length);
    expect(store.writes).toEqual([ASSET_MANIFEST_FILE]);
  });

  it('uploads changed bytes under a new key and leaves the old object for pages that still use it', async () => {
    const store = memoryStore();
    await uploadSet({ store, plan: planOf([file('models/a.glb', HASH_A)]), concurrency: 1 });
    const changed = await uploadSet({ store, plan: planOf([file('models/a.glb', HASH_B)]), concurrency: 1 });
    expect(changed.uploaded).toEqual([hashedKey('models/a.glb', HASH_B)]);
    expect(store.objects.has(hashedKey('models/a.glb', HASH_A))).toBe(true);
    expect(changed.manifest.files['models/a.glb']).toBe(hashedKey('models/a.glb', HASH_B));
  });

  it('puts a kept entry of a model missing here into the manifest', async () => {
    const result = await uploadSet({ store: memoryStore(), plan: planOf(FILES, { 'models/elantra-2016.glb': 'models/elantra-2016.old.glb' }), concurrency: 2 });
    expect(result.manifest.files['models/elantra-2016.glb']).toBe('models/elantra-2016.old.glb');
  });

  it('rejects on a failed upload and writes no manifest, so the manifest never lists a missing object', async () => {
    // Regression: a manifest written after a partial upload would send every player a 404.
    const store = memoryStore({ failOn: hashedKey('sky/b.hdr', HASH_B) });
    await expect(uploadSet({ store, plan: planOf(FILES), concurrency: 1 })).rejects.toThrow('upload of');
    expect(store.objects.has(ASSET_MANIFEST_FILE)).toBe(false);
  });

  it('stops taking new files after the first failure', async () => {
    const store = memoryStore({ failOn: hashedKey('models/a.glb', HASH_A) });
    await expect(uploadSet({ store, plan: planOf(FILES), concurrency: 1 })).rejects.toThrow();
    expect(store.writes).toEqual([]);
  });
});

describe('readPublishedManifest — the manifest already on the CDN (deploy T5)', () => {
  it('gives null before the first upload, and the parsed manifest after it', async () => {
    const store = memoryStore();
    expect(await readPublishedManifest(store)).toBeNull();
    await uploadSet({ store, plan: planOf(FILES), concurrency: 2 });
    expect(await readPublishedManifest(store)).toEqual(buildManifest(Object.fromEntries(FILES.map((entry) => [entry.path, hashedKey(entry.path, entry.sha256Hex)]))));
  });
});

/** A read-only CDN as the release check sees it over HTTPS. */
function publishedCdn(options: { manifest: unknown | null; allowOrigin?: string | null; objects: Iterable<string> }) {
  const objects = new Set(options.objects);
  return {
    exists: async (key: string) => objects.has(key),
    getJson: async (key: string): Promise<FetchedJson> =>
      key === ASSET_MANIFEST_FILE && options.manifest !== null ? { found: true, body: options.manifest, allowOrigin: options.allowOrigin === undefined ? '*' : options.allowOrigin } : { found: false },
  };
}

describe('verifyPublished — the release gate in CI (deploy T5)', () => {
  const PAGE = 'https://rally.example';
  const committed = [file('sky/b.hdr', HASH_B)];
  const skyKey = hashedKey('sky/b.hdr', HASH_B);
  const foresterKey = 'models/forester-2019.1111111111.glb';
  const elantraKey = 'models/elantra-2016.2222222222.glb';
  const verify = (store: ReturnType<typeof publishedCdn>, localModels: readonly LocalModel[] = [FORESTER, ELANTRA]) =>
    verifyPublished({ store, committedFiles: committed, localModels, pageOrigin: PAGE, concurrency: 2 });
  const fullManifest = buildManifest({ 'sky/b.hdr': skyKey, [FORESTER.path]: foresterKey, [ELANTRA.path]: elantraKey });

  it('passes with no errors and no warnings when everything is published and reachable', async () => {
    expect(await verify(publishedCdn({ manifest: fullManifest, objects: [skyKey, foresterKey, elantraKey] }))).toEqual({ errors: [], warnings: [] });
  });

  it('accepts the page origin itself as the CORS answer', async () => {
    const result = await verify(publishedCdn({ manifest: fullManifest, allowOrigin: PAGE, objects: [skyKey, foresterKey, elantraKey] }));
    expect(result.errors).toEqual([]);
  });

  it('fails when no manifest is published', async () => {
    const result = await verify(publishedCdn({ manifest: null, objects: [] }));
    expect(result.errors.join('\n')).toContain('is not published');
  });

  it.each<[string, string | null]>([['another origin', 'https://evil.example'], ['no CORS header', null]])('fails the CORS check for %s', async (_name, allowOrigin) => {
    const result = await verify(publishedCdn({ manifest: fullManifest, allowOrigin, objects: [skyKey, foresterKey, elantraKey] }));
    expect(result.errors.join('\n')).toContain('CORS');
  });

  it('fails for a broken manifest, with its parse error', async () => {
    const result = await verify(publishedCdn({ manifest: { version: 9, files: {} }, objects: [] }));
    expect(result.errors.join('\n')).toContain('version must be 1');
  });

  it('fails for a committed file that changed since the last upload', async () => {
    const stale = buildManifest({ 'sky/b.hdr': hashedKey('sky/b.hdr', HASH_A), [FORESTER.path]: foresterKey });
    const result = await verify(publishedCdn({ manifest: stale, objects: [hashedKey('sky/b.hdr', HASH_A), foresterKey] }), [FORESTER]);
    expect(result.errors.join('\n')).toContain('changed since the last upload');
  });

  it('fails for a committed file the manifest does not list', async () => {
    const result = await verify(publishedCdn({ manifest: buildManifest({ [FORESTER.path]: foresterKey }), objects: [foresterKey] }), [FORESTER]);
    expect(result.errors.join('\n')).toContain('sky/b.hdr is not in the manifest');
  });

  it('fails when the Forester (required to play) is not in the manifest, but only warns for the Elantra', async () => {
    const result = await verify(publishedCdn({ manifest: buildManifest({ 'sky/b.hdr': skyKey }), objects: [skyKey] }));
    expect(result.errors.join('\n')).toContain(FORESTER.path);
    expect(result.errors.join('\n')).not.toContain(ELANTRA.path);
    expect(result.warnings.join('\n')).toContain(ELANTRA.path);
  });

  it('fails for a listed required object that is missing, and only warns for a missing optional one', async () => {
    const result = await verify(publishedCdn({ manifest: fullManifest, objects: [skyKey] }));
    expect(result.errors.join('\n')).toContain(foresterKey);
    expect(result.errors.join('\n')).not.toContain(elantraKey);
    expect(result.warnings.join('\n')).toContain(elantraKey);
  });
});

describe('withManifestText — the release checks the manifest baked into its image (release review)', () => {
  const PAGE = 'https://rally.example';
  const committed = [file('sky/b.hdr', HASH_B)];
  const skyKey = hashedKey('sky/b.hdr', HASH_B);
  const oldSkyKey = hashedKey('sky/b.hdr', HASH_A);
  const foresterKey = 'models/forester-2019.1111111111.glb';
  const bakedManifest = buildManifest({ 'sky/b.hdr': skyKey, [FORESTER.path]: foresterKey });
  const cdnManifest = buildManifest({ 'sky/b.hdr': oldSkyKey, [FORESTER.path]: foresterKey });
  const verify = (store: Parameters<typeof withManifestText>[0]) =>
    verifyPublished({ store, committedFiles: committed, localModels: [FORESTER], pageOrigin: PAGE, concurrency: 2 });

  it('reads the manifest from the text, not the one on the CDN', async () => {
    const store = withManifestText(publishedCdn({ manifest: cdnManifest, objects: [] }), JSON.stringify(bakedManifest));
    expect(await readPublishedManifest(store)).toEqual(bakedManifest);
  });

  it('passes the release when the baked manifest matches the files and every object it lists is on the CDN', async () => {
    const store = withManifestText(publishedCdn({ manifest: cdnManifest, objects: [skyKey, foresterKey] }), JSON.stringify(bakedManifest));
    expect(await verify(store)).toEqual({ errors: [], warnings: [] });
  });

  it('still asks the CDN whether each object exists: a listed object that is missing fails', async () => {
    const store = withManifestText(publishedCdn({ manifest: cdnManifest, objects: [skyKey] }), JSON.stringify(bakedManifest));
    expect((await verify(store)).errors.join('\n')).toContain(foresterKey);
  });

  it('takes the CORS answer from the CDN: no manifest there means no CORS header, and the check fails', async () => {
    const store = withManifestText(publishedCdn({ manifest: null, objects: [skyKey, foresterKey] }), JSON.stringify(bakedManifest));
    expect((await verify(store)).errors.join('\n')).toContain('CORS');
  });

  it('answers any other key from the CDN as it is', async () => {
    const otherAnswer: FetchedJson = { found: true, body: { note: 'from the CDN' }, allowOrigin: PAGE };
    const cdn = {
      exists: async () => false,
      getJson: async (key: string): Promise<FetchedJson> => (key === 'other.json' ? otherAnswer : { found: false }),
    };
    expect(await withManifestText(cdn, JSON.stringify(bakedManifest)).getJson('other.json')).toEqual(otherAnswer);
  });

  it('throws when the baked text is not JSON', async () => {
    const store = withManifestText(publishedCdn({ manifest: cdnManifest, objects: [] }), '<!doctype html>');
    await expect(readPublishedManifest(store)).rejects.toThrow(SyntaxError);
  });
});

describe('readHttpsUrl — a CDN or page URL from the environment (deploy T5)', () => {
  it('takes the default when the variable is unset or empty', () => {
    expect(readHttpsUrl({}, 'ASSET_BASE_URL', 'https://assets.example')).toBe('https://assets.example');
    expect(readHttpsUrl({ ASSET_BASE_URL: '  ' }, 'ASSET_BASE_URL', 'https://assets.example')).toBe('https://assets.example');
  });

  it('drops trailing slashes', () => {
    expect(readHttpsUrl({ ASSET_BASE_URL: 'https://cdn.example/x//' }, 'ASSET_BASE_URL', 'https://assets.example')).toBe('https://cdn.example/x');
  });

  it('throws for a plain http URL and for text that is not a URL, naming the variable', () => {
    expect(() => readHttpsUrl({ ASSET_BASE_URL: 'http://cdn.example' }, 'ASSET_BASE_URL', 'https://a.example')).toThrow('ASSET_BASE_URL must be an https URL');
    expect(() => readHttpsUrl({ ASSET_BASE_URL: 'cdn' }, 'ASSET_BASE_URL', 'https://a.example')).toThrow('ASSET_BASE_URL is not a valid URL');
  });
});
