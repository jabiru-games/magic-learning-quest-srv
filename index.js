import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';

// Duel server for Magic Learning Quest: one WebSocket per player, no storage.
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || undefined;
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 200;
const MAX_PER_ADDRESS = Number(process.env.MAX_PER_ADDRESS) || 8;
const MAX_MESSAGE_BYTES = 2048;
const MAX_MESSAGES_PER_10S = 60;

const lobby = new Lobby();
const perAddress = new Map();
const http = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, players: lobby.players.size }));
    return;
  }
  response.writeHead(404).end();
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

http.on('upgrade', (request, socket, head) => {
  const address =
    request.headers['x-forwarded-for']?.split(',')[0].trim() ?? request.socket.remoteAddress;
  const refuse = (status) => socket.end(`HTTP/1.1 ${status}\r\n\r\n`);
  if (new URL(request.url, 'http://localhost').pathname !== '/ws') return refuse('404 Not Found');
  if (ORIGINS.length && !ORIGINS.includes(request.headers.origin)) return refuse('403 Forbidden');
  if (lobby.players.size >= MAX_PLAYERS || (perAddress.get(address) ?? 0) >= MAX_PER_ADDRESS)
    return refuse('503 Service Unavailable');
  sockets.handleUpgrade(request, socket, head, (ws) => accept(ws, address));
});

function accept(ws, address) {
  perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
  const id = lobby.connect((message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  });
  let windowStart = Date.now(),
    count = 0;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 10000) [windowStart, count] = [now, 0];
    if (++count > MAX_MESSAGES_PER_10S) return ws.close(1008, 'rate');
    try {
      lobby.receive(id, JSON.parse(data.toString()));
    } catch {
      ws.close(1003, 'format');
    }
  });
  ws.on('close', () => {
    lobby.disconnect(id);
    const left = (perAddress.get(address) ?? 1) - 1;
    if (left > 0) perAddress.set(address, left);
    else perAddress.delete(address);
  });
  ws.on('error', () => ws.terminate());
}

// Drops connections that stopped answering, so a lost phone never blocks a duel.
setInterval(() => {
  for (const ws of sockets.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000).unref();

http.listen(PORT, HOST, () => console.log(`Duel server listening on ${HOST ?? ''}:${PORT}`));
