/**
 * MVP 5: the session loop, with real socket clients against an in-process server (guests only):
 *   npm run test:session -w @fgn/server
 * Short timings: 100 ms countdown, 300 ms rounds, 200 ms results (which advance BY THEMSELVES).
 * Spies stand in for database saving; test-history.ts checks the real thing.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord, SessionRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rounds: RoundRecord[] = [];
const sessions: SessionRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', {
  countdownMs: 100, roundMs: 300, resultsMs: 200,
  onRound: (r) => rounds.push(r), onSession: (s) => sessions.push(s),
});
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; closed: boolean; seenTapKeys: string[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, closed: false, seenTapKeys: [] };
  socket.on('room:state', (s) => {
    p.latest = s;
    if (s.phase === 'playing' && s.game?.gameId === 'tap-race') p.seenTapKeys = Object.keys(s.game.taps).sort();
  });
  socket.on('room:closed', () => (p.closed = true));
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const cmd = (emit: (r: (a: Ack<null>) => void) => void) => new Promise<Ack<null>>((r) => emit(r));
const settings = (p: Player, s: object) => cmd((r) => p.socket.emit('room:settings', s, r));
const ready = (p: Player) => cmd((r) => p.socket.emit('player:ready', true, r));
const reset = (p: Player) => cmd((r) => p.socket.emit('room:reset', r));
const close = (p: Player) => cmd((r) => p.socket.emit('room:close', r));
const errorOf = (a: Ack<unknown>) => (a.ok ? 'none' : a.error);
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 4000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}
async function tapMany(p: Player, n: number) { for (let i = 0; i < n; i++) { p.socket.emit('game:action', { type: 'tap' }); await sleep(50); } }

async function makeRoom(n: number, totalRounds?: number) {
  const players = await Promise.all(Array.from({ length: n }, (_, i) => guest(['A', 'B', 'C', 'D'][i])));
  const made = await create(players[0]);
  const code = made.ok ? made.data.room.code : '';
  for (const p of players.slice(1)) await join(p, code);
  await settings(players[0], { gameId: 'tap-race', ...(totalRounds ? { totalRounds } : {}) });
  return { players, host: players[0], code };
}
/**
 * Plays one round: `readyUp` players ready, `winner` taps (null = nobody taps = a draw), then we wait
 * for the room to move on BY ITSELF (no host action) out of the results screen.
 */
async function playRound(host: Player, readyUp: Player[], winner: Player | null, extraTapper?: Player) {
  await Promise.all(readyUp.map(ready));
  await until(host, (s) => s.phase === 'playing');
  if (extraTapper) await tapMany(extraTapper, 2); // a spectator tapping: must be ignored
  if (winner) await tapMany(winner, 3);
  await until(host, (s) => s.phase === 'results', 2000);
  await until(host, (s) => s.phase !== 'results', 2000);
}

try {
  // ================= S1: a whole 3-round session between 2 players =================
  const S1 = await makeRoom(2);
  const [a, b] = S1.players;
  check('a fresh session starts at 0 rounds played', a.latest!.roundsPlayed === 0 && a.latest!.contenders === null);

  await playRound(a, S1.players, a);
  check('results move on by themselves: back to the lobby for the next round',
    a.latest!.phase === 'lobby' && a.latest!.roundsPlayed === 1 && a.latest!.scores[a.id] === 1 && a.latest!.readyIds.length === 0);
  check('session length is locked after the first round', errorOf(await settings(a, { totalRounds: 5 })) === 'WRONG_PHASE');

  await playRound(a, S1.players, null); // nobody taps: a draw
  check('a draw does not count as a round: it is replayed', a.latest!.roundsPlayed === 1 && a.latest!.phase === 'lobby' && rounds.length === 1);

  await playRound(a, S1.players, a);
  check('round 2 counted', a.latest!.roundsPlayed === 2 && a.latest!.phase === 'lobby');
  await playRound(a, S1.players, a);
  check('after the final round the session is over', a.latest!.phase === 'session-over' && await until(b, (s) => s.phase === 'session-over'));
  check('the player with the most round wins is crowned', a.latest!.sessionWinner?.id === a.id && a.latest!.scores[a.id] === 3);
  check('the session is handed off for saving (3 rounds, no tie-breakers)',
    sessions.length === 1 && sessions[0].winner.id === a.id && sessions[0].winnerWins === 3 && sessions[0].totalRounds === 3 && sessions[0].tiebreakerRounds === 0);
  check('all 3 decided rounds were handed off, none flagged as tie-breakers', rounds.length === 3 && rounds.every((r) => !r.isTiebreaker));
  check('cannot ready up once the session is over', errorOf(await ready(b)) === 'WRONG_PHASE');
  check('only the host can reset the room', errorOf(await reset(b)) === 'NOT_HOST');
  check('host resets: scores wiped, settings kept', (await reset(a)).ok && await until(b, (s) =>
    s.phase === 'lobby' && Object.keys(s.scores).length === 0 && s.roundsPlayed === 0 && s.sessionWinner === null
    && s.settings.gameId === 'tap-race' && s.settings.totalRounds === 3));
  check('after a reset the session length can be changed again', (await settings(a, { totalRounds: 5 })).ok);

  // ================= S2: 4 players, 3-way tie -> tie-breaker with a spectator =================
  const S2 = await makeRoom(4);
  const [A, B, C, D] = S2.players;
  await playRound(A, S2.players, A);
  await playRound(A, S2.players, B);
  await playRound(A, S2.players, C);
  check('a tie after the last round starts a tie-breaker (not a winner)', A.latest!.phase === 'lobby' && A.latest!.sessionWinner === null && A.latest!.roundsPlayed === 3);
  check('only the tied players are contenders; the other player spectates',
    JSON.stringify([...A.latest!.contenders!].sort()) === JSON.stringify([A.id, B.id, C.id].sort()) && !A.latest!.contenders!.includes(D.id));

  // Only the 3 contenders ready up: the spectator does NOT have to.
  const roundsBefore = rounds.length;
  await playRound(A, [A, B, C], null, D); // tie-breaker ends in a draw (and the spectator taps, ignored)
  check('only contenders were in the round (the spectator is not in the game)', JSON.stringify(A.seenTapKeys) === JSON.stringify([A.id, B.id, C.id].sort()));
  check('a drawn tie-breaker is replayed: same contenders, nothing saved', A.latest!.phase === 'lobby' && A.latest!.contenders!.length === 3 && rounds.length === roundsBefore && A.latest!.roundsPlayed === 3);

  await playRound(A, [A, B, C], B);
  check('winning the tie-breaker crowns that player', A.latest!.phase === 'session-over' && A.latest!.sessionWinner?.id === B.id && A.latest!.scores[B.id] === 2);
  const last = rounds[rounds.length - 1];
  check('the tie-breaker round is saved and flagged', last.isTiebreaker && last.winner.id === B.id);
  const s2 = sessions[sessions.length - 1];
  check('the session record notes the tie-breaker', s2.winner.id === B.id && s2.tiebreakerRounds === 1 && s2.winnerWins === 2 && s2.totalRounds === 3);

  // ================= S3: a two-way tie settled because one contender leaves =================
  const S3 = await makeRoom(3, 5);
  const [X, Y, Z] = S3.players;
  await playRound(X, S3.players, X);
  await playRound(X, S3.players, X);
  await playRound(X, S3.players, Y);
  await playRound(X, S3.players, Y);
  await playRound(X, S3.players, Z);
  check('5 rounds ending 2-2-1 makes X and Y the contenders', X.latest!.phase === 'lobby' && X.latest!.contenders?.length === 2 && !X.latest!.contenders.includes(Z.id));
  const sessionsBefore = sessions.length;
  Y.socket.close(); // one contender walks away
  check('the remaining contender is crowned immediately', await until(X, (s) => s.phase === 'session-over') && X.latest!.sessionWinner?.id === X.id);
  check('...and that session is saved', sessions.length === sessionsBefore + 1 && sessions[sessions.length - 1].winner.id === X.id);

  // ================= S4: close the room =================
  const S4 = await makeRoom(2);
  const [H, G] = S4.players;
  check('only the host can close the room', errorOf(await close(G)) === 'NOT_HOST');
  await Promise.all(S4.players.map(ready));
  await until(H, (s) => s.phase === 'playing');
  check('cannot close the room mid-round', errorOf(await close(H)) === 'WRONG_PHASE');
  await until(H, (s) => s.phase === 'lobby', 3000);
  check('host closes the room: everyone is told', (await close(H)).ok && await (async () => { await sleep(100); return H.closed && G.closed; })());
  check('the old code no longer works', errorOf(await join(await guest('Late'), S4.code)) === 'ROOM_NOT_FOUND');
  check('closed-room players are free to make or join new rooms', (await create(G)).ok && (await join(H, G.latest!.code)).ok);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll session checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
