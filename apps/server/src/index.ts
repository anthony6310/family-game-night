import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { HealthResponse } from '@fgn/shared';
import { checkSupabase } from './supabase';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const app = express();
// CORS: the browser blocks cross-origin calls unless the server explicitly allows the web origin.
app.use(cors({ origin: CLIENT_ORIGIN }));

app.get('/health', (_req, res) => {
  const body: HealthResponse = { status: 'ok', time: new Date().toISOString() };
  res.json(body);
});

app.get('/health/supabase', async (_req, res) => {
  const ok = await checkSupabase();
  res.status(ok ? 200 : 503).json({ supabase: ok ? 'ok' : 'unreachable' });
});

// Socket.io shares the same HTTP server as Express (one port for REST + WebSockets).
// No events yet; rooms arrive in MVP 2.
const httpServer = createServer(app);
new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });

httpServer.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
