// src/net/playerViews.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PlayerViews } from './playerViews';
import type { NetPlayer } from './connection';
import { registerCarAsset } from '../render/buggyMesh';
import type { CarAssembly, CarPart, CarWheelParts } from '../render/carModel';
import type { WheelSlot } from '../assets/carPartRules';
import { DEFAULT_CAR_ID, type CarId } from '../vehicle/cars';
import { restingSuspensionLength, vehicleConfigFor } from '../vehicle/vehicleConfig';

const bodyNameOf = (carId: CarId): string => `${carId}-body`;

function fakeAssembly(carId: CarId): CarAssembly {
  const part = (name: string, slot: CarPart['slot']): CarPart =>
    ({ name, geometry: new THREE.BoxGeometry(0.2, 0.2, 0.2), slot, embeddedMaps: { map: null, normalMap: null } });
  const corner = (slot: WheelSlot): CarWheelParts => ({ spinning: [part(`${carId}-${slot}`, 'rubber')], hubFixed: [] });
  return {
    bodyParts: [part(bodyNameOf(carId), 'paint')],
    wheelParts: { wheelFL: corner('wheelFL'), wheelFR: corner('wheelFR'), wheelRL: corner('wheelRL'), wheelRR: corner('wheelRR') },
    fit: { bodyScale: 1, bodyOffset: { x: 0, y: 0, z: 0 }, wheelScale: 1, wheelInsetX: 0 },
  };
}

function netPlayer(carId: string, x = 0, y = 2, z = 0): NetPlayer {
  return { name: 'remote', carId, x, y, z, qx: 0, qy: 0, qz: 0, qw: 1, spawnSlot: 0 };
}

/** Which car's model a view shows, read from the body mesh the registered asset put there. */
function shownCarOf(views: PlayerViews, id: string): string | undefined {
  return views.group(id)?.children[0].children[0].name;
}

let world: RAPIER.World;
let scene: THREE.Scene;
let views: PlayerViews;

beforeAll(async () => {
  await RAPIER.init();
  registerCarAsset('forester', fakeAssembly('forester'));
  registerCarAsset('pajero', fakeAssembly('pajero'));
});

beforeEach(() => {
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0), ground);
  world.step(); // builds the query structures the wheel rays read
  scene = new THREE.Scene();
  views = new PlayerViews(scene, world);
});

describe('PlayerViews — each remote player drives the car they picked (R133–R135)', () => {
  it('shows a new remote player in the car they joined with', () => {
    views.add('p1', 'pajero');
    expect(shownCarOf(views, 'p1')).toBe(bodyNameOf('pajero'));
    expect(views.carIdOf('p1')).toBe('pajero');
    expect(scene.children).toContain(views.group('p1'));
  });

  it('swaps the model when the player picks another car, and drops the old model from the scene', () => {
    views.add('p1', 'pajero');
    const oldGroup = views.group('p1');
    views.pushState('p1', netPlayer('forester'), 0);
    expect(shownCarOf(views, 'p1')).toBe(bodyNameOf('forester'));
    expect(views.carIdOf('p1')).toBe('forester');
    expect(scene.children).not.toContain(oldGroup);
    expect(scene.children).toContain(views.group('p1'));
  });

  it('keeps the same model object while the car id does not change', () => {
    views.add('p1', 'forester');
    const group = views.group('p1');
    views.pushState('p1', netPlayer('forester'), 0);
    expect(views.group('p1')).toBe(group);
  });

  it.each(['lada-niva', '', 'PAJERO'])('draws the default car, complete, for an unknown car id "%s" without throwing', (carId) => {
    views.add('p1', 'pajero');
    expect(() => views.pushState('p1', netPlayer(carId), 0)).not.toThrow();
    expect(shownCarOf(views, 'p1')).toBe(bodyNameOf(DEFAULT_CAR_ID));
    expect(views.group('p1')?.children).toHaveLength(5);
  });

  it('ignores state for a player it never added', () => {
    views.pushState('ghost', netPlayer('pajero'), 0);
    expect(views.group('ghost')).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  });

  it('removes a player\'s model from the scene', () => {
    views.add('p1', 'pajero');
    views.remove('p1');
    expect(views.group('p1')).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  });
});

describe('PlayerViews.update — remote wheels stand on the ground', () => {
  it.each<CarId>(['forester', 'pajero'])('puts every %s wheel bottom on the ground the ray finds', (carId) => {
    const config = vehicleConfigFor(carId);
    const bodyHeight = config.wheel.radius + restingSuspensionLength(config.wheel) - config.wheel.positions[0].y + 0.05;
    views.add('p1', carId);
    views.pushState('p1', netPlayer(carId, 3, bodyHeight, 4), 0);
    views.update(0, null, 0);

    const pivots = views.group('p1')?.children.slice(1) ?? [];
    expect(pivots).toHaveLength(4);
    for (const pivot of pivots) {
      const wheelCentre = pivot.getWorldPosition(new THREE.Vector3());
      expect(wheelCentre.y - config.wheel.radius).toBeCloseTo(0, 3);
    }
  });

  it('never stands a remote wheel on a moving car (the local player\'s own car) under it', () => {
    const config = vehicleConfigFor('pajero');
    const localCar = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 38.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, 3), localCar);
    world.step();
    views.add('p1', 'pajero');
    views.pushState('p1', netPlayer('pajero', 0, 40, 0), 0);
    views.update(0, null, 0);
    const pivots = views.group('p1')?.children.slice(1) ?? [];
    pivots.forEach((pivot, wheelIndex) => {
      expect(pivot.position.y).toBeCloseTo(config.wheel.positions[wheelIndex].y - restingSuspensionLength(config.wheel), 6);
    });
  });

  it('hangs the wheels at their resting length when there is no ground under the car', () => {
    const config = vehicleConfigFor('pajero');
    views.add('p1', 'pajero');
    views.pushState('p1', netPlayer('pajero', 0, 40, 0), 0);
    views.update(0, null, 0);
    const pivots = views.group('p1')?.children.slice(1) ?? [];
    pivots.forEach((pivot, wheelIndex) => {
      expect(pivot.position.y).toBeCloseTo(config.wheel.positions[wheelIndex].y - restingSuspensionLength(config.wheel), 6);
    });
  });

  it('rolls the remote wheels by the distance the car moved along its nose', () => {
    const config = vehicleConfigFor('forester');
    views.add('p1', 'forester');
    views.pushState('p1', netPlayer('forester', 0, 40, 0), 0);
    views.pushState('p1', netPlayer('forester', 0, 40, 2), 100);
    views.update(0, null, 0);
    views.update(100, null, 100);
    const spinner = views.group('p1')?.children[1].children[0];
    expect(spinner?.rotation.x).toBeCloseTo(2 / config.wheel.radius, 6);
  });
});

describe('PlayerViews.update — a remote car far from the local collider ring (S0-5)', () => {
  // The client builds colliders only near its own car: a remote car farther away has no collider
  // under it, and its wheels must still stand on the drawn ground, not hang in the air.
  const DRAWN_GROUND = 7.5;
  let emptyWorld: RAPIER.World;

  beforeEach(() => {
    emptyWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    emptyWorld.step();
  });

  it('stands every wheel on the drawn ground when the ray finds no collider', () => {
    const config = vehicleConfigFor('forester');
    const aboveGround = new PlayerViews(new THREE.Scene(), emptyWorld, () => DRAWN_GROUND);
    const bodyHeight = DRAWN_GROUND + config.wheel.radius + restingSuspensionLength(config.wheel) - config.wheel.positions[0].y + 0.05;
    aboveGround.add('far', 'forester');
    aboveGround.pushState('far', netPlayer('forester', 900, bodyHeight, 900), 0);
    aboveGround.update(0, null, 0);

    const pivots = aboveGround.group('far')?.children.slice(1) ?? [];
    expect(pivots).toHaveLength(4);
    for (const pivot of pivots) {
      expect(pivot.getWorldPosition(new THREE.Vector3()).y - config.wheel.radius).toBeCloseTo(DRAWN_GROUND, 3);
    }
  });

  it('hangs the wheels at their resting length when the drawn ground is out of their reach', () => {
    const config = vehicleConfigFor('forester');
    const farBelow = new PlayerViews(new THREE.Scene(), emptyWorld, () => DRAWN_GROUND);
    farBelow.add('jumping', 'forester');
    farBelow.pushState('jumping', netPlayer('forester', 900, DRAWN_GROUND + 30, 900), 0);
    farBelow.update(0, null, 0);

    const pivots = farBelow.group('jumping')?.children.slice(1) ?? [];
    pivots.forEach((pivot, wheelIndex) => {
      expect(pivot.position.y).toBeCloseTo(config.wheel.positions[wheelIndex].y - restingSuspensionLength(config.wheel), 6);
    });
  });

  it('pushes the wheels fully up, not below the ground, for a car sunk into the drawn ground', () => {
    const config = vehicleConfigFor('forester');
    const sunk = new PlayerViews(new THREE.Scene(), emptyWorld, () => DRAWN_GROUND);
    sunk.add('sunk', 'forester');
    sunk.pushState('sunk', netPlayer('forester', 900, DRAWN_GROUND - 1, 900), 0);
    sunk.update(0, null, 0);

    const pivots = sunk.group('sunk')?.children.slice(1) ?? [];
    pivots.forEach((pivot, wheelIndex) => {
      // No wheel hangs lower than its resting pose while the body is under the ground.
      expect(pivot.position.y).toBeGreaterThan(config.wheel.positions[wheelIndex].y - restingSuspensionLength(config.wheel));
    });
  });
});
