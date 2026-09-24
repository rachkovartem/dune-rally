// src/render/buggyMesh.ts
import * as THREE from 'three/webgpu';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';
import type { WheelSlot } from '../assets/carPartRules';
import type { CarAssembly } from './carModel';
import { createCarMaterials, type CarMaterialSet } from './carMaterials';

const WHEEL_ORDER: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

let carAssembly: CarAssembly | null = null;
let carEnvironment: THREE.Texture | null = null;

/**
 * Set once in main.ts, before the first car (local Buggy or a remote PlayerViews entry) is
 * built, so buildBuggyMesh() can keep its existing zero-arg signature — buggy.ts and
 * playerViews.ts both call it with no argument, and neither is touched by this change.
 */
export function setCarAsset(assembly: CarAssembly, environment: THREE.Texture): void {
  carAssembly = assembly;
  carEnvironment = environment;
}

function isCarMaterialSet(value: unknown): value is CarMaterialSet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'paint' in value &&
    'glass' in value &&
    'chrome' in value &&
    'rubber' in value &&
    'rim' in value &&
    'headlight' in value &&
    'taillight' in value &&
    'interior' in value &&
    'blackTrim' in value
  );
}

/** Reads the material set buildBuggyMesh() stashed on the group's userData, for setBrakeLights
 * — each car keeps its own set (see carMaterials.ts), so this always reads the right one. */
export function getCarMaterials(mesh: THREE.Group): CarMaterialSet {
  const materials: unknown = mesh.userData.carMaterials;
  if (!isCarMaterialSet(materials)) {
    throw new Error('getCarMaterials: this group was not built by buildBuggyMesh()');
  }
  return materials;
}

function buildBody(assembly: CarAssembly, materials: CarMaterialSet): THREE.Group {
  const body = new THREE.Group();
  body.scale.setScalar(assembly.fit.bodyScale);
  body.position.set(assembly.fit.bodyOffset.x, assembly.fit.bodyOffset.y, assembly.fit.bodyOffset.z);
  for (const part of assembly.bodyParts) {
    const mesh = new THREE.Mesh(part.geometry, materials[part.slot]);
    mesh.name = part.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  return body;
}

function buildWheel(
  slot: WheelSlot,
  position: { x: number; y: number; z: number },
  assembly: CarAssembly,
  materials: CarMaterialSet,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(position.x, position.y, position.z);

  const spinner = new THREE.Group();
  pivot.add(spinner);

  // The pivot must stay at the physics position exactly (the rig contract); the wheel meshes are
  // nudged, inside the spinner only, to land under the scaled body's own fender opening.
  const insetX = position.x < 0 ? assembly.fit.wheelInsetX : -assembly.fit.wheelInsetX;
  const { tyre, rim } = assembly.wheelParts[slot];

  const tyreMesh = new THREE.Mesh(tyre.geometry, materials[tyre.slot]);
  tyreMesh.name = tyre.name;
  tyreMesh.scale.setScalar(assembly.fit.wheelScale);
  tyreMesh.position.x = insetX;
  tyreMesh.castShadow = true;
  spinner.add(tyreMesh);

  const rimMesh = new THREE.Mesh(rim.geometry, materials[rim.slot]);
  rimMesh.name = rim.name;
  rimMesh.scale.setScalar(assembly.fit.wheelScale);
  rimMesh.position.x = insetX;
  rimMesh.castShadow = true;
  spinner.add(rimMesh);

  return pivot;
}

/**
 * Builds one car's Group from the asset set by setCarAsset(). Contract Buggy.ts and
 * PlayerViews depend on exactly: children[0] = body, children[1..4] = wheel pivots in
 * cfg.wheel.positions order (FL, FR, RL, RR), each pivot's children[0] = a spinner holding the
 * wheel meshes that visually roll and steer.
 */
export function buildBuggyMesh(): THREE.Group {
  if (!carAssembly || !carEnvironment) {
    throw new Error('buildBuggyMesh: setCarAsset() must be called before building a car mesh');
  }
  const assembly = carAssembly;
  const materials = createCarMaterials(carEnvironment);

  const group = new THREE.Group();
  group.add(buildBody(assembly, materials));
  for (let wheelIndex = 0; wheelIndex < WHEEL_ORDER.length; wheelIndex++) {
    group.add(buildWheel(WHEEL_ORDER[wheelIndex], cfg.wheel.positions[wheelIndex], assembly, materials));
  }
  group.userData.carMaterials = materials;
  return group;
}
