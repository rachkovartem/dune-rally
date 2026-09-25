// src/render/chaseCamera.ts
import * as THREE from 'three';

export const CAMERA_PITCH_MIN = THREE.MathUtils.degToRad(3);
export const CAMERA_PITCH_MAX = THREE.MathUtils.degToRad(70);
export const CAMERA_DISTANCE_MIN = 4;
export const CAMERA_DISTANCE_MAX = 25;
/** Seconds without mouse input before the camera eases back behind the car. */
export const CAMERA_IDLE_RETURN = 2;
export const CAMERA_GROUND_CLEARANCE = 0.5;

// A close, low racing-game chase view: the car fills about a quarter of the screen width
// and the horizon sits near the upper third, with the ground ahead visible over the roof.
const DEFAULT_PITCH = Math.atan2(1.7, 4.7);
const DEFAULT_DISTANCE = Math.hypot(1.7, 4.7);
const TARGET_HEIGHT = 0;
const LOOK_AHEAD = 1.5;
const DRAG_YAW_PER_PIXEL = 0.006;
const DRAG_PITCH_PER_PIXEL = 0.005;
const ZOOM_PER_PIXEL = 0.0015;
const LINE_HEIGHT_PIXELS = 16;
const RETURN_RATE = 2.5;

/** Where the player has moved the camera around the car; all zero input = right behind it. */
export interface OrbitState {
  yawOffset: number;
  pitch: number;
  distance: number;
  /** Seconds since the last mouse input. */
  idle: number;
  dragging: boolean;
}

export function createOrbitState(): OrbitState {
  return { yawOffset: 0, pitch: DEFAULT_PITCH, distance: DEFAULT_DISTANCE, idle: Infinity, dragging: false };
}

export function applyOrbitDrag(state: OrbitState, deltaX: number, deltaY: number): void {
  state.yawOffset -= deltaX * DRAG_YAW_PER_PIXEL;
  state.pitch = THREE.MathUtils.clamp(state.pitch + deltaY * DRAG_PITCH_PER_PIXEL, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
  state.idle = 0;
}

/** `deltaPixels` > 0 zooms out. Multiplicative, so one wheel notch feels the same near and far. */
export function applyOrbitZoom(state: OrbitState, deltaPixels: number): void {
  state.distance = THREE.MathUtils.clamp(
    state.distance * Math.exp(deltaPixels * ZOOM_PER_PIXEL),
    CAMERA_DISTANCE_MIN,
    CAMERA_DISTANCE_MAX,
  );
  state.idle = 0;
}

export function resetOrbit(state: OrbitState): void {
  Object.assign(state, createOrbitState());
}

/** Shortest signed angle, so an orbit of several turns eases back the short way. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** After CAMERA_IDLE_RETURN seconds without input the view eases back behind the car; zoom stays. */
export function stepOrbit(state: OrbitState, dt: number): void {
  if (!state.dragging) state.idle += dt;
  if (state.idle <= CAMERA_IDLE_RETURN) return;
  state.yawOffset = THREE.MathUtils.damp(wrapAngle(state.yawOffset), 0, RETURN_RATE, dt);
  state.pitch = THREE.MathUtils.damp(state.pitch, DEFAULT_PITCH, RETURN_RATE, dt);
}

/** Heading of the car's nose on the ground plane, or null when the nose points straight up or down. */
function headingOf(quaternion: THREE.Quaternion): number | null {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  if (Math.hypot(forward.x, forward.z) < 0.2) return null;
  return Math.atan2(forward.x, forward.z);
}

/**
 * Chase camera the player can orbit with a left-mouse drag and zoom with the wheel. The heading
 * lags the car a little, the orbit input does not.
 */
export class ChaseCamera {
  readonly orbit = createOrbitState();
  private heading: number | null = null;
  private readonly lookOffset = new THREE.Vector3();
  private lookOffsetReady = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {}

  /** Mouse drag on `surface`, the wheel anywhere on the page, C to put the camera back. */
  bindInput(surface: HTMLElement): void {
    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.orbit.dragging = true;
      this.orbit.idle = 0;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener('pointermove', (event) => {
      if (!this.orbit.dragging) return;
      applyOrbitDrag(this.orbit, event.clientX - this.lastPointerX, event.clientY - this.lastPointerY);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
    });
    const endDrag = (event: PointerEvent): void => {
      if (!this.orbit.dragging) return;
      this.orbit.dragging = false;
      this.orbit.idle = 0;
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    };
    surface.addEventListener('pointerup', endDrag);
    surface.addEventListener('pointercancel', endDrag);
    // Not passive: the wheel and the trackpad pinch must zoom the camera, not scroll or zoom the page.
    window.addEventListener('wheel', (event) => {
      event.preventDefault();
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_HEIGHT_PIXELS : event.deltaY;
      applyOrbitZoom(this.orbit, pixels);
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyC') resetOrbit(this.orbit);
    });
  }

  update(target: THREE.Object3D, dt: number): void {
    stepOrbit(this.orbit, dt);

    const carHeading = headingOf(target.quaternion);
    if (this.heading === null) this.heading = carHeading ?? 0;
    else if (carHeading !== null) this.heading += wrapAngle(carHeading - this.heading) * (1 - Math.pow(0.02, dt));

    const focus = target.position.clone();
    focus.y += TARGET_HEIGHT;
    const behind = this.heading + Math.PI + this.orbit.yawOffset;
    const horizontal = Math.cos(this.orbit.pitch) * this.orbit.distance;
    const position = this.camera.position;
    position.set(
      focus.x + Math.sin(behind) * horizontal,
      focus.y + Math.sin(this.orbit.pitch) * this.orbit.distance,
      focus.z + Math.cos(behind) * horizontal,
    );
    position.y = Math.max(position.y, this.groundHeight(position.x, position.z) + CAMERA_GROUND_CLEARANCE);

    // Look a bit ahead of the car when behind it, straight at it while orbiting. Smoothed relative
    // to the car, so at top speed the look point does not fall behind and tip the view down.
    const ahead = LOOK_AHEAD * Math.max(0, Math.cos(this.orbit.yawOffset));
    const lookHeading = carHeading ?? this.heading;
    const wanted = new THREE.Vector3(Math.sin(lookHeading), 0, Math.cos(lookHeading)).multiplyScalar(ahead);
    if (!this.lookOffsetReady) {
      this.lookOffset.copy(wanted);
      this.lookOffsetReady = true;
    }
    this.lookOffset.lerp(wanted, 1 - Math.pow(0.002, dt));
    this.camera.lookAt(focus.add(this.lookOffset));
  }
}
