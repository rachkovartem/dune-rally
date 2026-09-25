// server/ArenaRoom.ts
import { Room, Client } from '@colyseus/core';
import { ArenaState, PlayerState } from './state';
import { ArenaSim, SIM_STEP_SECONDS } from './arenaSim';
import { dailySeed } from '../src/world/seed';
import {
  POSE_MESSAGE, RESET_CAR_MESSAGE, sanitizeCarId, sanitizeInput, sanitizePose, TICK_HZ, PATCH_HZ, type JoinOptions,
} from '../shared/protocol';

// The world steps at a fixed 1/60 s, so each 1/30 s tick runs two steps to keep real time.
const STEPS_PER_TICK = Math.max(1, Math.round(1 / TICK_HZ / SIM_STEP_SECONDS));

export class ArenaRoom extends Room<ArenaState> {
  private sim!: ArenaSim;

  async onCreate(options: { seed?: number }) {
    const seed = options.seed ?? dailySeed('2026-06-19');
    this.setState(new ArenaState());
    this.state.seed = seed;
    this.sim = await ArenaSim.create(seed);

    this.setPatchRate(1000 / PATCH_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_HZ);

    this.onMessage('input', (client, msg) => {
      this.sim.setInput(client.sessionId, sanitizeInput(msg));
    });

    // The payload is never read: a player can only reset its own car.
    this.onMessage(RESET_CAR_MESSAGE, (client) => {
      this.sim.resetPlayer(client.sessionId);
    });

    // A broken pose is dropped: the copy keeps its own physics until the next good one arrives.
    this.onMessage(POSE_MESSAGE, (client, msg: unknown) => {
      const pose = sanitizePose(msg);
      if (pose) this.sim.applyClientPose(client.sessionId, pose);
    });

    this.onMessage('selectCar', (client, msg: unknown) => {
      const carId = sanitizeCarId(typeof msg === 'object' && msg !== null && 'carId' in msg ? msg.carId : undefined);
      this.sim.setPlayerCar(client.sessionId, carId);
      const p = this.state.players.get(client.sessionId);
      if (p) p.carId = carId;
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    const carId = sanitizeCarId(options?.carId);
    const spawnSlot = this.sim.nextFreeSpawnSlot();
    this.sim.addPlayer(client.sessionId, carId, spawnSlot);
    const p = new PlayerState();
    p.name = (options?.name ?? 'rider').slice(0, 24);
    p.carId = carId;
    // Set before the player is added to the state, so the client's first patch already carries it.
    p.spawnSlot = spawnSlot;
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private tick() {
    for (let step = 0; step < STEPS_PER_TICK; step++) this.sim.step();
    for (const id of this.sim.playerIds()) {
      const t = this.sim.transform(id);
      const p = this.state.players.get(id);
      if (t && p) {
        p.x = t.x; p.y = t.y; p.z = t.z;
        p.qx = t.qx; p.qy = t.qy; p.qz = t.qz; p.qw = t.qw;
      }
    }
  }
}
