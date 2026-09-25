// src/physics/physicsWorld.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK_RES, CHUNK_SIZE } from '../world/chunk';
import { VERTS_PER_SIDE } from '../world/heightfieldData';
import { WORLD_GRAVITY } from '../../shared/drivetrain';
import {
  landmarkBox,
  type BuildingBox, type ChunkFeatures,
} from '../world/worldDef';
import type { PropPlacement } from '../world/propPlacement';
import { propColliderBox } from '../world/propColliders';

export async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  world.timestep = 1 / 60;
  return world;
}

/**
 * Reorders a row-major height grid (row = z, column = x) into the column-major order a Rapier
 * heightfield reads, where each column is one x and runs along z.
 */
export function toColumnMajor(heights: Float32Array, verticesPerSide: number): Float32Array {
  if (heights.length !== verticesPerSide * verticesPerSide) {
    throw new Error(`toColumnMajor: ${heights.length} heights is not a ${verticesPerSide} × ${verticesPerSide} grid`);
  }
  const columnMajor = new Float32Array(heights.length);
  for (let row = 0; row < verticesPerSide; row++) {
    for (let column = 0; column < verticesPerSide; column++) {
      columnMajor[column * verticesPerSide + row] = heights[row * verticesPerSide + column];
    }
  }
  return columnMajor;
}

/**
 * Add a static heightfield collider for a chunk from its row-major height grid. With this layout
 * Rapier splits every cell along the same diagonal as buildChunkGeometry, so the collider is
 * exactly the drawn ground (terrainSurfaceHeight), at about 1/50 of the memory of a trimesh.
 */
export function addChunkCollider(
  world: RAPIER.World,
  heights: Float32Array,
  originX: number,
  originZ: number,
): RAPIER.Collider {
  const halfSize = CHUNK_SIZE / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(originX + halfSize, 0, originZ + halfSize),
  );
  const desc = RAPIER.ColliderDesc.heightfield(
    CHUNK_RES,
    CHUNK_RES,
    toColumnMajor(heights, VERTS_PER_SIDE),
    { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE },
    RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
  );
  return world.createCollider(desc, body);
}

/**
 * Add a static solid box collider for a town building. `baseY` is the (flattened) ground height at
 * the building's footprint, so the box sits flush on the pad. Placement is derived from the same
 * deterministic road network on client and server, so the solid buildings agree on both sides.
 */
export function addBuildingCollider(
  world: RAPIER.World,
  b: BuildingBox,
  baseY: number,
): RAPIER.Collider {
  const half = b.yaw / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(b.x, baseY + b.h / 2, b.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
  );
  return world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2), body);
}

/**
 * Add solid colliders for all placed features (town buildings, landmarks) in a chunk.
 * `heightAt` gives the (flattened) ground height under each feature. Returns every created collider
 * so the client can remove them on chunk unload.
 */
export function addFeatureColliders(
  world: RAPIER.World,
  f: ChunkFeatures,
  heightAt: (x: number, z: number) => number,
): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  for (const b of f.buildings) out.push(addBuildingCollider(world, b, heightAt(b.x, b.z)));
  for (const l of f.landmarks) out.push(addBuildingCollider(world, landmarkBox(l), heightAt(l.x, l.z)));
  return out;
}

/** Share of a prop box's smallest half size that is rounded off, so a wheel rides over a corner instead of stopping dead. */
const PROP_EDGE_ROUNDING = 0.3;

/**
 * Static round-box colliders for the solid placements of a chunk; every other placement is skipped.
 * The client and the server call this with the same placements, so both see the same boulders.
 */
export function addPropColliders(world: RAPIER.World, placements: readonly PropPlacement[]): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  for (const placement of placements) {
    if (!placement.solid) continue;
    const box = propColliderBox(placement);
    if (!box) throw new Error(`addPropColliders: ${placement.modelId} is marked solid but has no collider shape`);
    // A round cuboid is its inner box grown by the radius, so the inner box is shrunk by it.
    const radius = PROP_EDGE_ROUNDING * Math.min(box.halfX, box.halfY, box.halfZ);
    const half = box.yaw / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(box.x, box.y, box.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    const desc = RAPIER.ColliderDesc.roundCuboid(box.halfX - radius, box.halfY - radius, box.halfZ - radius, radius);
    colliders.push(world.createCollider(desc, body));
  }
  return colliders;
}

export function removeCollider(world: RAPIER.World, collider: RAPIER.Collider) {
  const body = collider.parent();
  if (body) world.removeRigidBody(body);
}
