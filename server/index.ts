// server/index.ts
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import { ArenaRoom } from './ArenaRoom';
import { readClientDistDir, readPort } from './config';
import { createRequestHandler } from './httpHandler';

const port = readPort(process.env);
const distDir = readClientDistDir(process.env);

const httpServer = createServer(createRequestHandler({
  distDir,
  stats: () => ({ rooms: matchMaker.stats.local.roomCount, clients: matchMaker.stats.local.ccu }),
}));

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define('arena', ArenaRoom);
await gameServer.listen(port);
console.log(`DUNE RALLY server listening on ${port}${distDir === null ? '' : `, serving the client from ${distDir}`}`);
