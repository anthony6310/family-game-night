/**
 * Snowball engine, tested as pure functions (no server, no sockets, no clocks):
 *   npm run test:snowball -w @fgn/server
 * The physics is deterministic, so growth, speed, terrain, walls, rebounds, snow theft and immunity
 * can all be checked exactly. Tests that aren't about hills run on FLAT ground so they stay simple.
 */
import { createTerrain, type Terrain, type TerrainFeature } from '@fgn/shared';
import { createSnowball, DEFAULT_SNOWBALL_CONFIG, type SnowballState } from '../src/games/snowball';
import { arenaRadiusFor, generateTerrainFeatures, mulberry32, spawnPoints } from '../src/games/terrain';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const cfg = DEFAULT_SNOWBALL_CONFIG;
const FLAT: Terrain = { height: () => 0, gradient: () => ({ x: 0, z: 0 }) };
/** A plane that rises `s` per unit toward +x (uphill to the east when s > 0). */
const plane = (s: number): Terrain => ({ height: (x) => s * x, gradient: () => ({ x: s, z: 0 }) });

const engine = createSnowball({ terrain: FLAT });
const noGrowth = createSnowball({ terrain: FLAT, growthPerUnit: 0 }); // for exact snow-conservation checks
// A hill-shaped ground for the integration tests (the real game picks a random layout every round).
const SAMPLE_FEATURES: TerrainFeature[] = [
  { id: 'big-hill', x: -8, z: -4, radius: 22, height: 6 },
  { id: 'small-hill', x: 16, z: 10, radius: 12, height: 2.8 },
  { id: 'ditch', x: 10, z: -17, radius: 10, height: -2.4 },
];
const SAMPLE = createTerrain(SAMPLE_FEATURES);
const DT = 0.025; // the real tick step (40 per second)
type E = typeof engine;
type Ball = SnowballState['balls'][string];
const radius = (b: Ball) => Math.sqrt(b.snow);

/** Replaces fields of one ball (to set up a scenario). */
const place = (s: SnowballState, id: string, patch: Partial<Ball>): SnowballState => ({
  ...s, balls: { ...s.balls, [id]: { ...s.balls[id], ...patch } },
});
const steer = (e: E, s: SnowballState, id: string, x: number, z: number, now: number) => e.reduce(s, id, { type: 'steer', x, z }, now);
/** Runs `seconds` of ticks, calling `each` after every tick. Returns the final state and time. */
function run(e: E, s: SnowballState, seconds: number, now0 = 1000, each?: (s: SnowballState, now: number, t: number) => void) {
  let now = now0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    now += DT * 1000;
    s = e.tick!(s, DT, now);
    each?.(s, now, (i + 1) * DT);
  }
  return { state: s, now };
}
const fresh = (e: E, ids: string[]) => e.init(ids, 1000);
const speedOf = (b: Ball) => Math.hypot(b.vx, b.vz);

// ================= setup =================
const s4 = fresh(engine, ['A', 'B', 'C', 'D']);
check('init: one ball per player, all start at radius 1, standing still',
  Object.keys(s4.balls).length === 4 && Object.values(s4.balls).every((b) => near(radius(b), 1) && b.vx === 0 && b.vz === 0 && b.slowStacks === 0 && b.boostStacks === 0));
check('init: spawn points are inside the arena and well apart',
  Object.values(s4.balls).every((b) => Math.hypot(b.x, b.z) + 1 < s4.arenaRadius)
  && Object.values(s4.balls).every((b, i, all) => all.every((o, j) => i === j || Math.hypot(b.x - o.x, b.z - o.z) > 10)));
check('init: the round lasts the configured time', s4.endsAt - s4.startsAt === cfg.durationMs);
check('init: 8 players fit with room to spare', (() => {
  const s8 = fresh(engine, Array.from({ length: 8 }, (_, i) => `P${i}`));
  const b = Object.values(s8.balls);
  return b.every((x, i) => b.every((y, j) => i === j || Math.hypot(x.x - y.x, x.z - y.z) > 2 * 1 + 5));
})());
check('init: the base arena (2 players) has radius 45', cfg.arenaRadius === 45 && cfg.basePlayers === 2 && fresh(engine, ['A', 'B']).arenaRadius === 45);

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
  let s = place(fresh(engine, ['A']), 'A', { x: 15, z: 0 });
  s = steer(engine, s, 'A', -1, 0, 1000);
  let distance = 0;
  let prevRadius = radius(s.balls.A);
  let monotonic = true;
  const { state } = run(engine, s, 5, 1000, (st) => {
    const b = st.balls.A;
    distance += speedOf(b) * DT;
    monotonic &&= radius(b) >= prevRadius;
    prevRadius = radius(b);
  });
  const b = state.balls.A;
  check('growth: radius² = start² + 2 · growthPerUnit · distance rolled', near(b.snow, 1 + 2 * cfg.growthPerUnit * distance, 1e-9));
  check('growth: the ball got bigger, and never shrank on its own', radius(b) > 1.2 && monotonic);
  check('growth: it rolled a sensible distance (slowly, not teleporting)', distance > 10 && distance < cfg.maxSpeed * 5);
}
check('growth: a ball that never moves never grows', near(run(engine, fresh(engine, ['A']), 3).state.balls.A.snow, 1));
{
  const fast = createSnowball({ terrain: FLAT, growthPerUnit: 0.1 });
  const go = (e: E) => run(e, steer(e, place(fresh(e, ['A']), 'A', { x: 15, z: 0 }), 'A', -1, 0, 1000), 4).state.balls.A.snow;
  check('config: a higher growthPerUnit grows balls faster', go(fast) > go(engine));
}

// ================= speed: base speed, and size no longer slows you =================
{
  const topSpeedAfter = (e: E, snow: number, seconds = 3) => {
    let st = place(fresh(e, ['A']), 'A', { x: 0, z: 0, snow });
    st = steer(e, st, 'A', 1, 0, 1000);
    return speedOf(run(e, st, seconds).state.balls.A);
  };
  const small = topSpeedAfter(noGrowth, 1);
  const big = topSpeedAfter(noGrowth, 9); // radius 3
  check('speed: base speed is 11', near(cfg.maxSpeed, 11) && near(small, cfg.maxSpeed, 0.3));
  check('speed: size no longer slows a ball (a radius-3 ball is as fast as a radius-1 ball)', near(big, small, 0.2) && near(big, cfg.maxSpeed, 0.2));
  const oldBehaviour = createSnowball({ terrain: FLAT, growthPerUnit: 0, speedFalloff: 0.5 });
  check('config: speedFalloff can bring the size slowdown back', topSpeedAfter(oldBehaviour, 9) < topSpeedAfter(oldBehaviour, 1) * 0.7);
  const reach = (snow: number) => { // speed after only 0.6 s, i.e. how fast it accelerates
    let st = place(fresh(noGrowth, ['A']), 'A', { x: 0, z: 0, snow });
    st = steer(noGrowth, st, 'A', 1, 0, 1000);
    return speedOf(run(noGrowth, st, 0.6).state.balls.A);
  };
  check('accel: size no longer makes a ball sluggish to speed up either', near(reach(1), reach(9), 0.05));
}
check('friction: a ball that isn\'t steering coasts to a stop',
  speedOf(run(noGrowth, place(fresh(noGrowth, ['A']), 'A', { x: 0, z: 0, vx: 5 }), 6).state.balls.A) < 0.01);

// ================= terrain: the shape of a hill =================
{
  const [bigHill, smallHill, ditch] = SAMPLE_FEATURES;
  check('terrain: hill tops and the ditch bottom are at their full height/depth',
    near(SAMPLE.height(bigHill.x, bigHill.z), bigHill.height, 1e-9) && near(SAMPLE.height(smallHill.x, smallHill.z), smallHill.height, 1e-9)
    && near(SAMPLE.height(ditch.x, ditch.z), ditch.height, 1e-9) && ditch.height < 0);
  check('terrain: perfectly flat outside the features', near(SAMPLE.height(0, 40), 0) && near(SAMPLE.height(-40, 0), 0) && near(SAMPLE.height(40, -5), 0));
  check('terrain: level on the very top (no slope at the summit)', near(SAMPLE.gradient(bigHill.x, bigHill.z).x, 0) && near(SAMPLE.gradient(bigHill.x, bigHill.z).z, 0));
  let gradientOk = true, uphillOk = true;
  for (const [x, z] of [[-14, 0], [-3, -8], [20, 12], [14, 8], [10, -15], [14, -20], [-8, 12]]) {
    const g = SAMPLE.gradient(x, z);
    const e = 1e-5;
    gradientOk &&= near(g.x, (SAMPLE.height(x + e, z) - SAMPLE.height(x - e, z)) / (2 * e), 1e-4)
      && near(g.z, (SAMPLE.height(x, z + e) - SAMPLE.height(x, z - e)) / (2 * e), 1e-4);
    const mag = Math.hypot(g.x, g.z);
    uphillOk &&= mag < 1e-9 || SAMPLE.height(x + (g.x / mag) * 0.1, z + (g.z / mag) * 0.1) > SAMPLE.height(x, z);
  }
  check('terrain: the slope function matches the height function', gradientOk);
  check('terrain: the gradient really points uphill', uphillOk);
}

// ================= the map grows with the number of players =================
{
  const radius = (n: number) => arenaRadiusFor(n, cfg.arenaRadius, cfg.basePlayers);
  check('size: 2 players get the base arena; the minimum never goes below it', near(radius(2), 45) && near(radius(1), 45) && near(radius(0), 45));
  check('size: the AREA is proportional to the number of players (same room per player at every size)',
    [2, 3, 4, 5, 6, 7, 8].every((n) => near((Math.PI * radius(n) ** 2) / n, (Math.PI * 45 ** 2) / 2, 1e-6)));
  check('size: more players always means a bigger map', [2, 3, 4, 5, 6, 7].every((n) => radius(n + 1) > radius(n)));
  check('size: 4 players ≈ 1.41x the radius, 8 players = 2x', near(radius(4) / 45, Math.SQRT2, 1e-9) && near(radius(8) / 45, 2, 1e-9));
  const sized = (n: number) => fresh(engine, Array.from({ length: n }, (_, i) => `P${i}`));
  check('size: a round really uses that radius (state and what phones are told)',
    [2, 3, 5, 8].every((n) => { const st = sized(n); const v = engine.view(st); return near(st.arenaRadius, radius(n)) && v.gameId === 'snowball' && near(v.arenaRadius, radius(n)); }));
  check('size: spawn points are spread over the bigger ring and inside the walls', [2, 4, 8].every((n) => {
    const st = sized(n);
    return Object.values(st.balls).every((b) => near(Math.hypot(b.x, b.z), st.arenaRadius * 0.7, 1e-9) && Math.hypot(b.x, b.z) + 1 < st.arenaRadius);
  }));
  check('size: a tie-breaker with fewer players gets the smaller map', near(sized(3).arenaRadius, radius(3)) && sized(3).arenaRadius < sized(8).arenaRadius);
  // The wall of a big arena is the wall of THAT round: a ball can roll out to 80 in an 8-player round but not in a 2-player one.
  const roll80 = (n: number) => {
    const ids = Array.from({ length: n }, (_, i) => `P${i}`);
    let st = fresh(createSnowball({ terrain: FLAT, growthPerUnit: 0 }), ids);
    const e = createSnowball({ terrain: FLAT, growthPerUnit: 0 });
    st = place(st, 'P0', { x: 0, z: 0 });
    st = steer(e, st, 'P0', 1, 0, 1000);
    return Math.max(...(() => { const xs: number[] = []; run(e, st, 12, 1000, (c) => xs.push(c.balls.P0.x)); return xs; })());
  };
  check('size: the walls move with the map (the 8-player arena lets you roll farther than the 2-player one)', roll80(2) < 45 && roll80(8) > 60);
}

// ================= terrain: a random layout every round =================
{
  const radius = (n: number) => arenaRadiusFor(n, cfg.arenaRadius, cfg.basePlayers);
  const bonusFor = (players: number) => cfg.featureRadiusPerPlayer * Math.max(0, players - cfg.basePlayers);
  const layout = (seed: number, players: number) =>
    generateTerrainFeatures(mulberry32(seed), {
      arenaRadius: radius(players), spawns: spawnPoints(players, radius(players)),
      extraFeatures: Math.max(0, players - cfg.basePlayers), radiusBonus: bonusFor(players),
    });
  const count = (f: TerrainFeature[], id: string) => f.filter((x) => x.id === id).length;
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1);

  check('layout: 2 players get exactly the base: one big hill, one small hill, one ditch',
    seeds.every((sd) => { const f = layout(sd, 2); return f.length === 3 && count(f, 'big-hill') === 1 && count(f, 'small-hill') === 1 && count(f, 'ditch') === 1; }));
  check('layout: every additional player adds exactly one feature (players + 1 in total)',
    [2, 3, 4, 5, 6, 7, 8].every((n) => seeds.every((sd) => layout(sd, n).length === n + 1)));
  check('layout: the base three are always there, whatever the player count',
    [3, 5, 8].every((n) => seeds.every((sd) => { const f = layout(sd, n); return count(f, 'big-hill') >= 1 && count(f, 'small-hill') >= 1 && count(f, 'ditch') >= 1; })));
  check('layout: the extras are random: any of the three types can be added', (() => {
    const extras = { 'big-hill': 0, 'small-hill': 0, ditch: 0 } as Record<string, number>;
    for (const sd of seeds) { const f = layout(sd, 8); for (const id of Object.keys(extras)) extras[id] += count(f, id) - 1; } // minus the base one
    const total = Object.values(extras).reduce((a, b) => a + b, 0);
    return total === 6 * seeds.length && Object.values(extras).every((n) => n > total * 0.25 && n < total * 0.42); // roughly a third each
  })());
  check('layout: the extras vary from round to round (not always the same mix)', new Set(seeds.slice(0, 60).map((sd) => layout(sd, 6).map((x) => x.id).sort().join())).size >= 5);
  check('layout: every feature lies completely inside that round\'s arena', [2, 3, 5, 8].every((n) =>
    seeds.every((sd) => layout(sd, n).every((f) => Math.hypot(f.x, f.z) + f.radius <= radius(n) + 0.01)))); // (positions are rounded to 0.01 units)
  check('layout: nobody starts on a slope (2 to 8 players, 300 layouts each)', (() => {
    for (let n = 2; n <= 8; n++) for (const sd of seeds) {
      const ground = createTerrain(layout(sd, n));
      for (const sp of spawnPoints(n, radius(n))) {
        const g = ground.gradient(sp.x, sp.z);
        if (Math.abs(ground.height(sp.x, sp.z)) > 1e-9 || Math.hypot(g.x, g.z) > 1e-9) return false;
      }
    }
    return true;
  })());
  check('layout: the same random numbers always give the same layout (reproducible)', JSON.stringify(layout(42, 5)) === JSON.stringify(layout(42, 5)));
  check('layout: different rounds get different layouts', new Set(seeds.slice(0, 40).map((sd) => JSON.stringify(layout(sd, 3)))).size >= 38);
  const spread = (v: number[]) => Math.sqrt(v.reduce((t, n) => t + (n - v.reduce((a, c) => a + c, 0) / v.length) ** 2, 0) / v.length);
  const bigHills = (players: number) => seeds.map((sd) => layout(sd, players).find((f) => f.id === 'big-hill')!);
  check('layout: positions really vary across the map (the big hill is not always in the same place)', (() => {
    // With 2 players the (big) hill has to sit between the two start spots, so it moves north/south more than east/west.
    const two = bigHills(2), four = bigHills(4);
    return spread(two.map((f) => f.z)) > 6 && spread(four.map((f) => f.x)) > 6 && spread(four.map((f) => f.z)) > 6;
  })());
  check('layout: all three base features move around (small hill and ditch too)', [1, 2].every((k) => {
    const xs = seeds.map((sd) => layout(sd, 4).filter((f) => f.id === (k === 1 ? 'small-hill' : 'ditch'))[0].x);
    return Math.max(...xs) - Math.min(...xs) > 30;
  }));
  const ratio = (f: TerrainFeature[], i: number, j: number) => Math.hypot(f[i].x - f[j].x, f[i].z - f[j].z) / (f[i].radius + f[j].radius);
  check('layout: with 2-3 players the features stay mostly apart (at least half their combined radii apart, in 90%+ of layouts)', (() => {
    let apart = 0, total = 0;
    for (const n of [2, 3]) for (const sd of seeds) {
      const f = layout(sd, n);
      let ok = true;
      for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (ratio(f, i, j) < 0.5 - 1e-6) ok = false;
      if (ok) apart++;
      total++;
    }
    return apart / total >= 0.9;
  })());
  const minRatio = (f: TerrainFeature[]) => { let m = Infinity; for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) m = Math.min(m, ratio(f, i, j)); return m; };
  check('layout: with up to 4 players no two features are stacked on top of each other (centres at least 30% of their radii apart)',
    [2, 3, 4].every((n) => seeds.every((sd) => minRatio(layout(sd, n)) >= 0.3 - 1e-6)));
  // 5-8 players: the wider hills cover most of the map (footprints add up to ~80% of the arena at 8 players), so some overlap is unavoidable.
  check('layout: at any player count two features are never (nearly) on the very same spot (centres at least 15% of their radii apart)',
    [2, 3, 4, 5, 6, 7, 8].every((n) => seeds.every((sd) => minRatio(layout(sd, n)) >= 0.15 - 1e-6)));
  check('layout: bigger hills in a crowded map overlap only modestly on average (under a quarter of their combined radii)', [2, 4, 8].every((n) => {
    let overlap = 0, pairs = 0;
    for (const sd of seeds) { const f = layout(sd, n); for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { overlap += Math.max(0, 1 - ratio(f, i, j)); pairs++; } }
    return overlap / pairs < 0.25;
  }));

  const BASE: Record<string, { radius: number; height: number }> = {
    'big-hill': { radius: 22, height: 6 }, 'small-hill': { radius: 12, height: 2.8 }, ditch: { radius: 10, height: -2.4 },
  };
  check('feature size: 1 or 2 players get exactly the base sizes (big hill radius 22, small hill 12, ditch 10)',
    [1, 2].every((n) => seeds.every((sd) => layout(sd, n).every((f) => near(f.radius, BASE[f.id].radius, 0.01) && near(f.height, BASE[f.id].height, 0.01)))) && cfg.featureRadiusPerPlayer === 2);
  check('feature size: each additional player adds a fixed 2 units to every feature\'s radius (big hill 24, 26, ... 34 at 8 players)',
    [3, 4, 5, 6, 7, 8].every((n) => seeds.slice(0, 100).every((sd) => layout(sd, n).every((f) => near(f.radius, BASE[f.id].radius + 2 * (n - 2), 0.01)))) && near(22 + 2 * 6, 34));
  check('feature size: it is a fixed amount, not a percentage (the big hill, small hill and ditch all grow by the same 2 per player)',
    [3, 4, 5, 6].every((n) => ['big-hill', 'small-hill', 'ditch'].every((id) => {
      const grow = (m: number) => layout(1, m).find((f) => f.id === id)!.radius;
      return near(grow(n + 1) - grow(n), 2, 0.01);
    })));
  check('feature size: heights and depths do not change with the player count', [2, 4, 8].every((n) =>
    seeds.slice(0, 100).every((sd) => layout(sd, n).every((f) => near(f.height, BASE[f.id].height, 0.01)))));
  check('feature size: even the widest, gentlest features (8 players) are still steep enough for the full hill speed effect', (() => {
    const wide = layout(1, 8);
    return ['big-hill', 'small-hill', 'ditch'].every((id) => {
      const f = wide.find((x) => x.id === id)!;
      return (Math.abs(f.height) * Math.PI) / (2 * f.radius) >= cfg.slopeFullEffect;
    });
  })());

  // ---- the engine: a new layout each round, sized for the players, fixed during it ----
  const e = createSnowball({ random: mulberry32(3) });
  const round1 = e.init(['A', 'B'], 1000);
  const round2 = e.init(['A', 'B'], 2000);
  check('engine: each round (each init) gets a different random layout', JSON.stringify(round1.features) !== JSON.stringify(round2.features) && round1.features.length === 3);
  const eight = createSnowball({ random: mulberry32(5) }).init(Array.from({ length: 8 }, (_, i) => `P${i}`), 1000);
  check('engine: an 8-player round has 9 features on a radius-90 map, each 12 units wider (radius) than the base', eight.features.length === 9 && near(eight.arenaRadius, 90) && eight.features.every((f) => near(f.radius, BASE[f.id].radius + 12, 0.01)) && eight.features.some((f) => near(f.radius, 34, 0.01)));
  check('engine: a 2-player round has exactly the base sizes', round1.features.every((f) => near(f.radius, BASE[f.id].radius, 0.01) && near(f.height, BASE[f.id].height, 0.01)));
  const before = JSON.stringify(round1.features);
  const later = run(e, steer(e, round1, 'A', 1, 1, 1000), 8).state;
  check('engine: the hills and ditches never move during a round (and neither do the walls)', JSON.stringify(later.features) === before && later.arenaRadius === round1.arenaRadius);
  const v = e.view(later);
  check('engine: the view hands the layout to the phones', v.gameId === 'snowball' && JSON.stringify(v.terrain) === before);
  check('engine: the ground the physics uses IS that layout', (() => {
    const mirror = createTerrain(round1.features);
    return [[0, 0], [10, 5], [-20, 8], [15, -22], [3, 30]].every(([x, z]) => near(round1.terrain.height(x, z), mirror.height(x, z), 1e-12))
      && round1.features.some((f) => Math.abs(round1.terrain.height(f.x, f.z)) > 0.5);
  })());
  const flatView = engine.view(fresh(engine, ['A', 'B']));
  check('engine: a fixed test terrain switches the random layout off', flatView.gameId === 'snowball' && flatView.terrain.length === 0);
}

// ================= terrain: uphill / downhill stacks =================
{
  const BIG = { arenaRadius: 100000, growthPerUnit: 0 }; // no walls, no growth: only the slope matters
  const base = cfg.maxSpeed;
  const slowPerStack = (1 - cfg.uphillMinFactor) / cfg.uphillMaxStacks; // 1% of speed
  const boostPerStack = (cfg.downhillMaxFactor - 1) / cfg.downhillMaxStacks; // 2% of speed
  const lifetimeMs = cfg.stackLifetimeSeconds * 1000;

  /** Rolls a ball (already at `base` speed) over `terrain` and reports its state at the requested times. */
  const roll = (terrain: Terrain, dirX: number, dirZ: number, seconds: number, at: number[] = [], extra: Partial<typeof cfg> = {}) => {
    const e = createSnowball({ terrain, ...BIG, ...extra });
    let st = place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: dirX * base, vz: dirZ * base });
    st = steer(e, st, 'A', dirX, dirZ, 1000);
    const seen: Ball[] = [];
    let maxSlow = 0, maxBoost = 0, factorOk = true;
    const { state, now } = run(e, st, seconds, 1000, (cur, _n, t) => {
      const b = cur.balls.A;
      maxSlow = Math.max(maxSlow, b.slowStacks);
      maxBoost = Math.max(maxBoost, b.boostStacks);
      const f = e.view(cur).gameId === 'snowball' ? (e.view(cur) as { balls: Record<string, { speedFactor: number }> }).balls.A.speedFactor : 1;
      factorOk &&= f >= cfg.uphillMinFactor - 1e-9 && f <= cfg.downhillMaxFactor + 1e-9;
      if (at.some((q) => near(q, t, DT / 2))) seen.push({ ...b });
    });
    return { e, ball: state.balls.A, seen, maxSlow, maxBoost, factorOk, state, now };
  };

  // ---- uphill: slow stacks ----
  const up = roll(plane(0.3), 1, 0, 4, [0.75, 1.5, 2]);
  check('uphill: a steep climb earns a slow stack every uphillFullSlowSeconds ÷ maxStacks (about 5 after 0.75 s)', Math.abs(up.seen[0].slowStacks - 5) <= 1);
  check('uphill: all 10 slow stacks are earned by 1.5 s of straight climbing', up.seen[1].slowStacks >= cfg.uphillMaxStacks - 1 && up.seen[2].slowStacks === cfg.uphillMaxStacks);
  check('uphill: stacks never exceed the cap, and no boost stacks are earned', up.maxSlow === cfg.uphillMaxStacks && up.maxBoost === 0);
  check('uphill: the stacks stay alive for as long as the climb continues (no flicker)', up.ball.slowStacks === cfg.uphillMaxStacks);
  check('uphill: full stacks give exactly the 90% floor, and the ball settles at 90% of base speed',
    near(1 - cfg.uphillMaxStacks * slowPerStack, cfg.uphillMinFactor) && near(speedOf(up.ball), base * cfg.uphillMinFactor, 0.15));

  // ---- downhill: boost stacks ----
  const down = roll(plane(0.3), -1, 0, 6, [1.5, 3.2]);
  check('downhill: boost stacks come more slowly (about 7 after 1.5 s)', Math.abs(down.seen[0].boostStacks - 7) <= 1);
  check('downhill: all 15 boost stacks are earned after ~3 s of straight descending', down.seen[1].boostStacks === cfg.downhillMaxStacks);
  check('downhill: stacks never exceed the cap, and no slow stacks are earned', down.maxBoost === cfg.downhillMaxStacks && down.maxSlow === 0);
  check('downhill: full stacks give exactly the 130% ceiling, and the ball settles at 130% of base speed',
    near(1 + cfg.downhillMaxStacks * boostPerStack, cfg.downhillMaxFactor) && near(speedOf(down.ball), base * cfg.downhillMaxFactor, 0.25));
  check('stacks: from hills alone the speed factor can never leave the 0.9 - 1.3 range', up.factorOk && down.factorOk);

  // ---- no effect ----
  const side = roll(plane(0.3), 0, 1, 3);
  check('slope: rolling ACROSS a slope earns no stacks and keeps normal speed', side.maxSlow === 0 && side.maxBoost === 0 && near(speedOf(side.ball), base, 0.1));
  const flat = roll(FLAT, 1, 0, 3);
  check('slope: flat ground earns no stacks and gives exactly normal speed', flat.maxSlow === 0 && flat.maxBoost === 0 && near(speedOf(flat.ball), base, 0.1));
  check('slope: downhill is faster than flat, flat is faster than uphill', speedOf(down.ball) > speedOf(flat.ball) + 1.5 && speedOf(flat.ball) > speedOf(up.ball) + 0.4);
  check('slope: slopes below the dead zone count as flat', roll(plane(0.01), 1, 0, 3).maxSlow === 0);
  const gentle = roll(plane(0.06), 1, 0, 3, [1.5]); // half of slopeFullEffect
  check('slope: a gentler slope earns stacks proportionally more slowly (half steepness = half the stacks)', Math.abs(gentle.seen[0].slowStacks - 5) <= 1);
  const diagonal = roll(plane(0.3), Math.SQRT1_2, Math.SQRT1_2, 2, [1.5]);
  check('slope: traversing diagonally still counts as climbing (0.3 × cos45° is still a steep slope)', diagonal.seen[0].slowStacks >= 8);

  // ---- falling off ----
  {
    // A ramp that ends at x = 20: steep uphill before it, perfectly flat after it.
    const ramp: Terrain = { height: (x) => 0.3 * Math.min(x, 20), gradient: (x) => ({ x: x < 20 ? 0.3 : 0, z: 0 }) };
    const e = createSnowball({ terrain: ramp, ...BIG });
    let st = steer(e, place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: base }), 'A', 1, 0, 1000);
    let crossedAt = -1, onFlat0 = -1, stacksAtCross = 0, stacksAfter100ms = -1, stacksAfter400ms = -1, speedLater = 0, factorAfter = 0;
    run(e, st, 6, 1000, (cur, _n, t) => {
      const b = cur.balls.A;
      if (crossedAt < 0 && b.x >= 20) { crossedAt = t; stacksAtCross = b.slowStacks; }
      if (crossedAt > 0 && near(t, crossedAt + 0.1, DT / 2)) stacksAfter100ms = b.slowStacks;
      if (crossedAt > 0 && near(t, crossedAt + 0.4, DT / 2)) { stacksAfter400ms = b.slowStacks; factorAfter = (e.view(cur) as { balls: Record<string, { speedFactor: number }> }).balls.A.speedFactor; }
      if (crossedAt > 0 && near(t, crossedAt + 2, DT / 2)) speedLater = speedOf(b);
      onFlat0 = crossedAt;
    });
    check('falloff: just after the slope ends the stacks are still there (they have a 0.3 s lifetime)', stacksAtCross === cfg.uphillMaxStacks && stacksAfter100ms === cfg.uphillMaxStacks);
    check('falloff: 0.3 s after leaving the slope every stack has fallen off by itself', stacksAfter400ms === 0 && near(factorAfter, 1));
    check('falloff: on the flat the ball goes back to normal speed', near(speedLater, base, 0.1) && onFlat0 > 0);
  }
  {
    // A longer lifetime is just a setting.
    const ramp: Terrain = { height: (x) => 0.3 * Math.min(x, 20), gradient: (x) => ({ x: x < 20 ? 0.3 : 0, z: 0 }) };
    const e = createSnowball({ terrain: ramp, ...BIG, stackLifetimeSeconds: 0.5 });
    let st = steer(e, place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: base }), 'A', 1, 0, 1000);
    let crossedAt = -1, at400 = -1, at600 = -1;
    run(e, st, 6, 1000, (cur, _n, t) => {
      if (crossedAt < 0 && cur.balls.A.x >= 20) crossedAt = t;
      if (crossedAt > 0 && near(t, crossedAt + 0.4, DT / 2)) at400 = cur.balls.A.slowStacks;
      if (crossedAt > 0 && near(t, crossedAt + 0.6, DT / 2)) at600 = cur.balls.A.slowStacks;
    });
    check('config: stackLifetimeSeconds changes how long stacks last (0.5 s: still there at 0.4 s, gone at 0.6 s)', at400 === cfg.uphillMaxStacks && at600 === 0);
  }

  // ---- the lifetime is refreshed by traversing a slope ----
  {
    const e = createSnowball({ terrain: plane(0.3), ...BIG });
    let st = place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: base, slowStacks: 4, slowUntil: 1000 + 50 }); // about to expire
    const refreshed = e.tick!(st, DT, 1000 + 40).balls.A; // still climbing at t+40 ms
    check('lifetime: still climbing resets the timer to a full lifetime, keeping the stacks', refreshed.slowStacks >= 4 && near(refreshed.slowUntil, 1040 + lifetimeMs, 1e-6));
    const flatE = createSnowball({ terrain: FLAT, ...BIG });
    const flatState = place(fresh(flatE, ['A']), 'A', { x: 0, z: 0, vx: base, slowStacks: 4, slowUntil: 1000 + 50 });
    check('lifetime: not climbing, the same stacks simply expire', flatE.tick!(flatState, DT, 1000 + 40).balls.A.slowStacks === 4 && flatE.tick!(flatState, DT, 1000 + 60).balls.A.slowStacks === 0);
  }

  // ---- cresting a hill: slow stacks fade, boost stacks build ----
  {
    const crest = 20;
    const ridge: Terrain = {
      height: (x) => 0.3 * Math.min(x, 2 * crest - x),
      gradient: (x) => ({ x: x < crest ? 0.3 : -0.3, z: 0 }),
    };
    const e = createSnowball({ terrain: ridge, ...BIG });
    let st = steer(e, place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: base }), 'A', 1, 0, 1000);
    let crossedAt = -1, slowGone = -1, boostBuilding = -1, boostMax = 0;
    run(e, st, 10, 1000, (cur, _n, t) => {
      const b = cur.balls.A;
      if (crossedAt < 0 && b.x >= crest) crossedAt = t;
      if (crossedAt > 0 && slowGone < 0 && b.slowStacks === 0) slowGone = t - crossedAt;
      if (crossedAt > 0 && boostBuilding < 0 && b.boostStacks > 0) boostBuilding = t - crossedAt;
      boostMax = Math.max(boostMax, b.boostStacks);
    });
    check('crest: after the top the slow stacks fade within their lifetime...', slowGone > 0 && slowGone <= cfg.stackLifetimeSeconds + 0.1);
    check('crest: ...while boost stacks start building straight away and reach the ceiling', boostBuilding >= 0 && boostBuilding < 0.5 && boostMax === cfg.downhillMaxStacks);
  }

  // ---- what the speed gauge shows ----
  {
    const v = up.e.view(up.state);
    check('gauge data: the view carries the ground\'s speed factor, both stack counts and the speed range',
      v.gameId === 'snowball' && near(v.balls.A.speedFactor, cfg.uphillMinFactor, 1e-9) && near(v.balls.A.hillFactor, cfg.uphillMinFactor, 1e-9)
      && v.balls.A.slowStacks === cfg.uphillMaxStacks && v.balls.A.boostStacks === 0 && !v.balls.A.escape && !v.balls.A.leader
      && near(v.speedRange.base, base) && near(v.speedRange.min, base * cfg.uphillMinFactor) && near(v.speedRange.hillMax, base * cfg.downhillMaxFactor)
      && near(v.speedRange.max, base * (cfg.downhillMaxFactor + cfg.escapeBoost)) && near(v.speedRange.escapeBonus, cfg.escapeBoost));
  }

  // ---- the real arena: climb the big hill straight on, along z = -4, from its west foot, over the top and down ----
  {
    const e = createSnowball({ growthPerUnit: 0, arenaRadius: 100000, terrain: SAMPLE }); // a realistic hill-shaped ground
    const bigHill = SAMPLE_FEATURES[0];
    let st = steer(e, place(fresh(e, ['A']), 'A', { x: bigHill.x - bigHill.radius - 2, z: bigHill.z, vx: base }), 'A', 1, 0, 1000);
    let slowest = Infinity, fastest = 0, onHill = false;
    run(e, st, 12, 1000, (cur) => {
      const b = cur.balls.A;
      const inside = Math.hypot(b.x - bigHill.x, b.z - bigHill.z) < bigHill.radius;
      if (!inside && !onHill) return;
      onHill = true;
      slowest = Math.min(slowest, speedOf(b));
      fastest = Math.max(fastest, speedOf(b));
    });
    check('real hill: the big hill slows a ball on the way up and speeds it on the way down',
      slowest < base * 0.95 && slowest >= base * cfg.uphillMinFactor - 0.1 && fastest > base * 1.1 && fastest <= base * cfg.downhillMaxFactor + 0.05);
  }
}

// ================= walls =================
{
  let s = place(fresh(engine, ['A']), 'A', { x: 40, z: 0 });
  s = steer(engine, s, 'A', 1, 0, 1000);
  let inside = true, rebounded = false;
  run(engine, s, 8, 1000, (st) => {
    const b = st.balls.A;
    inside &&= Math.hypot(b.x, b.z) + radius(b) <= cfg.arenaRadius + 1e-9;
    rebounded ||= b.vx < 0;
  });
  check('wall: the whole ball always stays inside the arena', inside);
  check('wall: hitting the wall makes the ball rebound', rebounded);
}
{
  let inside = true;
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    let s = place(fresh(engine, ['A']), 'A', { x: 0, z: 0 });
    s = steer(engine, s, 'A', Math.cos(a), Math.sin(a), 1000);
    run(engine, s, 14, 1000, (st) => { inside &&= Math.hypot(st.balls.A.x, st.balls.A.z) + radius(st.balls.A) <= cfg.arenaRadius + 1e-9; });
  }
  check('wall: holds from all 8 compass directions', inside);
}
{
  // A wall hit: place a (non-steering) ball just inside the wall, flying outward, and look at the bounce.
  const wallHit = (snow: number, vx: number) => {
    const r = Math.sqrt(snow);
    const s = place(fresh(noGrowth, ['A']), 'A', { x: cfg.arenaRadius - r - 0.001, z: 0, vx, snow });
    return noGrowth.tick!(s, DT, 2000).balls.A;
  };
  const flying = 6 * (1 - cfg.frictionRate * DT); // friction trims the speed a little before it hits
  const hard = wallHit(1, 6);
  check('wall: a hard hit bounces back at only a FRACTION of the impact speed (weak)', near(hard.vx, -cfg.wallRestitution * flying, 1e-9) && -hard.vx < flying * 0.5);
  const bigBall = wallHit(4, 2); // radius 2, a medium hit
  const flyingMedium = 2 * (1 - cfg.frictionRate * DT);
  check('wall: a medium hit gets a minimum bounce that grows with the ball\'s size (relative)',
    near(-bigBall.vx, Math.max(cfg.wallRestitution * flyingMedium, cfg.wallReboundPerRadius * 2), 1e-9) && -bigBall.vx > cfg.wallRestitution * flyingMedium);
  const smallBall = wallHit(1, 2);
  check('wall: ...so a small ball bounces back less than a big one at the same speed', -smallBall.vx < -bigBall.vx);
  const soft = wallHit(1, 0.5);
  check('wall: a gentle touch only uses the fraction (no buzzing against the wall)', near(-soft.vx, cfg.wallRestitution * 0.5 * (1 - cfg.frictionRate * DT), 1e-9));
}

// ================= ball-ball collisions =================
const pair = (e: E, a: Partial<Ball>, b: Partial<Ball>) =>
  place(place(fresh(e, ['A', 'B']), 'A', { x: 0, z: 0, ...a }), 'B', { x: 3, z: 0, ...b });
const totalSnow = (s: SnowballState) => Object.values(s.balls).reduce((t, b) => t + b.snow, 0);
const gap = (s: SnowballState) => Math.hypot(s.balls.B.x - s.balls.A.x, s.balls.B.z - s.balls.A.z) - radius(s.balls.A) - radius(s.balls.B);
/** What a ball's snow becomes after losing `points` of size (a ball's size is its radius × 100). */
const afterDamage = (snow: number, points: number) => (Math.sqrt(snow) - points / 100) ** 2;
const afterFriction = (v: number) => v * (1 - cfg.frictionRate * DT); // a coasting ball loses a little speed each tick

{
  // Equal balls head-on.
  const s = noGrowth.tick!(pair(noGrowth, { x: -1.05, vx: 5 }, { x: 1.05, vx: -5 }), DT, 2000);
  check('collision: each ball leaves at least ballReboundPerRadius × its own radius', -s.balls.A.vx >= cfg.ballReboundPerRadius - 1e-9 && s.balls.B.vx >= cfg.ballReboundPerRadius - 1e-9);
  check('collision: balls are pushed apart so they no longer overlap', gap(s) >= -1e-9);
}
{
  // A big (radius 3) and a small (radius 1) ball: each is thrown back in proportion to its OWN size.
  const s = noGrowth.tick!(pair(noGrowth, { snow: 9, x: -2.05, vx: 3 }, { snow: 1, x: 2.05, vx: -3 }), DT, 2000);
  check('collision: a big ball is thrown back harder than a small one (rebound relative to size)',
    -s.balls.A.vx >= cfg.ballReboundPerRadius * 3 - 1e-9 && s.balls.B.vx >= cfg.ballReboundPerRadius * 1 - 1e-9 && -s.balls.A.vx > s.balls.B.vx);

  // ...and the DISTANCE each one bounces back is relative to its size too. Let them coast to a stop.
  const startA = s.balls.A.x, startB = s.balls.B.x;
  const end = run(noGrowth, s, 6, 2000).state;
  const bounceBig = Math.abs(end.balls.A.x - startA);
  const bounceSmall = Math.abs(end.balls.B.x - startB);
  const floorPerRadius = cfg.ballReboundPerRadius / cfg.frictionRate; // bounce distance in radii, at the minimum
  check('rebound distance: EACH ball bounces back at least ~3 of its own radii (a floor relative to its size)',
    bounceBig >= floorPerRadius * 3 * 0.95 && bounceSmall >= floorPerRadius * 1 * 0.95);
  check('rebound distance: so the big ball travels farther in absolute terms', bounceBig > bounceSmall);
}
{
  // Equal pairs at two sizes: the bigger pair bounces back proportionally farther.
  const pairBounce = (snow: number) => {
    const r = Math.sqrt(snow);
    const s = noGrowth.tick!(pair(noGrowth, { snow, x: -r - 0.05, vx: 4 }, { snow, x: r + 0.05, vx: -4 }), DT, 2000);
    const start = s.balls.A.x;
    return Math.abs(run(noGrowth, s, 8, 2000).state.balls.A.x - start);
  };
  const small = pairBounce(1), large = pairBounce(4); // radius 1 vs radius 2
  check('rebound distance: a pair of radius-2 balls bounces ~2x as far as a pair of radius-1 balls', large / small > 1.6 && large / small < 2.6);
}
{
  // Player collisions rebound harder than wall hits, at the same impact speed and size.
  const ballRebound = (() => {
    const s = noGrowth.tick!(pair(noGrowth, { x: -1.05, vx: 6 }, { x: 1.05, vx: 0 }), DT, 2000);
    return -s.balls.A.vx; // how fast ball A leaves
  })();
  const wallRebound = (() => {
    const s = place(fresh(noGrowth, ['A']), 'A', { x: cfg.arenaRadius - 1.001, z: 0, vx: 6 });
    return -noGrowth.tick!(s, DT, 2000).balls.A.vx;
  })();
  check('rebound strength: ball-ball bounces are much stronger than wall bounces', ballRebound > wallRebound * 2);
}
// ---- damage: flat, dealt by BOTH balls, the biggest ball hits twice as hard ----
const hitEngine = createSnowball({ terrain: FLAT, growthPerUnit: 0, frictionRate: 0, accelRate: 0 }); // keeps the impact speeds exact
/** Two balls already touching, `a` moving at `v` into a stationary `b`: exactly one hit on the next tick. */
const oneHit = (e: E, a: Partial<Ball>, b: Partial<Ball>, v: number, now = 2000) => {
  const ra = Math.sqrt((a.snow ?? 1)), rb = Math.sqrt((b.snow ?? 1));
  return e.tick!(place(place(fresh(e, ['A', 'B']), 'A', { x: 0, z: 0, vx: v, ...a }), 'B', { x: ra + rb - 0.02, z: 0, vx: 0, ...b }), DT, now);
};
{
  const s = oneHit(hitEngine, { snow: 1 }, { snow: 1 }, 6);
  check('damage: BOTH balls take damage from a hit (not just the smaller one)', s.balls.A.snow < 1 && s.balls.B.snow < 1);
  check('damage: equal balls each lose exactly 5 points of size (a flat amount, not a percentage)', near(cfg.damage, 5) && near(s.balls.A.snow, afterDamage(1, 5), 1e-9) && near(s.balls.B.snow, afterDamage(1, 5), 1e-9));
  check('damage: both victims are flagged immune', s.balls.A.immune && s.balls.B.immune);

  // Flat: speed does not matter. Same pair, hit at very different speeds.
  const lostPoints = (v: number) => (1 - Math.sqrt(oneHit(hitEngine, { snow: 1 }, { snow: 1 }, v).balls.B.snow)) * 100;
  check('flat damage: a barely-counting hit, a typical hit and a huge hit ALL take exactly 5 points',
    [cfg.minImpactSpeed, 2, 6, 12, 40].every((v) => near(lostPoints(v), cfg.damage, 1e-7)));
  check('flat damage: and it does not depend on size either (a size-300 victim loses the same 5 as a size-100 one)',
    near((3 - Math.sqrt(oneHit(hitEngine, { snow: 9 }, { snow: 9 }, 6).balls.B.snow)) * 100, cfg.damage, 1e-7));
  const gentle = oneHit(hitEngine, { snow: 1 }, { snow: 1 }, cfg.minImpactSpeed * 0.5);
  check('damage: a touch that closes in slower than minImpactSpeed is not a hit (no damage)', near(gentle.balls.A.snow, 1) && near(gentle.balls.B.snow, 1));
}
{
  // ---- the big ball buff ----
  const big = oneHit(hitEngine, { snow: 4 }, { snow: 1 }, 6); // A is the single biggest ball: the leader
  check('big ball buff: the biggest ball deals 10 (double the regular 5)', near(cfg.leaderDamage, 10) && near(big.balls.B.snow, afterDamage(1, cfg.leaderDamage), 1e-9));
  check('big ball buff: ...while the smaller ball still hits it for the regular 5', near(big.balls.A.snow, afterDamage(4, cfg.damage), 1e-9));
  check('big ball buff: the leader flag is set on the biggest ball only', big.balls.A.leader && !big.balls.B.leader);

  const near2 = oneHit(hitEngine, { snow: 1.01 }, { snow: 1 }, 6); // within the 2% margin: nobody clearly leads
  check('big ball buff: nobody gets it when the two biggest are within 2% of each other', !near2.balls.A.leader && !near2.balls.B.leader && near(near2.balls.B.snow, afterDamage(1, cfg.damage), 1e-9));
  const one = engine.tick!(fresh(engine, ['A']), DT, 2000);
  check('big ball buff: a lone ball has nobody to lead', !one.balls.A.leader);

  // Three balls: only the single biggest gets the buff. B (bigger than C) is NOT the leader.
  let three = fresh(hitEngine, ['A', 'B', 'C']);
  three = place(place(place(three, 'A', { x: -30, z: 0, snow: 9 }), 'B', { x: 0, z: 0, snow: 4, vx: 6 }), 'C', { x: 2.98, z: 0, snow: 1 });
  three = hitEngine.tick!(three, DT, 2000);
  check('big ball buff: a ball that is bigger than its victim but is not THE biggest deals only the normal amount',
    three.balls.A.leader && !three.balls.B.leader && near(three.balls.C.snow, afterDamage(1, cfg.damage), 1e-9));
  const noBuff = createSnowball({ terrain: FLAT, growthPerUnit: 0, frictionRate: 0, accelRate: 0, leaderDamage: 5 });
  check('config: leaderDamage = damage turns the big ball buff off', near(oneHit(noBuff, { snow: 4 }, { snow: 1 }, 6).balls.B.snow, afterDamage(1, 5), 1e-9));
}
{
  // ---- immunity ----
  const s1 = oneHit(hitEngine, { snow: 1 }, { snow: 1 }, 6);
  const again = (s: SnowballState, now: number) =>
    hitEngine.tick!(place(place(s, 'A', { x: 0, vx: 6 }), 'B', { x: 1.98, vx: 0 }), DT, now);
  const s2 = again(s1, 2100); // 100 ms later: both are still immune
  check('immunity: a second hit inside 200 ms does no damage to either ball', near(s2.balls.A.snow, s1.balls.A.snow, 1e-12) && near(s2.balls.B.snow, s1.balls.B.snow, 1e-12));
  const s3 = again(s2, 2000 + cfg.immunityMs + 50);
  check('immunity: after it wears off they can be hurt again', s3.balls.A.snow < s2.balls.A.snow - 1e-6 && s3.balls.B.snow < s2.balls.B.snow - 1e-6);
  check('immunity: the flag clears once the window passes', (() => {
    const rolled = hitEngine.tick!(place(place(s3, 'A', { x: -20, vx: 0 }), 'B', { x: 20, vx: 0 }), DT, 2000 + 2 * cfg.immunityMs + 400);
    return !rolled.balls.A.immune && !rolled.balls.B.immune;
  })());
  // Only the ball that is still immune is spared: the other is hurt normally.
  const half = hitEngine.tick!(place(place(fresh(hitEngine, ['A', 'B']), 'A', { x: 0, vx: 6, immuneUntil: 9999, immune: true }), 'B', { x: 1.98, vx: 0 }), DT, 2000);
  check('immunity: an immune ball is spared but the other one is still damaged', near(half.balls.A.snow, 1, 1e-12) && near(half.balls.B.snow, afterDamage(1, cfg.damage), 1e-9));
}
{
  // ---- the small ball buff: the smaller ball of a fresh hit gets the escape boost ----
  const hit = oneHit(hitEngine, { snow: 4 }, { snow: 1 }, 6, 5000);
  check('small ball buff: the smaller ball gets the escape boost when it hits a bigger one', hit.balls.B.escape && near(hit.balls.B.escapeUntil, 5000 + cfg.escapeSeconds * 1000));
  check('small ball buff: the bigger ball does not', !hit.balls.A.escape);
  const hv = hitEngine.view(hit);
  check('small ball buff: instantly the full bonus (as if fully boosted downhill): +30% top speed',
    hv.gameId === 'snowball' && near(hv.balls.B.speedFactor, 1 + cfg.escapeBoost, 1e-9) && near(cfg.escapeBoost, cfg.downhillMaxFactor - 1, 1e-9) && near(hv.balls.B.hillFactor, 1));
  check('small ball buff: it is not given to equal-size balls', (() => { const e = oneHit(hitEngine, { snow: 1 }, { snow: 1 }, 6); return !e.balls.A.escape && !e.balls.B.escape; })());
  check('small ball buff: a ball that is still immune does not get a fresh buff (no spamming)', (() => {
    const e = hitEngine.tick!(place(place(fresh(hitEngine, ['A', 'B']), 'A', { x: 0, snow: 4, vx: 6 }), 'B', { x: 2.98, snow: 1, immuneUntil: 9999, immune: true }), DT, 2000);
    return !e.balls.B.escape;
  })());
  const second = hitEngine.tick!(place(place(hit, 'A', { x: 0, vx: 6 }), 'B', { x: 2.98, vx: 0 }), DT, 5000 + cfg.immunityMs + 100);
  check('small ball buff: hitting the big ball again after the immunity refreshes the 2 s', near(second.balls.B.escapeUntil, 5000 + cfg.immunityMs + 100 + cfg.escapeSeconds * 1000));

  // What the boost does to actual speed (flat ground): up to +30% for 2 s, then back to normal.
  const BIG = { arenaRadius: 100000, growthPerUnit: 0, terrain: FLAT } as const;
  const e = createSnowball(BIG);
  let st = place(fresh(e, ['A']), 'A', { x: 0, z: 0, vx: cfg.maxSpeed, escapeUntil: 1000 + cfg.escapeSeconds * 1000, escape: true });
  st = steer(e, st, 'A', 1, 0, 1000);
  let at15 = 0, at4 = 0, escapeOffAt = -1;
  run(e, st, 6, 1000, (cur, _n, t) => {
    if (near(t, 1.5, DT / 2)) at15 = speedOf(cur.balls.A);
    if (near(t, 5, DT / 2)) at4 = speedOf(cur.balls.A);
    if (escapeOffAt < 0 && !cur.balls.A.escape) escapeOffAt = t;
  });
  check('small ball buff: during the 2 s the ball really runs 30% faster', near(at15, cfg.maxSpeed * (1 + cfg.escapeBoost), 0.4));
  check('small ball buff: it ends by itself after 2 s and speed falls back to normal', near(escapeOffAt, cfg.escapeSeconds, DT * 2) && near(at4, cfg.maxSpeed, 0.15));

  // Stacking with hills: hill boost (up to +30%) and escape boost (+30%) add up to 160%; they never exceed it.
  const withHill = (terrain: Terrain, dir: number, escape: boolean) => {
    const eh = createSnowball({ arenaRadius: 100000, growthPerUnit: 0, terrain });
    let s0 = place(fresh(eh, ['A']), 'A', { x: 0, z: 0, vx: dir * cfg.maxSpeed, ...(escape ? { escapeUntil: 1e9, escape: true } : {}) });
    s0 = steer(eh, s0, 'A', dir, 0, 1000);
    const { state } = run(eh, s0, 7);
    return { speed: speedOf(state.balls.A), factor: (eh.view(state) as { balls: Record<string, { speedFactor: number }> }).balls.A.speedFactor };
  };
  const both = withHill(plane(0.3), -1, true);
  check('speed limit: rolling downhill right after hitting a big ball goes beyond 130% - up to 160% of base speed',
    both.speed > cfg.maxSpeed * cfg.downhillMaxFactor + 0.5 && near(both.speed, cfg.maxSpeed * 1.6, 0.4) && near(both.factor, 1.6, 1e-9));
  check('speed limit: 160% is the hard ceiling (hill boost + escape boost)', both.factor <= cfg.downhillMaxFactor + cfg.escapeBoost + 1e-9);
  const hillOnly = withHill(plane(0.3), -1, false);
  check('speed limit: without the escape boost a downhill roll still tops out at 130%', near(hillOnly.speed, cfg.maxSpeed * cfg.downhillMaxFactor, 0.3));
  const uphillEscape = withHill(plane(0.3), 1, true);
  check('speed limit: escaping uphill nets the two together (90% + 30% = 120%)', near(uphillEscape.factor, cfg.uphillMinFactor + cfg.escapeBoost, 1e-9) && near(uphillEscape.speed, cfg.maxSpeed * 1.2, 0.3));
}
{
  // ---- floors and options ----
  const tiny = cfg.minRadius ** 2 + 0.0005;
  const low = oneHit(hitEngine, { snow: 4 }, { snow: tiny }, 6);
  check('damage: a ball never shrinks below the minimum radius', low.balls.B.snow >= cfg.minRadius ** 2 - 1e-12);
  const steal = createSnowball({ terrain: FLAT, growthPerUnit: 0, frictionRate: 0, accelRate: 0, damageIsStolen: true });
  const stolen = oneHit(steal, { snow: 4 }, { snow: 1 }, 6);
  check('config: damageIsStolen makes the attacker gain the snow the victim loses (total snow conserved)', near(totalSnow(stolen), 5, 1e-9) && !near(stolen.balls.A.snow, 4));
  check('damage: by default the lost snow is simply gone', totalSnow(oneHit(hitEngine, { snow: 4 }, { snow: 1 }, 6)) < 5 - 1e-6);
}
{
  // Two balls steered straight into each other for 10 s must not get stuck grinding.
  const headOn = (e: E, snowA: number) => {
    let s = place(place(fresh(e, ['A', 'B']), 'A', { x: -3, z: 0, snow: snowA }), 'B', { x: 3, z: 0 });
    s = steer(e, steer(e, s, 'A', 1, 0, 1000), 'B', -1, 0, 1000);
    let overlap = 0, contact = 0, ticks = 0, hits = 0, lastHitAt = -Infinity, minGapBetweenHits = Infinity;
    let wasImmune = false;
    const { state } = run(e, s, 10, 1000, (st, now) => {
      ticks++;
      if (gap(st) < -1e-3) overlap++;
      if (gap(st) < 0.02) contact++;
      const immune = st.balls.A.immune || st.balls.B.immune;
      if (immune && !wasImmune) { hits++; minGapBetweenHits = Math.min(minGapBetweenHits, now - lastHitAt); lastHitAt = now; }
      wasImmune = immune;
    });
    return { state, overlap: overlap / ticks, contact: contact / ticks, hits, minGapBetweenHits };
  };
  const equalPair = headOn(engine, 1);
  // (Faster balls spend more time touching in non-stop head-on charging: ~9% at speed 7.8, ~12% at 9, ~22% at 11. They never overlap.)
  check('stuck (equal balls): never overlapping, and apart most of the time', equalPair.overlap < 0.05 && equalPair.contact < 0.3);
  check('stuck (equal balls): they keep colliding and separating, and both are hurt equally', equalPair.hits >= 8 && near(equalPair.state.balls.A.snow, equalPair.state.balls.B.snow, 0.05));
  const unequalPair = headOn(engine, 1.3);
  check('stuck (leader vs smaller): never overlapping, and apart most of the time', unequalPair.overlap < 0.05 && unequalPair.contact < 0.3);
  check('stuck (leader vs smaller): many hits in 10 s, never closer together than the immunity window', unequalPair.hits >= 8 && unequalPair.minGapBetweenHits >= cfg.immunityMs - 1e-6);
  const { A, B } = unequalPair.state.balls;
  check('stuck (leader vs smaller): 10 s of NON-STOP head-on ramming wears both down to the minimum size, and no further',
    A.snow >= cfg.minRadius ** 2 - 1e-9 && B.snow >= cfg.minRadius ** 2 - 1e-9 && A.snow < 1.3 && B.snow < 1);
}

// ================= winner and scores =================
{
  const s = place(place(fresh(engine, ['A', 'B', 'C']), 'A', { snow: 4 }), 'B', { snow: 1 });
  check('winner: the biggest ball wins', engine.getWinner(s) === 'A');
  check('scores: size = radius × 100', JSON.stringify(engine.scores(s)) === JSON.stringify({ A: 200, B: 100, C: 100 }));
  const tied = place(place(fresh(engine, ['A', 'B']), 'A', { snow: 2.25 }), 'B', { snow: 2.25 });
  check('winner: an exact tie is a draw', engine.getWinner(tied) === null);
  const visibleTie = place(place(fresh(engine, ['A', 'B']), 'A', { snow: 1 }), 'B', { snow: 1.008 });
  check('winner: a tie at the displayed (rounded) size is a draw too', engine.getWinner(visibleTie) === null && engine.scores(visibleTie).A === engine.scores(visibleTie).B);
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
  const script = (e: E) => {
    const s = steer(e, steer(e, fresh(e, ['A', 'B']), 'A', 1, 0.3, 1000), 'B', -1, 0, 1000);
    return JSON.stringify(run(e, s, 8).state);
  };
  check('purity: the same inputs (and the same random layout) always give the same result (deterministic)', script(engine) === script(engine) && script(createSnowball({ random: mulberry32(9) })) === script(createSnowball({ random: mulberry32(9) })));
}
{
  const s = place(place(fresh(engine, ['A', 'B']), 'A', { x: 1.23456, immune: true }), 'B', { snow: 2.25 });
  const v = engine.view(s);
  check('view: shaped for phones (game id, arena size, per-player ball)', v.gameId === 'snowball' && v.arenaRadius === cfg.arenaRadius && Object.keys(v.balls).join() === 'A,B');
  check('view: positions are rounded and radius is the real radius', v.gameId === 'snowball' && v.balls.A.x === 1.23 && near(v.balls.B.radius, 1.5, 1e-3));
  check('view: includes the speed, buff and leader fields on every ball', (() => { const v2 = engine.view(s); return v2.gameId === 'snowball' && Object.values(v2.balls).every((x) => x.speedFactor === 1 && x.hillFactor === 1 && x.slowStacks === 0 && x.boostStacks === 0 && x.escape === false && x.leader === false); })());
  check('view: carries the immune flash flag', v.gameId === 'snowball' && v.balls.A.immune === true && v.balls.B.immune === false);
}

console.log(failures === 0 ? '\nAll snowball engine checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
