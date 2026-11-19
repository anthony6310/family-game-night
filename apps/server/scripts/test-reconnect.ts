/**
 * Refreshing the page does not kick you out (real socket clients):  npm run test:reconnect -w @fgn/server
 * A dropped connection holds the seat for a grace period; the same guest (by their signed token) reconnecting and asking for `room:rejoin` gets it back; otherwise they leave.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

const GRACE_MS = 600;
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpServer = createGameServer('http://localhost:5173', { reconnectGraceMs: GRACE_MS, onRound: () => {}, onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
const open: Client[] = [];

/** A guest connection; resolves with the socket, its signed token and the latest room state it was told of. */
async function connect(name: string, guestToken?: string) {
  const socket: Client = io(url, { auth: { guestName: name, guestToken }, forceNew: true });
  open.push(socket);
  const info = { socket, token: '' as string, state: null as RoomState | null, replaced: false };
  socket.on('guest:token', (t) => { info.token = t; });
  socket.on('room:state', (s) => { info.state = s; });
  socket.on('session:replaced', () => { info.replaced = true; });
  await new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); });
  await sleep(50);
  return info;
}
const ask = <T,>(socket: Client, send: (ack: (res: Ack<T>) => void) => void) => new Promise<Ack<T>>((resolve) => send(resolve));

const host = await connect('Host');
const made = await ask<JoinResult>(host.socket, (ack) => host.socket.emit('room:create', ack));
if (!made.ok) throw new Error('create failed');
const code = made.data.room.code;
const guest = await connect('Guest');
const joined = await ask<JoinResult>(guest.socket, (ack) => guest.socket.emit('room:join', code, ack));
if (!joined.ok) throw new Error('join failed');
const guestId = joined.data.playerId;
check('a guest is given a signed identity token on connecting', guest.token.startsWith(guestId + '.'));

// 1. a refresh: the connection drops, the seat is held, the page reconnects with its token and asks to rejoin
guest.socket.disconnect();
await sleep(150);
const during = host.state!;
check('when a guest\'s connection drops they stay in the room, marked as reconnecting', during.players.some((p) => p.id === guestId) && during.offlineIds.includes(guestId));
const back = await connect('Guest', guest.token);
const rejoin = await ask<JoinResult>(back.socket, (ack) => back.socket.emit('room:rejoin', ack));
check('the same token is the same guest (same id)', rejoin.ok && rejoin.data.playerId === guestId);
check('rejoining puts them back in the same room with the seat held for them', rejoin.ok && rejoin.data.room.code === code && rejoin.data.room.players.length === 2);
await sleep(150);
check('everyone sees them back (no longer reconnecting)', host.state!.offlineIds.length === 0);
await sleep(GRACE_MS + 300);
check('and the old grace timer does not remove them later', host.state!.players.some((p) => p.id === guestId));

// 2. a second tab (or the refreshed page arriving first) takes over; the old connection is closed and does not count as leaving
const second = await connect('Guest', guest.token);
await sleep(100);
check('a second connection for the same guest closes the old one with a notice', back.replaced === true);
const taken = await ask<JoinResult>(second.socket, (ack) => second.socket.emit('room:rejoin', ack));
await sleep(GRACE_MS + 300);
check('the takeover does not remove the guest from the room', taken.ok && host.state!.players.some((p) => p.id === guestId) && host.state!.offlineIds.length === 0);

// 3. they do not come back: after the grace period they leave
second.socket.disconnect();
await sleep(150);
check('a dropped guest is held (reconnecting) during the grace period', host.state!.offlineIds.includes(guestId));
await sleep(GRACE_MS + 300);
check('after the grace period without coming back they have left the room', !host.state!.players.some((p) => p.id === guestId));

// 4. someone with no seat has nothing to rejoin; a forged token is a new guest
const stranger = await connect('Nobody', 'guest_00000000-0000-0000-0000-000000000000.forged');
const none = await ask<JoinResult>(stranger.socket, (ack) => stranger.socket.emit('room:rejoin', ack));
check('a connection with no seat gets NOT_IN_ROOM when it asks to rejoin', !none.ok && none.error === 'NOT_IN_ROOM');
check('a forged token does not give someone else\'s identity (they get their own new signed token)', stranger.token !== '' && !stranger.token.startsWith('guest_00000000'));

// 5. the host dropping keeps the host role during the grace period
const g2 = await connect('Guest2');
await ask<JoinResult>(g2.socket, (ack) => g2.socket.emit('room:join', code, ack));
host.socket.disconnect();
await sleep(150);
check('the host keeps the host role while they are reconnecting', g2.state!.hostId === made.data.playerId && g2.state!.offlineIds.includes(made.data.playerId));
await sleep(GRACE_MS + 300);
check('if the host does not come back the next player is made host', g2.state!.hostId === g2.state!.players[0].id && g2.state!.players.length === 1);

open.forEach((s) => s.disconnect());
httpServer.close();
console.log(failures === 0 ? '\nAll reconnect checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
