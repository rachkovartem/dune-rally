// server/arenaSim.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeightField, type Height2D } from '../src/world/noise';
import { generateChunkHeights } from '../src/world/heightfieldData';
import { chunkOrigin, chunksInRadius, worldToChunk, type ChunkCoord } from '../src/world/chunk';
import { featuresInChunk, SPAWN, WORLD_CHUNKS } from '../src/world/worldDef';
import { addChunkCollider, addFeatureColliders } from '../src/physics/physicsWorld';
import { createVehiclePhysics, RESET_LIFT, type VehiclePhysics } from '../shared/vehiclePhysics';
import { WORLD_GRAVITY } from '../shared/drivetrain';
import type { InputMsg } from '../shared/protocol';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import type { CarId } from '../src/vehicle/cars';
import { createBiome, type Biome } from '../src/world/biome';
import { surfaceSampleAt } from '../src/world/surfaceSample';
import { terrainGripFor } from '../shared/terrainGrip';
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
  carId: CarId;
}

export class ArenaSim {
  private players = new Map<string, Player>();
  private spawnIndex = 0;

  private readonly streamer: ColliderStreamer;

  private constructor(
    private world: RAPIER.World,
    private height: Height2D,
    private biome: Biome,
  ) {
    this.streamer = new ColliderStreamer({ build: (chunk) => this.buildChunk(chunk) }, SERVER_CHUNK_STREAMING);
  }

  static async create(seed: number): Promise<ArenaSim> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    world.timestep = SIM_STEP_SECONDS;
    const sim = new ArenaSim(world, createHeightField(seed), createBiome(seed));
    for (const chunk of chunksInRadius(worldToChunk(SPAWN.x, SPAWN.z), SPAWN_PREBUILD_RADIUS)) {
      if (chunk.cx >= 0 && chunk.cz >= 0 && chunk.cx < WORLD_CHUNKS && chunk.cz < WORLD_CHUNKS) sim.streamer.ensureBuilt(chunk);
    }
    return sim;
  }

  private buildChunk(chunk: ChunkCoord): void {
    const origin = chunkOrigin(chunk);
    addChunkCollider(this.world, generateChunkHeights(this.height, chunk), origin.x, origin.z);
    // Solid placed features (buildings, ramps, landmarks) — same deterministic placement as the client.
    addFeatureColliders(this.world, featuresInChunk(chunk.cx, chunk.cz), this.height);
  }

  /** Terrain chunks that have a collider on the server so far. */
  builtChunkCount(): number {
    return this.streamer.builtCount();
  }

  addPlayer(id: string, carId: CarId): void {
    // Deterministic spread of spawn points across the flat top of the spawn knoll (golden-angle spiral).
    const n = this.spawnIndex++;
    const ang = n * 2.39996;
    const r = 4 + (n % 4) * 4;
    const x = SPAWN.x + Math.cos(ang) * r;
    const z = SPAWN.z + Math.sin(ang) * r;
    const vehicle = createVehiclePhysics(this.world, { x, y: this.height(x, z) + 4, z }, vehicleConfigFor(carId));
    this.players.set(id, { vehicle, input: { throttle: 0, brake: 0, steer: 0 }, carId });
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
    this.players.set(id, { vehicle, input: p.input, carId });
  }

  carIdOf(id: string): CarId | undefined {
    return this.players.get(id)?.carId;
  }

  setInput(id: string, input: InputMsg): void {
    const p = this.players.get(id);
    if (p) p.input = input;
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
    // Before the physics step, so a car never stands over a chunk that has no collider yet.
    this.streamer.update([...this.players.values()].map((p) => movingCarOf(p.vehicle)));
    for (const p of this.players.values()) p.vehicle.applyInput(p.input, this.gripUnder(p));
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

  private gripUnder(p: Player): number {
    const { x, z } = p.vehicle.body.translation();
    const surface = surfaceSampleAt(this.height, x, z);
    return terrainGripFor(this.biome.coverAt(x, z, surface.height, surface.slope), vehicleConfigFor(p.carId));
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }
}

function movingCarOf(vehicle: VehiclePhysics): MovingCar {
  const position = vehicle.body.translation();
  const velocity = vehicle.body.linvel();
  return { x: position.x, z: position.z, vx: velocity.x, vz: velocity.z };
}
