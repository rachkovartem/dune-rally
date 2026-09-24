// server/arenaSim.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeightField, type Height2D } from '../src/world/noise';
import { generateChunkHeights } from '../src/world/heightfieldData';
import { chunkOrigin } from '../src/world/chunk';
import { featuresInChunk, SPAWN } from '../src/world/worldDef';
import { addChunkCollider, addFeatureColliders } from '../src/physics/physicsWorld';
import { createVehiclePhysics, type VehiclePhysics } from '../shared/vehiclePhysics';
import { ARENA_CHUNKS, type InputMsg } from '../shared/protocol';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import type { CarId } from '../src/vehicle/cars';

export interface PlayerTransform {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

interface Player {
  vehicle: VehiclePhysics;
  input: InputMsg;
}

export class ArenaSim {
  private players = new Map<string, Player>();
  private spawnIndex = 0;

  private constructor(
    private world: RAPIER.World,
    private height: Height2D,
  ) {}

  static async create(seed: number): Promise<ArenaSim> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    world.timestep = 1 / 60;
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
    return new ArenaSim(world, height);
  }

  addPlayer(id: string, carId: CarId): void {
    // Deterministic spread of spawn points across the hub-town plaza (golden-angle spiral).
    const n = this.spawnIndex++;
    const ang = n * 2.39996;
    const r = 4 + (n % 4) * 4;
    const x = SPAWN.x + Math.cos(ang) * r;
    const z = SPAWN.z + Math.sin(ang) * r;
    const vehicle = createVehiclePhysics(this.world, { x, y: this.height(x, z) + 4, z }, vehicleConfigFor(carId));
    this.players.set(id, { vehicle, input: { throttle: 0, brake: 0, steer: 0 } });
  }

  setInput(id: string, input: InputMsg): void {
    const p = this.players.get(id);
    if (p) p.input = input;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.world.removeRigidBody(p.vehicle.body);
    this.players.delete(id);
  }

  step(): void {
    for (const p of this.players.values()) p.vehicle.applyInput(p.input, 1);
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

  playerIds(): string[] {
    return [...this.players.keys()];
  }
}
