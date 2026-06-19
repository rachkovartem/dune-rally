// src/physics/physicsWorld.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { buildChunkGeometry } from '../world/chunkGeometry';

export async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = 1 / 60;
  return world;
}

/**
 * Add a static trimesh collider for a chunk, built from the SAME world-space geometry as the
 * render mesh (buildChunkGeometry). Using a trimesh — rather than a Rapier heightfield —
 * guarantees the collision surface matches what is drawn, with no axis/orientation ambiguity.
 */
export function addChunkCollider(
  world: RAPIER.World,
  heights: Float32Array,
  originX: number,
  originZ: number,
): RAPIER.Collider {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc = RAPIER.ColliderDesc.trimesh(positions, indices);
  return world.createCollider(desc, body);
}

export function removeCollider(world: RAPIER.World, collider: RAPIER.Collider) {
  const body = collider.parent();
  if (body) world.removeRigidBody(body);
}
