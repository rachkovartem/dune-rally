// src/render/cameraModes.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CameraRig,
  DEFAULT_CAMERA_MODE,
  LOOK_PITCH_LIMIT,
  LOOK_YAW_LIMIT,
  applyLookDrag,
  cameraModeLabelFor,
  createLookState,
  mountedViewPointsFor,
  nextCameraMode,
  readSavedCameraMode,
  saveCameraMode,
  stepLook,
  type CameraModeId,
} from './cameraModes';
import { CAMERA_IDLE_RETURN } from './chaseCamera';
import type { CarViewPoints } from './carViewPoints';

/** An in-memory stand-in for localStorage. */
class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('the C key — camera mode order (camera modes)', () => {
  it('cycles Близко → Далеко → Капот → Бампер → Салон → Кино and back to the start', () => {
    const visited: CameraModeId[] = [];
    let mode: CameraModeId = 'close';
    for (let press = 0; press < 6; press++) {
      visited.push(mode);
      mode = nextCameraMode(mode);
    }
    expect(visited).toEqual(['close', 'far', 'hood', 'bumper', 'cockpit', 'cinematic']);
    expect(mode).toBe('close');
  });

  it('tells the HUD the new mode and starts it looking straight ahead', () => {
    const shown: CameraModeId[] = [];
    const rig = new CameraRig(new THREE.PerspectiveCamera(), () => 0, 'far', (mode) => shown.push(mode));
    rig.look.yaw = 1;
    rig.cycleMode();
    expect(rig.mode()).toBe('hood');
    expect(shown).toEqual(['hood']);
    expect(rig.look.yaw).toBe(0);
  });
});

describe('the saved camera mode', () => {
  it('starts in the default mode on a first visit', () => {
    expect(readSavedCameraMode(new MemoryStorage())).toBe(DEFAULT_CAMERA_MODE);
  });

  it('comes back in the mode saved on the last visit', () => {
    const storage = new MemoryStorage();
    saveCameraMode(storage, 'bumper');
    expect(readSavedCameraMode(storage)).toBe('bumper');
  });

  it('falls back to the default mode for a saved value it does not know', () => {
    const storage = new MemoryStorage();
    saveCameraMode(storage, 'hood');
    const savedKey = 'dune-rally.cameraMode';
    expect(storage.getItem(savedKey)).toBe('hood');
    storage.setItem(savedKey, 'drone');
    expect(readSavedCameraMode(storage)).toBe(DEFAULT_CAMERA_MODE);
  });
});

describe('looking around in the views fixed to the car', () => {
  it('turns the view right for a drag to the right and down for a drag down', () => {
    const look = createLookState();
    applyLookDrag(look, 40, 30);
    expect(look.yaw).toBeLessThan(0);
    expect(look.pitch).toBeLessThan(0);
  });

  it('stops at its limits however far the mouse goes', () => {
    const look = createLookState();
    applyLookDrag(look, -1e6, -1e6);
    expect(look.yaw).toBe(LOOK_YAW_LIMIT);
    expect(look.pitch).toBe(LOOK_PITCH_LIMIT);
    applyLookDrag(look, 1e6, 1e6);
    expect(look.yaw).toBe(-LOOK_YAW_LIMIT);
    expect(look.pitch).toBe(-LOOK_PITCH_LIMIT);
  });

  it('holds the view until the idle time has passed, then eases it back toward straight ahead', () => {
    const look = createLookState();
    applyLookDrag(look, 100, 0);
    const turned = look.yaw;
    stepLook(look, CAMERA_IDLE_RETURN - 0.01);
    expect(look.yaw).toBe(turned);
    stepLook(look, 0.5);
    expect(Math.abs(look.yaw)).toBeLessThan(Math.abs(turned));
    for (let frame = 0; frame < 600; frame++) stepLook(look, 1 / 60);
    expect(Math.abs(look.yaw)).toBeLessThan(1e-3);
  });

  it('never eases back while the player holds the mouse button', () => {
    const look = createLookState();
    applyLookDrag(look, 100, 0);
    look.dragging = true;
    const turned = look.yaw;
    for (let frame = 0; frame < 600; frame++) stepLook(look, 1 / 60);
    expect(look.yaw).toBe(turned);
  });
});

describe('«Салон» on a car with no cabin (every car has one today; the fallback stays for a model without)', () => {
  const MEASURED: CarViewPoints = { hood: { x: 0, y: 1.2, z: 1 }, bumper: { x: 0, y: 0.5, z: 2.4 }, cockpit: { x: 0.35, y: 1.2, z: -0.2 } };

  it('puts the cockpit camera on the bonnet and says so in the banner', () => {
    expect(mountedViewPointsFor(MEASURED, false).cockpit).toEqual(MEASURED.hood);
    expect(cameraModeLabelFor('cockpit', false)).not.toBe(cameraModeLabelFor('cockpit', true));
  });

  it('keeps the measured driver\'s seat for a car with a cabin', () => {
    expect(mountedViewPointsFor(MEASURED, true)).toEqual(MEASURED);
    expect(cameraModeLabelFor('hood', false)).toBe(cameraModeLabelFor('hood', true));
  });
});
