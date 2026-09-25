// src/render/polyProps.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { placePolyProp, registerPolyProps } from './polyProps';
import type { PolyPropId } from '../world/propIds';

// Every test model is a 2 × 1 × 3 box whose centre sits off the model origin, like a scanned
// boulder whose pivot is not at its middle.
const MODEL_SIZE = new THREE.Vector3(2, 1, 3);
const MODEL_CENTRE = new THREE.Vector3(1.5, 0.5, -0.75);

function testModel(): THREE.Object3D {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(MODEL_SIZE.x, MODEL_SIZE.y, MODEL_SIZE.z), new THREE.MeshStandardMaterial());
  mesh.position.copy(MODEL_CENTRE);
  root.add(mesh);
  return root;
}

beforeAll(() => {
  registerPolyProps(() => testModel());
});

describe('placePolyProp — the collider box sits where the model is drawn', () => {
  it.each<[string, PolyPropId, number]>([
    ['a boulder, no turn', 'namaqualand_boulder_02', 0],
    ['a boulder turned 90 degrees', 'namaqualand_boulder_03', Math.PI / 2],
    ['a log turned 2.3 rad', 'dead_tree_trunk_02', 2.3],
  ])('centres the box on the drawn model for %s', (_name, id, yaw) => {
    const placed = placePolyProp(id, 40, 3, -12, yaw, 1.7);
    placed.object.updateMatrixWorld(true);
    const drawnCentre = MODEL_CENTRE.clone().applyMatrix4(placed.object.matrixWorld);
    expect(placed.solid).not.toBeNull();
    expect(placed.solid?.x).toBeCloseTo(drawnCentre.x, 9);
    expect(placed.solid?.y).toBeCloseTo(drawnCentre.y, 9);
    expect(placed.solid?.z).toBeCloseTo(drawnCentre.z, 9);
    expect(placed.solid?.yaw).toBe(yaw);
  });

  it('sizes the box to the model bounds times the placed scale', () => {
    const solid = placePolyProp('namaqualand_boulder_05', 0, 0, 0, 0.4, 2.5).solid;
    expect(solid?.halfX).toBeCloseTo((MODEL_SIZE.x / 2) * 2.5, 9);
    expect(solid?.halfY).toBeCloseTo((MODEL_SIZE.y / 2) * 2.5, 9);
    expect(solid?.halfZ).toBeCloseTo((MODEL_SIZE.z / 2) * 2.5, 9);
  });

  it.each<PolyPropId>(['wild_rooibos_bush', 'namaqualand_stones_01'])('gives the %s no collider: the car drives through it', (id) => {
    expect(placePolyProp(id, 0, 0, 0, 0, 1).solid).toBeNull();
  });

  it('draws the model at the asked spot, turn and scale', () => {
    const { object } = placePolyProp('wild_rooibos_bush', 5, 2, 7, 1.2, 0.9);
    expect(object.position.toArray()).toEqual([5, 2, 7]);
    expect(object.rotation.y).toBe(1.2);
    expect(object.scale.toArray()).toEqual([0.9, 0.9, 0.9]);
  });
});
