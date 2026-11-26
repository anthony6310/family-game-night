/**
 * Frog Climb over real sockets (guests, in-process server, no database):  npm run test:frog-net -w @fgn/server
 * Checks the live stream, climbing and swapping (the action whitelist), bad input, and that the round ends through the usual results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, FrogClimbView, GameView, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, snowballMs: 3000, finishMs: 50, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; views: FrogClimbView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'frog-climb') p.views.push(v); });
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
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'frog-climb' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts', await until(a, (s) => s.phase === 'playing'));
  const start = a.latest!.game as FrogClimbView;
  check('the round state carries a Frog Climb view with a frog for each player', start.gameId === 'frog-climb' && Object.keys(start.players).sort().join() === [a.id, b.id].sort().join());

  for (let i = 0; i < 80 && !lastView(a); i++) await sleep(25);
  check('snapshots stream during the round (the lean builds by itself)', a.views.length > 0);
  a.socket.emit('game:action', { type: 'climb' });
  for (let i = 0; i < 40 && lastView(a)?.players[a.id].h === 0; i++) await sleep(25);
  check('climb: Alice hops up and Bob does not', lastView(a).players[a.id].h > 0 && lastView(a).players[b.id].h === 0);
  const side = lastView(a).players[a.id].side;
  await sleep(300);
  a.socket.emit('game:action', { type: 'swap' });
  for (let i = 0; i < 40 && lastView(a)?.players[a.id].side === side; i++) await sleep(25);
  check('swap: Alice moves to the other side of the pole', lastView(a).players[a.id].side === -side);
  b.socket.emit('game:action', { type: 'fly' } as never);
  b.socket.emit('game:action', null as never);
  await sleep(100);
  check('junk from the other player changed nothing', lastView(b).players[b.id].h === 0);

  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 8000) && await until(b, (s) => s.phase === 'results'));
  await sleep(150);
  const result = a.latest!.result!;
  check('Alice, the only one who climbed, wins with her height as her score', result.winnerId === a.id && result.scores[a.id] > 0 && saved.length === 1 && saved[0].gameType === 'frog-climb');
  const count = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === count);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Frog Climb network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
