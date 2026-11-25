/**
 * The Tug of War engine (no sockets):  npm run test:tug -w @fgn/server
 */
import type { TugOfWarView } from '@fgn/shared';
import { createTugOfWar } from '../src/games/tugOfWar';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const e = createTugOfWar(15_000);
const st0 = e.init(['a', 'b', 'c'], 1000, { teams: { a: 'yellow', b: 'purple', c: 'purple' } });
const view = (s: Parameters<typeof e.view>[0]) => e.view(s) as TugOfWarView;
check('the view says who is on which team', view(st0).teams.a === 'yellow' && view(st0).gameId === 'tug-of-war');
check('both teams start from zero', view(st0).totals.yellow === 0 && view(st0).totals.purple === 0);
let st = e.reduce(st0, 'a', { type: 'tap' }, 1100);
st = e.reduce(st, 'b', { type: 'tap' }, 1100);
st = e.reduce(st, 'c', { type: 'tap' }, 1100);
st = e.reduce(st, 'c', { type: 'tap' }, 1200);
check('every tap counts for the player\'s team: yellow 1, purple 3', view(st).totals.yellow === 1 && view(st).totals.purple === 3);
check('a player\'s own taps are in the scores (the room adds up the teams and the head start)', e.scores(st).a === 1 && e.scores(st).c === 2);
check('taps closer together than 40 ms are ignored (auto-clickers)', e.reduce(st, 'a', { type: 'tap' }, 1110).taps.a === 1);
check('taps before the start and after the end are ignored', e.reduce(st, 'a', { type: 'tap' }, 900).taps.a === 1 && e.reduce(st, 'a', { type: 'tap' }, 16_100).taps.a === 1);
check('a non-player cannot tap, and the round is over only at the end time', e.reduce(st, 'z', { type: 'tap' }, 1500) === st && !e.isOver(st, 5000) && e.isOver(st, 16_000));
const gone = e.removePlayer(st, 'c');
check('a player who leaves takes their taps with them', view(gone).totals.purple === 1 && !('c' in gone.taps));
check('the engine names no single winner (the room picks the winning team)', e.getWinner(st) === null);

console.log(failures === 0 ? '\nAll Tug of War checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
