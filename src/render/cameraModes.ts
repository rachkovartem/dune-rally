// src/render/cameraModes.ts
// The camera modes the C key cycles through, and the rig that drives the one in use: two chase
// views, three views fixed to the car body, and a cinematic camera.
import * as THREE from 'three';
import { carDefinitionFor } from '../assets/carCatalog';
import type { CarId } from '../vehicle/cars';
import {
  CAMERA_GROUND_CLEARANCE,
  CAMERA_IDLE_RETURN,
  CLOSE_CHASE,
  ChaseCamera,
  FAR_CHASE,
  applyOrbitDrag,
  applyOrbitZoom,
  headingOf,
  type ChaseProfile,
} from './chaseCamera';
import { carViewPointsFrom, sampleCarBody, type CarPoint, type CarViewPoints } from './carViewPoints';

export const CAMERA_MODES = ['close', 'far', 'hood', 'bumper', 'cockpit', 'cinematic'] as const;
export type CameraModeId = (typeof CAMERA_MODES)[number];

export const CAMERA_MODE_LABELS: Readonly<Record<CameraModeId, string>> = {
  close: 'Близко',
  far: 'Далеко',
  hood: 'Капот',
  bumper: 'Бампер',
  cockpit: 'Салон',
  cinematic: 'Кино',
};

/** What the banner says for «Салон» on a car whose model has no inside. */
export const COCKPIT_WITHOUT_CABIN_LABEL = 'Салон (нет салона — вид с капота)';

export function cameraModeLabelFor(mode: CameraModeId, hasCabin: boolean): string {
  return mode === 'cockpit' && !hasCabin ? COCKPIT_WITHOUT_CABIN_LABEL : CAMERA_MODE_LABELS[mode];
}

/** A car without a cabin has nothing to sit in, so its cockpit view is the bonnet view. */
export function mountedViewPointsFor(measured: CarViewPoints, hasCabin: boolean): CarViewPoints {
  return hasCabin ? measured : { ...measured, cockpit: measured.hood };
}

export const CAMERA_MODE_STORAGE_KEY = 'dune-rally.cameraMode';
export const DEFAULT_CAMERA_MODE: CameraModeId = 'close';

export function isCameraModeId(value: unknown): value is CameraModeId {
  return typeof value === 'string' && CAMERA_MODES.some((mode) => mode === value);
}

export function nextCameraMode(mode: CameraModeId): CameraModeId {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
}

/** The mode saved on an earlier visit; nothing saved or an unknown value gives the default mode. */
export function readSavedCameraMode(storage: Pick<Storage, 'getItem'>): CameraModeId {
  const saved = storage.getItem(CAMERA_MODE_STORAGE_KEY);
  return isCameraModeId(saved) ? saved : DEFAULT_CAMERA_MODE;
}

export function saveCameraMode(storage: Pick<Storage, 'setItem'>, mode: CameraModeId): void {
  storage.setItem(CAMERA_MODE_STORAGE_KEY, mode);
}

type ChaseModeId = 'close' | 'far';
type MountedModeId = 'hood' | 'bumper' | 'cockpit';

const CHASE_PROFILES: Readonly<Record<ChaseModeId, ChaseProfile>> = { close: CLOSE_CHASE, far: FAR_CHASE };

function isChaseMode(mode: CameraModeId): mode is ChaseModeId {
  return mode === 'close' || mode === 'far';
}

function isMountedMode(mode: CameraModeId): mode is MountedModeId {
  return mode === 'hood' || mode === 'bumper' || mode === 'cockpit';
}

export const LOOK_YAW_LIMIT = THREE.MathUtils.degToRad(120);
export const LOOK_PITCH_LIMIT = THREE.MathUtils.degToRad(45);
const LOOK_PER_PIXEL = 0.005;
const LOOK_RETURN_RATE = 3;

/** Where the player turned the view of a camera fixed to the car; zero = straight ahead. */
export interface LookState {
  /** Positive turns the view to the driver's left. */
  yaw: number;
  /** Positive looks up. */
  pitch: number;
  idle: number;
  dragging: boolean;
}

export function createLookState(): LookState {
  return { yaw: 0, pitch: 0, idle: Infinity, dragging: false };
}

/** The view follows the mouse: a drag to the right looks right, a drag down looks down. */
export function applyLookDrag(state: LookState, deltaX: number, deltaY: number): void {
  state.yaw = THREE.MathUtils.clamp(state.yaw - deltaX * LOOK_PER_PIXEL, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
  state.pitch = THREE.MathUtils.clamp(state.pitch - deltaY * LOOK_PER_PIXEL, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);
  state.idle = 0;
}

/** After CAMERA_IDLE_RETURN seconds without input the view eases back to straight ahead. */
export function stepLook(state: LookState, dt: number): void {
  if (!state.dragging) state.idle += dt;
  if (state.idle <= CAMERA_IDLE_RETURN) return;
  state.yaw = THREE.MathUtils.damp(state.yaw, 0, LOOK_RETURN_RATE, dt);
  state.pitch = THREE.MathUtils.damp(state.pitch, 0, LOOK_RETURN_RATE, dt);
}

// The cameras fixed to the car see from very close to the body, so they need a closer near plane.
const MOUNTED_NEAR = 0.08;
const MOUNTED_GROUND_CLEARANCE = 0.1;
// How fast a fixed camera follows the body's tilt: quick enough to feel attached, slow enough
// to take the shake of the suspension out of the picture.
const BODY_TILT_FOLLOW_RATE = 12;

const CINEMATIC_SHOT_SECONDS = 6;
const CINEMATIC_ORBIT_RADIUS = 9;
const CINEMATIC_ORBIT_HEIGHT = 2.2;
const CINEMATIC_ORBIT_SPEED = 0.18;
const CINEMATIC_TRACKSIDE_AHEAD = 14;
const CINEMATIC_TRACKSIDE_LEAD_SECONDS = 2.5;
const CINEMATIC_TRACKSIDE_SIDE = 7;
const CINEMATIC_TRACKSIDE_HEIGHT = 1.4;
/** A trackside shot ends early once the car is this far from the camera. */
const CINEMATIC_TRACKSIDE_RANGE = 45;
const CINEMATIC_LOOK_HEIGHT = 0.6;
const CINEMATIC_AIM_RATE = 6;

type ShotKind = 'orbit' | 'trackside';

interface CinematicShot {
  kind: ShotKind;
  index: number;
  elapsed: number;
  orbitAngle: number;
  anchor: THREE.Vector3;
}

const LINE_HEIGHT_PIXELS = 16;

/**
 * Drives the camera in the mode the player picked. The chase views keep the chase camera's orbit
 * and zoom; the views fixed to the car let the mouse look around instead.
 */
export class CameraRig {
  readonly chase: ChaseCamera;
  readonly look = createLookState();
  private currentMode: CameraModeId;
  private readonly viewPoints = new WeakMap<THREE.Object3D, CarViewPoints>();
  private readonly bodyTilt = new THREE.Quaternion();
  private bodyTiltReady = false;
  private readonly defaultNear: number;
  private readonly shot: CinematicShot = { kind: 'orbit', index: 0, elapsed: 0, orbitAngle: 0, anchor: new THREE.Vector3() };
  private shotReady = false;
  /** Set on a cut, so the new shot aims at the car at once instead of panning over from the old aim. */
  private aimReady = false;
  private readonly aim = new THREE.Vector3();
  private readonly lastTargetPosition = new THREE.Vector3();
  private lastTargetPositionReady = false;
  private targetSpeed = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDown = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundHeight: (x: number, z: number) => number,
    initialMode: CameraModeId,
    private readonly onModeChange: (mode: CameraModeId) => void,
  ) {
    this.chase = new ChaseCamera(camera, groundHeight);
    this.defaultNear = camera.near;
    this.currentMode = initialMode;
    this.enterMode();
  }

  mode(): CameraModeId {
    return this.currentMode;
  }

  /** The C key: the next mode, with its view put back to where it starts. */
  cycleMode(): void {
    this.currentMode = nextCameraMode(this.currentMode);
    this.enterMode();
    this.onModeChange(this.currentMode);
  }

  private enterMode(): void {
    const mode = this.currentMode;
    this.chase.setProfile(isChaseMode(mode) ? CHASE_PROFILES[mode] : CLOSE_CHASE);
    Object.assign(this.look, createLookState());
    this.bodyTiltReady = false;
    this.shotReady = false;
    this.lastTargetPositionReady = false;
    this.targetSpeed = 0;
  }

  /** Mouse drag on `surface`, the wheel anywhere on the page, C for the next mode. */
  bindInput(surface: HTMLElement): void {
    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointerDown = true;
      this.chase.orbit.dragging = true;
      this.chase.orbit.idle = 0;
      this.look.dragging = true;
      this.look.idle = 0;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) return;
      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      if (isMountedMode(this.currentMode)) applyLookDrag(this.look, deltaX, deltaY);
      else if (isChaseMode(this.currentMode)) applyOrbitDrag(this.chase.orbit, deltaX, deltaY);
    });
    const endDrag = (event: PointerEvent): void => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.chase.orbit.dragging = false;
      this.chase.orbit.idle = 0;
      this.look.dragging = false;
      this.look.idle = 0;
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    };
    surface.addEventListener('pointerup', endDrag);
    surface.addEventListener('pointercancel', endDrag);
    // Not passive: the wheel and the trackpad pinch must never scroll or zoom the page.
    window.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (!isChaseMode(this.currentMode)) return;
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_HEIGHT_PIXELS : event.deltaY;
      applyOrbitZoom(this.chase.orbit, pixels);
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyC' && !event.repeat) this.cycleMode();
    });
  }

  /**
   * `carId` is null while no car body exists (the start screen looks at an empty spawn point);
   * then the fixed views have nothing to sit on and the close chase view stands in for them.
   */
  update(target: THREE.Object3D, dt: number, carId: CarId | null): void {
    const mode = this.currentMode;
    if (isMountedMode(mode) && carId !== null) {
      this.setNear(MOUNTED_NEAR);
      stepLook(this.look, dt);
      this.updateMounted(target, this.viewPointsOf(target, carId)[mode], dt);
      return;
    }
    this.setNear(this.defaultNear);
    if (mode === 'cinematic') {
      this.updateCinematic(target, dt);
      return;
    }
    this.chase.update(target, dt);
  }

  private setNear(near: number): void {
    if (this.camera.near === near) return;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
  }

  private viewPointsOf(car: THREE.Object3D, carId: CarId): CarViewPoints {
    const known = this.viewPoints.get(car);
    if (known) return known;
    const definition = carDefinitionFor(carId);
    const points = mountedViewPointsFor(carViewPointsFrom(sampleCarBody(car), definition.driverSide), definition.hasCabin);
    this.viewPoints.set(car, points);
    return points;
  }

  private updateMounted(car: THREE.Object3D, point: CarPoint, dt: number): void {
    if (!this.bodyTiltReady) {
      this.bodyTilt.copy(car.quaternion);
      this.bodyTiltReady = true;
    }
    this.bodyTilt.slerp(car.quaternion, 1 - Math.exp(-BODY_TILT_FOLLOW_RATE * dt));

    const position = this.camera.position;
    position.set(point.x, point.y, point.z).applyQuaternion(car.quaternion).add(car.position);
    position.y = Math.max(position.y, this.groundHeight(position.x, position.z) + MOUNTED_GROUND_CLEARANCE);

    // The camera looks down its own -Z; the half turn points it along the car's +Z nose.
    const lookAround = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.pitch, this.look.yaw + Math.PI, 0, 'YXZ'));
    this.camera.quaternion.copy(this.bodyTilt).multiply(lookAround);
  }

  private startShot(target: THREE.Object3D, index: number): void {
    const heading = headingOf(target.quaternion) ?? 0;
    this.shot.index = index;
    this.shot.elapsed = 0;
    this.shot.kind = index % 2 === 0 ? 'orbit' : 'trackside';
    // Every orbit starts from a new side of the car, so repeated shots do not look the same.
    this.shot.orbitAngle = heading + Math.PI * 0.75 + index * 1.9;
    const side = index % 4 === 1 ? 1 : -1;
    const lead = CINEMATIC_TRACKSIDE_AHEAD + this.targetSpeed * CINEMATIC_TRACKSIDE_LEAD_SECONDS;
    const anchorX = target.position.x + Math.sin(heading) * lead + Math.cos(heading) * side * CINEMATIC_TRACKSIDE_SIDE;
    const anchorZ = target.position.z + Math.cos(heading) * lead - Math.sin(heading) * side * CINEMATIC_TRACKSIDE_SIDE;
    this.shot.anchor.set(anchorX, this.groundHeight(anchorX, anchorZ) + CINEMATIC_TRACKSIDE_HEIGHT, anchorZ);
    this.aimReady = false;
  }

  private updateCinematic(target: THREE.Object3D, dt: number): void {
    if (dt > 0 && this.lastTargetPositionReady) {
      this.targetSpeed = target.position.distanceTo(this.lastTargetPosition) / dt;
    }
    this.lastTargetPosition.copy(target.position);
    this.lastTargetPositionReady = true;

    if (!this.shotReady) {
      this.startShot(target, 0);
      this.shotReady = true;
    }
    this.shot.elapsed += dt;
    const tooFar = this.shot.kind === 'trackside' && this.shot.anchor.distanceTo(target.position) > CINEMATIC_TRACKSIDE_RANGE;
    if (this.shot.elapsed > CINEMATIC_SHOT_SECONDS || tooFar) this.startShot(target, this.shot.index + 1);

    const position = this.camera.position;
    if (this.shot.kind === 'orbit') {
      this.shot.orbitAngle += CINEMATIC_ORBIT_SPEED * dt;
      position.set(
        target.position.x + Math.sin(this.shot.orbitAngle) * CINEMATIC_ORBIT_RADIUS,
        target.position.y + CINEMATIC_ORBIT_HEIGHT,
        target.position.z + Math.cos(this.shot.orbitAngle) * CINEMATIC_ORBIT_RADIUS,
      );
    } else {
      position.copy(this.shot.anchor);
    }
    position.y = Math.max(position.y, this.groundHeight(position.x, position.z) + CAMERA_GROUND_CLEARANCE);

    const wanted = target.position.clone();
    wanted.y += CINEMATIC_LOOK_HEIGHT;
    if (this.aimReady) this.aim.lerp(wanted, 1 - Math.exp(-CINEMATIC_AIM_RATE * dt));
    else this.aim.copy(wanted);
    this.aimReady = true;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.aim);
  }
}
