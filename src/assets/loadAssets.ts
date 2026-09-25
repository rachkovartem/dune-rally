// src/assets/loadAssets.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { progressFraction } from './loadProgress';

export interface ModelManifestEntry {
  id: string;
  kind: 'model';
  url: string;
}

export interface TextureManifestEntry {
  id: string;
  kind: 'texture';
  url: string;
}

/** A Radiance `.hdr` image, decoded to Float32 pixels. */
export interface HdrManifestEntry {
  id: string;
  kind: 'hdr';
  url: string;
}

export type AssetManifestEntry = ModelManifestEntry | TextureManifestEntry | HdrManifestEntry;

/** Names the file that failed, so a caller can explain a known missing file in its own words. */
export class AssetLoadError extends Error {
  readonly url: string;

  constructor(url: string, reason: string, cause: unknown) {
    super(`${url} (${reason})`, { cause });
    this.name = 'AssetLoadError';
    this.url = url;
  }
}

export interface LoadedAssets {
  models: Map<string, THREE.Group>;
  textures: Map<string, THREE.Texture>;
  hdrs: Map<string, THREE.DataTexture>;
}

/**
 * Loads every entry in the manifest, reporting combined progress as it goes. An empty manifest
 * resolves immediately at 100% — not a special case bolted on to hide a missing file, just the
 * natural result of an empty Promise.all, used by callers that have nothing to load yet.
 * Entries hold logical paths; `resolveUrl` turns each into the URL to load, and errors keep the
 * logical path so callers can still tell which file failed.
 */
export async function loadAssets(
  manifest: readonly AssetManifestEntry[],
  onProgress: ((fraction: number) => void) | undefined,
  resolveUrl: (path: string) => string,
): Promise<LoadedAssets> {
  const models = new Map<string, THREE.Group>();
  const textures = new Map<string, THREE.Texture>();
  const hdrs = new Map<string, THREE.DataTexture>();

  if (manifest.length === 0) {
    onProgress?.(1);
    return { models, textures, hdrs };
  }

  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const textureLoader = new THREE.TextureLoader();
  const hdrLoader = new HDRLoader().setDataType(THREE.FloatType);

  const progress = new Map<string, { loaded: number; total: number }>();
  for (const entry of manifest) progress.set(entry.id, { loaded: 0, total: 0 });
  // Promise.all rejects on the first failure while the other files keep loading; their late
  // progress must not overwrite the error the caller shows.
  let failed = false;
  const reportProgress = (): void => {
    if (!failed) onProgress?.(progressFraction([...progress.values()]));
  };

  await Promise.all(
    manifest.map(async (entry) => {
      const onEntryProgress = (event: ProgressEvent): void => {
        progress.set(entry.id, { loaded: event.loaded, total: event.total });
        reportProgress();
      };
      try {
        const url = resolveUrl(entry.url);
        if (entry.kind === 'model') {
          const gltf = await gltfLoader.loadAsync(url, onEntryProgress);
          models.set(entry.id, gltf.scene);
        } else if (entry.kind === 'hdr') {
          const hdr = await hdrLoader.loadAsync(url, onEntryProgress);
          hdrs.set(entry.id, hdr);
        } else {
          const texture = await textureLoader.loadAsync(url, onEntryProgress);
          textures.set(entry.id, texture);
        }
      } catch (error) {
        failed = true;
        if (error instanceof AssetLoadError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new AssetLoadError(entry.url, reason, error);
      }
    }),
  );

  reportProgress();
  return { models, textures, hdrs };
}
