/**
 * MVP 5.4: a finished session really lands in `session_results`, and browsers can read but never
 * write it. Needs supabase/migrations/0003 applied first.
 *   npm run test:history -w @fgn/server
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

// Real saving (no overrides), short timings.
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, roundMs: 300, resultsMs: 200 });
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
async function playRound(players: Player[], winner: Player) {
  await Promise.all(players.map(ready));
  await until(players[0], (s) => s.phase === 'playing');
  for (let i = 0; i < 3; i++) { winner.socket.emit('game:action', { type: 'tap' }); await sleep(60); }
  await until(players[0], (s) => s.phase !== 'playing' && s.phase !== 'results', 3000);
}

const email = `history-${Date.now()}@example.com`;
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
  await new Promise((r) => account.socket.emit('room:settings', { gameId: 'tap-race' }, r));

  // 3 rounds: the account wins them all, then the session is saved.
  for (let i = 0; i < 3; i++) await playRound([account, guest], account);
  check('the room reaches session-over', await until(account, (s) => s.phase === 'session-over'));
  await sleep(600); // saving is fire-and-forget: give the inserts a moment

  const { data: rows } = await admin.from('session_results').select('*').eq('room_code', code);
  check('exactly one session row is saved, with the account winner\'s profile id',
    rows?.length === 1 && rows[0].winner_profile_id === userId && rows[0].winner_name === 'Ada' && rows[0].is_guest === false);
  check('it records wins, session length and tie-breakers',
    rows?.[0].winner_wins === 3 && rows[0].total_rounds === 3 && rows[0].tiebreaker_rounds === 0 && Boolean(rows[0].finished_at));
  const { data: roundRows } = await admin.from('game_results').select('is_tiebreaker').eq('room_code', code);
  check('the 3 rounds were saved too, none flagged as tie-breakers', roundRows?.length === 3 && roundRows.every((r) => r.is_tiebreaker === false));

  // The CHECK constraint keeps total_rounds odd, matching the "no even sessions" rule.
  const even = await admin.from('session_results').insert({ room_code: 'EVEN', winner_name: 'x', is_guest: true, winner_wins: 1, total_rounds: 4 });
  check('the database itself rejects an even session length', even.error !== null);

  // ---- who may read / write ----
  const anon = createClient(url, pub, opts);
  const { data: publicRows } = await anon.from('session_results').select('winner_name').eq('room_code', code);
  check('logged-out visitors can read the history', publicRows?.length === 1);
  const forgedAnon = await anon.from('session_results').insert({ room_code: 'FAKE', winner_name: 'Cheater', is_guest: true, winner_wins: 1, total_rounds: 3 });
  check('logged-out visitors cannot insert history', forgedAnon.error !== null);
  const forgedUser = await browser.from('session_results').insert({ room_code: 'FAKE', winner_name: 'Cheater', is_guest: false, winner_profile_id: userId, winner_wins: 1, total_rounds: 3 });
  check('a signed-in user cannot insert history for themselves', forgedUser.error !== null);
  const edited = await browser.from('session_results').update({ winner_name: 'Hacked' }).eq('room_code', code).select();
  const removed = await browser.from('session_results').delete().eq('room_code', code).select();
  const { data: still } = await admin.from('session_results').select('winner_name').eq('room_code', code);
  check('a signed-in user cannot edit or delete history', edited.data?.length === 0 && removed.data?.length === 0 && still?.length === 1 && still[0].winner_name === 'Ada');
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
  if (code) {
    await admin.from('session_results').delete().eq('room_code', code);
    await admin.from('game_results').delete().eq('room_code', code);
  }
  await admin.auth.admin.deleteUser(userId);
}
console.log(failures === 0 ? '\nAll history checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
