/**
 * The Random tile and its roulette step (room manager only, no sockets):  npm run test:random -w @fgn/server
 * The host picks Random: no game yet. Everyone readies up, the countdown ends, the server picks a game and the room goes to the 'roulette' phase (everyone watches
 * the carousel spin onto it); when that ends the round starts as usual. After the round the Random tile is still chosen and the next round rolls again.
 */
import { ACTIVE_GAMES, GAMES, RANDOM_GAME, type Player } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });

const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, rouletteMs: 5000, startingMs: 0, introMs: 0, forceRandom: null }); // (forceRandom null: these tests check the real Random rules, whatever the temporary switch in rooms.ts says)
const made = rooms.create(player('A'));
if (!made.ok) throw new Error('create failed');
const code = made.room.code;
rooms.join(code, player('B'));
const state = () => rooms.stateOf(code)!;

check('a new room starts with Random selected: no game rolled yet', state().settings.gameId === null && state().settings.random === true && state().roulette === null);
check('only the host can change the pick', !rooms.setSettings('B', { gameId: 'tap-race' }).ok && state().settings.random);
check('the host can pick a game instead, and Random again', rooms.setSettings('A', { gameId: 'tap-race' }).ok && !state().settings.random && state().settings.gameId === 'tap-race');
check('the host picks Random: nothing is rolled yet (no game until everyone is ready)', rooms.setSettings('A', { gameId: RANDOM_GAME }).ok && state().settings.random === true && state().settings.gameId === null);
check('players can ready up with Random chosen', rooms.setReady('A', true).ok && rooms.setReady('B', true).ok && state().phase === 'countdown');
const first = state();
rooms.finishCountdown(code, first.countdownEndsAt!);
const s1 = state();
check('when the countdown ends the room goes to the roulette step, with the chosen game and when the spin ends', s1.phase === 'roulette' && s1.roulette !== null && GAMES.some((g) => g.id === s1.roulette!.gameId && !(g as { teams?: boolean }).teams) && s1.roulette.endsAt - s1.roulette.startsAt === 5000);
check('the game the roulette lands on is the game that is played', s1.settings.gameId === s1.roulette!.gameId);
check('a stale roulette timer does nothing', rooms.finishRoulette(code, s1.roulette!.endsAt + 1) === null && state().phase === 'roulette');
check('settings cannot be changed during the roulette', !rooms.setSettings('A', { gameId: 'tap-race' }).ok);
rooms.finishRoulette(code, s1.roulette!.endsAt);
check('when the roulette ends the round starts as usual', state().phase === 'playing' && state().game?.gameId === s1.roulette!.gameId && state().roulette === null);

// after the round: still Random, no game chosen, ready again for a new roll
rooms.returnToLobby('A');
check('back in the lobby the Random tile is still chosen but no game is: the next round rolls again', state().phase === 'lobby' && state().settings.random === true && state().settings.gameId === null);

// leaving during the roulette calls the round off when too few players remain
rooms.setReady('A', true); rooms.setReady('B', true);
rooms.finishCountdown(code, state().countdownEndsAt!);
check('(a second round: in the roulette again)', state().phase === 'roulette');
rooms.leave('B');
check('a player leaving during the roulette calls it off when too few remain', state().phase === 'lobby');

// over many rolls every game comes up, and picking a game by hand clears the random mark
const seen = new Set<string>();
const many = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, rouletteMs: 1000, startingMs: 0, introMs: 0, forceRandom: null }); // (forceRandom null: these tests check the real Random rules, whatever the temporary switch in rooms.ts says)
const m = many.create(player('X')); if (!m.ok) throw new Error('create failed');
many.join(m.room.code, player('Y'));
for (let i = 0; i < 80; i++) {
  many.setSettings('X', { gameId: RANDOM_GAME }); many.setReady('X', true); many.setReady('Y', true);
  many.finishCountdown(m.room.code, many.stateOf(m.room.code)!.countdownEndsAt!);
  seen.add(many.stateOf(m.room.code)!.settings.gameId!);
  many.returnToLobby('X');
}
const normal = ACTIVE_GAMES.filter((g) => !(g as { teams?: boolean }).teams);
check('over many rolls every ordinary game comes up, and a team game never does (teams need their own lobby step: GAME_RULES.md #17)', seen.size === normal.length && !seen.has('tug-of-war'));
check('an archived game (Snowball) never comes up either', !seen.has('snowball') && !ACTIVE_GAMES.some((g) => g.id === 'snowball') && normal.length > 0);
many.setSettings('X', { gameId: 'tap-race' });
check('picking a game by hand clears the random mark', many.stateOf(m.room.code)!.settings.gameId === 'tap-race' && many.stateOf(m.room.code)!.settings.random === false);
check('an unknown game is still refused', !many.setSettings('X', { gameId: 'nope' as never }).ok);

console.log(failures === 0 ? '\nAll Random-tile checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
