/**
 * The end-of-round "you won / you lost" sequence, with real socket clients (guests, no database):
 *   npm run test:finish -w @fgn/server
 * A round ends -> a FINISH phase (result decided, input stopped, game frozen) -> the RESULTS summary -> next.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import {
  COUNTDOWN_SECONDS, FINISH_SECONDS, RESULTS_SECONDS,
  type Ack, type ClientToServerEvents, type JoinResult, type RoomState, type ServerToClientEvents, type TapRaceView,
} from '@fgn/shared';
import { createGameServer } from '../src/server';
import type { RoundRecord } from '../src/rooms';

const FINISH_MS = 500;
const RESULTS_MS = 700;
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the defaults the real game uses ----
check('timing: the countdown after everyone is ready is 3 seconds', COUNTDOWN_SECONDS === 3);
check('timing: the you-won / you-lost sequence is 3 seconds', FINISH_SECONDS === 3);
check('timing: the round summary screen is 4 seconds', RESULTS_SECONDS === 4);

const saved: RoundRecord[] = [];
const httpServer = createGameServer('http://localhost:5173', {
  countdownMs: 100, roundMs: 500, finishMs: FINISH_MS, resultsMs: RESULTS_MS, onRound: (r) => saved.push(r), onSession: () => {},
});
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface Player { socket: Client; id: string; latest: RoomState | null; log: { phase: string; at: number }[] }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null, log: [] };
  socket.on('room:state', (s) => {
    if (p.log[p.log.length - 1]?.phase !== s.phase) p.log.push({ phase: s.phase, at: Date.now() });
    p.latest = s;
  });
  return p;
}
const ack = (p: Player, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (res) => r(ack(p, res))));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', code, (res) => r(ack(p, res))));
const cmd = (emit: (r: (a: Ack<null>) => void) => void) => new Promise<Ack<null>>((r) => emit(r));
const errorOf = (a: Ack<unknown>) => (a.ok ? 'none' : a.error);
const tapView = (s: RoomState | null) => (s?.game?.gameId === 'tap-race' ? (s.game as TapRaceView) : undefined);
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 4000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(10)) if (p.latest && cond(p.latest)) return true;
  return false;
}

try {
  const [a, b] = await Promise.all([guest('Alice'), guest('Bob')]);
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code);
  await cmd((r) => a.socket.emit('room:settings', { gameId: 'tap-race' }, r));
  await Promise.all([a, b].map((p) => cmd((r) => p.socket.emit('player:ready', true, r))));
  await until(a, (s) => s.phase === 'playing');
  for (let i = 0; i < 4; i++) { a.socket.emit('game:action', { type: 'tap' }); await sleep(60); } // Alice taps, Bob doesn't: Alice wins

  // ---- the round ends: FINISH comes first ----
  check('round end: the room goes to the finish phase first (not straight to the summary)', await until(a, (s) => s.phase === 'finish', 2000));
  const fin = a.latest!;
  check('finish: the result is already decided, with the winner named', fin.result?.winnerId === a.id && fin.result.winner?.name === 'Alice');
  check('finish: it lasts finishMs (the end time is ~500 ms after the server timestamp)', fin.finishEndsAt !== null && fin.finishEndsAt - fin.serverTime > FINISH_MS - 200 && fin.finishEndsAt - fin.serverTime <= FINISH_MS);
  check('finish: the game is still there, frozen, for the screens to draw behind the message', (tapView(fin)?.taps[a.id] ?? 0) >= 3);
  check('finish: both players are told at the same moment', await until(b, (s) => s.phase === 'finish', 500) && b.latest?.result?.winnerId === a.id);
  check('finish: the winner is saved straight away', saved.length === 1 && saved[0].winner.id === a.id);

  // ---- input is arrested for the whole sequence ----
  const tapsBefore = tapView(a.latest)?.taps[a.id];
  b.socket.emit('game:action', { type: 'tap' });
  a.socket.emit('game:action', { type: 'tap' });
  a.socket.emit('game:action', { type: 'steer', x: 1, z: 0 });
  await sleep(80);
  check('input stopped: taps and steering during the finish sequence change nothing', a.latest?.phase === 'finish' && tapView(a.latest)?.taps[a.id] === tapsBefore && tapView(a.latest)?.taps[b.id] === 0);
  check('input stopped: nobody can ready up, change settings or end the round early during it',
    errorOf(await cmd((r) => b.socket.emit('player:ready', true, r))) === 'WRONG_PHASE'
    && errorOf(await cmd((r) => a.socket.emit('room:settings', { gameId: 'snowball' }, r))) === 'WRONG_PHASE'
    && errorOf(await cmd((r) => a.socket.emit('room:return-to-lobby', r))) === 'WRONG_PHASE');
  const late = await guest('Late');
  const lateJoin = await join(late, code);
check('input stopped: someone joining during the finish sequence can only watch', lateJoin.ok && lateJoin.data.room.watchingIds.includes(late.id));

  // ---- then the summary, then the next round ----
  check('after the sequence the room shows the round summary', await until(a, (s) => s.phase === 'results', FINISH_MS + 800));
  const res = a.latest!;
  check('summary: it has the same result, no frozen game, and the (shorter) results timer', res.result?.winnerId === a.id && res.game === null && res.finishEndsAt === null
    && res.resultsEndsAt !== null && res.resultsEndsAt - res.serverTime > RESULTS_MS - 200 && res.resultsEndsAt - res.serverTime <= RESULTS_MS);
  check('summary: the winner got their point exactly once', res.scores[a.id] === 1 && !(b.id in res.scores));
  check('the whole order is playing -> finish -> results -> lobby', await until(a, (s) => s.phase === 'lobby', RESULTS_MS + 800)
    && a.log.map((x) => x.phase).join('>').includes('playing>finish>results>lobby'));
  const finishLasted = a.log.find((x) => x.phase === 'results')!.at - a.log.find((x) => x.phase === 'finish')!.at;
  check('finish really lasted about as long as configured before the summary appeared', finishLasted >= FINISH_MS - 80 && finishLasted <= FINISH_MS + 250);

  // ---- a draw also gets the finish sequence ----
  await Promise.all([a, b].map((p) => cmd((r) => p.socket.emit('player:ready', true, r))));
  await until(a, (s) => s.phase === 'finish', 3000); // nobody taps: a draw
  check('a draw still plays the finish sequence, with no winner', a.latest!.phase === 'finish' && a.latest!.result?.winnerId === null && a.latest!.result.winner === null);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll finish-sequence checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
