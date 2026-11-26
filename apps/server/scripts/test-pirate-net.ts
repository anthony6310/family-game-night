/**
 * Broadside Battle over real sockets (guests, in-process server, no database):  npm run test:pirate-net -w @fgn/server
 * Checks the registration and the action whitelist (aim, fire), the team setup, the live stream, bad input, the wick and the boom, and that the round ends through the usual team results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { WICK_MS, type Ack, type ClientToServerEvents, type GameView, type JoinResult, type PirateBroadsideView, type RoomState, type ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, snowballMs: 4500, finishMs: 50, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; views: PirateBroadsideView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'pirate-broadside') p.views.push(v); });
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const ready = (p: Player) => new Promise((r) => p.socket.emit('player:ready', true, r));
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 4000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}
const lastView = (p: Player) => p.views[p.views.length - 1];

try {
  const [a, b] = await Promise.all([guest('Alice'), guest('Bob')]);
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code);
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'pirate-broadside' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts', await until(a, (s) => s.phase === 'playing'));
  const start = a.latest!.game as PirateBroadsideView;
  check('a Broadside Battle view: a cannon each, on different ships', start.gameId === 'pirate-broadside' && Object.keys(start.players).length === 2 && new Set(Object.values(start.players).map((p) => p.team)).size === 2 && start.crew.yellow === 1 && start.crew.purple === 1);
  for (let i = 0; i < 60 && !lastView(a); i++) await sleep(25);
  check('snapshots stream during the round', a.views.length > 0);

  // aim and fire get through the whitelist; junk does not change anything
  b.socket.emit('game:action', { type: 'aim', yaw: 'left', pitch: 0.2 } as never);
  b.socket.emit('game:action', { type: 'aim', yaw: NaN, pitch: 0.2 } as never);
  b.socket.emit('game:action', { type: 'fly' } as never);
  a.socket.emit('game:action', { type: 'aim', yaw: 0.2, pitch: 0.5 });
  for (let i = 0; i < 40 && Math.abs((lastView(a)?.players[a.id]?.yaw ?? 0) - 0.2) > 0.001; i++) await sleep(25);
  check('aim works: the server holds where the cannon points (and everyone sees it)', Math.abs(lastView(b).players[a.id].yaw - 0.2) < 0.001 && Math.abs(lastView(b).players[a.id].pitch - 0.5) < 0.001);
  check('junk from the other player changed nothing', lastView(a).players[b.id].yaw === 0 && lastView(a).players[b.id].wickAt === null);
  const firedAt = Date.now();
  a.socket.emit('game:action', { type: 'fire' });
  for (let i = 0; i < 40 && lastView(a).players[a.id].wickAt === null; i++) await sleep(20);
  check('fire lights the wick', lastView(a).players[a.id].wickAt !== null && lastView(a).players[a.id].launchAt! - lastView(a).players[a.id].wickAt! === WICK_MS);
  a.socket.emit('game:action', { type: 'aim', yaw: -0.1, pitch: 0.45 }); // (still aiming while the wick burns)
  check('nothing has been fired while the wick burns', lastView(a).shots.length === 0);
  for (let i = 0; i < 120 && lastView(a).shots.length === 0; i++) await sleep(20);
  const waited = Date.now() - firedAt;
  check('BOOM about a second after the press: the shot is in the view', lastView(a).shots.length === 1 && waited >= WICK_MS - 100 && waited < WICK_MS + 600);
  check('the shot carries its whole flight (where it starts, how fast, when it ends)', lastView(a).shots[0].endAt > lastView(a).shots[0].launchAt + 800 && lastView(a).shots[0].owner === a.id);

  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 9000) && await until(b, (s) => s.phase === 'results'));
  await sleep(150);
  const result = a.latest!.result!;
  check('a team game result: scores for both, and the teams\' totals', Object.keys(result.scores).length === 2 && !!result.team && result.team.totals.yellow + result.team.totals.purple >= 0);
  const count = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === count);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Broadside Battle network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
