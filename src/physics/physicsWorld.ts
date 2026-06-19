// src/physics/physicsWorld.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK_SIZE, CHUNK_RES } from '../world/chunk';
import { VERTS_PER_SIDE } from '../world/heightfieldData';

export async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = 1 / 60;
  return world;
}

/** Rapier heightfields are column-major; our grid is row-major (row=z, col=x). Transpose. */
export function rapierHeights(rowMajor: Float32Array): Float32Array {
  const n = VERTS_PER_SIDE;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      out[col * n + r] = rowMajor[r * n + col];
    }
  }
  return out;
}

export function addChunkCollider(
  world: RAPIER.World,
  heights: Float32Array,
  originX: number,
  originZ: number,
): RAPIER.Collider {
  const nrows = CHUNK_RES;
  const ncols = CHUNK_RES;
  const scale = new RAPIER.Vector3(CHUNK_SIZE, 1, CHUNK_SIZE);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      originX + CHUNK_SIZE / 2,
      0,
      originZ + CHUNK_SIZE / 2,
    ),
  );
  const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, rapierHeights(heights), scale);
  return world.createCollider(desc, body);
}

export function removeCollider(world: RAPIER.World, collider: RAPIER.Collider) {
  const body = collider.parent();
  if (body) world.removeRigidBody(body);
}
