// src/render/grass.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Grass } from './grass';
import type { QualityTier } from './qualityTiers';
import { createHeightField } from '../world/noise';
import { createBiome } from '../world/biome';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import * as W from '../world/worldDef';

const TIER: QualityTier = {
  pixelRatio: 1, shadowMapSize: 1024, shadowHalfExtent: 50, fogDensity: 0.002, cameraFar: 1000,
  ambientOcclusion: false, grassRadius: 70, grassDensity: 1, grassDetailDistance: 30, extraProps: false,
};

function grassModel(): THREE.Object3D {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4), material));
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), material));
  return root;
}

const heightField = createHeightField(1);
const biome = createBiome(1);

/** Builds every grass block around each camera spot and returns where each drawn tuft stands. */
function tuftsAround(cameras: [number, number][], tier: QualityTier = TIER): { scene: THREE.Scene; tufts: THREE.Vector3[] } {
  const scene = new THREE.Scene();
  const grass = new Grass(scene, grassModel(), heightField, biome);
  grass.setTier(tier);
  for (const [x, z] of cameras) {
    for (let frame = 0; frame < 80; frame++) grass.update(new THREE.Vector3(x, 0, z));
  }
  const tufts: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();
  scene.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh) || object.geometry.attributes.position.count < 20) return;
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, matrix);
      tufts.push(new THREE.Vector3().setFromMatrixPosition(matrix));
    }
  });
  return { scene, tufts };
}

// Spots that cover the town, the lake, a road and the border, with open desert in between.
const CAMERAS: [number, number][] = [[W.TOWN.x, W.TOWN.z], [W.LAKE.x, W.LAKE.z], [60, 300], [W.SPAWN.x, W.SPAWN.z]];
let tufts: THREE.Vector3[];

beforeAll(() => {
  tufts = tuftsAround(CAMERAS).tufts;
});

describe('Grass — where tufts may grow', () => {
  it('grows grass on the open desert around the places it must avoid', () => {
    expect(tufts.length).toBeGreaterThan(500);
  });

  it('keeps every tuft off the road and its shoulder', () => {
    for (const tuft of tufts) {
      expect(W.nearestRoad(tuft.x, tuft.z)?.dist ?? Infinity).toBeGreaterThanOrEqual(W.ROAD_HALF + W.ROAD_SHOULDER);
    }
  });

  it('keeps the town plaza clear', () => {
    for (const tuft of tufts) expect(W.townDist(tuft.x, tuft.z)).toBeGreaterThanOrEqual(W.TOWN.plaza);
  });

  it('keeps the lake and its wet shore clear', () => {
    for (const tuft of tufts) expect(W.lakeDist(tuft.x, tuft.z)).toBeGreaterThanOrEqual(W.LAKE.radius + W.LAKE.feather);
  });

  it('grows nothing on the border slope outside the playable area', () => {
    for (const tuft of tufts) expect(W.borderDepth(tuft.x, tuft.z)).toBe(0);
  });

  it('plants every tuft on the drawn ground, not floating or buried', () => {
    for (const tuft of tufts) expect(Math.abs(tuft.y - terrainSurfaceHeight(heightField, tuft.x, tuft.z))).toBeLessThan(0.05);
  });

  it('grows the same tufts in the same places every time', () => {
    const again = tuftsAround(CAMERAS).tufts;
    expect(again.length).toBe(tufts.length);
    expect(again.every((tuft, index) => tuft.equals(tufts[index]))).toBe(true);
  });

  it('draws a lower tier\'s share of the tufts without moving any of them', () => {
    const half = tuftsAround(CAMERAS, { ...TIER, grassDensity: 0.5 }).tufts;
    expect(half.length).toBeGreaterThan(tufts.length * 0.4);
    expect(half.length).toBeLessThan(tufts.length * 0.6);
    const fullTier = new Set(tufts.map((tuft) => tuft.toArray().join(',')));
    for (const tuft of half) expect(fullTier.has(tuft.toArray().join(','))).toBe(true);
  });

  it('throws when it is asked to grow before a tier was set', () => {
    const grass = new Grass(new THREE.Scene(), grassModel(), heightField, biome);
    expect(() => grass.update(new THREE.Vector3())).toThrow('setTier was never called');
  });

  it('throws for a grass model with no standard-material mesh', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
    expect(() => new Grass(new THREE.Scene(), root, heightField, biome)).toThrow('no mesh with a standard material');
  });
});
