// server/arenaSim.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeightField, type Height2D } from '../src/world/noise';
import { generateChunkHeights } from '../src/world/heightfieldData';
import { chunkOrigin, chunksInRadius, worldToChunk, type ChunkCoord } from '../src/world/chunk';
import {
  featuresInChunk, rotationForYaw, spawnPoseFor, SPAWN, SPAWN_LIFT, SPAWN_SLOT_COUNT, WORLD_CHUNKS, type SpawnPose,
} from '../src/world/worldDef';
import { borderEscapeTarget } from '../src/world/borderSafety';
import { terrainSurfaceHeight } from '../src/world/chunkGeometry';
import { addChunkCollider, addFeatureColliders, addPropColliders } from '../src/physics/physicsWorld';
import { propPlacementsInChunk } from '../src/world/propPlacement';
import { createVehiclePhysics, RESET_LIFT, type VehiclePhysics } from '../shared/vehiclePhysics';
import { WORLD_GRAVITY } from '../shared/drivetrain';
import { INPUT_TIMEOUT_SECONDS, type InputMsg, type PoseMsg } from '../shared/protocol';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import type { CarId } from '../src/vehicle/cars';
import { createBiome, type Biome } from '../src/world/biome';
import { groundAt } from '../src/world/groundAt';
import type { SurfaceGround } from '../shared/terrainGrip';
import type { MovingCar } from '../shared/chunkDemand';
import { ColliderStreamer, type ColliderStreamerOptions } from './colliderStreamer';

/** Seconds of simulated time per step(). */
export const SIM_STEP_SECONDS = 1 / 60;

// The streamer runs once per step(); the room runs two steps per 30 Hz tick, so a budget of 1
// here is 2 chunk builds per room tick.
export const SERVER_CHUNK_STREAMING: ColliderStreamerOptions = {
  mustRadius: 1,
  wantRadius: 2,
  lookAheadSeconds: 1.5,
  worldChunks: WORLD_CHUNKS,
  buildBudgetPerTick: 1,
};
/** Chunks around the spawn built in create(), so the first players never wait for ground. */
export const SPAWN_PREBUILD_RADIUS = 2;

export interface PlayerTransform {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

interface Player {
  vehicle: VehiclePhysics;
  input: InputMsg;
  /** Steps run since the last input message from this player's client. */
  inputAgeSteps: number;
  carId: CarId;
  spawnSlot: number;
}

// A client sends its input at most once per tick, plus a 150 ms heartbeat when it is unchanged.
// A hidden or frozen tab sends nothing, and the copy must not keep driving on the pedals it last
// saw: after INPUT_TIMEOUT_SECONDS (shared/protocol.ts) it gets pedals and steering released.
const INPUT_TIMEOUT_STEPS = Math.round(INPUT_TIMEOUT_SECONDS / SIM_STEP_SECONDS);

/** The last input with the pedals and steering released; the traction control and drive mode stay. */
export function releasedInput(input: InputMsg): InputMsg {
  return { ...input, throttle: 0, brake: 0, steer: 0 };
}

/** The lowest slot no one holds; when every slot is taken, cars share one (`used.size` mod `count`). */
export function lowestFreeSlot(used: ReadonlySet<number>, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error(`lowestFreeSlot: bad slot count ${count}`);
  for (let slot = 0; slot < count; slot++) {
    if (!used.has(slot)) return slot;
  }
  return used.size % count;
}

// The server copy follows its own physics until the driver's own car is this far away from it.
export const POSE_SNAP_DISTANCE = 2;
export const POSE_SNAP_ANGLE = (20 * Math.PI) / 180;

export class ArenaSim {
  private players = new Map<string, Player>();

  private readonly streamer: ColliderStreamer;

  private constructor(
    private world: RAPIER.World,
    private height: Height2D,
    private biome: Biome,
    private readonly seed: number,
  ) {
    this.streamer = new ColliderStreamer({ build: (chunk) => this.buildChunk(chunk) }, SERVER_CHUNK_STREAMING);
  }

  static async create(seed: number): Promise<ArenaSim> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    world.timestep = SIM_STEP_SECONDS;
    const sim = new ArenaSim(world, createHeightField(seed), createBiome(seed), seed);
    for (const chunk of chunksInRadius(worldToChunk(SPAWN.x, SPAWN.z), SPAWN_PREBUILD_RADIUS)) {
      if (chunk.cx >= 0 && chunk.cz >= 0 && chunk.cx < WORLD_CHUNKS && chunk.cz < WORLD_CHUNKS) sim.streamer.ensureBuilt(chunk);
    }
    return sim;
  }

  private buildChunk(chunk: ChunkCoord): void {
    const origin = chunkOrigin(chunk);
    addChunkCollider(this.world, generateChunkHeights(this.height, chunk), origin.x, origin.z);
    // Solid placed features (buildings, landmarks) — same deterministic placement as the client.
    addFeatureColliders(this.world, featuresInChunk(chunk.cx, chunk.cz), this.height);
    const placements = propPlacementsInChunk({ ...chunk, seed: this.seed, height: this.height, biome: this.biome, drawnHeight: colliderGround });
    addPropColliders(this.world, placements);
  }

  /** Terrain chunks that have a collider on the server so far. */
  builtChunkCount(): number {
    return this.streamer.builtCount();
  }

  /** The slot the next player gets: the lowest one no player in the room holds. */
  nextFreeSpawnSlot(): number {
    return lowestFreeSlot(new Set([...this.players.values()].map((player) => player.spawnSlot)), SPAWN_SLOT_COUNT);
  }

  spawnSlotOf(id: string): number | undefined {
    return this.players.get(id)?.spawnSlot;
  }

  /** Adds a car standing in its spawn slot, facing north; the client builds its own car there too. */
  addPlayer(id: string, carId: CarId, spawnSlot: number): void {
    if (this.players.has(id)) throw new Error(`addPlayer: player ${id} is already in the arena`);
    const pose = spawnPoseFor(spawnSlot);
    const vehicle = createVehiclePhysics(this.world, { x: pose.x, y: this.standingHeight(pose), z: pose.z }, vehicleConfigFor(carId));
    this.placeAt(vehicle, pose);
    this.players.set(id, { vehicle, input: { throttle: 0, brake: 0, steer: 0 }, inputAgeSteps: 0, carId, spawnSlot });
  }

  private standingHeight(pose: SpawnPose): number {
    return terrainSurfaceHeight(this.height, pose.x, pose.z) + SPAWN_LIFT;
  }

  /** Puts a car at a pose, upright, standing still, SPAWN_LIFT above the ground, not dug in. */
  private placeAt(vehicle: VehiclePhysics, pose: SpawnPose): void {
    vehicle.body.setTranslation({ x: pose.x, y: this.standingHeight(pose), z: pose.z }, true);
    vehicle.body.setRotation(rotationForYaw(pose.yaw), true);
    vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.resetSurface();
  }

  /** Swap a player's car in place: same position and rotation, standing still. */
  setPlayerCar(id: string, carId: CarId): void {
    const p = this.players.get(id);
    if (!p || p.carId === carId) return;
    const translation = p.vehicle.body.translation();
    const rotation = p.vehicle.body.rotation();
    this.destroyVehicle(p.vehicle);
    const vehicle = createVehiclePhysics(this.world, translation, vehicleConfigFor(carId));
    vehicle.body.setRotation(rotation, true);
    this.players.set(id, { vehicle, input: p.input, inputAgeSteps: p.inputAgeSteps, carId, spawnSlot: p.spawnSlot });
  }

  carIdOf(id: string): CarId | undefined {
    return this.players.get(id)?.carId;
  }

  setInput(id: string, input: InputMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    p.input = input;
    p.inputAgeSteps = 0;
  }

  /**
   * Puts a player's car at (x, z), `lift` metres above the ground there, with a flat velocity and
   * no spin; its rotation is kept. For tools and tests that move cars without driving them.
   */
  teleportPlayer(id: string, x: number, z: number, lift: number, velocity: { vx: number; vz: number }): void {
    const p = this.players.get(id);
    if (!p) throw new Error(`teleportPlayer: no player ${id}`);
    p.vehicle.body.setTranslation({ x, y: this.height(x, z) + lift, z }, true);
    p.vehicle.body.setLinvel({ x: velocity.vx, y: 0, z: velocity.vz }, true);
    p.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.vehicle.resetSurface();
  }

  /**
   * Moves the server copy to where its driver's car is when the two have drifted apart by more than
   * POSE_SNAP_DISTANCE or POSE_SNAP_ANGLE; closer than that the copy keeps its own physics. Returns
   * whether it moved the copy. The spin is cleared, so a copy tumbling on its own stops tumbling.
   * The driver's wheelspin and sinkage come with the snap, so the copy is not left dug in.
   */
  applyClientPose(id: string, pose: PoseMsg): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const position = p.vehicle.body.translation();
    const rotation = p.vehicle.body.rotation();
    const positionError = Math.hypot(pose.x - position.x, pose.y - position.y, pose.z - position.z);
    const dot = Math.abs(pose.qx * rotation.x + pose.qy * rotation.y + pose.qz * rotation.z + pose.qw * rotation.w);
    const rotationError = 2 * Math.acos(Math.min(1, dot));
    if (positionError <= POSE_SNAP_DISTANCE && rotationError <= POSE_SNAP_ANGLE) return false;
    p.vehicle.body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    p.vehicle.body.setRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }, true);
    p.vehicle.body.setLinvel({ x: pose.vx, y: pose.vy, z: pose.vz }, true);
    p.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.vehicle.markMoved();
    if (pose.surface) {
      p.vehicle.setSurfaceState({
        spin: pose.surface.spin,
        spinDirection: p.vehicle.surfaceState().spinDirection,
        sink: pose.surface.sink,
        digDirection: pose.surface.digDirection,
      });
    }
    return true;
  }

  /** The server copy of the client's R: the same upright rule, so other players see the car recover. */
  resetPlayer(id: string): void {
    this.players.get(id)?.vehicle.resetUpright(RESET_LIFT);
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.destroyVehicle(p.vehicle);
    this.players.delete(id);
  }

  private destroyVehicle(vehicle: VehiclePhysics): void {
    this.world.removeVehicleController(vehicle.controller);
    this.world.removeRigidBody(vehicle.body);
  }

  step(): void {
    // The same net the client runs on its own car, so both put a car that got over a crest back
    // at the same safe spot.
    for (const p of this.players.values()) {
      const position = p.vehicle.body.translation();
      const escape = borderEscapeTarget(position.x, position.y, position.z, this.height);
      if (escape) this.placeAt(p.vehicle, escape);
    }
    // Before the physics step, so a car never stands over a chunk that has no collider yet.
    this.streamer.update([...this.players.values()].map((p) => movingCarOf(p.vehicle)));
    for (const p of this.players.values()) {
      const input = p.inputAgeSteps >= INPUT_TIMEOUT_STEPS ? releasedInput(p.input) : p.input;
      p.inputAgeSteps++;
      p.vehicle.applyInput(input, this.groundUnder(p));
    }
    this.world.step();
    for (const p of this.players.values()) p.vehicle.update(this.world.timestep);
  }

  transform(id: string): PlayerTransform | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const t = p.vehicle.body.translation();
    const r = p.vehicle.body.rotation();
    return { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }

  private groundUnder(p: Player): SurfaceGround {
    const { x, z } = p.vehicle.body.translation();
    return groundAt(this.biome, this.height, x, z, vehicleConfigFor(p.carId)).ground;
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }
}

/** The server draws nothing, and solid placements never read the drawn ground. */
const colliderGround = (colliderHeight: number): number => colliderHeight;

function movingCarOf(vehicle: VehiclePhysics): MovingCar {
  const position = vehicle.body.translation();
  const velocity = vehicle.body.linvel();
  return { x: position.x, z: position.z, vx: velocity.x, vz: velocity.z };
}
