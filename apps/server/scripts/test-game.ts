/**
 * MVP 4: Tap Race end to end with real socket clients (guests, in-process server, no database):
 *   npm run test:game -w @fgn/server
 * Rounds are shortened (150 ms countdown, 600 ms round). A spy stands in for database saving;
 * the real saving is checked by test-results.ts.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

const COUNTDOWN_MS = 150;
const ROUND_MS = 600;
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = []; // what the server asked to persist
const httpServer = createGameServer('http://localhost:5173', {
  countdownMs: COUNTDOWN_MS, roundMs: ROUND_MS, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {},
});
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null };
  socket.on('room:state', (s) => (p.latest = s));
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const command = <T,>(emit: (r: (a: Ack<null>) => void) => T) => new Promise<Ack<null>>((r) => emit(r));
const ready = (p: Player, v = true) => command((r) => p.socket.emit('player:ready', v, r));
const backToLobby = (p: Player) => command((r) => p.socket.emit('room:return-to-lobby', r));
const tap = (p: Player) => p.socket.emit('game:action', { type: 'tap' });
/** Sends n taps spaced out enough (50 ms) to pass the server's tap-rate limit. */
async function tapMany(p: Player, n: number) { for (let i = 0; i < n; i++) { tap(p); await sleep(50); } }

async function until(p: Player, cond: (s: RoomState) => boolean, ms = 3000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}

/** A room of n guests, tap-race selected, everyone readied. Resolves once the round is running. */
async function startRound(n: number) {
  const players = await Promise.all(Array.from({ length: n }, (_, i) => guest(i === 0 ? 'Host' : `P${i}`)));
  const made = await create(players[0]);
  const code = made.ok ? made.data.room.code : '';
  for (const p of players.slice(1)) await join(p, code);
  await new Promise((r) => players[0].socket.emit('room:settings', { gameId: 'tap-race' }, r));
  await Promise.all(players.map((p) => ready(p)));
  const running = await until(players[0], (s) => s.phase === 'playing');
  return { players, code, running };
}
/** From the results screen, ready everyone up again and wait for the next round to start. */
async function nextRound(players: Player[]) {
  await backToLobby(players[0]);
  await Promise.all(players.map((p) => ready(p)));
  return until(players[0], (s) => s.phase === 'playing');
}

try {
  // ---- round 1: a clear winner ----
  const R = await startRound(3);
  const [host, p1, p2] = R.players;
  check('round starts after the countdown with a game view', R.running && host.latest?.game?.gameId === 'tap-race');
  const view = host.latest!.game!;
  check('round window matches the configured duration', view.endsAt - view.startsAt === ROUND_MS);
  check('every player starts at 0 taps', Object.values(view.taps).every((n) => n === 0) && Object.keys(view.taps).length === 3);

  // A burst of 20 taps with no pause: the server's rate limit should let only ~1 through.
  for (let i = 0; i < 20; i++) tap(host);
  await sleep(250);
  check('rapid-fire taps are rate limited by the server', (host.latest!.game?.taps[host.id] ?? 99) <= 2);

  // Record the highest tap count p2 SEES for p1 while the round is still running.
  let seenMid = 0;
  p2.socket.on('room:state', (s) => { if (s.phase === 'playing') seenMid = Math.max(seenMid, s.game?.taps[p1.id] ?? 0); });
  await Promise.all([tapMany(p1, 6), tapMany(p2, 3)]);
  check('live tap counts reach other players mid-round (batched broadcast)', seenMid >= 3);

  check('round ends on the server clock and everyone sees results', await until(host, (s) => s.phase === 'results', ROUND_MS + 1000) && await until(p2, (s) => s.phase === 'results'));
  const r1 = host.latest!;
  check('the player with most taps wins', r1.result?.winnerId === p1.id);
  check('results include each player\'s taps, counted by the server', r1.result?.scores[p1.id] === 6 && r1.result.scores[p2.id] === 3);
  check('winner gets +1 on the session scoreboard', r1.scores[p1.id] === 1 && !(p2.id in r1.scores));
  check('the decided round is handed off for saving', saved.length === 1 && saved[0].winner.id === p1.id && saved[0].winner.isGuest && saved[0].gameType === 'tap-race');

  tap(p2);
  await sleep(100);
  check('taps after the round ended change nothing', host.latest!.result?.scores[p2.id] === 3 && host.latest!.phase === 'results');
  check('cannot ready up while results are showing', (await ready(p2)).ok === false);

  // ---- round 2: a tie is a draw ----
  check('host can return everyone to the lobby; session scores are kept', (await backToLobby(host)).ok && await until(p1, (s) => s.phase === 'lobby' && s.scores[p1.id] === 1));
  await Promise.all(R.players.map((p) => ready(p)));
  await until(host, (s) => s.phase === 'playing');
  tap(p1); await sleep(60); tap(p2); // 1 tap each, host none: tied for most
  await until(host, (s) => s.phase === 'results', ROUND_MS + 1000);
  check('a tie for most taps is a draw: no winner, no point', host.latest!.result?.winnerId === null && host.latest!.scores[p1.id] === 1 && Object.keys(host.latest!.scores).length === 1);
  check('a draw is not saved', saved.length === 1);

  // ---- round 3: nobody taps = draw; then p2 wins and scores accumulate ----
  check('another round starts', await nextRound(R.players));
  await until(host, (s) => s.phase === 'results', ROUND_MS + 1000);
  check('nobody tapping is a draw', host.latest!.result?.winnerId === null);
  await nextRound(R.players);
  await tapMany(p2, 4);
  await until(host, (s) => s.phase === 'results', ROUND_MS + 1000);
  check('session scores accumulate across rounds', host.latest!.scores[p1.id] === 1 && host.latest!.scores[p2.id] === 1 && saved.length === 2 && saved[1].winner.id === p2.id);

  // ---- leaving mid-round ----
  const L = await startRound(3);
  await tapMany(L.players[1], 2);
  L.players[2].socket.close(); // a spectator-ish player leaves; 2 remain, still enough
  await until(L.players[0], (s) => s.players.length === 2);
  check('with enough players left, the round carries on', L.players[0].latest!.phase === 'playing' && !(L.players[2].id in L.players[0].latest!.game!.taps));
  await until(L.players[0], (s) => s.phase === 'results', ROUND_MS + 1000);
  check('a leaver is excluded from the results', L.players[0].latest!.result?.winnerId === L.players[1].id && !(L.players[2].id in L.players[0].latest!.result!.scores));

  const before = saved.length;
  const M = await startRound(2);
  tap(M.players[1]);
  M.players[1].socket.close();
  check('below the minimum players, the round is called off', await until(M.players[0], (s) => s.phase === 'lobby' && s.game === null));
  await sleep(ROUND_MS + 250);
  check('...and nothing is decided or saved afterwards', M.players[0].latest!.phase === 'lobby' && saved.length === before);

  // ---- host aborts ----
  const H = await startRound(2);
  await backToLobby(H.players[0]);
  await sleep(ROUND_MS + 250);
  check('host ending a round early cancels it for good', H.players[1].latest!.phase === 'lobby' && saved.length === before);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll game checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
