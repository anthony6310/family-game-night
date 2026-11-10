import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from '@fgn/shared';
import { saveRound } from './results';
import { RoomManager, type RoundRecord } from './rooms';
import { registerSockets, type GameServer } from './sockets';
import { checkSupabase } from './supabase';

/** Builds the HTTP + WebSocket server without starting it, so tests can run it on any port. */
/** Durations can be shortened in tests; `onRound` replaces database saving (tests spy on it). */
export function createGameServer(clientOrigin: string, options: { countdownMs?: number; roundMs?: number; onRound?: (round: RoundRecord) => void } = {}) {
  const app = express();
  // CORS: the browser blocks cross-origin calls unless the server explicitly allows the web origin.
  app.use(cors({ origin: clientOrigin }));

  app.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', time: new Date().toISOString() };
    res.json(body);
  });

  app.get('/health/supabase', async (_req, res) => {
    const ok = await checkSupabase();
    res.status(ok ? 200 : 503).json({ supabase: ok ? 'ok' : 'unreachable' });
  });

  // Socket.io shares the same HTTP server as Express (one port for REST + WebSockets).
  const httpServer = createServer(app);
  const io: GameServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: clientOrigin },
  });
  registerSockets(io, new RoomManager(options), options.onRound ?? saveRound);
  return httpServer;
}
