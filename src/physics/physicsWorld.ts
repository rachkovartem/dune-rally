// src/physics/physicsWorld.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { buildChunkGeometry } from '../world/chunkGeometry';
import { WORLD_GRAVITY } from '../../shared/drivetrain';
import {
  landmarkBox,
  type BuildingBox, type Ramp, type ChunkFeatures,
} from '../world/worldDef';

export async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
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
 * Add a static wedge (triangular-prism) collider for a stunt ramp: flat on the ground at the back,
 * rising to `rise` over `len`, so the car climbs the slope and launches off the front lip. `baseY`
 * is the ground height under the ramp; the wedge's base sits on it. Same deterministic placement on
 * client and server.
 */
export function addRampCollider(world: RAPIER.World, r: Ramp, baseY: number): RAPIER.Collider {
  const hw = r.width / 2;
  const hl = r.len / 2;
  // local: drive up +Z; triangle (z=-hl,y=0) → (z=+hl,y=0) → (z=+hl,y=rise), extruded along x.
  const pts = new Float32Array([
    -hw, 0, -hl, hw, 0, -hl, // back-bottom edge
    -hw, 0, hl, hw, 0, hl,   // front-bottom edge
    -hw, r.rise, hl, hw, r.rise, hl, // front-top edge
  ]);
  const half = r.yaw / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(r.x, baseY, r.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
  );
  const desc = RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.cuboid(hw, r.rise / 2, hl);
  return world.createCollider(desc, body);
}

/**
 * Add solid colliders for all placed features (town buildings, stunt ramps, landmarks) in a chunk.
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
  for (const r of f.ramps) out.push(addRampCollider(world, r, heightAt(r.x, r.z)));
  for (const l of f.landmarks) out.push(addBuildingCollider(world, landmarkBox(l), heightAt(l.x, l.z)));
  return out;
}

export function removeCollider(world: RAPIER.World, collider: RAPIER.Collider) {
  const body = collider.parent();
  if (body) world.removeRigidBody(body);
}
