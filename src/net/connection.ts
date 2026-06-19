// src/net/connection.ts
import { Client, Room } from 'colyseus.js';
import type { InputMsg } from '../../shared/protocol';

export interface NetPlayer {
  name: string;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface Connection {
  sessionId: string;
  seed: number;
  sendInput(i: InputMsg): void;
  onAdd(cb: (id: string, p: NetPlayer) => void): void;
  onRemove(cb: (id: string) => void): void;
  players(): Map<string, NetPlayer>;
}

export async function connectToArena(url: string, name: string): Promise<Connection> {
  const client = new Client(url);
  const room: Room = await client.joinOrCreate('arena', { name });

  const players = new Map<string, NetPlayer>();
  const addCbs: ((id: string, p: NetPlayer) => void)[] = [];
  const removeCbs: ((id: string) => void)[] = [];

  room.state.players.onAdd((p: NetPlayer, id: string) => {
    players.set(id, p);
    for (const cb of addCbs) cb(id, p);
  });
  room.state.players.onRemove((_p: NetPlayer, id: string) => {
    players.delete(id);
    for (const cb of removeCbs) cb(id);
  });

  return {
    sessionId: room.sessionId,
    seed: room.state.seed,
    sendInput: (i: InputMsg) => room.send('input', i),
    onAdd: (cb) => addCbs.push(cb),
    onRemove: (cb) => removeCbs.push(cb),
    players: () => players,
  };
}
