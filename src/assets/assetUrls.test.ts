// src/assets/assetUrls.test.ts
// The client side of the asset manifest contract (deploy T1): parse and resolve are category 1,
// the loader is category 2 with an in-memory FetchJson port.
import { describe, it, expect } from 'vitest';
import {
  ASSET_PREFIX, AssetManifestError, assetRootFor, createAssetResolver, loadAssetManifest, parseAssetManifest, type FetchJson,
} from './assetUrls';
import { AssetLoadError } from './loadAssets';

const MANIFEST = { version: 1, files: { 'models/forester-2019.glb': 'models/forester-2019.0123456789.glb', 'sky/goegap_2k.hdr': 'sky/goegap_2k.abcdefabcd.hdr' } };

describe('parseAssetManifest — the manifest the upload script writes (deploy T1)', () => {
  it('reads a valid manifest', () => {
    expect(parseAssetManifest(MANIFEST)).toEqual(MANIFEST);
  });

  it.each<[string, unknown, string]>([
    ['not an object', 'manifest', 'expected an object'],
    ['an array', [MANIFEST], 'expected an object'],
    ['a newer version', { ...MANIFEST, version: 2 }, 'version must be 1'],
    ['no version', { files: MANIFEST.files }, 'version must be 1'],
    ['no files', { version: 1 }, 'files must be an object'],
    ['files as a list', { version: 1, files: ['a'] }, 'files must be an object'],
    ['an empty files object', { version: 1, files: {} }, 'files is empty'],
    ['a key that is not text', { version: 1, files: { 'models/a.glb': 7 } }, 'files["models/a.glb"] must be a non-empty string'],
    ['an empty key', { version: 1, files: { 'models/a.glb': '' } }, 'files["models/a.glb"] must be a non-empty string'],
  ])('throws for %s, naming the bad field', (_name, json, message) => {
    expect(() => parseAssetManifest(json)).toThrow(AssetManifestError);
    expect(() => parseAssetManifest(json)).toThrow(message);
  });
});

describe('createAssetResolver — a logical path to the URL the browser loads (deploy T1)', () => {
  it('serves every path from public/ in dev, with one leading slash', () => {
    const resolve = createAssetResolver({ baseUrl: null, files: {} });
    expect(resolve('models/forester-2019.glb')).toBe('/models/forester-2019.glb');
    expect(resolve('//sound/manifest.json')).toBe('/sound/manifest.json');
  });

  it.each(['https://assets.example/dune-rally', 'https://assets.example/dune-rally/'])('joins the hashed key to the root %s with exactly one slash', (baseUrl) => {
    const resolve = createAssetResolver({ baseUrl, files: MANIFEST.files });
    expect(resolve('models/forester-2019.glb')).toBe('https://assets.example/dune-rally/models/forester-2019.0123456789.glb');
    expect(resolve('/sky/goegap_2k.hdr')).toBe('https://assets.example/dune-rally/sky/goegap_2k.abcdefabcd.hdr');
  });

  it('throws an AssetLoadError that carries the logical path for a file the manifest does not list', () => {
    // Regression: main.ts withdraws an optional car from the picker by matching error.url with
    // the car's logical model path; a resolved or empty URL there would crash the start instead.
    const resolve = createAssetResolver({ baseUrl: 'https://assets.example/dune-rally', files: MANIFEST.files });
    let thrown: unknown = null;
    try {
      resolve('models/elantra-2016.glb');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AssetLoadError);
    expect(thrown instanceof AssetLoadError ? thrown.url : '').toBe('models/elantra-2016.glb');
  });
});

describe('assetRootFor — this game\'s folder on the CDN', () => {
  it.each(['https://assets.example', 'https://assets.example/', 'https://assets.example///'])('puts the game folder under %s with one slash', (baseUrl) => {
    expect(assetRootFor(baseUrl)).toBe(`https://assets.example/${ASSET_PREFIX}`);
  });
});

/** An in-memory FetchJson: a table of URL → answer; a URL missing from it fails like a dead network. */
function fakeFetch(answers: Readonly<Record<string, { status: number; body: unknown }>>): FetchJson {
  return async (url) => {
    const answer = answers[url];
    if (!answer) throw new TypeError(`network down for ${url}`);
    return { status: answer.status, json: async () => answer.body };
  };
}

describe('loadAssetManifest — the manifest from the CDN (deploy T1)', () => {
  const MANIFEST_URL = 'https://assets.example/dune-rally/assets-manifest.json';

  it('gives the parsed manifest for a 200 answer', async () => {
    expect(await loadAssetManifest({ url: MANIFEST_URL, fetchJson: fakeFetch({ [MANIFEST_URL]: { status: 200, body: MANIFEST } }) })).toEqual(MANIFEST);
  });

  it.each([404, 500, 304])('throws an AssetLoadError naming the manifest URL for HTTP %s: without it no file can be found', async (status) => {
    const loading = loadAssetManifest({ url: MANIFEST_URL, fetchJson: fakeFetch({ [MANIFEST_URL]: { status, body: MANIFEST } }) });
    await expect(loading).rejects.toBeInstanceOf(AssetLoadError);
    await expect(loading).rejects.toThrow(`HTTP ${status}`);
  });

  it('throws an AssetLoadError naming the URL when the network fails', async () => {
    const loading = loadAssetManifest({ url: MANIFEST_URL, fetchJson: fakeFetch({}) });
    await expect(loading).rejects.toBeInstanceOf(AssetLoadError);
    await expect(loading).rejects.toThrow('network down');
  });

  it('throws the manifest error for a 200 answer with a broken body', async () => {
    await expect(loadAssetManifest({ url: MANIFEST_URL, fetchJson: fakeFetch({ [MANIFEST_URL]: { status: 200, body: { version: 1, files: {} } } }) })).rejects.toThrow(AssetManifestError);
  });
});
