// src/render/buggyMesh.ts
import * as THREE from 'three';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import type { CarId } from '../vehicle/cars';
import type { CarMaterialSlot, WheelSlot } from '../assets/carPartRules';
import type { CarAssembly, CarPart } from './carModel';
import {
  CAR_MATERIAL_RECIPES,
  createCarMaterials,
  type CarMaterialSet,
  type CarTextureMaps,
  type EmbeddedCarMaps,
} from './carMaterials';

const WHEEL_ORDER: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

// A Record, so adding a slot to the union without listing it here is a compile error.
const MATERIAL_SLOT_PRESENCE: Record<CarMaterialSlot, true> = {
  paint: true, glass: true, chrome: true, rubber: true, rim: true, headlight: true, taillight: true,
  interior: true, blackTrim: true, clearGlass: true, indicator: true, silver: true, rimDark: true,
  brake: true, plate: true,
};
const MATERIAL_SLOTS = Object.keys(MATERIAL_SLOT_PRESENCE);

// Tinted glass draws after the opaque body, and clear lamp covers draw over the tinted glass.
const GLASS_RENDER_ORDER = 10;
const CLEAR_GLASS_RENDER_ORDER = 11;
const TEXTURE_ANISOTROPY = 8;

const carAssemblies = new Map<CarId, CarAssembly>();

/** Registered once per car in main.ts, before the first car of that id is built. */
export function registerCarAsset(carId: CarId, assembly: CarAssembly): void {
  carAssemblies.set(carId, assembly);
}

function isCarMaterialSet(value: unknown): value is CarMaterialSet {
  if (typeof value !== 'object' || value === null) return false;
  return MATERIAL_SLOTS.every(
    (slot) => slot in value && Reflect.get(value, slot) instanceof THREE.MeshStandardMaterial,
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

function allParts(assembly: CarAssembly): CarPart[] {
  const parts = [...assembly.bodyParts];
  for (const slot of WHEEL_ORDER) parts.push(...assembly.wheelParts[slot].spinning, ...assembly.wheelParts[slot].hubFixed);
  return parts;
}

/** The one texture pair every part of `slot` shares; null when no part of that slot is textured.
 * A half-textured part or two different textures for one slot is a converter defect, so it throws. */
function embeddedMapsForSlot(parts: CarPart[], slot: CarMaterialSlot): CarTextureMaps | null {
  let found: CarTextureMaps | null = null;
  for (const part of parts) {
    if (part.slot !== slot) continue;
    const { map, normalMap } = part.embeddedMaps;
    if (map === null && normalMap === null) continue;
    if (map === null || normalMap === null) {
      throw new Error(`buildBuggyMesh: part "${part.name}" carries only one of its colour and normal maps`);
    }
    if (found && (found.map !== map || found.normalMap !== normalMap)) {
      throw new Error(`buildBuggyMesh: the "${slot}" parts carry different textures`);
    }
    found = { map, normalMap };
  }
  if (found) {
    found.map.anisotropy = TEXTURE_ANISOTROPY;
    found.normalMap.anisotropy = TEXTURE_ANISOTROPY;
  }
  return found;
}

function embeddedCarMapsOf(assembly: CarAssembly): EmbeddedCarMaps {
  const parts = allParts(assembly);
  return { tyre: embeddedMapsForSlot(parts, 'rubber'), brake: embeddedMapsForSlot(parts, 'brake') };
}

function partMesh(part: CarPart, materials: CarMaterialSet): THREE.Mesh {
  const material = materials[part.slot];
  if ((material.map || material.normalMap) && !part.geometry.getAttribute('uv')) {
    throw new Error(`buildBuggyMesh: part "${part.name}" has no UV set for its "${part.slot}" textures`);
  }
  const mesh = new THREE.Mesh(part.geometry, material);
  mesh.name = part.name;
  mesh.receiveShadow = true;
  mesh.castShadow = part.slot !== 'glass' && part.slot !== 'clearGlass';
  if (part.slot === 'glass') mesh.renderOrder = GLASS_RENDER_ORDER;
  if (part.slot === 'clearGlass') mesh.renderOrder = CLEAR_GLASS_RENDER_ORDER;
  return mesh;
}

function buildBody(assembly: CarAssembly, materials: CarMaterialSet): THREE.Group {
  const body = new THREE.Group();
  body.scale.setScalar(assembly.fit.bodyScale);
  body.position.set(assembly.fit.bodyOffset.x, assembly.fit.bodyOffset.y, assembly.fit.bodyOffset.z);
  for (const part of assembly.bodyParts) body.add(partMesh(part, materials));
  return body;
}

function wheelPartMesh(part: CarPart, insetX: number, assembly: CarAssembly, materials: CarMaterialSet): THREE.Mesh {
  const mesh = partMesh(part, materials);
  mesh.scale.setScalar(assembly.fit.wheelScale);
  mesh.position.x = insetX;
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
  const materials = createCarMaterials(CAR_MATERIAL_RECIPES[carId], embeddedCarMapsOf(assembly));
  const wheelPositions = vehicleConfigFor(carId).wheel.positions;

  const group = new THREE.Group();
  group.add(buildBody(assembly, materials));
  for (let wheelIndex = 0; wheelIndex < WHEEL_ORDER.length; wheelIndex++) {
    group.add(buildWheel(WHEEL_ORDER[wheelIndex], wheelPositions[wheelIndex], assembly, materials));
  }
  group.userData.carMaterials = materials;
  return group;
}
