// server/state.ts
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  x = 0; y = 0; z = 0;
  qx = 0; qy = 0; qz = 0; qw = 1;
  name = '';
}
defineTypes(PlayerState, {
  x: 'number', y: 'number', z: 'number',
  qx: 'number', qy: 'number', qz: 'number', qw: 'number',
  name: 'string',
});

export class ArenaState extends Schema {
  seed = 0;
  players = new MapSchema<PlayerState>();
}
defineTypes(ArenaState, {
  seed: 'number',
  players: { map: PlayerState },
});
