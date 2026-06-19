// server/index.ts
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import { SERVER_PORT } from '../shared/protocol';
import { ArenaRoom } from './ArenaRoom';

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});
gameServer.define('arena', ArenaRoom);
gameServer.listen(SERVER_PORT);
console.log(`DUNE RALLY server listening on ${SERVER_PORT}`);
