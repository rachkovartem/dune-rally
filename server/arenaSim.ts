// server/arenaSim.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeightField, type Height2D } from '../src/world/noise';
import { generateChunkHeights } from '../src/world/heightfieldData';
import { chunkOrigin } from '../src/world/chunk';
import { featuresInChunk, SPAWN } from '../src/world/worldDef';
import { addChunkCollider, addFeatureColliders } from '../src/physics/physicsWorld';
import { createVehiclePhysics, RESET_LIFT, type VehiclePhysics } from '../shared/vehiclePhysics';
import { WORLD_GRAVITY } from '../shared/drivetrain';
import { ARENA_CHUNKS, type InputMsg } from '../shared/protocol';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import type { CarId } from '../src/vehicle/cars';
import { createBiome, type Biome } from '../src/world/biome';
import { surfaceSampleAt } from '../src/world/surfaceSample';
import { terrainGripFor } from '../shared/terrainGrip';

/** Seconds of simulated time per step(). */
export const SIM_STEP_SECONDS = 1 / 60;

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

  private constructor(
    private world: RAPIER.World,
    private height: Height2D,
    private biome: Biome,
  ) {}

  static async create(seed: number): Promise<ArenaSim> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    world.timestep = SIM_STEP_SECONDS;
    const height = createHeightField(seed);

    for (let cz = 0; cz < ARENA_CHUNKS; cz++) {
      for (let cx = 0; cx < ARENA_CHUNKS; cx++) {
        const heights = generateChunkHeights(height, { cx, cz });
        const origin = chunkOrigin({ cx, cz });
        addChunkCollider(world, heights, origin.x, origin.z);
        // Solid placed features (buildings, ramps, landmarks) — same deterministic placement as the client.
        addFeatureColliders(world, featuresInChunk(cx, cz), height);
      }
    }
    return new ArenaSim(world, height, createBiome(seed));
  }

  addPlayer(id: string, carId: CarId): void {
    // Deterministic spread of spawn points across the hub-town plaza (golden-angle spiral).
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
