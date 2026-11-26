/**
 * The loading step over real sockets (guests, in-process server, no database):  npm run test:starting-net -w @fgn/server
 * Checks that `player:loaded` is accepted (the wiring), that the round waits for every phone once the minimum time is over, that the safety deadline starts it anyway, that the game travels
 * with the 'starting' state (phones build it under the loading page) and the round's reveal and GO are announced to everyone, and that `clock:ping` answers with the server's clock.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Player { socket: Client; id: string; latest: RoomState | null }
const sockets: Client[] = [];
const servers: ReturnType<typeof createGameServer>[] = [];
async function start(options: Parameters<typeof createGameServer>[1]) {
  const httpServer = createGameServer('http://localhost:5173', { finishMs: 50, resultsMs: 60_000, onRound: () => {}, onSession: () => {}, ...options });
  servers.push(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));
  return `http://localhost:${(httpServer.address() as AddressInfo).port}`;
}
async function guest(url: string, name: string): Promise<Player> {
  const socket: Client = io(url, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null };
  socket.on('room:state', (s) => { p.latest = s; });
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const ready = (p: Player) => new Promise((r) => p.socket.emit('player:ready', true, r));
const ping = (p: Player) => new Promise<number>((r) => p.socket.emit('clock:ping', r));
const loaded = (p: Player) => new Promise<Ack<null>>((r) => p.socket.emit('player:loaded', r));
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 4000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(15)) if (p.latest && cond(p.latest)) return true;
  return false;
}
/** A room of two guests with Tap Race picked and both ready (the countdown and the flash step then run). */
async function room(url: string) {
  const [a, b] = await Promise.all([guest(url, 'Alice'), guest(url, 'Bob')]);
  const made = await create(a);
  await join(b, made.ok ? made.data.room.code : '');
  await new Promise((r) => a.socket.emit('room:settings', { gameId: 'tap-race' }, r));
  await Promise.all([ready(a), ready(b)]);
  return { a, b };
}

try {
  // ---- the round waits for every phone, once the minimum time is over ----
  {
    const url = await start({ countdownMs: 50, startingMs: 300, startingMaxMs: 10_000 });
    const { a, b } = await room(url);
    check('the room enters the starting step', await until(a, (s) => s.phase === 'starting'));
    check('the state carries the safety deadline', a.latest!.startingDeadline !== null && a.latest!.startingDeadline > Date.now() + 5000);
    const first = await loaded(a);
    check('player:loaded is accepted over the socket', first.ok);
    await sleep(500); // (the 300 ms minimum is over, but Bob has not reported)
    check('minimum over, one phone still loading: the room is still in the starting step', a.latest!.phase === 'starting' && b.latest!.phase === 'starting');
    await loaded(b);
    check('the last phone reports: the round starts for everyone', await until(a, (s) => s.phase === 'playing') && await until(b, (s) => s.phase === 'playing'));
    const late = await loaded(a);
    check('a report after the round began is refused, not fatal', !late.ok && a.latest!.phase === 'playing');
  }
  // ---- everyone loads early: the minimum time still holds ----
  {
    const url = await start({ countdownMs: 50, startingMs: 600, startingMaxMs: 10_000 });
    const { a, b } = await room(url);
    await until(a, (s) => s.phase === 'starting');
    const t0 = Date.now();
    await Promise.all([loaded(a), loaded(b)]);
    await sleep(200);
    check('everyone loaded early: the round does not start before the minimum time', a.latest!.phase === 'starting');
    check('...then it starts when the minimum is over', await until(a, (s) => s.phase === 'playing') && Date.now() - t0 >= 450);
  }
  // ---- nobody ever reports: the deadline starts it ----
  {
    const url = await start({ countdownMs: 50, startingMs: 100, startingMaxMs: 700 });
    const { a, b } = await room(url);
    await until(a, (s) => s.phase === 'starting');
    const t0 = Date.now();
    await sleep(350);
    check('no one has reported and the minimum is over: still waiting', a.latest!.phase === 'starting');
    check('the safety deadline starts the round anyway', await until(b, (s) => s.phase === 'playing', 3000) && Date.now() - t0 >= 500);
  }
  // ---- the game is made with the loading step, and its clock is set for everyone when the last phone is ready ----
  {
    const url = await start({ countdownMs: 50, startingMs: 100, startingMaxMs: 10_000, introMs: 2000 });
    const { a, b } = await room(url);
    check('the starting state carries the round\'s game (so phones build it under the loading page)', await until(a, (s) => s.phase === 'starting' && s.game !== null) && await until(b, (s) => s.phase === 'starting' && s.game !== null));
    const id = a.latest!.roundId, provisional = (a.latest!.game as { startsAt: number }).startsAt;
    check('...with GO far away while it loads (the latest it could be)', provisional > Date.now() + 9000 && a.latest!.revealAt === null);
    await loaded(a);
    await sleep(250);
    check('one phone ready, one still building: still loading', a.latest!.phase === 'starting' && b.latest!.phase === 'starting');
    await loaded(b);
    check('the last phone ready: the round begins for everyone', await until(a, (s) => s.phase === 'playing') && await until(b, (s) => s.phase === 'playing'));
    const sa = a.latest!, sb = b.latest!;
    const goA = (sa.game as { startsAt: number }).startsAt, goB = (sb.game as { startsAt: number }).startsAt;
    check('both phones got the SAME reveal moment and GO, GO one intro after the reveal', sa.revealAt !== null && sa.revealAt === sb.revealAt && goA === goB && goA === sa.revealAt + 2000);
    check('...the reveal is just ahead (the message is there before it), and it is the same round', sa.revealAt! > Date.now() - 50 && sa.revealAt! < Date.now() + 1000 && sa.roundId === id);
  }
  // ---- clock sync ----
  {
    const url = await start({ countdownMs: 50 });
    const p = await guest(url, 'Clock');
    const t0 = Date.now(); const serverTime = await ping(p); const t1 = Date.now();
    check('clock:ping answers with the server\'s clock, taken between the ping and its answer', serverTime >= t0 && serverTime <= t1);
  }
} finally {
  sockets.forEach((s) => s.close());
  servers.forEach((s) => s.close());
}
console.log(failures === 0 ? '\nAll loading-step network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
