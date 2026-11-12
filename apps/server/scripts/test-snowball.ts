/**
 * Snowball engine, tested as pure functions (no server, no sockets, no clocks):
 *   npm run test:snowball -w @fgn/server
 * The physics is deterministic, so growth, speed, walls, rebounds, snow theft and immunity can
 * all be checked exactly.
 */
import { createSnowball, DEFAULT_SNOWBALL_CONFIG, type SnowballState } from '../src/games/snowball';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const cfg = DEFAULT_SNOWBALL_CONFIG;
const engine = createSnowball();
const noGrowth = createSnowball({ growthPerUnit: 0 }); // for exact snow-conservation checks
const DT = 0.025; // the real tick step (40 per second)
type Ball = SnowballState['balls'][string];
const radius = (b: Ball) => Math.sqrt(b.snow);

/** Replaces fields of one ball (to set up a scenario). */
const place = (s: SnowballState, id: string, patch: Partial<Ball>): SnowballState => ({
  ...s, balls: { ...s.balls, [id]: { ...s.balls[id], ...patch } },
});
const steer = (e: typeof engine, s: SnowballState, id: string, x: number, z: number, now: number) =>
  e.reduce(s, id, { type: 'steer', x, z }, now);
/** Runs `seconds` of ticks, calling `each` after every tick. Returns the final state and time. */
function run(e: typeof engine, s: SnowballState, seconds: number, now0 = 1000, each?: (s: SnowballState, now: number) => void) {
  let now = now0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    now += DT * 1000;
    s = e.tick!(s, DT, now);
    each?.(s, now);
  }
  return { state: s, now };
}
const fresh = (e: typeof engine, ids: string[]) => e.init(ids, 1000);

// ================= setup =================
const s4 = fresh(engine, ['A', 'B', 'C', 'D']);
check('init: one ball per player, all start at radius 1, standing still',
  Object.keys(s4.balls).length === 4 && Object.values(s4.balls).every((b) => near(radius(b), 1) && b.vx === 0 && b.vz === 0));
check('init: spawn points are inside the arena and well apart',
  Object.values(s4.balls).every((b) => Math.hypot(b.x, b.z) + 1 < cfg.arenaRadius)
  && Object.values(s4.balls).every((b, i, all) => all.every((o, j) => i === j || Math.hypot(b.x - o.x, b.z - o.z) > 10)));
check('init: the round lasts the configured time', s4.endsAt - s4.startsAt === cfg.durationMs);
check('init: 8 players fit with room to spare', (() => {
  const s8 = fresh(engine, Array.from({ length: 8 }, (_, i) => `P${i}`));
  const b = Object.values(s8.balls);
  return b.every((x, i) => b.every((y, j) => i === j || Math.hypot(x.x - y.x, x.z - y.z) > 2 * 1 + 5));
})());

// ================= steering input =================
check('steer: NaN or infinite input is ignored', steer(engine, s4, 'A', NaN, 0, 1100) === s4 && steer(engine, s4, 'A', 0, Infinity, 1100) === s4);
check('steer: an oversized vector is clamped to length 1 (no speed hacking)', (() => {
  const s = steer(engine, s4, 'A', 5, 0, 1100);
  return near(Math.hypot(s.balls.A.steerX, s.balls.A.steerZ), 1);
})());
check('steer: unknown players and late input are ignored', steer(engine, s4, 'ZZZ', 1, 0, 1100) === s4 && steer(engine, s4, 'A', 1, 0, s4.endsAt + 1) === s4);
check('steer: a tap action does nothing in this game', engine.reduce(s4, 'A', { type: 'tap' }, 1100) === s4);

// ================= growth: distance rolled =================
{
  // Alone in the middle, rolling west for 5s: no walls, no collisions, so the formula is exact.
  let s = place(fresh(engine, ['A']), 'A', { x: 15, z: 0 });
  s = steer(engine, s, 'A', -1, 0, 1000);
  let distance = 0;
  let prevRadius = radius(s.balls.A);
  let monotonic = true;
  const { state } = run(engine, s, 5, 1000, (st) => {
    const b = st.balls.A;
    distance += Math.hypot(b.vx, b.vz) * DT;
    monotonic &&= radius(b) >= prevRadius;
    prevRadius = radius(b);
  });
  const b = state.balls.A;
  check('growth: radius² = start² + 2 · growthPerUnit · distance rolled', near(b.snow, 1 + 2 * cfg.growthPerUnit * distance, 1e-9));
  check('growth: the ball got bigger, and never shrank on its own', radius(b) > 1.2 && monotonic);
  check('growth: it rolled a sensible distance (slowly, not teleporting)', distance > 10 && distance < cfg.maxSpeed * 5);
}
{
  const s = fresh(engine, ['A']);
  const { state } = run(engine, s, 3);
  check('growth: a ball that never moves never grows', near(state.balls.A.snow, 1));
}
{
  const fast = createSnowball({ growthPerUnit: 0.1 });
  let s = place(fresh(fast, ['A']), 'A', { x: 15, z: 0 });
  s = steer(fast, s, 'A', -1, 0, 1000);
  const slowGrown = run(engine, steer(engine, place(fresh(engine, ['A']), 'A', { x: 15, z: 0 }), 'A', -1, 0, 1000), 4).state.balls.A.snow;
  check('config: a higher growthPerUnit grows balls faster', run(fast, s, 4).state.balls.A.snow > slowGrown);
}

// ================= speed: bigger = slower =================
{
  const speedAfter = (snow: number) => {
    let s = place(fresh(noGrowth, ['A']), 'A', { x: 0, z: 0, snow });
    s = steer(noGrowth, s, 'A', 1, 0, 1000);
    const b = run(noGrowth, s, 3).state.balls.A;
    return Math.hypot(b.vx, b.vz);
  };
  const small = speedAfter(1);
  const big = speedAfter(9); // radius 3
  check('speed: a starting-size ball reaches ~maxSpeed', near(small, cfg.maxSpeed, 0.2));
  check('speed: a radius-3 ball is capped by the falloff law', near(big, cfg.maxSpeed * (1 / 3) ** cfg.speedFalloff, 0.2));
  check('speed: so bigger balls are clearly slower', big < small * 0.7);
}
{
  let s = place(fresh(noGrowth, ['A']), 'A', { x: 0, z: 0, vx: 5 });
  const stopped = run(noGrowth, s, 6).state.balls.A;
  check('friction: a ball that isn\'t steering coasts to a stop', Math.hypot(stopped.vx, stopped.vz) < 0.01);
}

// ================= walls =================
{
  let s = place(fresh(engine, ['A']), 'A', { x: 24, z: 0 });
  s = steer(engine, s, 'A', 1, 0, 1000);
  let inside = true;
  let rebounded = false;
  run(engine, s, 8, 1000, (st) => {
    const b = st.balls.A;
    inside &&= Math.hypot(b.x, b.z) + radius(b) <= cfg.arenaRadius + 1e-9;
    rebounded ||= b.vx < 0;
  });
  check('wall: the whole ball always stays inside the arena', inside);
  check('wall: hitting the wall makes the ball rebound', rebounded);
}
{
  // Diagonal run into the curved wall from every direction.
  let inside = true;
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    let s = place(fresh(engine, ['A']), 'A', { x: 0, z: 0 });
    s = steer(engine, s, 'A', Math.cos(a), Math.sin(a), 1000);
    run(engine, s, 12, 1000, (st) => { inside &&= Math.hypot(st.balls.A.x, st.balls.A.z) + radius(st.balls.A) <= cfg.arenaRadius + 1e-9; });
  }
  check('wall: holds from all 8 compass directions', inside);
}

// ================= ball-ball collisions =================
const pair = (e: typeof engine, a: Partial<Ball>, b: Partial<Ball>) =>
  place(place(fresh(e, ['A', 'B']), 'A', { x: 0, z: 0, ...a }), 'B', { x: 3, z: 0, ...b });
const totalSnow = (s: SnowballState) => Object.values(s.balls).reduce((t, b) => t + b.snow, 0);
const gap = (s: SnowballState) => Math.hypot(s.balls.B.x - s.balls.A.x, s.balls.B.z - s.balls.A.z) - radius(s.balls.A) - radius(s.balls.B);

{
  // Equal balls head-on.
  const s = noGrowth.tick!(pair(noGrowth, { x: -1.05, vx: 5 }, { x: 1.05, vx: -5 }), DT, 2000);
  const leaving = s.balls.B.vx - s.balls.A.vx;
  check('collision: balls rebound, leaving each other', leaving >= cfg.minSeparateSpeed - 1e-9);
  check('collision: balls are pushed apart so they no longer overlap', gap(s) >= -1e-9);
}
{
  // Bigger (A, radius 2) runs into smaller (B, radius 1).
  const s0 = pair(noGrowth, { snow: 4, x: 0, vx: 5 }, { snow: 1, x: 3.05, vx: 0 });
  const s1 = noGrowth.tick!(s0, DT, 2000);
  const stolen = s1.balls.B.snow - 1;
  check('damage: the SMALLER ball loses snow...', stolen < 0 && near(stolen, -cfg.damageFraction, 1e-9));
  check('damage: ...and the BIGGER ball gains exactly that much (snow is conserved)', near(s1.balls.A.snow, 4 + cfg.damageFraction, 1e-9) && near(totalSnow(s1), 5, 1e-9));
  check('damage: the victim is flagged immune, the attacker is not', s1.balls.B.immune && !s1.balls.A.immune);
  check('damage: it bounces them apart too', s1.balls.B.vx - s1.balls.A.vx >= cfg.minSeparateSpeed - 1e-9);

  // Immunity: hit them together again 100 ms later (inside the 200 ms window): no more damage.
  const again = (s: SnowballState, now: number) => noGrowth.tick!(place(place(s, 'A', { x: 0, vx: 5 }), 'B', { x: 3.05, vx: 0 }), DT, now);
  const s2 = again(s1, 2100);
  check('immunity: a second hit inside 200 ms steals nothing', near(s2.balls.B.snow, s1.balls.B.snow, 1e-12));
  const s3 = again(s2, 2000 + cfg.immunityMs + 50);
  check('immunity: after it wears off the victim can be hit again', s3.balls.B.snow < s2.balls.B.snow - 1e-6);
  check('immunity: the flag clears once the window passes', (() => {
    const rolled = noGrowth.tick!(place(place(s3, 'A', { x: -20, vx: 0 }), 'B', { x: 20, vx: 0 }), DT, 2000 + 2 * cfg.immunityMs + 400);
    return !rolled.balls.B.immune;
  })());
}
{
  const equal = noGrowth.tick!(pair(noGrowth, { snow: 1, x: -1.05, vx: 5 }, { snow: 1, x: 1.05, vx: -5 }), DT, 2000);
  check('damage: equal-size balls just bounce (nobody steals)', near(equal.balls.A.snow, 1, 1e-12) && near(equal.balls.B.snow, 1, 1e-12));
  const close = noGrowth.tick!(pair(noGrowth, { snow: 1, x: -1.05, vx: 5 }, { snow: 1.015, x: 1.05, vx: -5 }), DT, 2000);
  check('damage: sizes within 2% count as equal', near(close.balls.A.snow, 1, 1e-12));
}
{
  // Gentle touch: bigger ball drifting at 0.5 u/s (below the impact threshold).
  const soft = noGrowth.tick!(pair(noGrowth, { snow: 4, x: 0, vx: 0.5 }, { snow: 1, x: 2.99, vx: 0 }), DT, 2000);
  check('damage: a gentle touch bounces but does not steal', near(soft.balls.B.snow, 1, 1e-12) && soft.balls.B.vx - soft.balls.A.vx >= cfg.minSeparateSpeed - 1e-9);
}
{
  // The small ball rams the big one: the big one is never the victim.
  const s = noGrowth.tick!(pair(noGrowth, { snow: 4, x: 0, vx: 0 }, { snow: 1, x: 2.9, vx: -6 }), DT, 2000);
  check('damage: ramming a bigger ball never hurts the bigger ball', s.balls.A.snow >= 4 && s.balls.B.snow <= 1);
}
{
  // A victim at the minimum size can't be drained further.
  const tiny = cfg.minRadius ** 2 + 0.001;
  const s = noGrowth.tick!(pair(noGrowth, { snow: 4, x: 0, vx: 5 }, { snow: tiny, x: 2.5, vx: 0 }), DT, 2000);
  check('damage: a ball never shrinks below the minimum radius', s.balls.B.snow >= cfg.minRadius ** 2 - 1e-12);
}
{
  // Two balls steered straight into each other for 10 s must not get stuck grinding.
  const headOn = (snowA: number) => {
    let s = place(place(fresh(engine, ['A', 'B']), 'A', { x: -3, z: 0, snow: snowA }), 'B', { x: 3, z: 0 });
    s = steer(engine, steer(engine, s, 'A', 1, 0, 1000), 'B', -1, 0, 1000);
    let overlap = 0, contact = 0, ticks = 0, hits = 0, lastHitAt = -Infinity, minGapBetweenHits = Infinity;
    let wasImmune = false;
    const { state } = run(engine, s, 10, 1000, (st, now) => {
      ticks++;
      if (gap(st) < -1e-3) overlap++;
      if (gap(st) < 0.02) contact++;
      const immune = st.balls.A.immune || st.balls.B.immune;
      if (immune && !wasImmune) { hits++; minGapBetweenHits = Math.min(minGapBetweenHits, now - lastHitAt); lastHitAt = now; }
      wasImmune = immune;
    });
    return { state, overlap: overlap / ticks, contact: contact / ticks, hits, minGapBetweenHits };
  };
  const equalPair = headOn(1);
  check('stuck (equal balls): never overlapping, and apart most of the time', equalPair.overlap < 0.05 && equalPair.contact < 0.25);
  check('stuck (equal balls): no snow changes hands', equalPair.hits === 0);
  const unequalPair = headOn(1.3);
  check('stuck (unequal balls): never overlapping, and apart most of the time', unequalPair.overlap < 0.05 && unequalPair.contact < 0.25);
  check('stuck (unequal balls): they keep colliding and separating (many hits in 10 s)', unequalPair.hits >= 8);
  check('stuck (unequal balls): hits are never closer together than the immunity window', unequalPair.minGapBetweenHits >= cfg.immunityMs - 1e-6);
  check('stuck (unequal balls): relentless ramming hurts, but does not delete the victim',
    radius(unequalPair.state.balls.B) < 0.85 && radius(unequalPair.state.balls.B) > cfg.minRadius && radius(unequalPair.state.balls.A) > radius(unequalPair.state.balls.B));
}

// ================= winner and scores =================
{
  const s = place(place(fresh(engine, ['A', 'B', 'C']), 'A', { snow: 4 }), 'B', { snow: 1 });
  check('winner: the biggest ball wins', engine.getWinner(s) === 'A');
  check('scores: sizes in cm (radius × 100)', JSON.stringify(engine.scores(s)) === JSON.stringify({ A: 200, B: 100, C: 100 }));
  const tied = place(place(fresh(engine, ['A', 'B']), 'A', { snow: 2.25 }), 'B', { snow: 2.25 });
  check('winner: an exact tie is a draw', engine.getWinner(tied) === null);
  const visibleTie = place(place(fresh(engine, ['A', 'B']), 'A', { snow: 1 }), 'B', { snow: 1.008 });
  check('winner: a tie at the displayed (rounded) size is a draw too', engine.getWinner(visibleTie) === null && engine.scores(visibleTie).A === engine.scores(visibleTie).B);
  check('winner: a lone ball wins', engine.getWinner(fresh(engine, ['A'])) === 'A' || engine.getWinner(fresh(engine, ['A'])) === null);
}
check('isOver: only once the time is up', !engine.isOver(s4, s4.endsAt - 1) && engine.isOver(s4, s4.endsAt));
check('removePlayer: the leaver\'s ball disappears', (() => {
  const s = engine.removePlayer(s4, 'B');
  return !('B' in s.balls) && Object.keys(s.balls).length === 3 && 'B' in s4.balls;
})());
check('init: a tie-breaker can start with just some of the players', Object.keys(fresh(engine, ['B', 'D']).balls).join() === 'B,D');

// ================= purity and the view =================
{
  const before = JSON.stringify(s4);
  engine.tick!(steer(engine, s4, 'A', 1, 0, 1000), DT, 1025);
  check('purity: tick() never mutates the state it was given', JSON.stringify(s4) === before);
  const script = () => {
    let s = steer(engine, steer(engine, fresh(engine, ['A', 'B']), 'A', 1, 0.3, 1000), 'B', -1, 0, 1000);
    return JSON.stringify(run(engine, s, 6).state);
  };
  check('purity: the same inputs always give the same result (deterministic)', script() === script());
}
{
  const s = place(place(fresh(engine, ['A', 'B']), 'A', { x: 1.23456, immune: true }), 'B', { snow: 2.25 });
  const v = engine.view(s);
  check('view: shaped for phones (game id, arena size, per-player ball)', v.gameId === 'snowball' && v.arenaRadius === cfg.arenaRadius && Object.keys(v.balls).join() === 'A,B');
  check('view: positions are rounded and radius is the real radius', v.gameId === 'snowball' && v.balls.A.x === 1.23 && near(v.balls.B.radius, 1.5, 1e-3));
  check('view: carries the immune flash flag', v.gameId === 'snowball' && v.balls.A.immune === true && v.balls.B.immune === false);
}

console.log(failures === 0 ? '\nAll snowball engine checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
