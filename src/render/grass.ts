// src/render/grass.ts
// The drive prototype's instanced dry grass: 20 m blocks, each with a detailed and a light clump
// mesh, a distance fade in the shader, and per-tier counts. The prototype grew grass in one circle
// round its start; here the blocks are anchored to the world and built as the camera nears them.
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import { surfaceSampleAt } from '../world/surfaceSample';
import * as W from '../world/worldDef';
import type { Height2D } from '../world/noise';
import type { Biome, Cover } from '../world/biome';
import { isPropAllowedAt } from './scatter';
import type { QualityTier } from './qualityTiers';

const BLOCK_SIZE = 20;
// The prototype's high tier: 30 000 tufts in a 180 m circle.
const TUFTS_PER_BLOCK = Math.round((30000 / (Math.PI * 180 * 180)) * BLOCK_SIZE * BLOCK_SIZE);
const GRASS_COLOR = 0xd8c08a;
const GRASS_COVERS: ReadonlySet<Cover> = new Set<Cover>(['sand', 'dirt', 'dryGrass', 'grass', 'forest']);
const ROAD_CLEARANCE = W.ROAD_HALF + W.ROAD_SHOULDER + 1;
const BLOCKS_BUILT_PER_FRAME = 8;

interface GrassBlock {
  detail: THREE.InstancedMesh;
  light: THREE.InstancedMesh;
  centerX: number;
  centerZ: number;
  tufts: number;
}

function bakedGeometry(source: THREE.Mesh): THREE.BufferGeometry {
  source.updateWorldMatrix(true, false);
  return source.geometry.clone().applyMatrix4(source.matrixWorld);
}

export class Grass {
  private readonly group = new THREE.Group();
  private readonly blocks = new Map<string, GrassBlock | null>();
  private readonly detailGeometry: THREE.BufferGeometry;
  private readonly lightGeometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly fadeStart = { value: 0 };
  private readonly fadeEnd = { value: 0 };
  private tier: QualityTier | null = null;

  constructor(
    scene: THREE.Scene,
    template: THREE.Object3D,
    private readonly heightField: Height2D,
    private readonly biome: Biome,
  ) {
    const sources: THREE.Mesh[] = [];
    template.traverse((object) => { if (object instanceof THREE.Mesh) sources.push(object); });
    sources.sort((first, second) => second.geometry.attributes.position.count - first.geometry.attributes.position.count);
    const densest = sources[0];
    const lightest = sources[sources.length - 1];
    if (!densest || !(densest.material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('Grass: the grass model has no mesh with a standard material');
    }
    this.detailGeometry = bakedGeometry(densest);
    this.lightGeometry = bakedGeometry(lightest);
    this.material = this.createMaterial(densest.material);
    scene.add(this.group);
  }

  private createMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      map: source.map, normalMap: source.normalMap, roughness: 0.9, metalness: 0,
      color: new THREE.Color(GRASS_COLOR), alphaTest: 0.45, side: THREE.DoubleSide,
    });
    const fadeStart = this.fadeStart;
    const fadeEnd = this.fadeEnd;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.fadeStart = fadeStart;
      shader.uniforms.fadeEnd = fadeEnd;
      shader.vertexShader = 'varying float vFade;\nuniform float fadeStart; uniform float fadeEnd;\n'
        + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          { vec4 grassWorld = modelMatrix * instanceMatrix * vec4(position, 1.0); vFade = 1.0 - smoothstep(fadeStart, fadeEnd, distance(grassWorld.xyz, cameraPosition)); }`);
      shader.fragmentShader = 'varying float vFade;\n'
        + shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vFade;\n#include <alphatest_fragment>');
    };
    material.customProgramCacheKey = () => 'grass-fade';
    return material;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.fadeStart.value = tier.grassRadius * 0.6;
    this.fadeEnd.value = tier.grassRadius * 0.95;
    for (const block of this.blocks.values()) if (block) this.applyDensity(block, tier);
  }

  private applyDensity(block: GrassBlock, tier: QualityTier): void {
    const count = Math.floor(block.tufts * tier.grassDensity);
    block.detail.count = count;
    block.light.count = count;
  }

  /** Builds the blocks the camera has come near, a few per frame, and picks each block's clump. */
  update(camera: THREE.Vector3): void {
    const tier = this.tier;
    if (!tier) throw new Error('Grass.update: setTier was never called');
    const reach = tier.grassRadius + BLOCK_SIZE;
    const minBlockX = Math.floor((camera.x - reach) / BLOCK_SIZE);
    const maxBlockX = Math.floor((camera.x + reach) / BLOCK_SIZE);
    const minBlockZ = Math.floor((camera.z - reach) / BLOCK_SIZE);
    const maxBlockZ = Math.floor((camera.z + reach) / BLOCK_SIZE);
    let built = 0;
    for (let blockX = minBlockX; blockX <= maxBlockX && built < BLOCKS_BUILT_PER_FRAME; blockX++) {
      for (let blockZ = minBlockZ; blockZ <= maxBlockZ && built < BLOCKS_BUILT_PER_FRAME; blockZ++) {
        const key = `${blockX},${blockZ}`;
        if (this.blocks.has(key)) continue;
        const centerX = (blockX + 0.5) * BLOCK_SIZE;
        const centerZ = (blockZ + 0.5) * BLOCK_SIZE;
        if (Math.hypot(centerX - camera.x, centerZ - camera.z) > reach) continue;
        this.blocks.set(key, this.buildBlock(blockX, blockZ, tier));
        built++;
      }
    }
    for (const block of this.blocks.values()) {
      if (!block) continue;
      const distance = Math.hypot(block.centerX - camera.x, block.centerZ - camera.z);
      const inReach = distance < reach;
      const near = distance < tier.grassDetailDistance || tier.grassDetailDistance === 0;
      block.detail.visible = inReach && near;
      block.light.visible = inReach && !near;
    }
  }

  private allowedAt(x: number, z: number): boolean {
    if (W.borderDepth(x, z) > 0 || !isPropAllowedAt(x, z)) return false;
    if (W.townDist(x, z) < W.TOWN.plaza + 4) return false;
    const road = W.nearestRoad(x, z);
    if (road && road.dist < ROAD_CLEARANCE) return false;
    const { height, slope } = surfaceSampleAt(this.heightField, x, z);
    return GRASS_COVERS.has(this.biome.coverAt(x, z, height, slope));
  }

  /** Null for a block with no ground grass may grow on, so it is never sampled again. */
  private buildBlock(blockX: number, blockZ: number, tier: QualityTier): GrassBlock | null {
    const random = mulberry32(((blockX * 73856093) ^ (blockZ * 19349663) ^ 0x6a55) >>> 0);
    const matrices: THREE.Matrix4[] = [];
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let tuft = 0; tuft < TUFTS_PER_BLOCK; tuft++) {
      const x = (blockX + random()) * BLOCK_SIZE;
      const z = (blockZ + random()) * BLOCK_SIZE;
      const turn = random() * Math.PI * 2;
      const size = 0.6 + random() * 0.7;
      const stretch = 0.7 + random() * 0.5;
      if (!this.allowedAt(x, z)) continue;
      position.set(x, terrainSurfaceHeight(this.heightField, x, z) - 0.02, z);
      rotation.setFromAxisAngle(up, turn);
      scale.set(size, size * stretch, size);
      matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
    }
    if (matrices.length === 0) return null;
    const instanced = (geometry: THREE.BufferGeometry): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geometry, this.material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      return mesh;
    };
    const block: GrassBlock = {
      detail: instanced(this.detailGeometry),
      light: instanced(this.lightGeometry),
      centerX: (blockX + 0.5) * BLOCK_SIZE,
      centerZ: (blockZ + 0.5) * BLOCK_SIZE,
      tufts: matrices.length,
    };
    this.applyDensity(block, tier);
    return block;
  }
}
