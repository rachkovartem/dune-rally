// server/index.ts
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import { SERVER_PORT } from '../shared/protocol';

// Note: import Server/Room from '@colyseus/core' (not the umbrella 'colyseus' package —
// its ESM build does not re-export these under tsx) and supply the WS transport explicitly.
const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

// ArenaRoom is registered in Task 6; kept minimal here so the server boots.
gameServer.listen(SERVER_PORT);
console.log(`DUNE RALLY server listening on ${SERVER_PORT}`);
