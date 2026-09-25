// src/render/polyProps.ts
// The drive prototype's Poly Haven props: prepared once from the loaded GLBs, cloned per placement.
// Clones share geometry and materials, so a chunk that unloads disposes nothing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOULDER_IDS, POLY_PROP_IDS, type PolyPropId } from '../world/propIds';
import type { RockKind } from '../world/worldDef';
import { ROCK_LOOK_GLSL } from './rockLook';
import { SURFACE_TINT_GLSL, surfaceTintFor, type SurfaceTint } from './surfaceTints';

export { POLY_PROP_IDS } from '../world/propIds';

export const GRASS_MODEL_ID = 'grass_medium_02';

export function polyPropUrl(id: string): string {
  return `/props/${id}.glb`;
}

/** A registered prop: one flattened root per rock kind for the boulders, one root for the rest. */
interface PropTemplate {
  root: THREE.Object3D;
  byRock: Readonly<Record<RockKind, THREE.Object3D>> | null;
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

/** The GLBs are quantized (normalized integer attributes); a matrix can only be baked into plain floats. */
function floatGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const index = source.getIndex();
  if (index !== null) geometry.setIndex(index.clone());
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let item = 0; item < attribute.count; item++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values[item * attribute.itemSize + component] = attribute.getComponent(item, component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  return geometry;
}

/**
 * One mesh per material, with the GLB's node transforms baked into the geometry. A placed prop is
 * then a group of a few meshes instead of a copy of the whole GLB node tree, which kept the main
 * thread busy walking tens of thousands of nodes every frame once the open map filled with props.
 */
function flattenByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const geometriesByMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) throw new Error(`polyProps: mesh "${object.name}" has several materials; flattening expects one`);
    const geometry = floatGeometry(object.geometry).applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, object.matrixWorld));
    const list = geometriesByMaterial.get(object.material) ?? [];
    list.push(geometry);
    geometriesByMaterial.set(object.material, list);
  });
  const flat = new THREE.Group();
  for (const [material, geometries] of geometriesByMaterial) {
    // Parts whose attribute sets differ cannot share one buffer; they stay separate meshes.
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    for (const geometry of merged ? [merged] : geometries) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      flat.add(mesh);
    }
  }
  return flat;
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
    const flat = flattenByMaterial(root);
    const byRock = BOULDER_IDS.includes(id) ? { granite: withRockLook(flat, null), dolerite: withRockLook(flat, surfaceTintFor('dolerite')) } : null;
    templates.set(id, { root: flat, byRock });
  }
}

const rockMaterials = new Map<string, THREE.Material>();

/**
 * A boulder material that shades its scan the way the terrain shades its rock layer, then applies
 * the ground's surface tint, so a boulder matches the rock face or the dolerite ridge it lies on.
 */
function rockMaterialFor(source: THREE.Material, tint: SurfaceTint | null): THREE.Material {
  const key = `${source.uuid}:${tint === null ? 'granite' : 'dolerite'}`;
  const cached = rockMaterials.get(key);
  if (cached) return cached;
  const material = source.clone();
  const tintVector = tint === null ? 'vec4(1.0, 1.0, 1.0, 0.0)' : `vec4(${tint.red}, ${tint.green}, ${tint.blue}, ${tint.desaturate})`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vBoulderWorld;\nvarying vec3 vBoulderNormal;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBoulderWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vBoulderNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = 'varying vec3 vBoulderWorld;\nvarying vec3 vBoulderNormal;\n' + ROCK_LOOK_GLSL + SURFACE_TINT_GLSL
      + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = applySurfaceTint(rockLook(diffuseColor.rgb * (0.55 + 0.9 * diffuseColor.rgb), vBoulderWorld, normalize(vBoulderNormal)), ${tintVector});`);
  };
  material.customProgramCacheKey = () => key.endsWith('granite') ? 'boulder-rock-granite' : 'boulder-rock-dolerite';
  rockMaterials.set(key, material);
  return material;
}

function withRockLook(flat: THREE.Group, tint: SurfaceTint | null): THREE.Object3D {
  const root = flat.clone(true);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) object.material = rockMaterialFor(object.material, tint);
  });
  return root;
}

function templateOf(id: PolyPropId): PropTemplate {
  const template = templates.get(id);
  if (!template) throw new Error(`polyProps: "${id}" was not registered before scattering`);
  return template;
}

/** Where and how one prop is drawn; `rock` picks the granite or dolerite look of a boulder. */
export interface PolyPropPlacement {
  modelId: PolyPropId;
  x: number;
  groundY: number;
  z: number;
  yaw: number;
  scale: number;
  rock: RockKind | null;
}

export function placePolyProp(placement: PolyPropPlacement): THREE.Object3D {
  const template = templateOf(placement.modelId);
  if (template.byRock !== null && placement.rock === null) throw new Error(`polyProps: boulder "${placement.modelId}" was placed without a rock kind`);
  const source = template.byRock !== null && placement.rock !== null ? template.byRock[placement.rock] : template.root;
  const object = source.clone(true);
  object.rotation.y = placement.yaw;
  object.scale.setScalar(placement.scale);
  object.position.set(placement.x, placement.groundY, placement.z);
  return object;
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
