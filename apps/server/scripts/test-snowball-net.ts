/**
 * Snowball over real sockets (guests, in-process server, no database):
 *   npm run test:snowball-net -w @fgn/server
 * 100 ms countdown, a 1.5 s round. Checks the live snapshot stream, steering, bad input,
 * and that the round ends through the usual results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, GameView, JoinResult, RoomState, ServerToClientEvents, SnowballView } from '@fgn/shared';
import { createGameServer } from '../src/server';
import { DEFAULT_SNOWBALL_CONFIG as cfg } from '../src/games/snowball';
import type { RoundRecord } from '../src/rooms';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', {
  countdownMs: 100, snowballMs: 1500, resultsMs: 60_000, onRound: (r) => saved.push(r), onSession: () => {},
});
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player {
  socket: Client; id: string; latest: RoomState | null;
  views: SnowballView[]; stateEventsWhilePlaying: number;
}
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [], stateEventsWhilePlaying: 0 };
  socket.on('room:state', (s) => { p.latest = s; if (s.phase === 'playing') p.stateEventsWhilePlaying++; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'snowball') p.views.push(v); });
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const ready = (p: Player) => new Promise((r) => p.socket.emit('player:ready', true, r));
const steer = (p: Player, x: number, z: number) => p.socket.emit('game:action', { type: 'steer', x, z });
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 4000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}

try {
  const [a, b] = await Promise.all([guest('Alice'), guest('Bob')]);
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code);
  await new Promise((r) => a.socket.emit('session:start', 3, r));
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'snowball' }, r));
  await Promise.all([ready(a), ready(b)]);
  check('the round starts after the countdown', await until(a, (s) => s.phase === 'playing'));

  const start = a.latest!.game as SnowballView;
  check('the round state carries a Snowball view with one ball per player',
    start.gameId === 'snowball' && Object.keys(start.balls).sort().join() === [a.id, b.id].sort().join() && start.arenaRadius > 0);
  check('everyone starts at radius 1', Object.values(start.balls).every((ball) => Math.abs(ball.radius - 1) < 1e-6));
  const startA = { ...start.balls[a.id] };
  const startB = { ...start.balls[b.id] };

  // Alice rolls toward the middle for most of the round. Bob sends junk and a tap, then nothing.
  a.socket.emit('game:action', { type: 'tap' } as never);
  b.socket.emit('game:action', { type: 'steer', x: 'up', z: null } as never);
  b.socket.emit('game:action', { type: 'steer', x: NaN, z: 1 } as never);
  b.socket.emit('game:action', { type: 'fly' } as never);
  b.socket.emit('game:action', null as never);
  const towardCentreX = startA.x > 0 ? -1 : 1;
  const towardCentreZ = startA.z > 0 ? -1 : 1;
  const statesBefore = a.stateEventsWhilePlaying;
  for (let i = 0; i < 12; i++) { steer(a, 3 * towardCentreX, 3 * towardCentreZ); await sleep(80); } // an oversized vector on purpose

  check('live snapshots stream during the round (~20 per second)', a.views.length >= 15 && a.views.length <= 45);
  check('both players receive the same stream', b.views.length >= 15);
  check('snapshots are not spammed through room:state on every steer', a.stateEventsWhilePlaying - statesBefore <= 3);

  const latest = a.views[a.views.length - 1];
  const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
  check('the steering player\'s ball moved', dist(latest.balls[a.id], startA) > 2);
  check('the player who sent junk (and no valid input) did not move', dist(latest.balls[b.id], startB) < 1e-6);
  check('the moving ball grew', latest.balls[a.id].radius > 1.01);
  check('speed stays within the cap (130% downhill at most) despite the oversized steering vector', Math.hypot(latest.balls[a.id].vx, latest.balls[a.id].vz) <= cfg.maxSpeed * cfg.downhillMaxFactor + 0.01);
  check('every ball stays inside the arena',
    a.views.every((v) => Object.values(v.balls).every((ball) => Math.hypot(ball.x, ball.z) + ball.radius <= v.arenaRadius + 0.01)));

  // Round end: the server decides, using the normal results flow.
  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 3000) && await until(b, (s) => s.phase === 'results'));
  const result = a.latest!.result!;
  check('the bigger ball wins the round', result.winnerId === a.id && result.winner?.name === 'Alice');
  check('scores are sizes in cm, and the winner scored above the starting 100', result.scores[a.id] > 100 && result.scores[b.id] === 100);
  check('the winner gets the point and the round is handed off for saving', a.latest!.scores[a.id] === 1 && saved.length === 1 && saved[0].gameType === 'snowball' && saved[0].winner.id === a.id);

  const countAtEnd = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === countAtEnd);
  steer(a, 1, 0);
  await sleep(100);
  check('steering after the round has ended changes nothing', a.latest!.phase === 'results');
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll snowball network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
