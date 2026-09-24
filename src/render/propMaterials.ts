// src/render/propMaterials.ts
// Shared PBR materials per prop/building kind — one instance per kind, reused by every chunk's
// scatter group (rule: no per-instance material; chunks stream in/out all session long).
import * as THREE from 'three';

export interface PropTextureSet {
  color: THREE.Texture;
  normal: THREE.Texture;
}

/** One texture set per prop kind, matching `PROP_TEXTURE_SETS` in `textureManifest.ts`. */
export interface PropTextureSets {
  rock: PropTextureSet;
  bark: PropTextureSet;
  stucco: PropTextureSet;
  roof: PropTextureSet;
  metal: PropTextureSet;
  wood: PropTextureSet;
}

export interface PropMaterials {
  rock: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  bush: THREE.MeshStandardMaterial;
  cactus: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial[];
  roof: THREE.MeshStandardMaterial;
  ramp: THREE.MeshStandardMaterial;
  beaconMetal: THREE.MeshStandardMaterial;
  windmillTower: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
}

function texturedMaterial(set: PropTextureSet, tint: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.color, normalMap: set.normal, color: tint, roughness, metalness: 0,
  });
}

function flatMaterial(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/** One shared material per kind, built from the already-loaded prop texture sets
 * (`PROP_TEXTURE_SETS` in `textureManifest.ts`). Low-poly primitives keep their geometry — only
 * the material changes. */
export function createPropMaterials(sets: PropTextureSets): PropMaterials {
  return {
    rock: texturedMaterial(sets.rock, 0xffffff, 0.95),
    bark: texturedMaterial(sets.bark, 0xffffff, 0.95),
    leaf: flatMaterial(0x3c6a2e, 0.85),
    bush: flatMaterial(0x4f7a32, 0.85),
    cactus: flatMaterial(0x4a7a40, 0.8),
    wall: [
      texturedMaterial(sets.stucco, 0xb89b72, 0.9),
      texturedMaterial(sets.stucco, 0xa67c52, 0.9),
      texturedMaterial(sets.stucco, 0xc9b489, 0.9),
      texturedMaterial(sets.stucco, 0x9c8466, 0.9),
    ],
    roof: texturedMaterial(sets.roof, 0xffffff, 0.8),
    ramp: texturedMaterial(sets.wood, 0xffffff, 0.75),
    beaconMetal: texturedMaterial(sets.metal, 0xb6bcc4, 0.35),
    windmillTower: texturedMaterial(sets.stucco, 0xcdb9a0, 0.85),
    blade: texturedMaterial(sets.metal, 0x3a3a3a, 0.4),
  };
}
