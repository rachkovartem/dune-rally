// server/ArenaRoom.ts
import { Room, Client, ErrorCode, ServerError, type RoomException } from '@colyseus/core';
import { ArenaState, PlayerState } from './state';
import { ArenaSim, SIM_STEP_SECONDS } from './arenaSim';
import { ARENA_WORLD_SEED, MAX_ARENA_ROOMS, ROOM_MAX_CLIENTS } from './config';
import { MESSAGE_RATE_LIMIT, MessageRateLimiter, type MessageKind } from './messageRateLimit';
import { trustedPose } from './poseTrust';
import { RoomSlots } from './roomSlots';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import {
  MESSAGE_FLOOD_CLOSE_CODE, POSE_MESSAGE, RESET_CAR_MESSAGE, ROOM_BROKEN_CLOSE_CODE, sanitizeCarId, sanitizeInput,
  sanitizeJoinOptions, sanitizePose, TICK_HZ, PATCH_HZ, type PoseMsg,
} from '../shared/protocol';

// The world steps at a fixed 1/60 s, so each 1/30 s tick runs two steps to keep real time.
const STEPS_PER_TICK = Math.max(1, Math.round(1 / TICK_HZ / SIM_STEP_SECONDS));

/** Shared by every arena room of this process. */
export const arenaRoomSlots = new RoomSlots(MAX_ARENA_ROOMS);

interface ClientGuard {
  limiter: MessageRateLimiter;
  /** performance.now() of the last pose that passed the trust check, or of the join. */
  poseAcceptedAtMs: number;
  /** Set while poses are being rejected, so one bad streak is logged once. */
  rejectingPoses: boolean;
  /** The socket closes a little later: messages already on the way are ignored, not logged again. */
  kicked: boolean;
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = ROOM_MAX_CLIENTS;
  private sim: ArenaSim | null = null;
  private holdsRoomSlot = false;
  private readonly guards = new Map<string, ClientGuard>();

  // Join options come from the client, so they never choose the world: every room runs the same one.
  async onCreate() {
    if (!arenaRoomSlots.tryClaim()) {
      throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, `the server already runs ${MAX_ARENA_ROOMS} rooms`);
    }
    this.holdsRoomSlot = true;
    this.setState(new ArenaState());
    this.state.seed = ARENA_WORLD_SEED;
    try {
      this.sim = await ArenaSim.create(ARENA_WORLD_SEED);
    } catch (error) {
      this.releaseRoomSlot();
      throw error;
    }

    this.setPatchRate(1000 / PATCH_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_HZ);

    this.onLimitedMessage('input', 'input', (client, message) => {
      this.readySim().setInput(client.sessionId, sanitizeInput(message));
    });

    // The payload is never read: a player can only reset its own car.
    this.onLimitedMessage(RESET_CAR_MESSAGE, 'control', (client) => {
      this.readySim().resetPlayer(client.sessionId);
    });

    // A broken pose is dropped: the copy keeps its own physics until the next good one arrives.
    this.onLimitedMessage(POSE_MESSAGE, 'control', (client, message) => {
      const pose = sanitizePose(message);
      if (pose) this.applyTrustedPose(client, pose);
    });

    this.onLimitedMessage('selectCar', 'control', (client, message) => {
      const carId = sanitizeCarId(typeof message === 'object' && message !== null && 'carId' in message ? message.carId : undefined);
      this.readySim().setPlayerCar(client.sessionId, carId);
      const player = this.state.players.get(client.sessionId);
      if (player) player.carId = carId;
    });
  }

  onJoin(client: Client, options: unknown) {
    const sim = this.readySim();
    const { name, carId } = sanitizeJoinOptions(options);
    const spawnSlot = sim.nextFreeSpawnSlot();
    sim.addPlayer(client.sessionId, carId, spawnSlot);
    this.guardOf(client).poseAcceptedAtMs = performance.now();
    const player = new PlayerState();
    player.name = name;
    player.carId = carId;
    // Set before the player is added to the state, so the client's first patch already carries it.
    player.spawnSlot = spawnSlot;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.guards.delete(client.sessionId);
    this.sim?.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    this.releaseRoomSlot();
  }

  private releaseRoomSlot(): void {
    if (!this.holdsRoomSlot) return;
    this.holdsRoomSlot = false;
    arenaRoomSlots.release();
  }

  // Colyseus calls this for a throw in onCreate, onJoin, a message handler or the tick. Without it
  // the throw reaches the process and Colyseus shuts the whole server down.
  onUncaughtException(error: RoomException<this>, methodName: string) {
    // A ServerError is a planned refusal (the room limit), so it gets one line and no stack.
    const cause = error.cause instanceof ServerError || !(error.cause instanceof Error)
      ? error.message
      : error.cause.stack ?? error.cause.message;
    console.error(`[arena ${this.roomId}] ${methodName} failed: ${cause}`);
  }

  // The state encoder runs outside every hook above. A value it cannot encode would throw on every
  // patch from then on, so the room is closed instead of taking the process down with it.
  broadcastPatch(): boolean {
    try {
      return super.broadcastPatch();
    } catch (error) {
      this.closeBrokenRoom('patch', error);
      return false;
    }
  }

  protected sendFullState(client: Client): void {
    try {
      super.sendFullState(client);
    } catch (error) {
      this.closeBrokenRoom('full state', error);
    }
  }

  private closeBrokenRoom(what: string, error: unknown): void {
    console.error(`[arena ${this.roomId}] cannot encode the ${what}, closing the room:`, error instanceof Error ? error.stack : String(error));
    this.setPatchRate(null);
    void this.disconnect(ROOM_BROKEN_CLOSE_CODE);
  }

  private readySim(): ArenaSim {
    if (this.sim === null) throw new Error('the arena world is not built yet');
    return this.sim;
  }

  private guardOf(client: Client): ClientGuard {
    const existing = this.guards.get(client.sessionId);
    if (existing) return existing;
    const nowMs = performance.now();
    const guard: ClientGuard = { limiter: new MessageRateLimiter(MESSAGE_RATE_LIMIT, nowMs), poseAcceptedAtMs: nowMs, rejectingPoses: false, kicked: false };
    this.guards.set(client.sessionId, guard);
    return guard;
  }

  private onLimitedMessage(type: string, kind: MessageKind, handler: (client: Client, message: unknown) => void): void {
    this.onMessage(type, (client: Client, message: unknown) => {
      const guard = this.guardOf(client);
      if (guard.kicked) return;
      const decision = guard.limiter.take(kind, performance.now());
      if (decision === 'accept') {
        handler(client, message);
      } else if (decision === 'kick') {
        guard.kicked = true;
        console.warn(`[arena ${this.roomId}] ${client.sessionId} sends messages faster than any game client, disconnecting`);
        client.leave(MESSAGE_FLOOD_CLOSE_CODE);
      }
    });
  }

  private applyTrustedPose(client: Client, pose: PoseMsg): void {
    const sim = this.readySim();
    const serverPosition = sim.transform(client.sessionId);
    const carId = sim.carIdOf(client.sessionId);
    if (!serverPosition || carId === undefined) return;
    const guard = this.guardOf(client);
    const nowMs = performance.now();
    const trusted = trustedPose({
      pose,
      serverPosition,
      secondsSinceAccepted: (nowMs - guard.poseAcceptedAtMs) / 1000,
      topSpeed: vehicleConfigFor(carId).drivetrain.topSpeed,
    });
    if (trusted === null) {
      if (!guard.rejectingPoses) console.warn(`[arena ${this.roomId}] ${client.sessionId} sent a pose too far from its car, ignoring it`);
      guard.rejectingPoses = true;
      return;
    }
    guard.rejectingPoses = false;
    guard.poseAcceptedAtMs = nowMs;
    sim.applyClientPose(client.sessionId, trusted);
  }

  private tick() {
    const sim = this.readySim();
    for (let step = 0; step < STEPS_PER_TICK; step++) sim.step();
    for (const id of sim.playerIds()) {
      const transform = sim.transform(id);
      const player = this.state.players.get(id);
      if (transform && player) {
        player.x = transform.x; player.y = transform.y; player.z = transform.z;
        player.qx = transform.qx; player.qy = transform.qy; player.qz = transform.qz; player.qw = transform.qw;
      }
    }
  }
}
