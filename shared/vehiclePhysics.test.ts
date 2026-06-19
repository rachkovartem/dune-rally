// shared/vehiclePhysics.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createVehiclePhysics } from './vehiclePhysics';

describe('createVehiclePhysics', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('builds a dynamic chassis with four wheels that cannot sleep', () => {
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    // flat ground so the wheels have something to rest on
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, 0, 0), ground);

    const v = createVehiclePhysics(world, { x: 0, y: 3, z: 0 });
    expect(v.controller.numWheels()).toBe(4);

    // Step a couple of seconds with full throttle; the chassis should travel some distance.
    const start = v.body.translation();
    for (let i = 0; i < 180; i++) {
      v.applyInput({ throttle: 1, brake: 0, steer: 0 });
      world.step();
      v.update(world.timestep);
    }
    const end = v.body.translation();
    const moved = Math.hypot(end.x - start.x, end.z - start.z);
    expect(moved).toBeGreaterThan(1);
    expect(v.body.isSleeping()).toBe(false);
  });
});
