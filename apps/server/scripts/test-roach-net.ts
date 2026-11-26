/**
 * Roach Rumble over real sockets (guests, in-process server, no database):  npm run test:roach-net -w @fgn/server
 * Checks the registration and the action whitelist (steer, smack), that a lone player is drawn as the sandal, the live stream, bad input, and that the round ends through the usual team results flow.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { type Ack, type ClientToServerEvents, type GameView, type JoinResult, type RoachHuntView, type RoomState, type ServerToClientEvents } from '@fgn/shared';
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

interface Player { socket: Client; id: string; latest: RoomState | null; views: RoachHuntView[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, views: [] };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('game:view', (v: GameView) => { if (v.gameId === 'roach-hunt') p.views.push(v); });
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
  const [a, b, c] = await Promise.all([guest('Alice'), guest('Bob'), guest('Cara')]);
  const all = [a, b, c];
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code); await join(c, code);
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'roach-hunt' }, r));
  await Promise.all(all.map(ready));
  check('the round starts (a one-against-all team game goes straight to the round: no team step)', await until(a, (s) => s.phase === 'playing', 6000));
  for (let i = 0; i < 80 && !lastView(a); i++) await sleep(25);
  const start = lastView(a);
  check('a Roach Rumble view: one sandal, two roaches, all alive', start.gameId === 'roach-hunt' && Object.keys(start.players).length === 3 && start.players[start.sandalId].role === 'sandal' && start.alive === 2 && start.total === 2);
  const sandal = all.find((p) => p.id === start.sandalId)!;
  const roach = all.find((p) => p.id !== start.sandalId)!;
  const teams = a.latest!.teams;
  check('the sandal is the lone (purple) player and the roaches are yellow', teams[sandal.id] === 'purple' && all.filter((p) => teams[p.id] === 'yellow').length === 2);

  // wait for the round's clock to start (the opening), then move and smack
  for (let i = 0; i < 200 && Date.now() < start.startsAt; i++) await sleep(25);
  await sleep(150);
  roach.socket.emit('game:action', { type: 'steer', x: 'up', z: 0 } as never);
  roach.socket.emit('game:action', { type: 'steer', x: NaN, z: 0 } as never);
  roach.socket.emit('game:action', { type: 'dance' } as never);
  const x0 = lastView(a).players[roach.id].x, z0 = lastView(a).players[roach.id].z;
  await sleep(150);
  check('junk steers and unknown actions change nothing', lastView(a).players[roach.id].x === x0 && lastView(a).players[roach.id].z === z0);
  roach.socket.emit('game:action', { type: 'steer', x: 0, z: 1 });
  await sleep(500);
  check('a roach steers: the server moves it and everyone sees it', Math.abs(lastView(b).players[roach.id].z - z0) > 2 || Math.abs(lastView(b).players[roach.id].z) > 19);
  roach.socket.emit('game:action', { type: 'smack' });
  await sleep(100);
  check('a roach cannot smack', lastView(a).players[roach.id].smackAt === null);
  // (the kitchen is random, so the spot in front of the sandal may be over an island or a prop, where a smack is refused: try each way round until one is on open floor)
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1]]) {
    sandal.socket.emit('game:action', { type: 'steer', x: dx, z: dz }); await sleep(60);
    sandal.socket.emit('game:action', { type: 'steer', x: 0, z: 0 }); await sleep(60);
    sandal.socket.emit('game:action', { type: 'smack' });
    for (let i = 0; i < 8 && lastView(a).players[sandal.id].smackAt === null; i++) await sleep(20);
    if (lastView(a).players[sandal.id].smackAt !== null) break;
  }
  for (let i = 0; i < 40 && lastView(a).players[sandal.id].smackAt === null; i++) await sleep(20);
  check('the sandal smacks: the swing is in the view (the smack action gets through the whitelist)', lastView(a).players[sandal.id].smackAt !== null);

  check('time runs out: everyone moves to the results screen', await until(a, (s) => s.phase === 'results', 12000) && await until(b, (s) => s.phase === 'results'));
  await sleep(150);
  const result = a.latest!.result!;
  check('a team game result with the sides named for this game', !!result.team && result.team.names.yellow === 'The Roaches' && result.team.names.purple === 'The Sandal' && Object.keys(result.scores).length === 3);
  const count = a.views.length;
  await sleep(300);
  check('snapshots stop once the round is over', a.views.length === count);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll Roach Rumble network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
