// Mountain Goats engine rules (no sockets). Run: npx tsx scripts/test-goat.ts
import { type MountainGoatView, BIRD_FROM, birdAt, birdCollision, judgeJump, FALL_MS, JUMP_MS, LAG_MAX_MS, LEN_MAX, LEN_MIN, gapAt, indicatorLen, periodAt, tolAt } from '@fgn/shared';
import { createMountainGoat } from '../src/games/mountainGoat';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const eng = createMountainGoat({ durationMs: 30_000, seed: 12345 });
const T0 = 1_000_000;
const jump = (s: ReturnType<typeof eng.init>, who: string, at: number, now = at) => eng.reduce(s, who, { type: 'jump', at }, now);
/** the time (since the indicator started) at which the marker is exactly on the next ledge, for the jump from platform n: on the way out */
const goodSince = (n: number) => ((gapAt(12345, n) - LEN_MIN) / (LEN_MAX - LEN_MIN)) * (periodAt(n) * 1000) / 2;

check('indicator sweeps out and back', indicatorLen(0, 0) === LEN_MIN && Math.abs(indicatorLen(0, periodAt(0) * 500) - LEN_MAX) < 1e-6 && Math.abs(indicatorLen(0, periodAt(0) * 1000) - LEN_MIN) < 1e-6);
check('same ledges every time for a seed', gapAt(7, 3) === gapAt(7, 3) && gapAt(7, 3) !== gapAt(8, 3));

let s = eng.init(['a', 'b'], T0);
jump(s, 'a', T0 + goodSince(0) - 1000 * 5, T0 - 100);
check('nothing before the start', s.players.a.jumps === 0 && s.players.a.last === null);

jump(s, 'a', T0 + goodSince(0));
check('a perfect tap lands: a point, goat in the air for JUMP_MS', s.players.a.jumps === 1 && s.players.a.last!.ok && Math.abs(s.players.a.armedAt - (s.players.a.last!.at + JUMP_MS)) < 1);
const a1 = s.players.a.armedAt;
jump(s, 'a', a1 - 50, a1 - 50 + 200);
check('a tap while in the air does nothing', s.players.a.jumps === 1);
check('the other goat is unaffected', s.players.b.jumps === 0 && s.players.b.last === null);

// the second jump: tap just inside and just outside the window
const tol = tolAt(1), speed = (LEN_MAX - LEN_MIN) / (periodAt(1) * 1000 / 2); // units per ms
s = eng.init(['a'], T0); jump(s, 'a', T0 + goodSince(0)); const arm = s.players.a.armedAt;
const g1 = goodSince(1);
jump(s, 'a', arm + g1 + (tol * 0.8) / speed);
check('inside the window lands', s.players.a.jumps === 2);
s = eng.init(['a'], T0); jump(s, 'a', T0 + goodSince(0)); const arm2 = s.players.a.armedAt;
jump(s, 'a', arm2 + g1 + (tol * 1.3) / speed);
check('outside the window falls: no point, climbs back for FALL_MS', s.players.a.jumps === 1 && !s.players.a.last!.ok && Math.abs(s.players.a.armedAt - (s.players.a.last!.at + FALL_MS)) < 1);
const fallAt = s.players.a.last!.at;
jump(s, 'a', fallAt + 300, fallAt + 300);
check('no jumping while climbing back', s.players.a.jumps === 1);

// lag: a claimed time in the past is believed up to LAG_MAX_MS; further back is clamped; the future is clamped to now
s = eng.init(['a'], T0);
const claim = T0 + goodSince(0);
jump(s, 'a', claim, claim + 250);
check('a tap 250 ms old (lag) counts at the time the phone says', s.players.a.jumps === 1 && s.players.a.last!.at === claim);
s = eng.init(['a'], T0);
jump(s, 'a', claim, claim + LAG_MAX_MS + 600);
check('a tap older than the lag limit is moved up to the limit', s.players.a.last !== null && s.players.a.last.at === claim + 600);
s = eng.init(['a'], T0);
jump(s, 'a', T0 + 99999, T0 + 500);
check('a time in the future is clamped to now', s.players.a.last === null || s.players.a.last.at === T0 + 500);

// throttle, end of the clock, winners
s = eng.init(['a', 'b'], T0);
jump(s, 'a', T0 + 500); const n0 = s.players.a.last!.at; jump(s, 'a', T0 + 520);
check('rapid taps are throttled', s.players.a.last!.at === n0);
jump(s, 'a', T0 + 31_000);
check('no taps after the end', s.players.a.last!.at === n0);
s = eng.init(['a', 'b'], T0);
check('no points: a draw', eng.getWinner(s) === null && !eng.isOver(s, T0 + 1000) && eng.isOver(s, T0 + 30_000));
s.players.a.jumps = 3; s.players.b.jumps = 3;
check('level on points: a draw', eng.getWinner(s) === null);
s.players.b.jumps = 4;
check('most ledges wins', eng.getWinner(s) === 'b' && eng.scores(s).b === 4);
eng.removePlayer(s, 'b');
check('leaving removes the goat', (eng.view(s) as MountainGoatView).players.b === undefined);
check('view is a copy', (() => { const v = eng.view(s) as MountainGoatView; v.players.a.jumps = 99; return s.players.a.jumps === 3; })());

// the bird: none early on; from BIRD_FROM it can block a leap that is otherwise on target
check('no bird on the early jumps', [0, 1, 2, 3].every((n) => birdAt(12345, n) === null) && BIRD_FROM === 4);
let birdN = -1, seedB = 0;
for (let sd = 1; sd < 200 && birdN < 0; sd++) if (birdAt(sd, 5)) { birdN = 5; seedB = sd; }
check('a later jump can have a bird (same bird for everyone)', birdN === 5 && JSON.stringify(birdAt(seedB, 5)) === JSON.stringify(birdAt(seedB, 5)));
const target = gapAt(seedB, 5);
const winOk = (since: number) => Math.abs(indicatorLen(5, since) - target) <= tolAt(5);
let hit = -1, clear = -1;
for (let ms = 0; ms < 40_000; ms += 5) if (winOk(ms)) { if (birdCollision(seedB, 5, ms) !== null) { if (hit < 0) hit = ms; } else if (clear < 0) clear = ms; }
check('with the marker on target the bird sometimes blocks and sometimes does not', hit >= 0 && clear >= 0);
check('judgeJump: on target but the bird is in the way is a fall', judgeJump(seedB, 5, hit, hit).ok === false && judgeJump(seedB, 5, hit, hit).birdU !== null && judgeJump(seedB, 5, clear, clear).ok === true);
const engB = createMountainGoat({ durationMs: 60_000, seed: seedB });
s = engB.init(['a'], T0); s.players.a.jumps = 5; // (armedAt = the round start, so the time since the marker started is also the round's elapsed time)
engB.reduce(s, 'a', { type: 'jump', at: T0 + hit }, T0 + hit);
check('engine: a bird hit is no point and a fall', s.players.a.jumps === 5 && !s.players.a.last!.ok && s.players.a.last!.birdU !== null && s.players.a.last!.since === hit && Math.abs(s.players.a.armedAt - (T0 + hit + FALL_MS)) < 1);
s = engB.init(['a'], T0); s.players.a.jumps = 5;
engB.reduce(s, 'a', { type: 'jump', at: T0 + clear }, T0 + clear);
check('engine: slipping past the bird lands', s.players.a.jumps === 6 && s.players.a.last!.ok && s.players.a.last!.birdU === null);
// a goat that leaps off target into the bird hits it too (it does not fly through)
let offHit = -1;
for (let ms = 0; ms < 40_000 && offHit < 0; ms += 5) if (!winOk(ms) && birdCollision(seedB, 5, ms, indicatorLen(5, ms)) !== null) offHit = ms;
check('leaping short or long into the bird is a collision too', offHit >= 0 && judgeJump(seedB, 5, offHit, offHit).ok === false && judgeJump(seedB, 5, offHit, offHit).birdU !== null);
check('the marker speed never changes', periodAt(0) === periodAt(30));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
