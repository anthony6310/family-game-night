/**
 * The round is made at the start of the loading step and its clock is set when every phone has it on screen:  npm run test:pending -w @fgn/server
 *  1. moving a game's clock (`shiftTimes`) gives exactly the state a LATER `init` would have, for every game (this is what lets the round be created early and moved);
 *  2. the room rules: during 'starting' the round exists with a provisional GO, nobody can act and nothing ticks; the last `setLoaded` (or the deadline) announces ONE reveal moment
 *     (REVEAL_LEAD_MS ahead) and GO exactly one intro after it, for everyone; offline phones are not waited for; a one-against-all game draws its sides when the round is made.
 */
import { deepStrictEqual } from 'node:assert';
import { GAME_INTRO_COUNT_SECONDS, GAME_INTRO_HOLD_SECONDS, REVEAL_LEAD_MS, STARTING_MAX_MS, type Player } from '@fgn/shared';
import { createAdoptionDay } from '../src/games/adoptionDay';
import { createFishing } from '../src/games/fishing';
import { createFrogClimb } from '../src/games/frogClimb';
import { createMountainGoat } from '../src/games/mountainGoat';
import { createPenguinLasso } from '../src/games/penguinLasso';
import { createPirateBroadside } from '../src/games/pirateBroadside';
import { createRoachHunt } from '../src/games/roachHunt';
import { createSantaSack } from '../src/games/santaSack';
import { shiftTimes } from '../src/games/shiftTime';
import { createSnowball } from '../src/games/snowball';
import { createSnowflakeMatch } from '../src/games/snowflakeMatch';
import { createTapRace } from '../src/games/tapRace';
import { createTugOfWar } from '../src/games/tugOfWar';
import type { GameEngine } from '../src/games/types';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

// ---- 1. shifting == a later init, for every game ----
// (some engines keep `Math.random` as it is when they are built, so a delegating stand-in is put in BEFORE they are made)
const realRandom = Math.random;
let currentRandom: () => number = realRandom;
Math.random = () => currentRandom();
const engines = {
  'pirate-broadside': createPirateBroadside({}), 'roach-hunt': createRoachHunt({}), 'adoption-day': createAdoptionDay({ random: Math.random }), 'frog-climb': createFrogClimb({}), 'mountain-goat': createMountainGoat({}),
  'snowflake-match': createSnowflakeMatch({}), 'tap-race': createTapRace(30_000), 'tug-of-war': createTugOfWar(30_000), snowball: createSnowball({ random: Math.random }), 'santa-sack': createSantaSack({}),
  'penguin-lasso': createPenguinLasso({ random: Math.random }), fishing: createFishing({}),
};
const seededRandom = () => { let a = 12345; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
/** (A state may hold a function, snowball's terrain does: two inits make two different but equal functions, so they are compared as markers.) */
const plain = (v: unknown): unknown => typeof v === 'function' ? '[function]' : Array.isArray(v) ? v.map(plain) : v instanceof Map ? new Map([...v].map(([k, x]) => [k, plain(x)])) : v instanceof Set ? new Set([...v].map(plain)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
const T = 1_800_000_000_000, DELTA = -9_876;
for (const [id, engine] of Object.entries(engines) as [string, GameEngine][]) {
  for (const n of [2, 4]) {
    const ids = ['a', 'b', 'c', 'd'].slice(0, n);
    const teams = { teams: { a: 'yellow', b: 'purple', c: 'yellow', d: 'purple' } as never };
    currentRandom = seededRandom(); const early = engine.init(ids, T, teams);
    currentRandom = seededRandom(); const later = engine.init(ids, T + DELTA, teams);
    currentRandom = realRandom;
    let same = true;
    try { deepStrictEqual(plain(shiftTimes(early, DELTA)), plain(later)); deepStrictEqual(plain(engine.view(shiftTimes(early, DELTA))), plain(engine.view(later))); } catch (e) { same = false; console.log(String(e).slice(0, 400)); }
    check(`${id} (${n} players): moving the clock equals a later init`, same);
  }
}
check('shiftTimes leaves small numbers, strings and the input alone', (() => { const s = { n: 5, t: T, s: 'x', m: new Map([['k', T]]) }; const out = shiftTimes(s, 10); return out.n === 5 && out.t === T + 10 && out.s === 'x' && out.m.get('k') === T + 10 && s.t === T; })());

// ---- 2. the room rules ----
const INTRO = (GAME_INTRO_HOLD_SECONDS + GAME_INTRO_COUNT_SECONDS) * 1000;
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
/** A room of `n` players, everyone ready, run by hand (no timers here) into the 'starting' step with its minimum time already over. */
function loading(n: number, gameId: 'tap-race' | 'roach-hunt' | 'snowball' = 'tap-race') {
  const rooms = new RoomManager({ countdownMs: 5, startingMs: 1, introMs: INTRO });
  const made = rooms.create(player('a'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  const ids = ['a', 'b', 'c', 'd'].slice(0, n);
  ids.slice(1).forEach((id) => rooms.join(code, player(id)));
  rooms.setSettings('a', { gameId });
  let last = null as ReturnType<RoomManager['setReady']> | null;
  for (const id of ids) last = rooms.setReady(id, true);
  if (!last || !last.ok || last.room.countdownEndsAt === null) throw new Error('no countdown');
  const inStarting = rooms.finishCountdown(code, last.room.countdownEndsAt)!;
  rooms.finishStarting(code, inStarting.startingEndsAt!);
  return { rooms, code, ids, first: inStarting };
}
const state = (rooms: RoomManager, code: string) => { const r = rooms.stateOf(code); if (!r) throw new Error('no room'); return r; };
const go = (s: { game: unknown }) => (s.game as { startsAt: number }).startsAt;
const end = (s: { game: unknown }) => (s.game as { endsAt: number }).endsAt;

{
  const { rooms, code, ids, first } = loading(3);
  check('the round is made when the loading step begins (phones get the real game to build)', first.phase === 'starting' && first.game !== null && first.revealAt === null);
  check('...with a provisional GO, the latest it could be (deadline + reveal lead + intro)', Math.abs(go(first) - (Date.now() + STARTING_MAX_MS + REVEAL_LEAD_MS + INTRO)) < 1000);
  check('...nobody can act', rooms.gameAction('a', { type: 'tap' } as never) === null);
  rooms.setLoaded(ids[0]!); rooms.setLoaded(ids[1]!);
  check('two of three have the game on screen: still loading', state(rooms, code).phase === 'starting');
  const before = Date.now();
  rooms.setLoaded(ids[2]!);
  const s1 = state(rooms, code);
  check('the last phone reports: the round begins', s1.phase === 'playing' && s1.startingDeadline === null);
  check('...with ONE reveal moment for everyone, REVEAL_LEAD_MS ahead', s1.revealAt !== null && s1.revealAt >= before + REVEAL_LEAD_MS && s1.revealAt <= Date.now() + REVEAL_LEAD_MS);
  check('...and GO exactly one intro after the reveal', go(s1) === s1.revealAt! + INTRO);
  check('...the round keeps the same roundId (the screens must not be rebuilt)', s1.roundId === first.roundId);
  check('...and the round end moved with GO (same length as before)', end(s1) - go(s1) === end(first) - go(first));
  check('an action before GO is still ignored', rooms.gameAction('a', { type: 'tap' } as never) === null);
  check('a late report after the round began is refused and harmless', !rooms.setLoaded('a').ok && state(rooms, code).phase === 'playing');
}
{
  const { rooms, code } = loading(2, 'snowball');
  check('a game with a tick loop does not move during the loading step', !rooms.tick(Date.now() + STARTING_MAX_MS * 3).some((r) => r.code === code));
}
{
  const { rooms, code, first } = loading(2);
  check('a stale deadline does nothing', rooms.forceStarting(code, first.startingDeadline! + 1) === null && state(rooms, code).phase === 'starting');
  const forced = rooms.forceStarting(code, first.startingDeadline!)!;
  check('the deadline begins the round even though nobody reported, with the same reveal rule', forced.phase === 'playing' && forced.revealAt !== null && go(forced) === forced.revealAt + INTRO);
}
{
  const { rooms, code, ids } = loading(3);
  rooms.setLoaded(ids[0]!); rooms.setLoaded(ids[1]!);
  rooms.leave(ids[2]!);
  check('the one it was waiting for leaves: the rest are not held up', state(rooms, code).phase === 'playing');
}
{
  const { rooms, code, ids } = loading(3);
  rooms.setLoaded(ids[0]!); rooms.setLoaded(ids[1]!);
  rooms.setOffline(ids[2]!);
  check('the one it was waiting for drops offline: the rest are not held up', state(rooms, code).phase === 'playing');
}
{
  const { rooms, code, ids, first } = loading(3, 'roach-hunt');
  const purple = ids.filter((id) => first.teams[id] === 'purple');
  check('a one-against-all game draws its sides when the round is made (one lone player, the rest together)', purple.length === 1 && ids.filter((id) => first.teams[id] === 'yellow').length === 2);
  rooms.leave(purple[0]!);
  const s = state(rooms, code);
  check('...and the lone player leaving while it loads calls the round off', s.phase === 'lobby' && s.game === null);
}
{
  const rooms = new RoomManager({ countdownMs: 5 }); // (no flash step, as in every other test: no wait)
  const made = rooms.create(player('a')); if (!made.ok) throw new Error('x');
  rooms.join(made.room.code, player('b')); rooms.setSettings('a', { gameId: 'tap-race' });
  rooms.setReady('a', true); const r = rooms.setReady('b', true);
  if (!r.ok || r.room.countdownEndsAt === null) throw new Error('no countdown');
  const started = rooms.finishCountdown(made.room.code, r.room.countdownEndsAt);
  check('without a flash step the round starts at once (revealed now)', started !== null && started.phase === 'playing' && started.revealAt !== null && Math.abs(started.revealAt - Date.now()) < 100);
}

console.log(failures === 0 ? 'All pending-start checks passed.' : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
