// Frog Climb engine rules (no sockets). Run: npx tsx scripts/test-frog.ts
import { CLIMB_COOLDOWN_MS, CLIMB_STEP, OBSTACLE_DROP, POLE_TOP, POLE_WORLD_HEIGHT, SLIP_DROP, SLIP_RESET, SWAP_COOLDOWN_MS, bendStress, frogDeflection, leanRate, obstaclesFor, poleCurve, worldY } from '@fgn/shared';
import { createFrogClimb } from '../src/games/frogClimb';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const eng = createFrogClimb({ durationMs: 30_000, seed: 4242 });
const T0 = 1_000_000;
const act = (s: ReturnType<typeof eng.init>, who: string, type: 'climb' | 'swap', now: number) => eng.reduce(s, who, { type }, now);
const tickTo = (s: ReturnType<typeof eng.init>, from: number, to: number) => { for (let t = from; t < to; t += 25) eng.tick!(s, 0.025, t + 25); };

let s = eng.init(['a', 'b'], T0);
act(s, 'a', 'climb', T0 - 100);
check('nothing before the start', s.players.a.h === 0);
act(s, 'a', 'climb', T0 + 10);
check('a climb hops up one step', s.players.a.h === CLIMB_STEP && s.players.b.h === 0);
act(s, 'a', 'climb', T0 + 10 + CLIMB_COOLDOWN_MS - 20);
check('no climbing during the cooldown', s.players.a.h === CLIMB_STEP);
act(s, 'a', 'climb', T0 + 10 + CLIMB_COOLDOWN_MS + 5);
check('climbs again after the cooldown', s.players.a.h === 2 * CLIMB_STEP);
const side: number = s.players.a.side;
act(s, 'a', 'swap', T0 + 2000);
check('swap flips the side, with its own cooldown', s.players.a.side === (side === 1 ? -1 : 1) && s.players.a.readyAt === T0 + 2000 + SWAP_COOLDOWN_MS);
act(s, 'a', 'climb', T0 + 2000 + 100);
check('no climbing right after a swap', s.players.a.h === 2 * CLIMB_STEP);
act(s, 'x', 'climb', T0 + 5000); act(s, 'a', { type: 'fly' } as never, T0 + 5000);
check('a stranger or a bad action changes nothing', s.players.a.h === 2 * CLIMB_STEP);

// the lean builds toward the frog's side, faster when higher
s = eng.init(['a'], T0); s.players.a.side = 1;
tickTo(s, T0, T0 + 1000);
check('lean builds toward the frog side at the bottom rate', Math.abs(s.players.a.lean - leanRate(0)) < 0.02);
s = eng.init(['a'], T0); s.players.a.side = 1; s.players.a.h = POLE_TOP - 2;
tickTo(s, T0, T0 + 1000);
check('lean builds faster near the top', s.players.a.lean > leanRate(0) * 2);
s = eng.init(['a'], T0); s.players.a.side = 1; s.players.a.lean = 0.5;
act(s, 'a', 'swap', T0 + 10); tickTo(s, T0 + 10, T0 + 1010);
check('swapping turns the lean round', (s.players.a.side as number) === -1 && s.players.a.lean < 0.5 - 0.1);

// over-bending slips the frog down and springs the pole back
s = eng.init(['a'], T0); s.players.a.side = -1; s.players.a.h = 40; s.players.a.lean = -0.99;
tickTo(s, T0, T0 + 200);
check('over-bending drops the frog and resets the lean', s.players.a.h === 40 - SLIP_DROP && Math.abs(s.players.a.lean - -SLIP_RESET) < 0.1 && s.players.a.slipAt > 0);
s = eng.init(['a'], T0); s.players.a.h = 2; s.players.a.side = 1; s.players.a.lean = 0.99; tickTo(s, T0, T0 + 200);
check('a slip never goes below the ground', s.players.a.h === 0);
s = eng.init(['a'], T0); s.players.a.side = 1; s.players.a.lean = -0.99; s.players.a.h = 10;
tickTo(s, T0, T0 + 100);
check('lean at the far side is no danger yet', s.players.a.h === 10);


// THE FIRST-HOP BUG: the pole must never swing far sideways because a low frog is pushed a little
for (const lean of [0.3, 0.6, 1, -1]) for (const h of [2, 4, 10, 30, 70, POLE_TOP]) {
  const a = worldY(h), d = frogDeflection(h, lean), tip = poleCurve(POLE_WORLD_HEIGHT + 5, a, d).x;
  if (Math.abs(tip) > 28) check(`the pole tip stays near the middle (lean ${lean}, height ${h}: tip ${tip.toFixed(1)})`, false);
}
check('a low frog barely bends the pole, a high one bends it a lot', Math.abs(poleCurve(POLE_WORLD_HEIGHT, worldY(2), frogDeflection(2, 0.9)).x) < 3 && Math.abs(frogDeflection(POLE_TOP, 1)) > 10);

check('stress is nothing at a gentle lean, rises with the bend, and is 1 at the limit', bendStress(0.3) === 0 && bendStress(0.7) > 0 && bendStress(0.9) > bendStress(0.7) && bendStress(-1) === 1);

// OBSTACLES
const obs = obstaclesFor(4242);
check('obstacles start about 30% of the way up, are few, and never at the very top', obs.length >= 3 && obs.length <= 6 && obs[0].y0 >= POLE_TOP * 0.3 && obs[0].y0 <= POLE_TOP * 0.3 + 6 && obs[obs.length - 1].y1 <= POLE_TOP - 4);
const gaps = obs.slice(1).map((o, i) => o.y0 - obs[i].y1), len = obs.map((o) => o.y1 - o.y0);
check('they get closer together with height, have 2 to 5 thorns, and the hitbox is taller for more thorns', gaps[0] > gaps[gaps.length - 1] && obs.every((o) => o.thorns >= 2 && o.thorns <= 5 && o.y1 - o.y0 === o.thorns + 2));
{ // any count can appear anywhere, but big ones are likelier higher up (measured over many seeds)
  let lo = 0, hi = 0, nlo = 0, nhi = 0; const seen = new Set<number>();
  for (let sd = 1; sd <= 200; sd++) { const l = obstaclesFor(sd); lo += l[0].thorns; nlo++; hi += l[l.length - 1].thorns; nhi++; l.forEach((o) => seen.add(o.thorns)); }
  check('thorn counts vary (all of 2 to 5 turn up) and are higher near the top', seen.size === 4 && hi / nhi > lo / nlo + 0.8);
}
check('every player faces the same obstacles for a seed, and another seed differs', JSON.stringify(obstaclesFor(4242)) === JSON.stringify(obs) && JSON.stringify(obstaclesFor(1)) !== JSON.stringify(obs));
const o0 = obs[0];
s = eng.init(['a', 'b'], T0); s.players.a.side = o0.side; s.players.a.h = o0.y0 - 2; s.players.a.lean = 0;
act(s, 'a', 'climb', T0 + 100);
check('climbing into a vine on your side makes you fall below it', s.players.a.h < o0.y0 && s.players.a.h >= o0.y0 - 1 - OBSTACLE_DROP && s.players.a.slipAt === T0 + 100);
act(s, 'a', 'climb', T0 + 100 + CLIMB_COOLDOWN_MS + 5);
check('and is stunned for a moment (no climb right away)', s.players.a.h < o0.y0 && s.players.a.readyAt >= T0 + 100 + 350);
s = eng.init(['a'], T0); s.players.a.side = (o0.side === 1 ? -1 : 1); s.players.a.h = o0.y0 - 2;
act(s, 'a', 'climb', T0 + 100); act(s, 'a', 'climb', T0 + 500); act(s, 'a', 'climb', T0 + 900);
check('on the other side you climb straight past it', s.players.a.h === o0.y0 - 2 + 3 * CLIMB_STEP);
s = eng.init(['a'], T0); s.players.a.side = (o0.side === 1 ? -1 : 1); s.players.a.h = o0.y0 + 1;
act(s, 'a', 'swap', T0 + 100);
check('swapping onto a vine you are level with is a hit', s.players.a.side === o0.side && s.players.a.h < o0.y0);
s = eng.init(['a'], T0); s.players.a.side = o0.side; s.players.a.h = o0.y0 + 3; s.players.a.lean = o0.side * 0.999;
tickTo(s, T0, T0 + 100);
check('a slip that lands inside a vine is moved just below it', s.players.a.h < o0.y0);

// the first to the top wins at once
s = eng.init(['a', 'b'], T0); s.players.a.h = POLE_TOP - CLIMB_STEP; s.players.b.h = 80;
act(s, 'a', 'climb', T0 + 100);
check('reaching the top ends the round with that winner', eng.isOver(s, T0 + 100) && eng.getWinner(s) === 'a' && s.players.a.finishedAt === T0 + 100);
act(s, 'b', 'climb', T0 + 200);
check('nothing counts after the round is decided', s.players.b.h === 80);
// time cap
s = eng.init(['a', 'b'], T0);
check('no one climbing: a draw, ends at the cap', eng.getWinner(s) === null && !eng.isOver(s, T0 + 1000) && eng.isOver(s, T0 + 30_000));
s.players.a.h = 30; s.players.b.h = 20;
check('at the cap the highest frog wins', eng.getWinner(s) === 'a');
s.players.b.h = 30;
check('equal heights are a draw', eng.getWinner(s) === null);
check('scores are the heights', eng.scores(s).a === 30);
eng.removePlayer(s, 'b');
check('a leaving player is dropped', !('b' in s.players) && !('b' in (eng.view(s) as { players: object }).players));
const v = eng.view(s) as unknown as { players: { a: { h: number } } }; v.players.a.h = 99;
check('the view is a copy', s.players.a.h === 30);
console.log(failed === 0 ? '\nAll Frog Climb checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
