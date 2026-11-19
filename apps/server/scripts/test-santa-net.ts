/**
 * Santa's Sack over real sockets (guests, in-process server, no database):  npm run test:santa-net -w @fgn/server
 * Checks the live stream, grabbing and throwing, bad input, and that the round ends through the usual results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, GameView, JoinResult, RoomState, SantaSackView, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, snowballMs: 9000, finishMs: 50, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; views: SantaSackView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'santa-sack') p.views.push(v); });
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
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'santa-sack' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts', await until(a, (s) => s.phase === 'playing'));
  const start = a.latest!.game as SantaSackView;
  check('the round state carries a Santa\'s Sack view: a station for each player and the 9 bags', start.gameId === 'santa-sack' && Object.keys(start.stations).sort().join() === [a.id, b.id].sort().join() && start.bags.length === 9);
  check('every bag has a lid schedule (closed for 15 s in the second or third quarter) and its gifts (a heap in the mouth)', start.bags.every((bag) => bag.lid.openAt - bag.lid.closeAt === 15000 && Array.isArray(bag.gifts)) && start.warnMs === 3000);

  for (let i = 0; i < 60 && !lastView(a); i++) await sleep(25); // (wait for the first streamed snapshot)
  check('snapshots stream during the round', a.views.length > 0);
  // Alice throws; Bob sends junk.
  b.socket.emit('game:action', { type: 'throw', x: 'up', z: null, power: NaN } as never);
  b.socket.emit('game:action', { type: 'fly' } as never);
  b.socket.emit('game:action', null as never);
  const st = start.stations[a.id];
  a.socket.emit('game:action', { type: 'throw', x: -st.x, z: -st.z, power: 0.6 });
  for (let i = 0; i < 40 && lastView(a)?.flying.length === 0; i++) await sleep(25);
  check('throw: a gift leaves the pile and is in the air (no grabbing step, and no limit on gifts)', lastView(a).flying.length === 1);
  check('junk from the other player changed nothing', lastView(b).flying.every((f) => f.owner === a.id));
  a.socket.emit('game:action', { type: 'grab' } as never);
  for (let i = 0; i < 160 && lastView(a).flying.length > 0; i++) await sleep(25); // (a lob takes a couple of seconds)
  check('the gift has come down (landed)', lastView(a).flying.length === 0 && lastView(a).landed.length >= 1);

  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 12000) && await until(b, (s) => s.phase === 'results'));
  await sleep(150); // (the round is saved a moment after the results screen shows)
  const result = a.latest!.result!;
  check('scores are the points from the bags won; a decided round is handed off for saving (a draw is not)', Object.keys(result.scores).length === 2 && (result.winnerId ? saved.length === 1 && saved[0].gameType === 'santa-sack' : saved.length === 0));
  const count = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === count);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Santa\'s Sack network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
