/**
 * MVP 3 rules with real socket clients against an in-process server (guests only):
 *   npm run test:lobby -w @fgn/server
 * Covers: host-only settings, validation, ready rules, countdown start/cancel/finish,
 * stale-timer safety, and what each kind of change does to a running countdown.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomSettings, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

const COUNTDOWN_MS = 400;
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpServer = createGameServer('http://localhost:5173', { countdownMs: COUNTDOWN_MS, onRound: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

/** A connected guest that remembers the latest room state the server sent it. */
interface Player { socket: Client; id: string; latest: RoomState | null }
const sockets: Client[] = [];
async function guest(name: string): Promise<Player> {
  const socket: Client = io(serverUrl, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const p: Player = { socket, id: '', latest: null };
  socket.on('room:state', (s) => (p.latest = s));
  return p;
}
const create = (p: Player) => new Promise<Ack<JoinResult>>((r) =>
  p.socket.emit('room:create', (res) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } r(res); }));
const join = (p: Player, code: string) => new Promise<Ack<JoinResult>>((r) =>
  p.socket.emit('room:join', code, (res) => { if (res.ok) { p.id = res.data.playerId; p.latest = res.data.room; } r(res); }));
const settings = (p: Player, s: Partial<RoomSettings> | Record<string, unknown>) =>
  new Promise<Ack<null>>((r) => p.socket.emit('room:settings', s as Partial<RoomSettings>, r));
const ready = (p: Player, v: boolean) => new Promise<Ack<null>>((r) => p.socket.emit('player:ready', v, r));
const backToLobby = (p: Player) => new Promise<Ack<null>>((r) => p.socket.emit('room:return-to-lobby', r));
const errorOf = (a: Ack<unknown>) => (a.ok ? 'none' : a.error);

/** Waits (polling) until this player's latest room state satisfies the condition. */
async function until(p: Player, cond: (s: RoomState) => boolean, ms = 2000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(20)) if (p.latest && cond(p.latest)) return true;
  return false;
}

/** Makes a room with `n` guests (first is host) that is configured for tap-race. */
async function makeRoom(n: number, configure = true) {
  const players = await Promise.all(Array.from({ length: n }, (_, i) => guest(i === 0 ? 'Host' : `P${i}`)));
  const made = await create(players[0]);
  const code = made.ok ? made.data.room.code : '';
  for (const p of players.slice(1)) await join(p, code);
  if (configure) await settings(players[0], { gameId: 'tap-race' });
  return { players, host: players[0], code };
}

try {
  // ---- settings: who and what ----
  const A = await makeRoom(2, false);
  const [host, bob] = A.players;
  check('new room starts in lobby with no game and the first round option',
    host.latest?.phase === 'lobby' && host.latest.settings.gameId === null && host.latest.settings.totalRounds === 3);
  check('non-host cannot change settings', errorOf(await settings(bob, { gameId: 'tap-race' })) === 'NOT_HOST');
  check('unknown game is rejected', errorOf(await settings(host, { gameId: 'nope' })) === 'INVALID_SETTING');
  check('round count outside ROUND_OPTIONS is rejected', errorOf(await settings(host, { totalRounds: 4 })) === 'INVALID_SETTING');
  check('cannot ready up before a game is chosen', errorOf(await ready(host, true)) === 'NO_GAME_SELECTED');

  check('host picks game + rounds', (await settings(host, { gameId: 'tap-race', totalRounds: 5 })).ok);
  check('everyone sees the settings', await until(bob, (s) => s.settings.gameId === 'tap-race' && s.settings.totalRounds === 5));

  // ---- ready + countdown ----
  await ready(host, true);
  await sleep(100);
  check('countdown does NOT start until everyone is ready', bob.latest?.phase === 'lobby' && bob.latest.readyIds.length === 1);
  await ready(bob, true);
  check('countdown starts when the last player readies', await until(host, (s) => s.phase === 'countdown'));
  const cd = host.latest!;
  const remaining = cd.countdownEndsAt! - cd.serverTime;
  check('countdown end is ~COUNTDOWN_MS after the server timestamp', remaining > COUNTDOWN_MS - 150 && remaining <= COUNTDOWN_MS);

  // ---- cancel by un-ready, and no stale timer fires afterwards ----
  await ready(bob, false);
  check('un-ready cancels the countdown', await until(host, (s) => s.phase === 'lobby' && s.countdownEndsAt === null));
  await sleep(COUNTDOWN_MS + 250);
  check('a cancelled countdown never turns into "playing"', host.latest?.phase === 'lobby');

  // ---- restart, finish ----
  await ready(bob, true);
  check('countdown restarts after re-ready', await until(host, (s) => s.phase === 'countdown'));
  check('countdown finishes and the game phase begins', await until(host, (s) => s.phase === 'playing', COUNTDOWN_MS + 1000));
  check('everyone moves to "playing" together', await until(bob, (s) => s.phase === 'playing'));

  // ---- mid-game rules ----
  const late = await guest('Late');
  check('cannot join a room mid-game', errorOf(await join(late, A.code)) === 'GAME_IN_PROGRESS');
  check('settings are locked mid-game', errorOf(await settings(host, { totalRounds: 3 })) === 'WRONG_PHASE');
  check('only the host can return to lobby', errorOf(await backToLobby(bob)) === 'NOT_HOST');
  check('host returns everyone to lobby; Ready cleared, settings kept',
    (await backToLobby(host)).ok && await until(bob, (s) => s.phase === 'lobby' && s.readyIds.length === 0 && s.settings.totalRounds === 5));

  // ---- what cancels a running countdown ----
  const B = await makeRoom(2);
  await Promise.all(B.players.map((p) => ready(p, true)));
  await until(B.host, (s) => s.phase === 'countdown');
  await settings(B.host, { totalRounds: 7 });
  check('host changing settings cancels the countdown and clears Ready',
    await until(B.players[1], (s) => s.phase === 'lobby' && s.readyIds.length === 0 && s.settings.totalRounds === 7));

  const C = await makeRoom(2);
  await Promise.all(C.players.map((p) => ready(p, true)));
  await until(C.host, (s) => s.phase === 'countdown');
  const newcomer = await guest('Newcomer');
  await join(newcomer, C.code);
  check('a new (unready) player joining cancels the countdown',
    await until(C.host, (s) => s.phase === 'lobby' && s.players.length === 3 && s.readyIds.length === 2));
  await ready(newcomer, true);
  check('countdown restarts once the newcomer is ready', await until(C.host, (s) => s.phase === 'countdown'));
  newcomer.socket.close();
  check('a ready player leaving does NOT cancel while enough ready players remain',
    await until(C.host, (s) => s.players.length === 2) && C.host.latest?.phase === 'countdown');
  check('...and that countdown still finishes', await until(C.host, (s) => s.phase === 'playing', COUNTDOWN_MS + 1000));

  const D = await makeRoom(2);
  await Promise.all(D.players.map((p) => ready(p, true)));
  await until(D.host, (s) => s.phase === 'countdown');
  D.players[1].socket.close();
  check('dropping below the minimum players cancels the countdown',
    await until(D.host, (s) => s.players.length === 1 && s.phase === 'lobby' && s.countdownEndsAt === null));
  await sleep(COUNTDOWN_MS + 250);
  check('...and it stays cancelled', D.host.latest?.phase === 'lobby');

  const E = await makeRoom(1);
  await ready(E.host, true);
  await sleep(150);
  check('a lone ready player does not start a countdown (needs 2 players)', E.host.latest?.phase === 'lobby');
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}
console.log(failures === 0 ? '\nAll lobby checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
