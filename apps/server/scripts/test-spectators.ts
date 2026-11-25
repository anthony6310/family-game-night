/**
 * Playing vs watching: any member can switch, points are kept, and watchers still count for the session win.
 *   npm run test:spectators -w @fgn/server
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { MAX_PLAYERS, type Ack, type ClientToServerEvents, type JoinResult, type RoomState, type ServerToClientEvents, type TapRaceView } from '@fgn/shared';
import { createGameServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpServer = createGameServer('http://localhost:5173', { countdownMs: 80, roundMs: 400, finishMs: 60, resultsMs: 80, onRound: () => {}, onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

interface P { socket: Client; id: string; latest: RoomState | null; closed: boolean }
const all: Client[] = [];
async function guest(name: string): Promise<P> {
  const socket: Client = io(url, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  all.push(socket);
  await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  const p: P = { socket, id: '', latest: null, closed: false };
  socket.on('room:state', (s) => { p.latest = s; });
  socket.on('room:closed', () => { p.closed = true; });
  return p;
}
const take = (p: P, res: Ack<JoinResult>) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } return res; };
const create = (p: P) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:create', (x) => r(take(p, x))));
const join = (p: P, c: string) => new Promise<Ack<JoinResult>>((r) => p.socket.emit('room:join', c, (x) => r(take(p, x))));
const cmd = (emit: (r: (a: Ack<null>) => void) => void) => new Promise<Ack<null>>((r) => emit(r));
const err = (a: Ack<unknown>) => (a.ok ? 'none' : a.error);
const watching = (p: P, on: boolean) => cmd((r) => p.socket.emit('player:watching', on, r));
const ready = (p: P) => cmd((r) => p.socket.emit('player:ready', true, r));
const isWatching = (s: RoomState | null, id: string) => s?.watchingIds.includes(id) ?? false;
async function until(p: P, cond: (s: RoomState) => boolean, ms = 3000) {
  for (const t = Date.now(); Date.now() - t < ms; await sleep(10)) if (p.latest && cond(p.latest)) return true;
  return false;
}
const tap = async (p: P, n: number) => { for (let i = 0; i < n; i++) { p.socket.emit('game:action', { type: 'tap' }); await sleep(15); } };

try {
  // ---- toggling in the lobby ----
  const a = await guest('Alice'); const b = await guest('Bob'); const c = await guest('Cara');
  const made = await create(a);
  const code = made.ok ? made.data.room.code : '';
  await join(b, code); await join(c, code);
  check('everybody starts out playing', a.latest!.watchingIds.length === 0);
  check('a player can switch to watching, and everyone sees it', (await watching(c, true)).ok && await until(a, (s) => isWatching(s, c.id)));
  check('a watcher is still a member of the room (listed in players)', a.latest!.players.some((p) => p.id === c.id));
  await cmd((r) => a.socket.emit('room:settings', { gameId: 'tap-race' }, r));

  // ---- a round plays without the watcher ----
  await Promise.all([a, b].map(ready));
  await sleep(150);
  check('spectators have to be ready too: the round waits for the watcher', a.latest!.phase === 'lobby');
  check('a watcher can ready up', (await ready(c)).ok);
  check('the round starts once the players AND the watcher are ready', await until(a, (s) => s.phase === 'playing'));
  check('the watcher is not in the game', !(c.id in (a.latest!.game as TapRaceView).taps));
  c.socket.emit('game:action', { type: 'tap' });
  await tap(a, 5);
  check('can\'t switch mid-round', err(await watching(b, true)) === 'WRONG_PHASE' && err(await watching(c, false)) === 'WRONG_PHASE');
  const late = await guest('Late');
  check('someone joining mid-round starts out watching (not refused)', (await join(late, code)).ok && isWatching(late.latest, late.id));
  late.socket.emit('room:leave'); // (they would otherwise have to ready for every later round)
  check('round ends: Alice wins it', await until(a, (s) => s.phase === 'results' && s.result?.winnerId === a.id));
  await until(a, (s) => s.phase === 'lobby');
  check('the watcher\'s taps counted for nothing', a.latest!.result === null && a.latest!.scores[c.id] === undefined);

  // ---- switching back, and the points survive ----
  check('Alice leads with 1 point after round 1', a.latest!.scores[a.id] === 1);
  check('a spectator cannot choose to play again: there is no way back to a seat on your own', err(await watching(c, false)) === 'NO_SEAT' && isWatching(a.latest, c.id));
  check('the spectator readies again with the others and the countdown starts', (await ready(a)).ok && (await ready(b)).ok && (await ready(c)).ok && await until(a, (s) => s.phase === 'countdown' || s.phase === 'playing'));
  await until(a, (s) => s.phase === 'playing');
  await tap(a, 5);
  await until(a, (s) => s.phase === 'lobby');
  check('Alice now has 2 wins', a.latest!.scores[a.id] === 2);

  // ---- a watcher who leads still wins the session ----
  // New room for the session-winner rules.
  await a.socket.emit('room:leave'); await b.socket.emit('room:leave'); await c.socket.emit('room:leave');
  await sleep(100);

  const x = await guest('X'); const y = await guest('Y'); const z = await guest('Z');
  const m2 = await create(x); const code2 = m2.ok ? m2.data.room.code : '';
  await join(y, code2); await join(z, code2);
  await cmd((r) => x.socket.emit('room:settings', { gameId: 'tap-race' }, r));
  async function round(players: P[], winner: P | null) {
    await Promise.all([x, y, z].map(ready)); // everyone readies, watchers included
    await until(x, (s) => s.phase === 'playing');
    if (winner) await tap(winner, 6);
    await until(x, (s) => s.phase === 'results' || s.phase === 'session-over' || s.phase === 'finish');
    await until(x, (s) => s.phase === 'lobby' || s.phase === 'session-over', 4000);
  }
  await round([x, y, z], y);              // Y: 1
  await round([x, y, z], y);              // Y: 2
  await watching(y, true);                // Y leads and then goes to watch
  await round([x, y, z], x);              // X: 1 (Y watches)
  await cmd((r) => x.socket.emit('session:end', r));
  check('a watcher who leads at the end is crowned', await until(x, (s) => s.phase === 'session-over' && s.sessionWinner?.id === y.id && isWatching(s, y.id)));

  // ---- seats: 8 seats; later joiners wait in a line; seats change hands only when someone leaves or gives theirs up ----
  const host = await guest('Host');
  const m3 = await create(host); const code3 = m3.ok ? m3.data.room.code : '';
  const crowd: P[] = [host];
  for (let i = 1; i < MAX_PLAYERS; i++) { const g = await guest(`P${i}`); await join(g, code3); crowd.push(g); }
  const ninth = await guest('Ninth');
  check('the 9th person joins as a watcher', (await join(ninth, code3)).ok && isWatching(ninth.latest, ninth.id));
  check('...and is listed as a spectator (in the line)', await until(host, (s) => s.spectatorOnlyIds.length === 1 && s.spectatorOnlyIds[0] === ninth.id));
  check('...with no option to play', err(await watching(ninth, false)) === 'NO_SEAT');
  check('only a spectator can bet: a seat holder cannot', err(await cmd((r) => crowd[1].socket.emit('player:bet', crowd[2].id, 0, r))) === 'NOT_A_SPECTATOR');
  check('...and a spectator can', (await cmd((r) => ninth.socket.emit('player:bet', crowd[2].id, 0, r))).ok);
  check('a seat holder gives up their seat: the first in line takes it automatically, and the one who gave it up joins the back of the line', (await watching(crowd[3], true)).ok
    && await until(host, (s) => s.spectatorOnlyIds.length === 1 && s.spectatorOnlyIds[0] === crowd[3].id && !isWatching(s, ninth.id)));
  check('...who has no way back to the seat they gave up', err(await watching(crowd[3], false)) === 'NO_SEAT');
  check('...and the new seat holder starts without their bet', host.latest!.bets[ninth.id] === undefined);
  crowd[5].socket.emit('room:leave'); // a seat holder drops out
  check('when a seat holder leaves, the spectator at the front of the line gets the seat', await until(host, (s) => s.spectatorOnlyIds.length === 0 && !isWatching(s, crowd[3].id)));
} finally {
  all.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll spectator checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
