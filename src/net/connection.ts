// src/net/connection.ts
import { Client, Room } from 'colyseus.js';
import {
  PING_MESSAGE, PONG_MESSAGE, POSE_MESSAGE, RESET_CAR_MESSAGE,
  SET_NAME_MESSAGE, DUEL_INVITE_MESSAGE, DUEL_INVITE_RECEIVED_MESSAGE, DUEL_ACCEPT_MESSAGE,
  DUEL_DECLINE_MESSAGE, DUEL_CANCEL_MESSAGE, DUEL_START_MESSAGE, DUEL_PROGRESS_MESSAGE,
  DUEL_FINISH_MESSAGE, DUEL_RESULT_MESSAGE,
  type InputMsg, type JoinOptions, type PoseMsg, type SelectCarMsg,
  type DuelStartMsg, type DuelResultMsg, type DuelProgressMsg, type DuelInviteReceivedMsg, type DuelDeclineMsg,
} from '../../shared/protocol';
import type { CarId } from '../vehicle/cars';

export interface NetPlayer {
  name: string;
  /** Raw from the server; read it through sanitizeCarId. */
  carId: string;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  /** This player's place in the spawn grid; −1 until the server has given one. */
  spawnSlot: number;
  steer?: number;
}

export interface Connection {
  sessionId: string;
  seed: number;
  sendInput(i: InputMsg): void;
  /** Tell the server the player pressed R, so its copy of the car stands up too. */
  sendResetCar(): void;
  /** Where this player's car really is, so the server can correct the copy other players see. */
  sendPose(pose: PoseMsg): void;
  /** Swap this player's car on the server, so other players see the new model. */
  selectCar(carId: CarId): void;
  setName(name: string): void;

  sendDuelInvite(toSessionId: string, trackId: string): void;
  sendDuelAccept(fromSessionId: string, trackId: string): void;
  sendDuelDecline(fromSessionId: string): void;
  sendDuelCancel(): void;
  sendDuelCheckpoint(duelId: string, checkpointIndex: number, timeMs: number): void;
  sendDuelFinish(duelId: string, timeMs: number): void;

  onDuelInvite(cb: (msg: DuelInviteReceivedMsg) => void): void;
  onDuelDecline(cb: (msg: DuelDeclineMsg) => void): void;
  onDuelCancel(cb: () => void): void;
  onDuelStart(cb: (msg: DuelStartMsg) => void): void;
  onDuelProgress(cb: (msg: DuelProgressMsg) => void): void;
  onDuelResult(cb: (msg: DuelResultMsg) => void): void;

  onAdd(cb: (id: string, p: NetPlayer) => void): void;
  onRemove(cb: (id: string) => void): void;
  /** Fired whenever a state patch arrives from the server. */
  onPatch(cb: () => void): void;
  /** Fired whenever ping (RTT) is updated. */
  onPing(cb: (pingMs: number) => void): void;
  /** Current smoothed round-trip ping in milliseconds, or null before first reply. */
  ping(): number | null;
  /** The room is gone. The game has no leave action, so this means the server closed or restarted. */
  onDropped(cb: () => void): void;
  players(): Map<string, NetPlayer>;
}

export async function connectToArena(url: string, name: string, carId: CarId): Promise<Connection> {
  const client = new Client(url);
  const joinOptions: JoinOptions = { name, carId };
  const room: Room = await client.joinOrCreate('arena', joinOptions);

  const players = new Map<string, NetPlayer>();
  const addCbs: ((id: string, p: NetPlayer) => void)[] = [];
  const removeCbs: ((id: string) => void)[] = [];
  const patchCbs: (() => void)[] = [];
  const pingCbs: ((pingMs: number) => void)[] = [];
  const droppedCbs: (() => void)[] = [];
  let currentPing: number | null = null;

  // A send on a closed socket only logs a browser error; the page reloads once the server is back.
  let dropped = false;
  const sendWhileOpen = (send: () => void): void => {
    if (!dropped) send();
  };

  room.onMessage(PONG_MESSAGE, (sentTime: number) => {
    if (typeof sentTime === 'number' && Number.isFinite(sentTime)) {
      const rtt = Math.max(0, performance.now() - sentTime);
      currentPing = currentPing === null ? Math.round(rtt) : Math.round(currentPing * 0.7 + rtt * 0.3);
      for (const cb of pingCbs) cb(currentPing);
    }
  });

  const sendPing = () => {
    sendWhileOpen(() => room.send(PING_MESSAGE, performance.now()));
  };
  const pingInterval = setInterval(sendPing, 1000);
  sendPing();

  room.onLeave(() => {
    clearInterval(pingInterval);
    dropped = true;
    for (const cb of droppedCbs) cb();
  });

  room.state.players.onAdd((p: NetPlayer, id: string) => {
    players.set(id, p);
    for (const cb of addCbs) cb(id, p);
  });
  room.state.players.onRemove((_p: NetPlayer, id: string) => {
    players.delete(id);
    for (const cb of removeCbs) cb(id);
  });
  const duelInviteCbs: ((msg: DuelInviteReceivedMsg) => void)[] = [];
  const duelDeclineCbs: ((msg: DuelDeclineMsg) => void)[] = [];
  const duelCancelCbs: (() => void)[] = [];
  const duelStartCbs: ((msg: DuelStartMsg) => void)[] = [];
  const duelProgressCbs: ((msg: DuelProgressMsg) => void)[] = [];
  const duelResultCbs: ((msg: DuelResultMsg) => void)[] = [];

  room.onMessage(DUEL_INVITE_RECEIVED_MESSAGE, (msg: DuelInviteReceivedMsg) => {
    for (const cb of duelInviteCbs) cb(msg);
  });
  room.onMessage(DUEL_DECLINE_MESSAGE, (msg: DuelDeclineMsg) => {
    for (const cb of duelDeclineCbs) cb(msg);
  });
  room.onMessage(DUEL_CANCEL_MESSAGE, () => {
    for (const cb of duelCancelCbs) cb();
  });
  room.onMessage(DUEL_START_MESSAGE, (msg: DuelStartMsg) => {
    for (const cb of duelStartCbs) cb(msg);
  });
  room.onMessage(DUEL_PROGRESS_MESSAGE, (msg: DuelProgressMsg) => {
    for (const cb of duelProgressCbs) cb(msg);
  });
  room.onMessage(DUEL_RESULT_MESSAGE, (msg: DuelResultMsg) => {
    for (const cb of duelResultCbs) cb(msg);
  });

  room.onStateChange(() => {
    for (const cb of patchCbs) cb();
  });

  // The arena seed arrives with the first state sync (not synchronously at join time).
  // Wait for it so the client generates terrain visuals from the same seed the server uses.
  if (!room.state.seed) {
    await new Promise<void>((resolve) => {
      const check = () => { if (room.state.seed) resolve(); };
      room.onStateChange(check);
      check();
    });
  }

  return {
    sessionId: room.sessionId,
    seed: room.state.seed,
    sendInput: (i: InputMsg) => sendWhileOpen(() => room.send('input', i)),
    sendResetCar: () => sendWhileOpen(() => room.send(RESET_CAR_MESSAGE)),
    sendPose: (pose: PoseMsg) => sendWhileOpen(() => room.send(POSE_MESSAGE, pose)),
    selectCar: (selectedCarId: CarId) => {
      const message: SelectCarMsg = { carId: selectedCarId };
      sendWhileOpen(() => room.send('selectCar', message));
    },
    setName: (newName: string) => sendWhileOpen(() => room.send(SET_NAME_MESSAGE, { name: newName })),
    sendDuelInvite: (toSessionId: string, trackId: string) =>
      sendWhileOpen(() => room.send(DUEL_INVITE_MESSAGE, { toSessionId, trackId })),
    sendDuelAccept: (fromSessionId: string, trackId: string) =>
      sendWhileOpen(() => room.send(DUEL_ACCEPT_MESSAGE, { fromSessionId, trackId })),
    sendDuelDecline: (fromSessionId: string) =>
      sendWhileOpen(() => room.send(DUEL_DECLINE_MESSAGE, { fromSessionId })),
    sendDuelCancel: () =>
      sendWhileOpen(() => room.send(DUEL_CANCEL_MESSAGE, {})),
    sendDuelCheckpoint: (duelId: string, checkpointIndex: number, timeMs: number) =>
      sendWhileOpen(() => room.send(DUEL_PROGRESS_MESSAGE, { duelId, checkpointIndex, timeMs })),
    sendDuelFinish: (duelId: string, timeMs: number) =>
      sendWhileOpen(() => room.send(DUEL_FINISH_MESSAGE, { duelId, timeMs })),

    onDuelInvite: (cb) => duelInviteCbs.push(cb),
    onDuelDecline: (cb) => duelDeclineCbs.push(cb),
    onDuelCancel: (cb) => duelCancelCbs.push(cb),
    onDuelStart: (cb) => duelStartCbs.push(cb),
    onDuelProgress: (cb) => duelProgressCbs.push(cb),
    onDuelResult: (cb) => duelResultCbs.push(cb),

    onAdd: (cb) => addCbs.push(cb),
    onRemove: (cb) => removeCbs.push(cb),
    onPatch: (cb) => patchCbs.push(cb),
    onPing: (cb) => pingCbs.push(cb),
    ping: () => currentPing,
    onDropped: (cb) => {
      droppedCbs.push(cb);
      if (dropped) cb();
    },
    players: () => players,
  };
}
