// src/render/carModel.ts
// Fits a loaded car GLB to the physics chassis, and turns the raw scene into the
// reusable geometry the car rig is built from. fitCarToChassis and cylindricalUv are pure (no
// three.js state, no DOM) so they stay unit-testable; assembleCar does the one-time three.js work.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarMaterialSlot, WheelSlot } from '../assets/carPartRules';

export interface MeasuredCarLike {
  wheelbase: number;
  track: number;
  tyreRadius: number;
  archTopY: number;
}

export interface WheelFitConfig {
  radius: number;
  suspensionRestLength: number;
  positions: readonly { x: number; y: number; z: number }[];
}

export interface ChassisFitConfig {
  wheel: WheelFitConfig;
}

export interface CarFit {
  bodyScale: number;
  bodyOffset: { x: number; y: number; z: number };
  wheelScale: number;
  /** How far a wheel mesh must move, along local X inside its spinner, from the physics pivot
   * toward the car's centreline to land under the body's own (scaled) fender opening. */
  wheelInsetX: number;
}

/** How far above the tyre top the fitted body's wheel-arch opening should clear it. */
export const ARCH_CLEARANCE = 0.06;

// cfg.wheel.positions is always ordered FL, FR, RL, RR (the rig contract buggyMesh.ts depends on).
const FRONT_WHEEL_INDEX = 0;
const REAR_WHEEL_INDEX = 2;

// A loaded suspension sags part way from its rest length before the tyre reaches the ground;
// this fraction is an authored approximation, not a physics simulation, just for the visual fit.
const SUSPENSION_SAG_FRACTION = 0.8;

/**
 * Pure fit of the measured car onto the physics wheel geometry: how much to scale the body (so
 * the wheelbase matches), how much to scale the wheels (so their radius matches the physics
 * radius), where to shift the body vertically (so the wheel arch clears the tyre top by
 * ARCH_CLEARANCE), and how far to inset the wheels (so they sit under the scaled body's own
 * fender openings instead of at the physics pivot's raw X).
 */
export function fitCarToChassis(measured: MeasuredCarLike, cfg: ChassisFitConfig): CarFit {
  if (!(measured.wheelbase > 0)) {
    throw new Error(`fitCarToChassis: measured.wheelbase must be > 0, got ${measured.wheelbase}`);
  }

  const frontWheel = cfg.wheel.positions[FRONT_WHEEL_INDEX];
  const rearWheel = cfg.wheel.positions[REAR_WHEEL_INDEX];
  const physicsWheelbase = Math.abs(frontWheel.z - rearWheel.z);
  const bodyScale = physicsWheelbase / measured.wheelbase;
  const wheelScale = cfg.wheel.radius / measured.tyreRadius;

  const tyreTop = frontWheel.y - cfg.wheel.suspensionRestLength * SUSPENSION_SAG_FRACTION + cfg.wheel.radius;
  const bodyOffsetY = tyreTop + ARCH_CLEARANCE - measured.archTopY * bodyScale;

  const physicsHalfTrack = Math.abs(frontWheel.x);
  const wheelInsetX = physicsHalfTrack - (measured.track / 2) * bodyScale;

  return {
    bodyScale,
    // z is recentred in assembleCar from the actual loaded wheel node positions — the raw
    // model's wheelbase-centre Z is not one of the measured/cfg inputs this function takes.
    bodyOffset: { x: 0, y: bodyOffsetY, z: 0 },
    wheelScale,
    wheelInsetX,
  };
}

/**
 * Cylindrical UV around a wheel's own spin axis: u wraps once around the tyre (for the tread
 * normal map), v runs along the axis from one sidewall to the other. Only 'x' is implemented —
 * this model's wheels spin around local X (see buggy.ts's spinner.rotation.x).
 */
export function cylindricalUv(positions: Float32Array, axis: 'x'): Float32Array {
  if (axis !== 'x') {
    throw new Error(`cylindricalUv: only the 'x' axis is implemented, got "${axis}"`);
  }
  const vertexCount = positions.length / 3;
  const uv = new Float32Array(vertexCount * 2);

  let minAxis = Infinity;
  let maxAxis = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const axisValue = positions[vertex * 3];
    if (axisValue < minAxis) minAxis = axisValue;
    if (axisValue > maxAxis) maxAxis = axisValue;
  }
  const axisRange = maxAxis - minAxis || 1;

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const i3 = vertex * 3;
    const axisValue = positions[i3];
    const radialY = positions[i3 + 1];
    const radialZ = positions[i3 + 2];
    const angle = Math.atan2(radialZ, radialY);
    uv[vertex * 2] = ((angle + Math.PI) / (2 * Math.PI)) % 1;
    uv[vertex * 2 + 1] = (axisValue - minAxis) / axisRange;
  }
  return uv;
}

/**
 * Per-car rules that turn a loaded GLB's flat node list into the rig: which nodes belong to a
 * wheel corner, which of those roll with the wheel, and which material slot each node gets.
 */
export interface CarAssemblyRules {
  /** The wheel corner a node belongs to, or null for a body node. */
  wheelCornerOf(nodeId: string): WheelSlot | null;
  /** True when a wheel-corner node rolls with the wheel; false for hub-fixed parts (brakes). */
  spinsWithWheel(nodeId: string): boolean;
  slotFor(nodeId: string): CarMaterialSlot;
  /** The tyre node of a corner; its position is the hub the corner's parts are centred on. */
  tyreNodeIdOf(slot: WheelSlot): string;
  needsCylindricalUv(nodeId: string): boolean;
}

export interface CarEmbeddedMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
}

export interface CarPart {
  name: string;
  geometry: THREE.BufferGeometry;
  slot: CarMaterialSlot;
  embeddedMaps: CarEmbeddedMaps;
}

export interface CarWheelParts {
  spinning: CarPart[];
  hubFixed: CarPart[];
}

export interface CarAssembly {
  bodyParts: CarPart[];
  wheelParts: Record<WheelSlot, CarWheelParts>;
  fit: CarFit;
}

const CREASE_ANGLE = THREE.MathUtils.degToRad(30);

/** Decodes the position attribute into plain world-unit floats via getX/getY/getZ, since
 * KHR_mesh_quantization leaves it stored as a normalized int16 array — reading `.array` directly
 * would give raw quantization codes instead of real coordinates. */
function decodedPositionArray(geometry: THREE.BufferGeometry): Float32Array {
  const attribute = geometry.attributes.position;
  const positions = new Float32Array(attribute.count * 3);
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    positions[vertex * 3] = attribute.getX(vertex);
    positions[vertex * 3 + 1] = attribute.getY(vertex);
    positions[vertex * 3 + 2] = attribute.getZ(vertex);
  }
  return positions;
}

const _vector = new THREE.Vector3();

/**
 * Bakes this node's own local translation + rotation + scale into its vertex positions, so the
 * result sits in the shared "car" coordinate frame every node was quantized against (the
 * pipeline's per-node quantization gives each mesh its own compensating TRS on the node, not a
 * shared parent transform — the mesh's raw geometry alone is not in car-space). When `origin` is
 * given, it is subtracted afterward so the geometry is centred there instead (used for a wheel,
 * so it spins around its own hub once placed in a spinner group).
 */
function bakedPositions(mesh: THREE.Mesh, origin: { x: number; y: number; z: number } | null): Float32Array {
  mesh.updateMatrix();
  const positions = decodedPositionArray(mesh.geometry);
  const offsetX = origin?.x ?? 0;
  const offsetY = origin?.y ?? 0;
  const offsetZ = origin?.z ?? 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const i3 = vertex * 3;
    _vector.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    _vector.applyMatrix4(mesh.matrix);
    positions[i3] = _vector.x - offsetX;
    positions[i3 + 1] = _vector.y - offsetY;
    positions[i3 + 2] = _vector.z - offsetZ;
  }
  return positions;
}

function embeddedMapsOf(mesh: THREE.Mesh): CarEmbeddedMaps {
  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    return { map: material.map, normalMap: material.normalMap };
  }
  return { map: null, normalMap: null };
}

/** The pipeline ships no NORMAL attribute (GLTFLoader would otherwise flat-shade every panel),
 * so every mesh gets creased normals computed here, once, after its own node transform is baked
 * in (see bakedPositions). Only the parts the rules name get a cylindrical UV (a generated tread). */
function toCarPart(
  mesh: THREE.Mesh,
  origin: { x: number; y: number; z: number } | null,
  rules: CarAssemblyRules,
): CarPart {
  const baked = new THREE.BufferGeometry();
  baked.setAttribute('position', new THREE.BufferAttribute(bakedPositions(mesh, origin), 3));
  // The source geometry is indexed (shared/welded vertices) — carry the index over, or
  // toCreasedNormals would read consecutive position triplets as unrelated triangles.
  if (mesh.geometry.index) baked.setIndex(mesh.geometry.index.clone());
  const geometry = toCreasedNormals(baked, CREASE_ANGLE);
  if (rules.needsCylindricalUv(mesh.name)) {
    const uv = cylindricalUv(decodedPositionArray(geometry), 'x');
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return { name: mesh.name, geometry, slot: rules.slotFor(mesh.name), embeddedMaps: embeddedMapsOf(mesh) };
}

/** Every part of one corner is recentred on the tyre's own hub, so they all share one centre
 * (their independently quantized translations differ by a fraction of a millimetre). */
function wheelCornerParts(
  meshesByCorner: Map<WheelSlot, THREE.Mesh[]>,
  hubByCorner: Map<WheelSlot, THREE.Vector3>,
  slot: WheelSlot,
  rules: CarAssemblyRules,
): CarWheelParts {
  const hub = hubByCorner.get(slot);
  if (!hub) {
    throw new Error(`assembleCar: the loaded car model is missing the "${rules.tyreNodeIdOf(slot)}" tyre mesh`);
  }
  const tyreNodeId = rules.tyreNodeIdOf(slot);
  const spinning: CarPart[] = [];
  const hubFixed: CarPart[] = [];
  for (const mesh of meshesByCorner.get(slot) ?? []) {
    const part = toCarPart(mesh, hub, rules);
    if (!rules.spinsWithWheel(mesh.name)) hubFixed.push(part);
    else if (mesh.name === tyreNodeId) spinning.unshift(part);
    else spinning.push(part);
  }
  return { spinning, hubFixed };
}

/**
 * Processes the raw loaded GLB scene once: creased normals and tyre UVs (see toCarPart), and
 * splits the flat node list into body parts plus the four wheel corners, routed by the car's
 * own rules. Also recentres the fit's Z offset from the actual loaded tyre positions, since the
 * raw model's wheelbase-centre Z isn't part of fitCarToChassis's pure measured/cfg inputs.
 */
export function assembleCar(gltfScene: THREE.Object3D, fit: CarFit, rules: CarAssemblyRules): CarAssembly {
  const bodyParts: CarPart[] = [];
  const meshesByCorner = new Map<WheelSlot, THREE.Mesh[]>();
  const hubByCorner = new Map<WheelSlot, THREE.Vector3>();

  gltfScene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const corner = rules.wheelCornerOf(child.name);
    if (corner === null) {
      // Body parts keep their car-space position (no recentring) — buildBody() in buggyMesh.ts
      // applies one shared bodyScale/bodyOffset transform to all of them together.
      bodyParts.push(toCarPart(child, null, rules));
      return;
    }
    if (child.name === rules.tyreNodeIdOf(corner)) hubByCorner.set(corner, child.position.clone());
    const cornerMeshes = meshesByCorner.get(corner) ?? [];
    cornerMeshes.push(child);
    meshesByCorner.set(corner, cornerMeshes);
  });

  const wheelParts: Record<WheelSlot, CarWheelParts> = {
    wheelFL: wheelCornerParts(meshesByCorner, hubByCorner, 'wheelFL', rules),
    wheelFR: wheelCornerParts(meshesByCorner, hubByCorner, 'wheelFR', rules),
    wheelRL: wheelCornerParts(meshesByCorner, hubByCorner, 'wheelRL', rules),
    wheelRR: wheelCornerParts(meshesByCorner, hubByCorner, 'wheelRR', rules),
  };

  const frontLeftHub = hubByCorner.get('wheelFL');
  const rearLeftHub = hubByCorner.get('wheelRL');
  if (!frontLeftHub || !rearLeftHub) {
    throw new Error('assembleCar: the loaded car model is missing the front-left or rear-left tyre');
  }
  const wheelbaseCenterZ = (frontLeftHub.z + rearLeftHub.z) / 2;

  const resolvedFit: CarFit = {
    ...fit,
    bodyOffset: { ...fit.bodyOffset, z: -wheelbaseCenterZ * fit.bodyScale },
  };

  return { bodyParts, wheelParts, fit: resolvedFit };
}
