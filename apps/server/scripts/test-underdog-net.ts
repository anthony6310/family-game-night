/**
 * The underdog announcement and private bets, over real sockets:  npm run test:underdog-net -w @fgn/server
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { PLAYER_COLORS, UNDERDOG_SECONDS, type Ack, type ClientToServerEvents, type JoinResult, type RoomState, type ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpServer = createGameServer('http://localhost:5173', { countdownMs: 80, roundMs: 400, finishMs: 60, resultsMs: 80, onRound: () => {}, onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface P { socket: Client; id: string; latest: RoomState | null; log: { phase: string; at: number }[] }
const all: Client[] = [];
async function guest(name: string): Promise<P> {
  const socket: Client = io(url, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  all.push(socket);
  await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  const p: P = { socket, id: '', latest: null, log: [] };
  socket.on('room:state', (s) => { if (p.log[p.log.length - 1]?.phase !== s.phase) p.log.push({ phase: s.phase, at: Date.now() }); p.latest = s; });
  return p;
}
const take = (p: P, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: P) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (x) => r(take(p, x))));
const join = (p: P, c: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', c, (x) => r(take(p, x))));
const cmd = (emit: (r: (a: Ack<null>) => void) => void) => new Promise<Ack<null>>((r) => emit(r));
async function until(p: P, cond: (s: RoomState) => boolean, ms = 6000) {
  for (const t = Date.now(); Date.now() - t < ms; await sleep(10)) if (p.latest && cond(p.latest)) return true;
  return false;
}

try {
  const names = ['A', 'B', 'C', 'D', 'S1', 'S2', 'S3'];
  const [a, b, c, d, s1, s2, s3] = await Promise.all(names.map(guest));
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  for (const p of [b, c, d, s1, s2, s3]) await join(p, code);
  await cmd((r) => a.socket.emit('room:settings', { gameId: 'tap-race' }, r));
  for (const p of [s1, s2, s3]) await cmd((r) => p.socket.emit('player:watching', true, r));
  await sleep(100);
  // Free bets: S1 on A, S2 on B, S3 on C. Nobody backs D, so D is the underdog.
  await cmd((r) => s1.socket.emit('player:bet', a.id, 0, r));
  await cmd((r) => s2.socket.emit('player:bet', b.id, 0, r));
  await cmd((r) => s3.socket.emit('player:bet', c.id, 0, r));
  await sleep(150);

  check('everyone in the room has their own color, and every client is told them all', Object.keys(a.latest!.colors).length === 7 && new Set(Object.values(a.latest!.colors)).size === 7 && JSON.stringify(a.latest!.colors) === JSON.stringify(s3.latest!.colors));
  const taken = a.latest!.colors[b.id];
  check('picking a color someone else has is refused over the wire', (await cmd((r) => c.socket.emit('player:color', taken, r)) as { ok: boolean; error?: string }).ok === false);
  const free = PLAYER_COLORS.find((col) => !Object.values(a.latest!.colors).includes(col))!;
  check('picking a free color works and everyone sees it', (await cmd((r) => c.socket.emit('player:color', free, r))).ok && await until(s3, (st) => st.colors[c.id] === free));
  check('a spectator is sent their own bet', s1.latest!.bets[s1.id]?.targetId === a.id && Object.keys(s1.latest!.bets).length === 1);
  check('nobody else can see it: other spectators and players are sent no bet of S1', !(s1.id in s2.latest!.bets) && !(s1.id in a.latest!.bets) && Object.keys(a.latest!.bets).length === 0 && Object.keys(d.latest!.bets).length === 0);

  for (const p of [a, b, c, d, s1, s2, s3]) await cmd((r) => p.socket.emit('player:ready', true, r));
  check('after the countdown everyone sees the underdog announcement', await until(d, (s) => s.phase === 'underdog') && await until(a, (s) => s.phase === 'underdog') && await until(s1, (s) => s.phase === 'underdog'));
  check('it names D with a bonus of 3 (one per bettor)', a.latest!.underdog?.playerId === d.id && a.latest!.underdog.bonus === 3 && a.latest!.game === null);
  check('the round starts by itself when it ends', await until(a, (s) => s.phase === 'playing', UNDERDOG_SECONDS * 1000 + 2000));
  const shown = a.log.find((x) => x.phase === 'underdog')!.at, started = a.log.find((x) => x.phase === 'playing')!.at;
  check(`the announcement lasted about ${UNDERDOG_SECONDS} s (got ${started - shown} ms)`, Math.abs(started - shown - UNDERDOG_SECONDS * 1000) < 300);
  d.socket.emit('game:action', { type: 'tap' });
  check('the round then plays and ends: the underdog won and has +1 and +3', await until(a, (s) => s.phase === 'finish' && s.result?.winnerId === d.id) && a.latest!.scores[d.id] === 4 && a.latest!.result!.underdog?.bonus === 3);
  check('everyone sees the winning-bettor list (empty here) and only their own bet result', a.latest!.result!.winningBettors.length === 0 && a.latest!.result!.bets.length === 0 && (await until(s1, (s) => s.result !== null)) && s1.latest!.result!.bets.length === 1 && s1.latest!.result!.bets[0].bettorId === s1.id);
} finally {
  all.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll underdog network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
