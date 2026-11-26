/**
 * Zoo Adoption over real sockets (guests, in-process server, no database):  npm run test:shelter-net -w @fgn/server
 * Checks the registration and the action whitelist (steer, look, grab, give), the live stream, bad input, and that the round ends through the usual results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, AdoptionDayView, ClientToServerEvents, GameView, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, snowballMs: 3500, finishMs: 50, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; views: AdoptionDayView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'adoption-day') p.views.push(v); });
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
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'adoption-day' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts', await until(a, (s) => s.phase === 'playing'));
  const start = a.latest!.game as AdoptionDayView;
  check('the round state carries an Zoo Adoption view: a volunteer each, six adopters, a crowd', start.gameId === 'adoption-day' && Object.keys(start.players).sort().join() === [a.id, b.id].sort().join() && start.adoptees.length === 6 && start.animals.length > 20);
  for (let i = 0; i < 60 && !lastView(a); i++) await sleep(25);
  check('snapshots stream during the round', a.views.length > 0);

  // Steering and looking get through the whitelist; junk does not change anything.
  const z0 = lastView(a).players[a.id].z;
  b.socket.emit('game:action', { type: 'grab', target: 'x' } as never);
  b.socket.emit('game:action', { type: 'look', yaw: 'left' } as never);
  b.socket.emit('game:action', { type: 'steer', x: NaN, z: 1 } as never);
  b.socket.emit('game:action', { type: 'fly' } as never);
  a.socket.emit('game:action', { type: 'look', yaw: 2 });
  a.socket.emit('game:action', { type: 'steer', x: 0, z: 1 });
  for (let i = 0; i < 80 && !(lastView(a).players[a.id].z > z0 + 2); i++) await sleep(25);
  check('steer works: the volunteer walks', lastView(a).players[a.id].z > z0 + 2);
  check('look works: others can see which way they face', Math.abs(lastView(b).players[a.id].yaw - 2) < 0.01);
  check('junk from the other player changed nothing', lastView(a).players[b.id].z === start.players[b.id].z && lastView(a).players[b.id].yaw === 0);
  a.socket.emit('game:action', { type: 'grab', target: lastView(a).animals[0][0] }); // (far away: refused, but it must not break anything)
  a.socket.emit('game:action', { type: 'give' });
  a.socket.emit('game:action', { type: 'steer', x: 0, z: 0 });
  await sleep(200);
  check('a far grab and a give with nothing in hand change nothing', lastView(a).players[a.id].carry === null && lastView(a).players[a.id].adoptions === 0);

  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 8000) && await until(b, (s) => s.phase === 'results'));
  await sleep(150);
  const result = a.latest!.result!;
  check('scores are listed for both players; nobody adopted anything, so it is a draw and not saved', Object.keys(result.scores).length === 2 && result.winnerId === null && saved.length === 0);
  const count = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === count);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Zoo Adoption network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
