// src/world/propColliders.test.ts
// The shared collider boxes of the solid props (S3-2): a contract with the GLB files (category 4,
// read with @gltf-transform) and the pure placement maths (category 1).
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { PROP_COLLIDER_SHAPES, propColliderBox, propFootprintRadius, type PlacedModel } from './propColliders';
import { POLY_PROP_IDS, type PolyPropId } from './propIds';

const SOLID_IDS = POLY_PROP_IDS.filter((id) => PROP_COLLIDER_SHAPES[id] !== null);
const propFile = (id: PolyPropId): string => fileURLToPath(new URL(`../../public/props/${id}.glb`, import.meta.url));

describe('PROP_COLLIDER_SHAPES — the boxes match the prop models on disk (S3-2)', () => {
  const bounds = new Map<PolyPropId, { min: number[]; max: number[] }>();

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const id of SOLID_IDS) {
      const scene = (await io.read(propFile(id))).getRoot().listScenes()[0];
      if (!scene) throw new Error(`${id}.glb has no scene`);
      const box = getBounds(scene);
      bounds.set(id, { min: [...box.min], max: [...box.max] });
    }
  });

  it('has at least the boulders and the log as solids', () => {
    expect(SOLID_IDS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(SOLID_IDS)('fits the %s box to the model bounds within 2 % of its size', (id) => {
    // A stale box after a model swap puts an invisible wall beside the boulder, or lets a car drive into it.
    const shape = PROP_COLLIDER_SHAPES[id];
    const box = bounds.get(id);
    if (!shape || !box) throw new Error(`${id}: no shape or no bounds`);
    const size = Math.max(...[0, 1, 2].map((axis) => box.max[axis] - box.min[axis]));
    const tolerance = 0.02 * size;
    const halves = [shape.halfX, shape.halfY, shape.halfZ];
    const centres = [shape.centreX, shape.centreY, shape.centreZ];
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(halves[axis] - (box.max[axis] - box.min[axis]) / 2), `${id} half size, axis ${axis}`).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(centres[axis] - (box.max[axis] + box.min[axis]) / 2), `${id} centre, axis ${axis}`).toBeLessThanOrEqual(tolerance);
    }
  });
});

describe('propColliderBox — where a placed box stands (S3-2)', () => {
  const placed = (modelId: PolyPropId, yaw: number, scale: number): PlacedModel => ({ modelId, x: 120, z: -40, groundY: 7, yaw, scale });

  it.each<[PolyPropId, number, number]>([
    ['namaqualand_boulder_03', 0, 1],
    ['namaqualand_boulder_03', 1.1, 2.3],
    ['dead_tree_trunk_02', -2.6, 0.9],
  ])('turns the %s box centre the way three.js turns the drawn model (yaw %s, scale %s)', (modelId, yaw, scale) => {
    const shape = PROP_COLLIDER_SHAPES[modelId];
    if (!shape) throw new Error(`${modelId} is not solid`);
    const model = new THREE.Object3D();
    model.position.set(120, 7, -40);
    model.rotation.y = yaw;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const drawn = new THREE.Vector3(shape.centreX, shape.centreY, shape.centreZ).applyMatrix4(model.matrixWorld);
    const box = propColliderBox(placed(modelId, yaw, scale));
    expect(box?.x).toBeCloseTo(drawn.x, 9);
    expect(box?.y).toBeCloseTo(drawn.y, 9);
    expect(box?.z).toBeCloseTo(drawn.z, 9);
    expect(box?.halfX).toBeCloseTo(shape.halfX * scale, 12);
    expect(box?.yaw).toBe(yaw);
  });

  it.each(POLY_PROP_IDS.filter((id) => PROP_COLLIDER_SHAPES[id] === null))('gives the %s no box and no footprint: a car drives through it', (modelId) => {
    expect(propColliderBox(placed(modelId, 0.3, 1.2))).toBeNull();
    expect(propFootprintRadius(modelId, 1.2)).toBe(0);
  });
});

describe('propFootprintRadius — the ground a solid covers (S3-2)', () => {
  it.each(SOLID_IDS)('covers every corner of the %s box at any turn', (modelId) => {
    // The keep-clear check around roads reads this radius: a box corner outside it can reach a lane.
    const scale = 1.7;
    const radius = propFootprintRadius(modelId, scale);
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.35) {
      const box = propColliderBox({ modelId, x: 0, z: 0, groundY: 0, yaw, scale });
      if (!box) throw new Error(`${modelId} is not solid`);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      for (const [alongX, alongZ] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const cornerX = box.x + alongX * box.halfX * cos + alongZ * box.halfZ * sin;
        const cornerZ = box.z - alongX * box.halfX * sin + alongZ * box.halfZ * cos;
        expect(Math.hypot(cornerX, cornerZ)).toBeLessThanOrEqual(radius + 1e-9);
      }
    }
  });

  it('grows in step with the scale', () => {
    expect(propFootprintRadius('namaqualand_boulder_02', 3)).toBeCloseTo(3 * propFootprintRadius('namaqualand_boulder_02', 1), 12);
  });
});
