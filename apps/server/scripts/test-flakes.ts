// Snowflake Match engine rules (no sockets). Run: npx tsx scripts/test-flakes.ts
import {
  DESIGN_COUNT, FLAKE_COUNT, FLAKE_LANES, FLAKE_PICK_GAP_MS, FLAKE_RADIUS_FRAC, HAND_SIZE, HAND_SWAP_MS, POOL_SIZE,
  decodeDesign, designDistance, flakeLane, flakeOnScreen, flakePose, makePool, type SnowflakeMatchView,
} from '@fgn/shared';
import { createSnowflakeMatch } from '../src/games/snowflakeMatch';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const eng = createSnowflakeMatch({ durationMs: 30_000, seed: 4242 });
const T0 = 1_000_000;
type S = ReturnType<typeof eng.init>;
const pick = (s: S, who: string, flake: number, at: number, now = at) => eng.reduce(s, who, { type: 'pick', flake, at }, now);
const pose = (s: S, who: string, i: number, t: number) => { const f = s.players[who].flakes[i]; return flakePose(i, f.born, f.lane, t); };
/** a time at which flake i of this player's field is on the screen */
const onScreenAt = (s: S, who: string, i: number, from = T0) => { for (let t = from; t < from + 40_000; t += 50) if (flakeOnScreen(pose(s, who, i, t).ny)) return t; return -1; };
const matching = (s: S, who: string) => s.players[who].flakes.findIndex((f) => s.players[who].hand.includes(f.design));
const nonMatching = (s: S, who: string) => s.players[who].flakes.findIndex((f) => !s.players[who].hand.includes(f.design));

// designs
const pool = makePool(7);
check('a pool of distinct designs, every two differing in at least two features', pool.length === POOL_SIZE && new Set(pool).size === POOL_SIZE && pool.every((a, i) => pool.every((b, j) => i === j || designDistance(a, b) >= 2)));
check('the pool is repeatable from its seed and differs between seeds', JSON.stringify(makePool(7)) === JSON.stringify(pool) && JSON.stringify(makePool(8)) !== JSON.stringify(pool));
check('designs decode to distinct recipes', DESIGN_COUNT === 324 && Array.from({ length: DESIGN_COUNT }, (_, i) => JSON.stringify(decodeDesign(i))).every((v, i, a) => a.indexOf(v) === i));

// the fields and the hands
let s = eng.init(['a', 'b'], T0);
check('a full field; every design in the pool is falling at least once', s.players.a.flakes.length === FLAKE_COUNT && s.pool.every((d) => s.players.a.flakes.some((f) => f.design === d)));
check('the flake count fits the lanes (3 more than a multiple), so wrapping flakes stay clear', FLAKE_COUNT % FLAKE_LANES === 3);
check('every flake is already somewhere on its way down at the start (and during the countdown)', s.players.a.flakes.every((_, i) => pose(s, 'a', i, T0 - 5000).ny > -0.1 && pose(s, 'a', i, T0).ny > -0.1));
check('everyone starts with the very same field', JSON.stringify(s.players.a.flakes) === JSON.stringify(s.players.b.flakes) && s.players.a.flakes !== s.players.b.flakes);
check('each player holds one design from the pool', ['a', 'b'].every((id) => s.players[id].hand.length === HAND_SIZE && HAND_SIZE === 1 && s.pool.includes(s.players[id].hand[0])));
check('a flake wraps to the top and moves over one lane', (() => { const f = s.players.a.flakes[0]; const a = flakePose(0, f.born, f.lane, T0 + 1000), b = flakePose(0, f.born, f.lane, T0 + 1000 + 9300); return a.lap + 1 === b.lap && flakeLane(f.lane, b.lap) !== flakeLane(f.lane, a.lap); })());

// OVERLAP: flakes may brush each other now and then (that is fine) but must not pile up. On a narrow phone (0.46 as wide as it is tall), "noticeable" = overlapping by more than a quarter of a flake.
const overlaps = (st: S, t: number, depth: number) => {
  let n = 0;
  for (let i = 0; i < FLAKE_COUNT; i++) for (let j = i + 1; j < FLAKE_COUNT; j++) {
    const a = pose(st, 'a', i, t), b = pose(st, 'a', j, t);
    if (!flakeOnScreen(a.ny) || !flakeOnScreen(b.ny)) continue;
    if (Math.hypot((a.nx - b.nx) * 0.46, a.ny - b.ny) < 2 * FLAKE_RADIUS_FRAC * depth) n++;
  }
  return n;
};
let worst = 0;
for (let t = T0 - 5000; t < T0 + 60_000; t += 100) worst = Math.max(worst, overlaps(s, t, 0.9));
check('untouched, flakes never overlap at all', worst === 0);
/** a player who matches every `gapMs` for a minute: the share of moments with a noticeable overlap, the respawn count, and how often NO flake matching the hand was on the screen */
const playMinute = (gapMs: number, players = 1) => {
  const ids = Array.from({ length: players }, (_, i) => 'a' + (i ? i : ''));
  const e = createSnowflakeMatch({ durationMs: 120_000 }), st = e.init(['a', ...ids.slice(1)], T0);
  let respawns = 0, bad = 0, samples = 0, blind = 0, t = T0;
  for (let step = 0; step < 60_000 / 50; step++) {
    t += 50;
    for (const who of ['a', ...ids.slice(1)]) {
      if (t % gapMs >= 50) continue;
      const m = matching(st, who);
      if (m >= 0 && flakeOnScreen(pose(st, who, m, t).ny)) { const before = st.players[who].points; e.reduce(st, who, { type: 'pick', flake: m, at: t }, t); if (who === 'a' && st.players[who].points > before) respawns++; }
    }
    samples++;
    if (!st.players.a.flakes.some((f, i) => st.players.a.hand.includes(f.design) && flakeOnScreen(pose(st, 'a', i, t).ny))) blind++;
    if (step % 2 === 0 && overlaps(st, t, 0.75) > 0) bad++;
  }
  return { respawns, share: bad / (samples / 2), blind: blind / samples };
};
const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
const fast = Array.from({ length: 24 }, () => playMinute(1500)), quick = Array.from({ length: 12 }, () => playMinute(600)); // (many rounds: a few rounds are always worse than the rest, and that is fine; the average is what counts)
check(`a good player (a match every 1.5 s, ~${fast[0].respawns} respawns): noticeable overlaps are rare (${(100 * avg(fast.map((x) => x.share))).toFixed(1)}% of moments)`, fast[0].respawns > 20 && avg(fast.map((x) => x.share)) < 0.05);
check(`even a match every 0.6 s (~${quick[0].respawns} respawns) overlaps noticeably only now and then (${(100 * avg(quick.map((x) => x.share))).toFixed(1)}% of moments)`, quick[0].respawns > 60 && avg(quick.map((x) => x.share)) < 0.1);

// WHY THE FIELDS ARE SEPARATE: with other players matching, you are never left with nothing to tap more often than when you play alone
const alone = Array.from({ length: 8 }, () => playMinute(2000, 1)), crowd = Array.from({ length: 8 }, () => playMinute(2000, 8));
check(`with 7 other players matching, flakes to tap are still rarely missing (${(100 * avg(crowd.map((x) => x.blind))).toFixed(1)}% of the time, alone ${(100 * avg(alone.map((x) => x.blind))).toFixed(1)}%)`, avg(crowd.map((x) => x.blind)) < 0.04 && Math.abs(avg(crowd.map((x) => x.blind)) - avg(alone.map((x) => x.blind))) < 0.02);

// the next design in a hand is one that can be SEEN when it is shown (a flake of it well on the screen at that moment)
{
  let good = 0, total = 0;
  for (let run = 0; run < 40; run++) {
    const e = createSnowflakeMatch({ durationMs: 120_000 }), st = e.init(['a'], T0);
    let t = T0 + 2000;
    for (let k = 0; k < 12; k++) {
      t += 1500;
      const m = matching(st, 'a');
      if (m < 0 || !flakeOnScreen(pose(st, 'a', m, t).ny)) continue;
      const before = st.players.a.points; e.reduce(st, 'a', { type: 'pick', flake: m, at: t }, t);
      if (st.players.a.points === before) continue;
      total++;
      const shownAt = t + HAND_SWAP_MS, d = st.players.a.hand[0];
      if (st.players.a.flakes.some((f, i) => f.design === d && flakePose(i, f.born, f.lane, shownAt).ny >= 0.08 && flakePose(i, f.born, f.lane, shownAt).ny <= 0.8)) good++;
    }
  }
  check(`the new hand design has a flake well on screen when it is shown (${good} of ${total})`, total > 200 && good / total > 0.9);
}

// picks
s = eng.init(['a', 'b'], T0);
pick(s, 'a', 0, T0 - 500, T0 - 500);
check('nothing before the start', s.players.a.points === 0);
let m = matching(s, 'a'), t = onScreenAt(s, 'a', m);
const handBefore = [...s.players.a.hand], bornBefore = s.players.a.flakes[m].born, fieldB = JSON.stringify(s.players.b.flakes);
pick(s, 'a', m, t);
check('a match is a point, the flake falls again from the top (after a short wait out of sight at most), the hand gets a different design', s.players.a.points === 1 && s.players.a.flakes[m].born >= t && s.players.a.flakes[m].born <= t + 900 && s.players.a.flakes[m].born !== bornBefore && s.players.a.hand.length === 1 && s.players.a.hand[0] !== handBefore[0] && s.pool.includes(s.players.a.hand[0]));
check("another player's field, hand and points are untouched by it", s.players.b.points === 0 && JSON.stringify(s.players.b.flakes) === fieldB);
check('the new hand design is in the field (always something to match)', s.players.a.flakes.some((f) => f.design === s.players.a.hand[0]));
// the hand is swapping its snowflake: any pick in the next HAND_SWAP_MS (a match or a wrong one) is ignored, with no penalty
{
  const ts = t + 100, anyOnScreen = s.players.a.flakes.findIndex((_, i) => flakeOnScreen(pose(s, 'a', i, ts).ny)), before = s.players.a.points;
  pick(s, 'a', anyOnScreen, ts);
  check('while the hand swaps its snowflake, picks do nothing (no point, no penalty)', anyOnScreen >= 0 && s.players.a.points === before);
}
// both players can match "the same" flake: each has their own
s = eng.init(['a', 'b'], T0);
const same = s.players.a.flakes.findIndex((f) => f.design === s.players.a.hand[0] && s.players.b.hand.includes(f.design));
if (same >= 0) { const ts = onScreenAt(s, 'a', same); pick(s, 'a', same, ts); pick(s, 'b', same, ts + 10); check('two players can both match the same flake: each has their own', s.players.a.points === 1 && s.players.b.points === 1); }

// wrong picks cost a point, never below zero
s = eng.init(['a', 'b'], T0);
let w = nonMatching(s, 'a'); t = onScreenAt(s, 'a', w);
pick(s, 'a', w, t);
check('a wrong tap at zero points stays at zero', s.players.a.points === 0);
m = matching(s, 'a'); const tm = Math.max(onScreenAt(s, 'a', m, t + 200), t + 200); pick(s, 'a', m, tm);
w = nonMatching(s, 'a'); const tw = Math.max(onScreenAt(s, 'a', w, tm + HAND_SWAP_MS + 100), tm + HAND_SWAP_MS + 100);
const p1 = s.players.a.points; pick(s, 'a', w, tw);
check('a wrong tap costs a point', p1 === 1 && s.players.a.points === 0);

// throttle, bad input, off screen, lag, end
s = eng.init(['a'], T0);
m = matching(s, 'a'); t = onScreenAt(s, 'a', m);
pick(s, 'a', m, t);
pick(s, 'a', matching(s, 'a'), t + FLAKE_PICK_GAP_MS - 20);
check('rapid picks are throttled', s.players.a.points === 1);
pick(s, 'a', 99, t + 1500); pick(s, 'a', -1, t + 1600); pick(s, 'a', 1.5, t + 1700);
check('bad flake numbers do nothing', s.players.a.points === 1);
s = eng.init(['a'], T0);
const offAt = (() => { const mm = matching(s, 'a'); for (let tt = T0; tt < T0 + 60_000; tt += 50) if (!flakeOnScreen(pose(s, 'a', mm, tt).ny)) return tt; return -1; })();
pick(s, 'a', matching(s, 'a'), offAt);
check('a flake that is off the screen cannot be picked', s.players.a.points === 0);
s = eng.init(['a'], T0); m = matching(s, 'a'); t = onScreenAt(s, 'a', m);
pick(s, 'a', m, t, t + 250);
check('a tap 250 ms old (lag) counts', s.players.a.points === 1);
s = eng.init(['a'], T0); m = matching(s, 'a');
pick(s, 'a', m, T0 + 31_000);
check('no picks after the end', s.players.a.points === 0 && eng.isOver(s, T0 + 30_000) && !eng.isOver(s, T0 + 29_000));

// winners
s = eng.init(['a', 'b'], T0);
check('no points: a draw', eng.getWinner(s) === null);
s.players.a.points = 3; s.players.b.points = 3;
check('level on points: a draw', eng.getWinner(s) === null);
s.players.b.points = 4;
check('most matches wins', eng.getWinner(s) === 'b' && eng.scores(s).b === 4);
eng.removePlayer(s, 'b');
check('leaving removes the player', (eng.view(s) as SnowflakeMatchView).players.b === undefined);
check('view is a copy', (() => { const v = eng.view(s) as SnowflakeMatchView; v.players.a.flakes[0].design = -1; v.players.a.hand[0] = -1; return s.players.a.flakes[0].design !== -1 && s.players.a.hand[0] !== -1; })());

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
