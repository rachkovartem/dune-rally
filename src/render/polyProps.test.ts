// src/render/polyProps.test.ts
// Replacement (S3-2/S3-3): the collider box no longer comes from the drawn model's bounds but from
// the shared PROP_COLLIDER_SHAPES, so the promise is now "the shared box sits where the model is drawn".
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { placePolyProp, registerPolyProps, type PolyPropPlacement } from './polyProps';
import { PROP_COLLIDER_SHAPES, propColliderBox } from '../world/propColliders';
import type { PolyPropId } from '../world/propIds';

/** A stand-in model whose bounds are exactly the shared collider shape of its id (a unit box if not solid). */
function testModel(id: PolyPropId): THREE.Object3D {
  const shape = PROP_COLLIDER_SHAPES[id] ?? { halfX: 0.5, halfY: 0.5, halfZ: 0.5, centreX: 0, centreY: 0.5, centreZ: 0 };
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(shape.halfX * 2, shape.halfY * 2, shape.halfZ * 2), new THREE.MeshStandardMaterial());
  mesh.position.set(shape.centreX, shape.centreY, shape.centreZ);
  root.add(mesh);
  return root;
}

function drawnBoundsCentre(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const local = new THREE.Box3();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) local.union(child.geometry.boundingBox);
    }
  });
  return local.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
}

const placement = (modelId: PolyPropId, yaw: number, rock: PolyPropPlacement['rock']): PolyPropPlacement =>
  ({ modelId, x: 40, groundY: 3, z: -12, yaw, scale: 1.7, rock });

beforeAll(() => {
  registerPolyProps(testModel);
});

describe('placePolyProp — the drawn prop and the shared collider agree (S3-2, S3-3)', () => {
  it.each<[string, PolyPropId, number]>([
    ['a boulder, no turn', 'namaqualand_boulder_02', 0],
    ['a boulder turned 90 degrees', 'namaqualand_boulder_03', Math.PI / 2],
    ['a log turned 2.3 rad', 'dead_tree_trunk_02', 2.3],
  ])('centres the shared collider box on the drawn model for %s', (_name, id, yaw) => {
    // A sign slip in the yaw of either side puts the box beside the boulder the player sees.
    const placed = placement(id, yaw, id === 'dead_tree_trunk_02' ? null : 'granite');
    const drawnCentre = drawnBoundsCentre(placePolyProp(placed));
    const box = propColliderBox(placed);
    expect(box).not.toBeNull();
    expect(box?.x).toBeCloseTo(drawnCentre.x, 6);
    expect(box?.y).toBeCloseTo(drawnCentre.y, 6);
    expect(box?.z).toBeCloseTo(drawnCentre.z, 6);
  });

  it('draws the model at the asked spot, turn and scale', () => {
    const object = placePolyProp({ modelId: 'wild_rooibos_bush', x: 5, groundY: 2, z: 7, yaw: 1.2, scale: 0.9, rock: null });
    expect(object.position.toArray()).toEqual([5, 2, 7]);
    expect(object.rotation.y).toBe(1.2);
    expect(object.scale.toArray()).toEqual([0.9, 0.9, 0.9]);
  });

  it('throws for a boulder placed without a rock kind, instead of guessing its look', () => {
    expect(() => placePolyProp(placement('namaqualand_boulder_05', 0, null))).toThrow('without a rock kind');
  });
});
