import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from '@fgn/shared';
import { isAllowedOrigin, parseOrigins } from './origins';
import { saveRound, saveSession } from './results';
import { RoomManager, type RoundRecord, type SessionRecord } from './rooms';
import { registerSockets, type GameServer } from './sockets';
import { checkSupabase } from './supabase';

/** Builds the HTTP + WebSocket server without starting it, so tests can run it on any port. */
/** Durations can be shortened in tests; `onRound`/`onSession` replace database saving (tests spy on them). */
export function createGameServer(clientOrigins: string, options: {
    countdownMs?: number; roundMs?: number; snowballMs?: number; finishMs?: number; resultsMs?: number;
    onRound?: (round: RoundRecord) => void; onSession?: (session: SessionRecord) => void;
  } = {}) {
  const app = express();
  // CORS: the browser blocks cross-origin calls unless the server explicitly allows the web page's origin.
  // Pages on the local network are always allowed (so phones on your Wi-Fi work); deployed sites come from CLIENT_ORIGIN.
  // DEPLOY CHECKLIST (things to revisit before putting this server on the internet):
  //  - set CLIENT_ORIGIN to your real site, and consider turning the local-network allowance off (see origins.ts);
  //  - CORS does NOT cover WebSockets: the Socket.io server below never checks the page's origin (anyone can connect
  //    as a guest, which is low impact because auth is a token, not a cookie). Add `allowRequest` if you want it enforced;
  //  - /health/supabase is public and makes a Supabase admin call on every hit: remove it, protect it or rate limit it;
  //  - there are no rate limits on connections or room creation, and rooms live in memory (easy to flood).
  const extraOrigins = parseOrigins(clientOrigins);
  const originCheck = (origin: string | undefined, done: (err: Error | null, allow?: boolean) => void) =>
    done(null, isAllowedOrigin(origin, extraOrigins));
  app.use(cors({ origin: originCheck }));

  app.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', time: new Date().toISOString() };
    res.json(body);
  });

  // DEPLOY: public, and each call hits the Supabase ADMIN API with the secret key (only ok/unreachable is returned, but it
  // can be hammered). Fine for local testing; remove, protect or rate limit it before going online.
  app.get('/health/supabase', async (_req, res) => {
    const ok = await checkSupabase();
    res.status(ok ? 200 : 503).json({ supabase: ok ? 'ok' : 'unreachable' });
  });

  // Socket.io shares the same HTTP server as Express (one port for REST + WebSockets).
  // DEPLOY: its `cors` option only affects the polling transport; WebSocket connections are NOT origin-checked (see checklist above).
  const httpServer = createServer(app);
  const io: GameServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: originCheck },
  });
  const stopLoop = registerSockets(io, new RoomManager(options), {
    onRound: options.onRound ?? saveRound,
    onSession: options.onSession ?? saveSession,
  });
  httpServer.on('close', stopLoop);
  return httpServer;
}
