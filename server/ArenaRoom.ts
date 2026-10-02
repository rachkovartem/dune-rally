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
  MESSAGE_FLOOD_CLOSE_CODE, PING_MESSAGE, PONG_MESSAGE, POSE_MESSAGE, RESET_CAR_MESSAGE, ROOM_BROKEN_CLOSE_CODE,
  SET_NAME_MESSAGE, DUEL_INVITE_MESSAGE, DUEL_INVITE_RECEIVED_MESSAGE, DUEL_ACCEPT_MESSAGE,
  DUEL_DECLINE_MESSAGE, DUEL_CANCEL_MESSAGE, DUEL_START_MESSAGE, DUEL_PROGRESS_MESSAGE,
  DUEL_FINISH_MESSAGE, DUEL_RESULT_MESSAGE,
  sanitizeCarId, sanitizeInput, sanitizeJoinOptions, sanitizePlayerName, sanitizePose, TICK_HZ, PATCH_HZ,
  type InputMsg, type PoseMsg, type DuelStartMsg, type DuelResultMsg, type DuelParticipantResult,
} from '../shared/protocol';
import { duelTrackById, isDuelTrackId, type DuelTrackId } from '../shared/duelTracks';
import type { CarId } from '../src/vehicle/cars';

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
  /** The newest `input` the budget dropped. The tick applies it, so a burst of queued inputs ends on the latest one. */
  droppedInput: InputMsg | null;
}

interface PendingInvite {
  fromSessionId: string;
  toSessionId: string;
  trackId: DuelTrackId;
  sentAt: number;
}

interface ActiveDuel {
  id: string;
  trackId: DuelTrackId;
  player1: { sessionId: string; name: string; carId: CarId; slot: 0 };
  player2: { sessionId: string; name: string; carId: CarId; slot: 1 };
  state: 'countdown' | 'racing' | 'finished';
  startTime: number;
  checkpoints: Map<string, number>;
  finishTimes: Map<string, number>;
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = ROOM_MAX_CLIENTS;
  private sim: ArenaSim | null = null;
  private holdsRoomSlot = false;
  private readonly guards = new Map<string, ClientGuard>();
  private readonly pendingInvites = new Map<string, PendingInvite>();
  private readonly activeDuels = new Map<string, ActiveDuel>();
  private readonly playerToDuel = new Map<string, string>();
  private broken = false;

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
      this.guardOf(client).droppedInput = null;
      this.readySim().setInput(client.sessionId, sanitizeInput(message));
    }, (client, message) => {
      this.guardOf(client).droppedInput = sanitizeInput(message);
    });

    // The payload is never read: a player can only reset its own car.
    this.onLimitedMessage(RESET_CAR_MESSAGE, 'control', (client) => {
      this.readySim().resetPlayer(client.sessionId);
      const guard = this.guardOf(client);
      guard.poseAcceptedAtMs = performance.now();
      guard.rejectingPoses = false;
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

    this.onLimitedMessage(SET_NAME_MESSAGE, 'control', (client, message) => {
      const rawName = typeof message === 'object' && message !== null && 'name' in message ? (message as { name?: unknown }).name : message;
      const name = sanitizePlayerName(rawName);
      const player = this.state.players.get(client.sessionId);
      if (player) player.name = name;
    });

    this.onLimitedMessage(PING_MESSAGE, 'control', (client, timestamp) => {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        client.send(PONG_MESSAGE, timestamp);
      }
    });

    // ── Duel handlers ──────────────────────────────────────────────────
    this.onLimitedMessage(DUEL_INVITE_MESSAGE, 'control', (client, message) => {
      if (typeof message !== 'object' || message === null) return;
      const toSessionId = String((message as { toSessionId?: unknown }).toSessionId ?? '');
      const trackId = String((message as { trackId?: unknown }).trackId ?? '');
      if (!isDuelTrackId(trackId) || !toSessionId || toSessionId === client.sessionId) return;

      const targetClient = this.clientBySessionId(toSessionId);
      const targetPlayer = this.state.players.get(toSessionId);
      const senderPlayer = this.state.players.get(client.sessionId);
      if (!targetClient || !targetPlayer || !senderPlayer) return;
      if (this.playerToDuel.has(client.sessionId) || this.playerToDuel.has(toSessionId)) return;

      const inviteKey = `${client.sessionId}->${toSessionId}`;
      this.pendingInvites.set(inviteKey, {
        fromSessionId: client.sessionId,
        toSessionId,
        trackId,
        sentAt: Date.now(),
      });

      targetClient.send(DUEL_INVITE_RECEIVED_MESSAGE, {
        fromSessionId: client.sessionId,
        fromName: senderPlayer.name,
        trackId,
      });
    });

    this.onLimitedMessage(DUEL_DECLINE_MESSAGE, 'control', (client, message) => {
      if (typeof message !== 'object' || message === null) return;
      const fromSessionId = String((message as { fromSessionId?: unknown }).fromSessionId ?? '');
      const inviteKey = `${fromSessionId}->${client.sessionId}`;
      if (this.pendingInvites.delete(inviteKey)) {
        const inviterClient = this.clientBySessionId(fromSessionId);
        inviterClient?.send(DUEL_DECLINE_MESSAGE, { fromSessionId: client.sessionId });
      }
    });

    this.onLimitedMessage(DUEL_CANCEL_MESSAGE, 'control', (client) => {
      for (const [key, invite] of this.pendingInvites) {
        if (invite.fromSessionId === client.sessionId) {
          this.pendingInvites.delete(key);
          const targetClient = this.clientBySessionId(invite.toSessionId);
          targetClient?.send(DUEL_CANCEL_MESSAGE, {});
        }
      }
    });

    this.onLimitedMessage(DUEL_ACCEPT_MESSAGE, 'control', (client, message) => {
      if (typeof message !== 'object' || message === null) return;
      const fromSessionId = String((message as { fromSessionId?: unknown }).fromSessionId ?? '');
      const inviteKey = `${fromSessionId}->${client.sessionId}`;
      const invite = this.pendingInvites.get(inviteKey);
      if (!invite) return;
      this.pendingInvites.delete(inviteKey);

      const inviterClient = this.clientBySessionId(fromSessionId);
      const inviterPlayer = this.state.players.get(fromSessionId);
      const targetPlayer = this.state.players.get(client.sessionId);
      if (!inviterClient || !inviterPlayer || !targetPlayer) return;

      const track = duelTrackById(invite.trackId);
      if (!track) return;

      const duelId = Math.random().toString(36).substring(2, 9);
      const [slot0, slot1] = track.startSlots;

      // Teleport simulation copies to start grid
      this.readySim().teleportPlayer(fromSessionId, slot0.x, slot0.z, 0.5, { vx: 0, vz: 0 });
      this.readySim().teleportPlayer(client.sessionId, slot1.x, slot1.z, 0.5, { vx: 0, vz: 0 });
      this.guardOf(inviterClient).poseAcceptedAtMs = performance.now();
      this.guardOf(client).poseAcceptedAtMs = performance.now();

      const activeDuel: ActiveDuel = {
        id: duelId,
        trackId: invite.trackId,
        player1: { sessionId: fromSessionId, name: inviterPlayer.name, carId: inviterPlayer.carId as CarId, slot: 0 },
        player2: { sessionId: client.sessionId, name: targetPlayer.name, carId: targetPlayer.carId as CarId, slot: 1 },
        state: 'countdown',
        startTime: Date.now() + 3500,
        checkpoints: new Map(),
        finishTimes: new Map(),
      };

      this.activeDuels.set(duelId, activeDuel);
      this.playerToDuel.set(fromSessionId, duelId);
      this.playerToDuel.set(client.sessionId, duelId);

      const startMsg: DuelStartMsg = {
        duelId,
        trackId: invite.trackId,
        players: [activeDuel.player1, activeDuel.player2],
        startSlots: [slot0, slot1],
        countdownMs: 3500,
        startTime: activeDuel.startTime,
      };

      inviterClient.send(DUEL_START_MESSAGE, startMsg);
      client.send(DUEL_START_MESSAGE, startMsg);
    });

    this.onLimitedMessage(DUEL_PROGRESS_MESSAGE, 'control', (client, message) => {
      if (typeof message !== 'object' || message === null) return;
      const duelId = this.playerToDuel.get(client.sessionId);
      if (!duelId) return;
      const duel = this.activeDuels.get(duelId);
      if (!duel) return;

      const checkpointIndex = Number((message as { checkpointIndex?: unknown }).checkpointIndex ?? 0);
      const timeMs = Number((message as { timeMs?: unknown }).timeMs ?? 0);
      duel.checkpoints.set(client.sessionId, checkpointIndex);

      const opponentId = duel.player1.sessionId === client.sessionId ? duel.player2.sessionId : duel.player1.sessionId;
      const opponentClient = this.clientBySessionId(opponentId);
      const track = duelTrackById(duel.trackId);
      const totalCheckpoints = (track?.checkpoints.length ?? 0) + 1;

      opponentClient?.send(DUEL_PROGRESS_MESSAGE, {
        duelId,
        sessionId: client.sessionId,
        checkpointIndex,
        totalCheckpoints,
        timeMs,
      });
    });

    this.onLimitedMessage(DUEL_FINISH_MESSAGE, 'control', (client, message) => {
      if (typeof message !== 'object' || message === null) return;
      const duelId = this.playerToDuel.get(client.sessionId);
      if (!duelId) return;
      const duel = this.activeDuels.get(duelId);
      if (!duel || duel.finishTimes.has(client.sessionId)) return;

      const timeMs = Math.max(1, Number((message as { timeMs?: unknown }).timeMs ?? 0));
      duel.finishTimes.set(client.sessionId, timeMs);

      if (duel.finishTimes.size === 1) {
        // Allow up to 25s for the second player to finish
        setTimeout(() => {
          if (this.activeDuels.has(duelId)) {
            this.concludeDuel(duelId);
          }
        }, 25000);
      }

      if (duel.finishTimes.size >= 2) {
        this.concludeDuel(duelId);
      }
    });
  }

  private clientBySessionId(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private concludeDuel(duelId: string, reason?: string): void {
    const duel = this.activeDuels.get(duelId);
    if (!duel) return;
    this.activeDuels.delete(duelId);
    this.playerToDuel.delete(duel.player1.sessionId);
    this.playerToDuel.delete(duel.player2.sessionId);

    const t1 = duel.finishTimes.get(duel.player1.sessionId);
    const t2 = duel.finishTimes.get(duel.player2.sessionId);

    let winnerId = duel.player1.sessionId;
    let results: DuelParticipantResult[];

    if (t1 !== undefined && t2 !== undefined) {
      if (t1 <= t2) {
        winnerId = duel.player1.sessionId;
        results = [
          { sessionId: duel.player1.sessionId, name: duel.player1.name, timeMs: t1, rank: 1 },
          { sessionId: duel.player2.sessionId, name: duel.player2.name, timeMs: t2, rank: 2 },
        ];
      } else {
        winnerId = duel.player2.sessionId;
        results = [
          { sessionId: duel.player2.sessionId, name: duel.player2.name, timeMs: t2, rank: 1 },
          { sessionId: duel.player1.sessionId, name: duel.player1.name, timeMs: t1, rank: 2 },
        ];
      }
    } else if (t1 !== undefined) {
      winnerId = duel.player1.sessionId;
      results = [
        { sessionId: duel.player1.sessionId, name: duel.player1.name, timeMs: t1, rank: 1 },
        { sessionId: duel.player2.sessionId, name: duel.player2.name, timeMs: 0, rank: 2, dnf: true },
      ];
    } else if (t2 !== undefined) {
      winnerId = duel.player2.sessionId;
      results = [
        { sessionId: duel.player2.sessionId, name: duel.player2.name, timeMs: t2, rank: 1 },
        { sessionId: duel.player1.sessionId, name: duel.player1.name, timeMs: 0, rank: 2, dnf: true },
      ];
    } else {
      return;
    }

    const resultMsg: DuelResultMsg = {
      duelId,
      winnerSessionId: winnerId,
      results,
      reason,
    };

    const c1 = this.clientBySessionId(duel.player1.sessionId);
    const c2 = this.clientBySessionId(duel.player2.sessionId);
    c1?.send(DUEL_RESULT_MESSAGE, resultMsg);
    c2?.send(DUEL_RESULT_MESSAGE, resultMsg);
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
    // A broken world throws on every call; its cars are freed with the whole world in onDispose.
    if (!this.broken) this.sim?.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);

    // Cancel pending invites
    for (const [key, invite] of this.pendingInvites) {
      if (invite.fromSessionId === client.sessionId || invite.toSessionId === client.sessionId) {
        this.pendingInvites.delete(key);
        const otherId = invite.fromSessionId === client.sessionId ? invite.toSessionId : invite.fromSessionId;
        this.clientBySessionId(otherId)?.send(DUEL_CANCEL_MESSAGE, {});
      }
    }

    // Forfeit active duel
    const duelId = this.playerToDuel.get(client.sessionId);
    if (duelId) {
      const duel = this.activeDuels.get(duelId);
      if (duel) {
        const opponentId = duel.player1.sessionId === client.sessionId ? duel.player2.sessionId : duel.player1.sessionId;
        const opponentName = duel.player1.sessionId === client.sessionId ? duel.player2.name : duel.player1.name;
        this.activeDuels.delete(duelId);
        this.playerToDuel.delete(duel.player1.sessionId);
        this.playerToDuel.delete(duel.player2.sessionId);

        const opponentClient = this.clientBySessionId(opponentId);
        opponentClient?.send(DUEL_RESULT_MESSAGE, {
          duelId,
          winnerSessionId: opponentId,
          results: [
            { sessionId: opponentId, name: opponentName, timeMs: 0, rank: 1 },
            { sessionId: client.sessionId, name: this.state.players.get(client.sessionId)?.name ?? 'Соперник', timeMs: 0, rank: 2, dnf: true },
          ],
          reason: 'Соперник покинул игру. Техническая победа!',
        });
      }
    }
  }

  onDispose() {
    this.releaseRoomSlot();
    if (this.sim?.dispose() === false) {
      console.warn(`[arena ${this.roomId}] could not free the physics world, its memory stays taken`);
    }
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
      this.closeBrokenRoom('cannot encode the patch', error);
      return false;
    }
  }

  protected sendFullState(client: Client): void {
    try {
      super.sendFullState(client);
    } catch (error) {
      this.closeBrokenRoom('cannot encode the full state', error);
    }
  }

  // Patches and ticks keep running until the clients are gone, so only the first failure is logged.
  private closeBrokenRoom(reason: string, error: unknown): void {
    if (this.broken) return;
    this.broken = true;
    console.error(`[arena ${this.roomId}] ${reason}, closing the room:`, error instanceof Error ? error.stack : String(error));
    this.setPatchRate(null);
    this.setSimulationInterval();
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
    const guard: ClientGuard = {
      limiter: new MessageRateLimiter(MESSAGE_RATE_LIMIT, nowMs), poseAcceptedAtMs: nowMs, rejectingPoses: false, kicked: false, droppedInput: null,
    };
    this.guards.set(client.sessionId, guard);
    return guard;
  }

  private onLimitedMessage(
    type: string,
    kind: MessageKind,
    handler: (client: Client, message: unknown) => void,
    onDrop?: (client: Client, message: unknown) => void,
  ): void {
    this.onMessage(type, (client: Client, message: unknown) => {
      const guard = this.guardOf(client);
      if (guard.kicked) return;
      const decision = guard.limiter.take(kind, performance.now());
      if (decision === 'accept') {
        handler(client, message);
      } else if (decision === 'drop') {
        onDrop?.(client, message);
      } else {
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
    const elapsedSeconds = (nowMs - guard.poseAcceptedAtMs) / 1000;
    let trusted = trustedPose({
      pose,
      serverPosition,
      secondsSinceAccepted: elapsedSeconds,
      topSpeed: vehicleConfigFor(carId).drivetrain.topSpeed,
    });
    // If a client has been desynced for more than 1.5 seconds, force resync so they are never permanently stuck
    if (trusted === null && elapsedSeconds > 1.5) {
      const speedCap = vehicleConfigFor(carId).drivetrain.topSpeed * 1.25;
      const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
      const scale = speed <= speedCap ? 1 : speedCap / speed;
      trusted = { ...pose, vx: pose.vx * scale, vy: pose.vy * scale, vz: pose.vz * scale };
    }
    if (trusted === null) {
      if (!guard.rejectingPoses) console.warn(`[arena ${this.roomId}] ${client.sessionId} sent a pose too far from its car, ignoring it`);
      guard.rejectingPoses = true;
      return;
    }
    guard.rejectingPoses = false;
    guard.poseAcceptedAtMs = nowMs;
    sim.applyClientPose(client.sessionId, trusted);
  }

  // A throw here (a Rapier WASM panic) would repeat on every tick with the world frozen, so the room closes.
  private tick() {
    try {
      this.stepWorld();
    } catch (error) {
      this.closeBrokenRoom('the tick failed', error);
    }
  }

  private stepWorld() {
    const sim = this.readySim();
    for (const [sessionId, guard] of this.guards) {
      if (guard.droppedInput === null) continue;
      sim.setInput(sessionId, guard.droppedInput);
      guard.droppedInput = null;
    }
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
