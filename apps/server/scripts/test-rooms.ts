/**
 * Exercises MVP 2 end to end with real socket clients against an in-process server:
 *   npm run test:rooms -w @fgn/server
 * Covers: handshake auth (account JWT / guest / bad input), create+join, live updates,
 * host reassignment, the 8-player cap, and room cleanup.
 */
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, RoomState, ServerToClientEvents } from '@fgn/shared';
import { createGameServer } from '../src/server';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: pub } = process.env;
if (!url || !secret || !pub) throw new Error('Missing Supabase env vars in apps/server/.env');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

// ---- tiny helpers ----
const httpServer = createGameServer('http://localhost:5173');
await new Promise<void>((r) => httpServer.listen(0, r)); // port 0 = pick any free port
const serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

const connect = (auth: object) =>
  new Promise<Client>((resolve, reject) => {
    const s: Client = io(serverUrl, { auth, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });
const rejected = (auth: object) => connect(auth).then((s) => { s.close(); return false; }, () => true);
const create = (s: Client) => new Promise<Ack<JoinResult>>((r) => s.emit('room:create', r));
const join = (s: Client, code: string) => new Promise<Ack<JoinResult>>((r) => s.emit('room:join', code, r));
const nextState = (s: Client) => new Promise<RoomState>((r) => s.once('room:state', r));
const guest = (name: string) => connect({ guestName: name });

// Creates a real account (confirmed) and returns a valid access token for it.
const userIds: string[] = [];
async function makeAccount(label: string, withProfile: boolean) {
  const email = `rooms-${label}-${Date.now()}@example.com`;
  const password = 'Test-pass-1234';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userIds.push(data.user.id);
  if (withProfile) await admin.from('profiles').update({ display_name: 'Ada', avatar_url: '/avatars/fox.svg' }).eq('id', data.user.id);
  const client = createClient(url!, pub!, opts);
  const { data: s } = await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, token: s.session!.access_token };
}

const sockets: Client[] = [];
try {
  // ---- handshake ----
  check('empty guest name is rejected', await rejected({ guestName: '   ' }));
  check('forged token is rejected', await rejected({ token: 'not.a.jwt' }));
  const incomplete = await makeAccount('incomplete', false);
  check('account without a finished profile is rejected', await rejected({ token: incomplete.token }));

  // ---- create + join ----
  const host = await guest('Host'); sockets.push(host);
  const made = await create(host);
  const code = made.ok ? made.data.room.code : '';
  check('create returns a 4-char code with the creator as host', made.ok && /^[A-Z2-9]{4}$/.test(code) && made.data.room.hostId === made.data.playerId);
  check('creating a second room while in one is rejected', (await create(host)).ok === false);

  check('joining an unknown code fails', (await join(await guest('Lost').then((s) => (sockets.push(s), s)), 'ZZZZ')).ok === false);

  const bob = await guest('Bob'); sockets.push(bob);
  const hostUpdate = nextState(host);
  const bobJoin = await join(bob, code.toLowerCase()); // lowercase on purpose: codes are case-insensitive
  check('guest joins using a lowercase code', bobJoin.ok && bobJoin.data.room.players.length === 2);
  check('host is notified live when someone joins', (await hostUpdate).players.length === 2);

  // ---- account player: identity comes from the DB, not the client ----
  const acct = await makeAccount('ada', true);
  const ada = await connect({ token: acct.token }); sockets.push(ada);
  const adaJoin = await join(ada, code);
  const adaPlayer = adaJoin.ok ? adaJoin.data.room.players.find((p) => p.id === acct.id) : undefined;
  check('account joins with name+avatar from the database', adaPlayer?.name === 'Ada' && adaPlayer.avatarUrl === '/avatars/fox.svg' && adaPlayer.isGuest === false);

  const adaTab2 = await connect({ token: acct.token }); sockets.push(adaTab2);
  check('same account in a second tab cannot join twice', (await join(adaTab2, code)).ok === false);
  adaTab2.close();
  await new Promise((r) => setTimeout(r, 100));
  // The real proof: after the rejected tab closes, Ada must still be in the room.
  const probe = await guest('Probe'); sockets.push(probe);
  const probeJoin = await join(probe, code);
  check('closing the rejected tab does not evict the first one', probeJoin.ok && probeJoin.data.room.players.some((p) => p.id === acct.id));

  // ---- cap of 8 ----
  for (let i = 5; i <= 8; i++) { // Host, Bob, Ada, Probe are in; four more makes 8
    const s = await guest(`P${i}`); sockets.push(s);
    await join(s, code);
  }
  const ninth = await guest('Ninth'); sockets.push(ninth);
  const full = await join(ninth, code);
  check('9th person is let in, but as a watcher (all 8 playing slots are taken)', full.ok && full.data.room.watchingIds.includes(full.data.playerId) && full.data.room.watchingIds.length === 1);

  // ---- host reassignment ----
  await new Promise((r) => setTimeout(r, 150)); // let the 9th person's join broadcast arrive first, so we catch the NEXT state
  const bobSees = nextState(bob);
  host.close(); // the host disconnects
  const after = await bobSees;
  check('host leaving promotes the longest-present player', bobJoin.ok && after.hostId === bobJoin.data.playerId && after.players.length === 8); // 7 players + the watcher

  // ---- cleanup of empty rooms ----
  const solo = await guest('Solo'); sockets.push(solo);
  const soloRoom = await create(solo);
  solo.emit('room:leave');
  await new Promise((r) => setTimeout(r, 100));
  const late = await guest('Late'); sockets.push(late);
  check('empty rooms are deleted', soloRoom.ok && (await join(late, soloRoom.data.room.code)).ok === false);
} finally {
  sockets.forEach((s) => s.close());
  await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  httpServer.close();
}
console.log(failures === 0 ? '\nAll room checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
