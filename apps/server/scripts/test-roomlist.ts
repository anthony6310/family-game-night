/**
 * Rooms found in a list, with names and passwords:  npm run test:roomlist -w @fgn/server
 * The room manager is driven directly; the last part uses real sockets for the rate limits.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_ROOM_NAME, MAX_PLAYERS, MAX_ROOMS, MAX_SPECTATORS, ROOM_NAME_MAX, ROOM_PASSWORD_MAX, type Ack, type ClientToServerEvents, type JoinResult, type Player, type RoomListing, type ServerToClientEvents } from '@fgn/shared';
import { cleanName, RoomManager } from '../src/rooms';
import { createGameServer } from '../src/server';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
const err = (r: { ok: boolean; error?: string }) => (r.ok ? 'none' : r.error);
const made = (r: ReturnType<RoomManager['create']>) => { if (!r.ok) throw new Error('create failed: ' + r.error); return r.room.code; };

// ---- names ----
check('the default room name is "Game Room"', DEFAULT_ROOM_NAME === 'Game Room');
{
  const rooms = new RoomManager({ countdownMs: 0 });
  const plain = rooms.create(player('a'));
  check('a room made with no options is called "Game Room" and has no password', plain.ok && plain.room.name === 'Game Room' && !plain.room.hasPassword);
  const named = rooms.create(player('b'), { name: '  Grandma\'s   place  ' });
  check('a name is kept, with its spaces tidied', named.ok && named.room.name === "Grandma's place");
  check('an empty or non-text name falls back to the default', cleanName('   ') === DEFAULT_ROOM_NAME && cleanName(42) === DEFAULT_ROOM_NAME && cleanName(undefined) === DEFAULT_ROOM_NAME && cleanName({}) === DEFAULT_ROOM_NAME);
  check('a long name is cut to the limit', cleanName('x'.repeat(100)).length === ROOM_NAME_MAX);
  check('control and direction-changing characters are removed', cleanName('A\u0000B‮C​D\n') === 'ABCD');
  check('markup is just text (it is only ever drawn as plain text)', cleanName('<img src=x onerror=alert(1)>') === '<img src=x onerror=alert(1)>');
}

// ---- passwords ----
{
  const rooms = new RoomManager({ countdownMs: 0 });
  const code = made(rooms.create(player('host'), { name: 'Secret', password: 'hunter2' }));
  const state = rooms.stateOf(code)!;
  check('a room with a password says so', state.hasPassword === true);
  check('...but the password (or its hash) is never in anything sent out', !JSON.stringify(state).includes('hunter2') && !JSON.stringify(state).toLowerCase().includes('hash') && !JSON.stringify(rooms.list()).includes('hunter2'));
  check('joining with no password is refused', err(rooms.join(code, player('g1'))) === 'WRONG_PASSWORD');
  check('a wrong password is refused', err(rooms.join(code, player('g1'), 'nope')) === 'WRONG_PASSWORD');
  check('a password that is not text is refused', err(rooms.join(code, player('g1'), { password: 'hunter2' })) === 'WRONG_PASSWORD' && err(rooms.join(code, player('g1'), 12345)) === 'WRONG_PASSWORD');
  check('a huge "password" is refused without being checked', err(rooms.join(code, player('g1'), 'x'.repeat(ROOM_PASSWORD_MAX + 1))) === 'WRONG_PASSWORD');
  check('the right password lets you in', rooms.join(code, player('g1'), 'hunter2').ok);
  check('a room with NO password lets anyone in, even if a password is sent', rooms.join(made(rooms.create(player('open'))), player('g2'), 'whatever').ok);
  check('a password that is too long can\'t be set', err(rooms.create(player('x'), { password: 'p'.repeat(ROOM_PASSWORD_MAX + 1) })) === 'INVALID_SETTING');
}
{
  // guessing is slowed down: too many wrong passwords on one room and even the right one is refused for a while
  const rooms = new RoomManager({ countdownMs: 0 });
  const code = made(rooms.create(player('host'), { password: 'right' }));
  for (let i = 0; i < 12; i++) rooms.join(code, player(`g${i}`), 'wrong');
  check('after 12 wrong guesses the room refuses more attempts for a minute', err(rooms.join(code, player('late'), 'right')) === 'TOO_MANY_ATTEMPTS');
}

// ---- the list ----
{
  const rooms = new RoomManager({ countdownMs: 0 });
  const a = made(rooms.create(player('hostA'), { name: 'First', password: 'pw' }));
  const b = made(rooms.create(player('hostB'), { name: 'Second' }));
  rooms.setSettings('hostB', { gameId: 'fishing' });
  const list = rooms.list();
  check('the list has every room, with only public information', list.length === 2 && list.every((r) => Object.keys(r).sort().join() === ['capacity', 'code', 'full', 'gameName', 'hasPassword', 'hostName', 'members', 'name', 'phase'].sort().join()));
  const first = list.find((r) => r.code === a)!;
  check('...a locked room shows a lock, its host and its member count', first.name === 'First' && first.hasPassword && first.hostName === 'hostA' && first.members === 1 && first.capacity === MAX_PLAYERS + MAX_SPECTATORS && !first.full);
  check('...and the game the host picked', list.find((r) => r.code === b)!.gameName === 'Fishing');
  // fill room B up: it moves to the end of the list
  for (let i = 0; i < MAX_PLAYERS + MAX_SPECTATORS - 1; i++) rooms.join(b, player(`m${i}`));
  const after = rooms.list();
  check('a full room is marked full and listed after the open ones', after[after.length - 1].code === b && after[after.length - 1].full && err(rooms.join(b, player('one-too-many'))) === 'ROOM_FULL');
  rooms.close('hostA');
  check('a closed room leaves the list', rooms.list().every((r) => r.code !== a));
}

// ---- the host changes the name and password ----
{
  const rooms = new RoomManager({ countdownMs: 0 });
  const code = made(rooms.create(player('host')));
  rooms.join(code, player('guest'));
  check('the host can rename the room', rooms.setSettings('host', { name: 'Friday Night' }).ok && rooms.stateOf(code)!.name === 'Friday Night');
  check('...and clearing the name goes back to "Game Room"', rooms.setSettings('host', { name: '' }).ok && rooms.stateOf(code)!.name === 'Game Room');
  check('...and add a password', rooms.setSettings('host', { password: 'abc' }).ok && rooms.stateOf(code)!.hasPassword);
  check('...which new people then need', err(rooms.join(code, player('late'))) === 'WRONG_PASSWORD' && rooms.join(code, player('late'), 'abc').ok);
  check('...and remove it again', rooms.setSettings('host', { password: null }).ok && !rooms.stateOf(code)!.hasPassword && rooms.join(code, player('later')).ok);
  check('only the host can change them', err(rooms.setSettings('guest', { name: 'Hijacked' })) === 'NOT_HOST' && err(rooms.setSettings('guest', { password: 'x' })) === 'NOT_HOST');
  check('a bad password (too long) is refused and changes nothing', err(rooms.setSettings('host', { password: 'p'.repeat(ROOM_PASSWORD_MAX + 1) })) === 'INVALID_SETTING' && !rooms.stateOf(code)!.hasPassword);
}

// ---- the cap on rooms ----
{
  const rooms = new RoomManager({ countdownMs: 0 });
  for (let i = 0; i < MAX_ROOMS; i++) rooms.create(player(`h${i}`));
  check(`the server holds at most ${MAX_ROOMS} rooms`, err(rooms.create(player('one-more'))) === 'TOO_MANY_ROOMS');
}

// ---- over real sockets: the list, and the rate limits ----
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const httpServer = createGameServer('http://localhost:5173', { countdownMs: 50, onRound: () => {}, onSession: () => {} });
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
const sockets: Client[] = [];
async function guest(name: string): Promise<Client> {
  const socket: Client = io(url, { auth: { guestName: name }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  return socket;
}
const create = (s: Client, options?: { name?: string; password?: string }) => new Promise<Ack<JoinResult>>((r) => (options ? s.emit('room:create', options, r) : s.emit('room:create', r)));
const join = (s: Client, code: string, password?: string) => new Promise<Ack<JoinResult>>((r) => s.emit('room:join', password === undefined ? code : { code, password }, r));
const list = (s: Client) => new Promise<Ack<RoomListing[]>>((r) => s.emit('rooms:list', r));
try {
  const host = await guest('Host');
  const made1 = await create(host, { name: 'Socket Room', password: 'pw' });
  const code = made1.ok ? made1.data.room.code : '';
  check('over sockets: a room made with a name and a password has them', made1.ok && made1.data.room.name === 'Socket Room' && made1.data.room.hasPassword);
  const other = await guest('Other');
  const listed = await list(other);
  check('someone else, not in any room, can see it in the list', listed.ok && listed.data.some((r) => r.code === code && r.name === 'Socket Room' && r.hasPassword && r.hostName === 'Host'));
  check('a wrong password is refused over sockets', (await join(other, code, 'bad')).ok === false);
  check('the right one is not (a few wrong ones do not lock you out)', (await join(other, code, 'pw')).ok);
  other.emit('room:leave');
  // too many wrong passwords from one connection address: then even a correct one is refused
  const attacker = await guest('Attacker');
  let last: Ack<JoinResult> = { ok: true, data: null as never };
  for (let i = 0; i < 9; i++) last = await join(attacker, code, `guess${i}`);
  check('after 8 wrong passwords from one address the next attempt is refused outright', !last.ok && last.error === 'TOO_MANY_ATTEMPTS');
  const later = await join(attacker, code, 'pw');
  check('...even with the right password, for a while', !later.ok && later.error === 'TOO_MANY_ATTEMPTS');
  // making rooms too fast
  let tooMany = false;
  for (let i = 0; i < 8 && !tooMany; i++) {
    const s = await guest(`Maker${i}`);
    const r = await create(s);
    if (!r.ok && r.error === 'TOO_MANY_ROOMS') tooMany = true;
  }
  check('making rooms is limited (6 in 10 minutes from one address)', tooMany);
} finally {
  sockets.forEach((s) => s.close());
  httpServer.close();
}

console.log(failures === 0 ? '\nAll room-list checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
