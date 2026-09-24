// src/assets/loadAssets.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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

export type AssetManifestEntry = ModelManifestEntry | TextureManifestEntry;

export interface LoadedAssets {
  models: Map<string, THREE.Group>;
  textures: Map<string, THREE.Texture>;
}

/**
 * Loads every entry in the manifest, reporting combined progress as it goes. An empty manifest
 * resolves immediately at 100% — not a special case bolted on to hide a missing file, just the
 * natural result of an empty Promise.all, used by callers that have nothing to load yet.
 */
export async function loadAssets(
  manifest: readonly AssetManifestEntry[],
  onProgress?: (fraction: number) => void,
): Promise<LoadedAssets> {
  const models = new Map<string, THREE.Group>();
  const textures = new Map<string, THREE.Texture>();

  if (manifest.length === 0) {
    onProgress?.(1);
    return { models, textures };
  }

  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const textureLoader = new THREE.TextureLoader();

  const progress = new Map<string, { loaded: number; total: number }>();
  for (const entry of manifest) progress.set(entry.id, { loaded: 0, total: 0 });
  const reportProgress = (): void => onProgress?.(progressFraction([...progress.values()]));

  await Promise.all(
    manifest.map(async (entry) => {
      const onEntryProgress = (event: ProgressEvent): void => {
        progress.set(entry.id, { loaded: event.loaded, total: event.total });
        reportProgress();
      };
      if (entry.kind === 'model') {
        const gltf = await gltfLoader.loadAsync(entry.url, onEntryProgress);
        models.set(entry.id, gltf.scene);
      } else {
        const texture = await textureLoader.loadAsync(entry.url, onEntryProgress);
        textures.set(entry.id, texture);
      }
    }),
  );

  reportProgress();
  return { models, textures };
}
