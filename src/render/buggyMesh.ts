// src/render/buggyMesh.ts
import * as THREE from 'three';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import type { CarId } from '../vehicle/cars';
import type { WheelSlot } from '../assets/carPartRules';
import type { CarAssembly, CarPart } from './carModel';
import { createCarMaterials, type CarMaterialSet } from './carMaterials';

const WHEEL_ORDER: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

const carAssemblies = new Map<CarId, CarAssembly>();

/** Registered once per car in main.ts, before the first car of that id is built. */
export function registerCarAsset(carId: CarId, assembly: CarAssembly): void {
  carAssemblies.set(carId, assembly);
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

function wheelPartMesh(part: CarPart, insetX: number, assembly: CarAssembly, materials: CarMaterialSet): THREE.Mesh {
  const mesh = new THREE.Mesh(part.geometry, materials[part.slot]);
  mesh.name = part.name;
  mesh.scale.setScalar(assembly.fit.wheelScale);
  mesh.position.x = insetX;
  mesh.castShadow = true;
  return mesh;
}

function buildWheel(
  slot: WheelSlot,
  position: { x: number; y: number; z: number },
  assembly: CarAssembly,
  materials: CarMaterialSet,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(position.x, position.y, position.z);

  // The pivot must stay at the physics position exactly (the rig contract); the wheel meshes are
  // nudged, inside their groups only, to land under the scaled body's own fender opening.
  const insetX = position.x < 0 ? assembly.fit.wheelInsetX : -assembly.fit.wheelInsetX;
  const { spinning, hubFixed } = assembly.wheelParts[slot];

  const spinner = new THREE.Group();
  for (const part of spinning) spinner.add(wheelPartMesh(part, insetX, assembly, materials));
  pivot.add(spinner);

  if (hubFixed.length > 0) {
    const hubGroup = new THREE.Group();
    for (const part of hubFixed) hubGroup.add(wheelPartMesh(part, insetX, assembly, materials));
    pivot.add(hubGroup);
  }

  return pivot;
}

/**
 * Builds one car's Group from the asset registered for `carId`. Contract Buggy.ts and
 * PlayerViews depend on exactly: children[0] = body, children[1..4] = wheel pivots in
 * cfg.wheel.positions order (FL, FR, RL, RR), each pivot's children[0] = a spinner holding the
 * wheel meshes that visually roll and steer, and children[1] (only when the car has any) = the
 * hub-fixed parts that steer but do not roll.
 */
export function buildBuggyMesh(carId: CarId): THREE.Group {
  const assembly = carAssemblies.get(carId);
  if (!assembly) {
    throw new Error(`buildBuggyMesh: no asset registered for ${carId}`);
  }
  const materials = createCarMaterials();
  const wheelPositions = vehicleConfigFor(carId).wheel.positions;

  const group = new THREE.Group();
  group.add(buildBody(assembly, materials));
  for (let wheelIndex = 0; wheelIndex < WHEEL_ORDER.length; wheelIndex++) {
    group.add(buildWheel(WHEEL_ORDER[wheelIndex], wheelPositions[wheelIndex], assembly, materials));
  }
  group.userData.carMaterials = materials;
  return group;
}
