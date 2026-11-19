/**
 * Player colors (room manager only, no sockets):  npm run test:colors -w @fgn/server
 * Everyone in a room has their own color from the 16 in PLAYER_COLORS; they can change it to one nobody else has.
 */
import { MAX_PLAYERS, MAX_SPECTATORS, PLAYER_COLORS, type Player } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? 'none' : r.error);

const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0 });
const made = rooms.create(player('A'));
if (!made.ok) throw new Error('create failed');
const code = made.room.code;
for (const id of ['B', 'C']) rooms.join(code, player(id));
const colors = () => rooms.stateOf(code)!.colors;

check('there are 16 colors to pick from, all different', PLAYER_COLORS.length === 16 && new Set(PLAYER_COLORS).size === 16);
check('a room never holds more people than there are colors', MAX_PLAYERS + MAX_SPECTATORS === PLAYER_COLORS.length);
check('each member starts with a color: the first free one, in order', colors().A === PLAYER_COLORS[0] && colors().B === PLAYER_COLORS[1] && colors().C === PLAYER_COLORS[2]);
check('everyone in the room is told every color (it is in the room state)', Object.keys(colors()).length === 3);

check('a player can pick a color nobody has', rooms.setColor('B', PLAYER_COLORS[10]).ok && colors().B === PLAYER_COLORS[10]);
check('a color someone else has is refused', errorOf(rooms.setColor('C', PLAYER_COLORS[0])) === 'COLOR_TAKEN' && colors().C === PLAYER_COLORS[2]);
check('picking the color you already have is fine', rooms.setColor('A', PLAYER_COLORS[0]).ok);
check('a color that is not in the list is refused', errorOf(rooms.setColor('A', '#123456')) === 'INVALID_COLOR');
check('the color B gave up is free for someone else', rooms.setColor('C', PLAYER_COLORS[1]).ok && colors().C === PLAYER_COLORS[1]);

rooms.leave('C');
check("a leaver's color is freed", !('C' in colors()));
rooms.join(code, player('D'));
check('the next person to join gets the first free color (the one C left)', colors().D === PLAYER_COLORS[1]);

// colors cannot change under a round that is running
rooms.setSettings('A', { gameId: 'tap-race' });
rooms.setReady('A', true); rooms.setReady('B', true); rooms.setReady('D', true);
const state = rooms.stateOf(code)!;
rooms.finishCountdown(code, state.countdownEndsAt!);
check('colors cannot be changed once a round has started', errorOf(rooms.setColor('A', PLAYER_COLORS[15])) === 'WRONG_PHASE');
check('and they are unchanged by the round', colors().A === PLAYER_COLORS[0] && colors().B === PLAYER_COLORS[10]);

// a full room of 16
const full = new RoomManager();
const f = full.create(player('p0'));
if (!f.ok) throw new Error('create failed');
for (let i = 1; i < 16; i++) full.join(f.room.code, player(`p${i}`));
const all = Object.values(full.stateOf(f.room.code)!.colors);
check('a full room of 16 has 16 different colors', all.length === 16 && new Set(all).size === 16);

console.log(failures === 0 ? '\nAll color checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
