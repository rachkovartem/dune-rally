// src/render/polyProps.ts
// The drive prototype's Poly Haven props: prepared once from the loaded GLBs, cloned per placement.
// Clones share geometry and materials, so a chunk that unloads disposes nothing.
import * as THREE from 'three';
import { POLY_PROP_IDS, type PolyPropId } from '../world/propIds';

export { POLY_PROP_IDS } from '../world/propIds';

export const GRASS_MODEL_ID = 'grass_medium_02';

export function polyPropUrl(id: string): string {
  return `/props/${id}.glb`;
}

/** Boulders and the log stop the car; the bush folds over and the stones are pebbles. */
const SOLID_PROPS: Record<PolyPropId, boolean> = {
  namaqualand_boulder_02: true,
  namaqualand_boulder_03: true,
  namaqualand_boulder_05: true,
  dead_tree_trunk_02: true,
  namaqualand_stones_01: false,
  wild_rooibos_bush: false,
};

/** A box collider in world space, from the model's own bounds times its placed scale. */
export interface SolidProp {
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

interface PropTemplate {
  root: THREE.Object3D;
  bounds: THREE.Box3;
}

const templates = new Map<PolyPropId, PropTemplate>();

function prepareMaterial(material: THREE.Material, id: PolyPropId): void {
  // Blended leaves sort badly against each other; a cut-out with depth writes does not.
  if (material.transparent) {
    material.transparent = false;
    material.alphaTest = 0.5;
    material.depthWrite = true;
  }
  material.side = THREE.DoubleSide;
  if (id === 'wild_rooibos_bush' && material instanceof THREE.MeshStandardMaterial) {
    material.aoMapIntensity = 0.35;
    material.color.setScalar(1.25);
  }
}

/** Takes the loaded GLB scene of every prop; call once before the first chunk is scattered. */
export function registerPolyProps(loaded: (id: PolyPropId) => THREE.Object3D): void {
  for (const id of POLY_PROP_IDS) {
    const root = loaded(id);
    const seen = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (seen.has(material)) continue;
        seen.add(material);
        prepareMaterial(material, id);
      }
    });
    root.updateMatrixWorld(true);
    templates.set(id, { root, bounds: new THREE.Box3().setFromObject(root) });
  }
}

function templateOf(id: PolyPropId): PropTemplate {
  const template = templates.get(id);
  if (!template) throw new Error(`polyProps: "${id}" was not registered before scattering`);
  return template;
}

export interface PlacedProp {
  object: THREE.Object3D;
  solid: SolidProp | null;
}

export function placePolyProp(
  id: PolyPropId,
  x: number,
  groundY: number,
  z: number,
  yaw: number,
  scale: number,
): PlacedProp {
  const template = templateOf(id);
  const object = template.root.clone(true);
  object.rotation.y = yaw;
  object.scale.setScalar(scale);
  object.position.set(x, groundY, z);
  if (!SOLID_PROPS[id]) return { object, solid: null };

  const { min, max } = template.bounds;
  const centreX = ((min.x + max.x) / 2) * scale;
  const centreZ = ((min.z + max.z) / 2) * scale;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    object,
    solid: {
      x: x + centreX * cos + centreZ * sin,
      y: groundY + ((min.y + max.y) / 2) * scale,
      z: z - centreX * sin + centreZ * cos,
      yaw,
      halfX: ((max.x - min.x) / 2) * scale,
      halfY: ((max.y - min.y) / 2) * scale,
      halfZ: ((max.z - min.z) / 2) * scale,
    },
  };
}

/** The colour scan of a boulder, reused as the tiled rock layer of the cliff ring. */
export function boulderRockTexture(): THREE.Texture {
  const maps: THREE.Texture[] = [];
  templateOf('namaqualand_boulder_02').root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && object.material.map) {
      maps.push(object.material.map);
    }
  });
  const texture = maps[0];
  if (!texture) throw new Error('polyProps: the boulder model carries no colour map');
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
