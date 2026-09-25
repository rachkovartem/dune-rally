// src/render/chaseCamera.ts
import * as THREE from 'three';

export const CAMERA_PITCH_MIN = THREE.MathUtils.degToRad(3);
export const CAMERA_PITCH_MAX = THREE.MathUtils.degToRad(70);
export const CAMERA_DISTANCE_MIN = 4;
export const CAMERA_DISTANCE_MAX = 25;
/** Seconds without mouse input before the camera eases back behind the car. */
export const CAMERA_IDLE_RETURN = 2;
export const CAMERA_GROUND_CLEARANCE = 0.5;

/** How a chase view frames the car when the player has not moved it. */
export interface ChaseProfile {
  pitch: number;
  distance: number;
  /** Height above the car origin the camera orbits around. */
  focusHeight: number;
  /** How far ahead of the car the camera looks when it is right behind it. */
  lookAhead: number;
}

// A close, low racing-game chase view: the car fills about a quarter of the screen width
// and the horizon sits near the upper third, with the ground ahead visible over the roof.
export const CLOSE_CHASE: ChaseProfile = {
  pitch: Math.atan2(1.7, 4.7),
  distance: Math.hypot(1.7, 4.7),
  focusHeight: 0,
  lookAhead: 1.5,
};

// The earlier, wider chase view: more of the ground around the car is visible.
export const FAR_CHASE: ChaseProfile = {
  pitch: Math.atan2(4.4, 9.5),
  distance: Math.hypot(4.4, 9.5),
  focusHeight: 1.2,
  lookAhead: 4,
};

const DRAG_YAW_PER_PIXEL = 0.006;
const DRAG_PITCH_PER_PIXEL = 0.005;
const ZOOM_PER_PIXEL = 0.0015;
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

export function createOrbitState(profile: ChaseProfile = CLOSE_CHASE): OrbitState {
  return { yawOffset: 0, pitch: profile.pitch, distance: profile.distance, idle: Infinity, dragging: false };
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

export function resetOrbit(state: OrbitState, profile: ChaseProfile = CLOSE_CHASE): void {
  Object.assign(state, createOrbitState(profile));
}

/** Shortest signed angle, so an orbit of several turns eases back the short way. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** After CAMERA_IDLE_RETURN seconds without input the view eases back behind the car; zoom stays. */
export function stepOrbit(state: OrbitState, dt: number, restPitch: number = CLOSE_CHASE.pitch): void {
  if (!state.dragging) state.idle += dt;
  if (state.idle <= CAMERA_IDLE_RETURN) return;
  state.yawOffset = THREE.MathUtils.damp(wrapAngle(state.yawOffset), 0, RETURN_RATE, dt);
  state.pitch = THREE.MathUtils.damp(state.pitch, restPitch, RETURN_RATE, dt);
}

/** Heading of the car's nose on the ground plane, or null when the nose points straight up or down. */
export function headingOf(quaternion: THREE.Quaternion): number | null {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  if (Math.hypot(forward.x, forward.z) < 0.2) return null;
  return Math.atan2(forward.x, forward.z);
}

/**
 * Chase camera the player can orbit and zoom (the input is wired by the camera rig). The heading
 * lags the car a little, the orbit input does not.
 */
export class ChaseCamera {
  readonly orbit = createOrbitState();
  private profile: ChaseProfile = CLOSE_CHASE;
  private heading: number | null = null;
  private readonly lookOffset = new THREE.Vector3();
  private lookOffsetReady = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {}

  /** Switches the framing and puts the camera right behind the car in it. */
  setProfile(profile: ChaseProfile): void {
    this.profile = profile;
    resetOrbit(this.orbit, profile);
    this.resetFollow();
  }

  /** Forgets the lagged heading, so a view coming back from another camera starts behind the car. */
  resetFollow(): void {
    this.heading = null;
    this.lookOffsetReady = false;
  }

  update(target: THREE.Object3D, dt: number): void {
    stepOrbit(this.orbit, dt, this.profile.pitch);

    const carHeading = headingOf(target.quaternion);
    if (this.heading === null) this.heading = carHeading ?? 0;
    else if (carHeading !== null) this.heading += wrapAngle(carHeading - this.heading) * (1 - Math.pow(0.02, dt));

    const focus = target.position.clone();
    focus.y += this.profile.focusHeight;
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
    const ahead = this.profile.lookAhead * Math.max(0, Math.cos(this.orbit.yawOffset));
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
