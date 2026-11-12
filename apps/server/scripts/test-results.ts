/**
 * MVP 4.4: decided rounds really land in `game_results`, with the right guest/account fields,
 * and browsers can read but never write them. Needs supabase/migrations/0002 applied first.
 *   npm run test:results -w @fgn/server
 */
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: pub } = process.env;
if (!url || !secret || !pub) throw new Error('Missing Supabase env vars in apps/server/.env');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real saving (no onRound override), short rounds.
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 150, roundMs: 500, resultsMs: 60_000 });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null }
const sockets: Client[] = [];
async function connect(auth: object): Promise<Player> {
  const socket: Client = io(serverUrl, { auth, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null };
  socket.on('room:state', (s) => (p.latest = s));
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const until = async (p: Player, cond: (s: RoomState) => boolean, ms = 4000) => {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
};
const ready = (p: Player) => new Promise((r) => p.socket.emit('player:ready', true, r));
const lobby = (p: Player) => new Promise((r) => p.socket.emit('room:return-to-lobby', r));
async function playRound(players: Player[], winner: Player) {
  await Promise.all(players.map(ready));
  await until(players[0], (s) => s.phase === 'playing');
  for (let i = 0; i < 3; i++) { winner.socket.emit('game:action', { type: 'tap' }); await sleep(60); }
  await until(players[0], (s) => s.phase === 'results');
}

// A real account with a finished profile, plus a signed-in browser-style client for it.
const email = `results-${Date.now()}@example.com`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password: 'Test-pass-1234', email_confirm: true });
if (error) throw error;
const userId = created.user.id;
await admin.from('profiles').update({ display_name: 'Ada', avatar_url: '/avatars/fox.svg' }).eq('id', userId);
const browser = createClient(url, pub, opts);
const { data: session } = await browser.auth.signInWithPassword({ email, password: 'Test-pass-1234' });

let code = '';
try {
  const account = await connect({ token: session.session!.access_token });
  const guest = await connect({ guestName: 'Gus' });
  const made = await new Promise<Ack<JoinResult>>((r) => account.socket.emit('room:create', (res) => r(ack(account, res))));
  code = made.ok ? made.data.room.code : '';
  await new Promise((r) => guest.socket.emit('room:join', code, (res: Ack<JoinResult>) => r(ack(guest, res))));
  await new Promise((r) => account.socket.emit('session:start', 3, r));
  await new Promise((r) => account.socket.emit('room:settings', { gameId: 'tap-race' }, r));

  // Round 1: the ACCOUNT wins.
  await playRound([account, guest], account);
  await sleep(500); // saving is fire-and-forget: give the insert a moment
  let { data: rows } = await admin.from('game_results').select('*').eq('room_code', code);
  check('an account win is saved with its profile id and name', rows?.length === 1 && rows[0].winner_profile_id === userId
    && rows[0].winner_name === 'Ada' && rows[0].is_guest === false && rows[0].game_type === 'tap-race' && rows[0].is_tiebreaker === false);

  // Round 2: the GUEST wins.
  await lobby(account);
  await playRound([account, guest], guest);
  await sleep(500);
  ({ data: rows } = await admin.from('game_results').select('*').eq('room_code', code).order('played_at'));
  const last = rows?.[1];
  check('a guest win is saved by name only (no profile id)', rows?.length === 2 && last?.winner_profile_id === null
    && last.winner_name === 'Gus' && last.is_guest === true);

  // ---- who may read / write ----
  const anon = createClient(url, pub, opts);
  const { data: publicRows } = await anon.from('game_results').select('id').eq('room_code', code);
  check('logged-out visitors can read results (public history)', publicRows?.length === 2);

  const forgedAnon = await anon.from('game_results').insert({ room_code: 'FAKE', game_type: 'tap-race', winner_name: 'Cheater', is_guest: true });
  check('logged-out visitors cannot insert results', forgedAnon.error !== null);
  const forgedUser = await browser.from('game_results').insert({ room_code: 'FAKE', game_type: 'tap-race', winner_name: 'Cheater', is_guest: false, winner_profile_id: userId });
  check('a signed-in user cannot insert results for themselves', forgedUser.error !== null);
  const edited = await browser.from('game_results').update({ winner_name: 'Hacked' }).eq('room_code', code).select();
  const removed = await browser.from('game_results').delete().eq('room_code', code).select();
  const { data: still } = await admin.from('game_results').select('winner_name').eq('room_code', code);
  check('a signed-in user cannot edit or delete results', edited.data?.length === 0 && removed.data?.length === 0
    && still?.length === 2 && !still.some((r) => r.winner_name === 'Hacked'));
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
  if (code) await admin.from('game_results').delete().eq('room_code', code);
  await admin.auth.admin.deleteUser(userId);
}
console.log(failures === 0 ? '\nAll result checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
