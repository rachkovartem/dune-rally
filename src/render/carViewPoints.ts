// src/render/carViewPoints.ts
// Where the hood, bumper and cockpit cameras sit on a car, measured on its assembled body so that
// every car gets its own points and none is written in by hand.
import * as THREE from 'three';
import type { DriverSide } from '../assets/carCatalog';

/** A point in car space: Y up, the nose toward +Z, origin at the car body's centre. */
export interface CarPoint {
  x: number;
  y: number;
  z: number;
}

export interface CarViewPoints {
  hood: CarPoint;
  bumper: CarPoint;
  cockpit: CarPoint;
}

/** What the measurement needs: body vertices in car space (x, y, z, x, y, z, …) and the wheel hubs. */
export interface CarBodySample {
  bodyPoints: ArrayLike<number>;
  wheelHubs: readonly CarPoint[];
}

// Shares of the wheelbase behind the front axle: the base of the windscreen and the driver's eye.
const HOOD_BEHIND_FRONT_AXLE = 0.1;
const EYE_BEHIND_FRONT_AXLE = 0.54;
const HOOD_SAMPLE_LENGTH = 0.4;
const HOOD_SAMPLE_HALF_WIDTH = 0.35;
const HOOD_CAMERA_LIFT = 0.12;
const BUMPER_FACE_DEPTH = 0.12;
const BUMPER_FACE_HALF_WIDTH = 0.5;
/** Share of the front face's height, from its bottom, where the bumper camera sits. */
const BUMPER_HEIGHT_SHARE = 0.35;
const BUMPER_CAMERA_AHEAD = 0.15;
const ROOF_SAMPLE_HALF_LENGTH = 0.2;
const ROOF_SAMPLE_HALF_WIDTH = 0.3;
const HEAD_ROOM = 0.3;
const CABIN_SAMPLE_HALF_LENGTH = 0.15;
const CABIN_SAMPLE_HALF_HEIGHT = 0.1;
/** Share of the cabin's half-width at head height where the driver's eye is. */
const DRIVER_OFFSET_SHARE = 0.5;

interface Range {
  min: number;
  max: number;
}

function rangeOf(points: ArrayLike<number>, axis: 0 | 1 | 2, inside: (x: number, y: number, z: number) => boolean): Range | null {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index + 2 < points.length; index += 3) {
    const x = points[index];
    const y = points[index + 1];
    const z = points[index + 2];
    if (!inside(x, y, z)) continue;
    const value = points[index + axis];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? { min, max } : null;
}

function requireRange(range: Range | null, what: string): Range {
  if (range === null) throw new Error(`carViewPointsFrom: the car body has no vertices at the ${what}`);
  return range;
}

/** Throws when the body is missing a part a camera needs, so a bad model shows up instead of a camera inside the ground. */
export function carViewPointsFrom(sample: CarBodySample, driverSide: DriverSide): CarViewPoints {
  if (sample.wheelHubs.length === 0) throw new Error('carViewPointsFrom: the car has no wheels');
  const axleZs = sample.wheelHubs.map((hub) => hub.z);
  const frontAxleZ = Math.max(...axleZs);
  const wheelbase = frontAxleZ - Math.min(...axleZs);
  if (!(wheelbase > 0)) throw new Error('carViewPointsFrom: the front and rear wheels share one axle');
  const points = sample.bodyPoints;

  const hoodZ = frontAxleZ - HOOD_BEHIND_FRONT_AXLE * wheelbase;
  const hoodTop = requireRange(
    rangeOf(points, 1, (x, _y, z) => Math.abs(x) < HOOD_SAMPLE_HALF_WIDTH && z >= hoodZ && z <= hoodZ + HOOD_SAMPLE_LENGTH),
    'bonnet',
  ).max;

  const noseZ = requireRange(rangeOf(points, 2, () => true), 'nose').max;
  const frontFace = requireRange(
    rangeOf(points, 1, (x, _y, z) => Math.abs(x) < BUMPER_FACE_HALF_WIDTH && z > noseZ - BUMPER_FACE_DEPTH),
    'front bumper',
  );

  const eyeZ = frontAxleZ - EYE_BEHIND_FRONT_AXLE * wheelbase;
  const roofY = requireRange(
    rangeOf(points, 1, (x, _y, z) => Math.abs(x) < ROOF_SAMPLE_HALF_WIDTH && Math.abs(z - eyeZ) < ROOF_SAMPLE_HALF_LENGTH),
    'roof',
  ).max;
  const eyeY = roofY - HEAD_ROOM;
  const cabinSide = requireRange(
    rangeOf(points, 0, (_x, y, z) => Math.abs(z - eyeZ) < CABIN_SAMPLE_HALF_LENGTH && Math.abs(y - eyeY) < CABIN_SAMPLE_HALF_HEIGHT),
    'cabin sides',
  );
  const cabinHalfWidth = Math.min(Math.abs(cabinSide.min), Math.abs(cabinSide.max));
  // Car space has Y up and the nose at +Z, so the driver's left hand is toward +X.
  const sideSign = driverSide === 'left' ? 1 : -1;

  return {
    hood: { x: 0, y: hoodTop + HOOD_CAMERA_LIFT, z: hoodZ },
    bumper: {
      x: 0,
      y: frontFace.min + BUMPER_HEIGHT_SHARE * (frontFace.max - frontFace.min),
      z: noseZ + BUMPER_CAMERA_AHEAD,
    },
    cockpit: { x: sideSign * DRIVER_OFFSET_SHARE * cabinHalfWidth, y: eyeY, z: eyeZ },
  };
}

/**
 * Reads a built car (a buildBuggyMesh group: children[0] the body, children[1..] the wheel pivots)
 * into car space, whatever the group's own pose in the world is.
 */
export function sampleCarBody(car: THREE.Object3D): CarBodySample {
  const [body, ...wheelPivots] = car.children;
  if (!body) throw new Error('sampleCarBody: the car has no body');
  car.updateMatrixWorld(true);
  const toCarSpace = car.matrixWorld.clone().invert();
  const meshToCar = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  const bodyPoints: number[] = [];
  body.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry: unknown = child.geometry;
    if (!(geometry instanceof THREE.BufferGeometry)) return;
    const position = geometry.getAttribute('position');
    meshToCar.multiplyMatrices(toCarSpace, child.matrixWorld);
    for (let index = 0; index < position.count; index++) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(meshToCar);
      bodyPoints.push(vertex.x, vertex.y, vertex.z);
    }
  });
  const wheelHubs = wheelPivots.map((pivot) => ({ x: pivot.position.x, y: pivot.position.y, z: pivot.position.z }));
  return { bodyPoints, wheelHubs };
}
