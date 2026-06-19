// server/ArenaRoom.ts
import { Room, Client } from '@colyseus/core';
import { ArenaState, PlayerState } from './state';
import { ArenaSim } from './arenaSim';
import { dailySeed } from '../src/world/seed';
import { sanitizeInput, TICK_HZ, PATCH_HZ } from '../shared/protocol';

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
  }

  onJoin(client: Client, options: { name?: string }) {
    this.sim.addPlayer(client.sessionId);
    const p = new PlayerState();
    p.name = (options?.name ?? 'rider').slice(0, 24);
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private tick() {
    this.sim.step();
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
