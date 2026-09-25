// src/net/connection.ts
import { Client, Room } from 'colyseus.js';
import { POSE_MESSAGE, RESET_CAR_MESSAGE, type InputMsg, type JoinOptions, type PoseMsg, type SelectCarMsg } from '../../shared/protocol';
import type { CarId } from '../vehicle/cars';

export interface NetPlayer {
  name: string;
  /** Raw from the server; read it through sanitizeCarId. */
  carId: string;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  /** This player's place in the spawn grid; −1 until the server has given one. */
  spawnSlot: number;
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
  onAdd(cb: (id: string, p: NetPlayer) => void): void;
  onRemove(cb: (id: string) => void): void;
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
  const droppedCbs: (() => void)[] = [];
  // A send on a closed socket only logs a browser error; the page reloads once the server is back.
  let dropped = false;
  const sendWhileOpen = (send: () => void): void => {
    if (!dropped) send();
  };
  room.onLeave(() => {
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
    onAdd: (cb) => addCbs.push(cb),
    onRemove: (cb) => removeCbs.push(cb),
    onDropped: (cb) => {
      droppedCbs.push(cb);
      if (dropped) cb();
    },
    players: () => players,
  };
}
