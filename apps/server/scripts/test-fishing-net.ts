/**
 * Fishing over real sockets (guests, in-process server, no database):
 *   npm run test:fishing-net -w @fgn/server
 * 100 ms countdown; the rise lasts 2 s (with a 0.5 s cast first). Checks the live stream, steering, bad input and the usual results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, FishingView, GameView, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpServer = createGameServer('http://localhost:5173', { countdownMs: 100, snowballMs: 2000, finishMs: 50, resultsMs: 60_000, onRound: () => {}, onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface P { socket: Client; id: string; latest: RoomState | null; views: FishingView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<P> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  const p: P = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'fishing') p.views.push(v); });
  return p;
}
const ack = (p: P, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: P) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: P, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const ready = (p: P) => new Promise((r) => p.socket.emit('player:ready', true, r));
async function until(p: P, cond: (s: RoomState) => boolean, ms = 5000) {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}

try {
  const [a, b] = await Promise.all([guest('Alice'), guest('Bob')]);
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code);
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'fishing' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts after the countdown', await until(a, (s) => s.phase === 'playing'));

  const start = a.latest!.game as FishingView;
  check('the room state carries a Fishing view: a hook and a lane for each player',
    start.gameId === 'fishing' && start.lanes.length === 2 && Object.keys(start.hooks).sort().join() === [a.id, b.id].sort().join());
  check('the hooks start at the bottom and the ascent starts after the cast', start.hookDepth === start.depth && start.ascentStartsAt > start.startsAt && start.endsAt > start.ascentStartsAt);

  // Alice slides right for the whole round; Bob sends junk.
  b.socket.emit('game:action', { type: 'steer', x: 'left', z: null } as never);
  b.socket.emit('game:action', { type: 'steer', x: NaN, z: 0 } as never);
  b.socket.emit('game:action', { type: 'fly' } as never);
  b.socket.emit('game:action', null as never);
  await sleep(700); // (past the 0.5 s cast)
  a.socket.emit('game:action', { type: 'steer', x: 1, z: 0 });
  await sleep(500);
  const mid = a.views[a.views.length - 1];
  check('the live stream is flowing, and the hooks are rising', a.views.length > 10 && mid.hookDepth < mid.depth);
  check('Alice\'s hook slid right inside her lane (and stopped at its edge)', mid.hooks[a.id].x > start.hooks[a.id].x && mid.hooks[a.id].x <= start.laneWidth);
  check('Bob\'s junk changed nothing', mid.hooks[b.id].x === start.hooks[b.id].x);
  check('only the fish near the hooks are sent', mid.fish.length > 0 && mid.fish.length < 60);

  check('the round ends and the results come up', await until(a, (s) => s.phase === 'finish' || s.phase === 'results'));
  const end = a.views[a.views.length - 1];
  check('the hooks reached (nearly) the surface by the last snapshot', end.hookDepth <= end.depth * 0.15 && end.endDepth > 0); // (the 2 s test rise is fast, so the last snapshot can be well short of the surface)
  check('a catch count for every player came with the result', await until(a, (s) => s.result !== null && a.id in s.result.scores && b.id in s.result.scores));
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Fishing network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
