// src/render/chaseCamera.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_DISTANCE_MAX,
  CAMERA_DISTANCE_MIN,
  CAMERA_GROUND_CLEARANCE,
  CAMERA_IDLE_RETURN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  ChaseCamera,
  applyOrbitDrag,
  applyOrbitZoom,
  createOrbitState,
  resetOrbit,
  stepOrbit,
  wrapAngle,
} from './chaseCamera';

describe('orbit drag and zoom', () => {
  it('keeps the pitch between its limits however far the mouse is dragged', () => {
    const state = createOrbitState();
    applyOrbitDrag(state, 0, 1e6);
    expect(state.pitch).toBe(CAMERA_PITCH_MAX);
    applyOrbitDrag(state, 0, -1e6);
    expect(state.pitch).toBe(CAMERA_PITCH_MIN);
  });

  it('turns the view the opposite way for opposite drags, and a drag back returns it', () => {
    const state = createOrbitState();
    applyOrbitDrag(state, 120, 0);
    const afterRight = state.yawOffset;
    applyOrbitDrag(state, -240, 0);
    expect(Math.sign(state.yawOffset)).toBe(-Math.sign(afterRight));
    applyOrbitDrag(state, 120, 0);
    expect(state.yawOffset).toBeCloseTo(0, 12);
  });

  it('keeps the distance between its limits however far the wheel turns', () => {
    const state = createOrbitState();
    applyOrbitZoom(state, 1e6);
    expect(state.distance).toBe(CAMERA_DISTANCE_MAX);
    applyOrbitZoom(state, -1e6);
    expect(state.distance).toBe(CAMERA_DISTANCE_MIN);
  });

  it('zooms by the same share per wheel notch, near and far', () => {
    const near = { ...createOrbitState(), distance: 5 };
    const far = { ...createOrbitState(), distance: 20 };
    applyOrbitZoom(near, 100);
    applyOrbitZoom(far, 100);
    expect(near.distance / 5).toBeCloseTo(far.distance / 20, 12);
    expect(near.distance).toBeGreaterThan(5);
  });

  it('marks any drag or zoom as fresh input, which stops the ease back', () => {
    const dragged = { ...createOrbitState(), idle: 10 };
    applyOrbitDrag(dragged, 1, 1);
    expect(dragged.idle).toBe(0);
    const zoomed = { ...createOrbitState(), idle: 10 };
    applyOrbitZoom(zoomed, 1);
    expect(zoomed.idle).toBe(0);
  });
});

describe('stepOrbit — easing back behind the car', () => {
  const orbited = () => {
    const state = createOrbitState();
    applyOrbitDrag(state, 300, 80);
    applyOrbitZoom(state, 400);
    return state;
  };

  it('holds the orbit still until CAMERA_IDLE_RETURN seconds pass without input', () => {
    const state = orbited();
    const { yawOffset, pitch } = state;
    stepOrbit(state, CAMERA_IDLE_RETURN);
    expect(state.yawOffset).toBe(yawOffset);
    expect(state.pitch).toBe(pitch);
  });

  it('eases back behind the car after the idle time, and keeps the player\'s zoom', () => {
    const state = orbited();
    const zoomed = state.distance;
    for (let step = 0; step < 60 * 10; step++) stepOrbit(state, 1 / 60);
    expect(state.yawOffset).toBeCloseTo(0, 3);
    expect(state.pitch).toBeCloseTo(createOrbitState().pitch, 3);
    expect(state.distance).toBe(zoomed);
  });

  it('never eases back while the mouse button is held', () => {
    const state = orbited();
    state.dragging = true;
    const { yawOffset } = state;
    for (let step = 0; step < 60 * 10; step++) stepOrbit(state, 1 / 60);
    expect(state.yawOffset).toBe(yawOffset);
  });

  it('eases back the short way after several full turns of orbit', () => {
    const state = { ...createOrbitState(), yawOffset: 4 * Math.PI + 0.3, idle: CAMERA_IDLE_RETURN + 1 };
    stepOrbit(state, 1 / 60);
    expect(Math.abs(state.yawOffset)).toBeLessThan(0.3);
  });
});

describe('wrapAngle', () => {
  it.each([
    [0, 0],
    [Math.PI / 2, Math.PI / 2],
    [2 * Math.PI + 0.25, 0.25],
    [-2 * Math.PI - 0.25, -0.25],
    [3 * Math.PI / 2, -Math.PI / 2],
  ])('wraps %s to %s', (angle, wrapped) => {
    expect(wrapAngle(angle)).toBeCloseTo(wrapped, 12);
  });
});

describe('resetOrbit (the C key)', () => {
  it('puts the camera right behind the car at the default distance', () => {
    const state = createOrbitState();
    applyOrbitDrag(state, 500, -50);
    applyOrbitZoom(state, 900);
    resetOrbit(state);
    expect(state).toEqual(createOrbitState());
  });
});

describe('ChaseCamera.update', () => {
  const carAt = (x: number, y: number, z: number): THREE.Object3D => {
    const car = new THREE.Object3D();
    car.position.set(x, y, z);
    return car;
  };

  it('sits behind the car: on the side opposite its nose', () => {
    const camera = new THREE.PerspectiveCamera();
    const chase = new ChaseCamera(camera, () => 0);
    chase.update(carAt(0, 1, 0), 1 / 60);
    expect(camera.position.z).toBeLessThan(0);
    expect(camera.position.x).toBeCloseTo(0, 6);
  });

  it('never goes below the ground under it, even when orbited down to the minimum pitch', () => {
    const camera = new THREE.PerspectiveCamera();
    const hill = (x: number, z: number): number => 30 + 0.01 * x + 0.01 * z;
    const chase = new ChaseCamera(camera, hill);
    applyOrbitDrag(chase.orbit, 0, -1e6);
    chase.update(carAt(0, 1, 0), 1 / 60);
    expect(camera.position.y).toBeGreaterThanOrEqual(hill(camera.position.x, camera.position.z) + CAMERA_GROUND_CLEARANCE - 1e-9);
  });
});
