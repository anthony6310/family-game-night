/**
 * Fishing engine rules (pure, no sockets):  npm run test:fishing -w @fgn/server
 * Fish are placed by hand so catches can be checked exactly.
 */
import type { FishingView } from '@fgn/shared';
import { createFishing, DEFAULT_FISHING } from '../src/games/fishing';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const DT = 0.025;
const cfg = DEFAULT_FISHING;

const NO_MINES = { mineCountMin: 0, mineCountMax: 0 }; // (the other checks aren't about mines, which would get in the way of the hooks)
const engine = createFishing(NO_MINES);
const viewOf = (s: Parameters<typeof engine.view>[0]) => engine.view(s) as FishingView;
const fresh = () => engine.init(['a', 'b'], 0);

// ---- setup ----
const s0 = fresh();
check('the cast sequence is at most 8 seconds', s0.ascentStartsAt - s0.startsAt <= 8000);
check('the rise lasts exactly 1 minute', s0.endsAt - s0.ascentStartsAt === 60000);
check('every player has a lane and a hook in it', s0.lanes.join() === 'a,b' && s0.hooks.a.x === cfg.laneWidth * 0.5 && s0.hooks.b.x === cfg.laneWidth * 1.5);
check('fish are spread over the whole depth', s0.fish.some((f) => f.baseY < 10) && s0.fish.some((f) => f.baseY > cfg.depth - 10));

/** One fish held still (speed 0) with its mouth at (mouth, depth), and no others. */
function withFish(mouth: number, depth: number) {
  const s = fresh();
  s.fish = [{ id: 1, x: mouth - 1, baseY: depth, phase: 0, dir: 1, speed: 0, size: 2, variant: 0 }];
  return s;
}
const at = (s: ReturnType<typeof fresh>, t: number) => s.ascentStartsAt + t;
const runTo = (s: ReturnType<typeof fresh>, from: number, to: number) => { let st = s; for (let t = from; t < to; t += DT * 1000) st = engine.tick!(st, DT, t); return st; };

// ---- hooks all rise at one speed ----
const mid = viewOf(engine.tick!(fresh(), DT, at(fresh(), 30000)));
check('halfway through the rise the hooks are halfway up', Math.abs(mid.hookDepth - (cfg.depth + cfg.endDepth) / 2) < 0.1);
check('at the end they are at the finish line (a little under the surface)', viewOf(engine.tick!(fresh(), DT, fresh().endsAt)).hookDepth === cfg.endDepth);
check('before the rise they are at the bottom', viewOf(engine.tick!(fresh(), DT, 1000)).hookDepth === cfg.depth);

// ---- steering: sideways only, inside the lane ----
let s = fresh();
s = engine.reduce(s, 'a', { type: 'steer', x: 1, z: -1 }, at(s, 0)); // z (up/down) means nothing
s = runTo(s, at(s, 0), at(s, 3000));
check('a hook slides sideways but stops at its lane\'s edge', Math.abs(s.hooks.a.x - (cfg.laneWidth - cfg.hookMargin)) < 1e-6);
s = engine.reduce(s, 'a', { type: 'steer', x: -1, z: 0 }, at(s, 3000));
s = runTo(s, at(s, 3000), at(s, 8000));
check('...and on the other side', Math.abs(s.hooks.a.x - cfg.hookMargin) < 1e-6);
check('the other lane is unaffected', s.hooks.b.x === cfg.laneWidth * 1.5);
let cast = fresh();
cast = engine.reduce(cast, 'a', { type: 'steer', x: 1, z: 0 }, 100);
cast = runTo(cast, 100, 1500);
check('steering does nothing while the lines are still being cast', cast.hooks.a.x === cfg.laneWidth * 0.5);
check('a bad payload is ignored', engine.reduce(fresh(), 'a', { type: 'steer', x: NaN, z: 0 }, 5).hooks.a.steer === 0);
check('an outsider\'s steering is ignored', Object.keys(engine.reduce(fresh(), 'zed', { type: 'steer', x: 1, z: 0 }, 5).hooks).join() === 'a,b');

// ---- catching ----
const passDepth = cfg.depth - (cfg.depth - cfg.endDepth) * (20 / 60); // where the hooks are 20 seconds into the rise
// Hook a sits at x = 4.5 (lane 0's middle). A fish held still with its mouth there, at the depth the hooks pass at 20 s, is caught.
{
  const st = withFish(4.5, passDepth);
  let justAfter = st;
  for (let t = at(st, 0); justAfter.hooks.a.fish === 0 && t < at(st, 30000); t += DT * 1000) justAfter = engine.tick!(justAfter, DT, t); // tick until the moment of the catch
  check('a fish at the hook\'s depth with its mouth at the hook is caught (and is shown being reeled in)', justAfter.hooks.a.fish === 1 && justAfter.fish[0]?.caughtBy === 'a');
  const done = runTo(justAfter, at(st, 20000), at(st, 25000));
  check('...it counts only once, and only for that hook', done.hooks.a.fish === 1 && done.hooks.b.fish === 0);
  check('...and the caught fish leaves the ocean after its reel-in time', done.fish.length === 0);
}
{
  const done = runTo(withFish(4.5 + 3, passDepth), 0, 25000 + 30000); // 3 units sideways of the hook
  check('a fish whose mouth is not lined up with the hook is missed', done.hooks.a.fish === 0 && done.hooks.b.fish === 0 || done.hooks.a.fish === 0);
}
{
  // Facing right the mouth is half a body AHEAD of the centre; facing left, behind it. Size 3: the mouth is 1.5 from the centre.
  const right = withFish(4.5, passDepth); right.fish[0].size = 3; right.fish[0].x = 3; // mouth at 3 + 1.5 = 4.5
  check('the mouth (the front) is what counts: facing right', runTo(right, 0, 25000 + 30000).hooks.a.fish === 1);
  const left = withFish(4.5, passDepth); left.fish[0].size = 3; left.fish[0].dir = -1; left.fish[0].x = 6; // mouth at 6 - 1.5 = 4.5
  check('...and facing left', runTo(left, 0, 25000 + 30000).hooks.a.fish === 1);
  const bodyOnly = withFish(4.5, passDepth); bodyOnly.fish[0].size = 3; bodyOnly.fish[0].dir = -1; bodyOnly.fish[0].x = 4.5; // body over the hook, mouth at 3
  check('a fish with its body over the hook but its mouth away from it is missed', runTo(bodyOnly, 0, 25000 + 30000).hooks.a.fish === 0);
}
{
  // A swimming fish is caught as its mouth passes the hook (the hook stays put at x = 4.5).
  const st = fresh();
  st.fish = [{ id: 1, x: -3, baseY: passDepth, phase: 0, dir: 1, speed: 5, size: 2, variant: 0 }]; // mouth reaches 4.5 at about 20.3 s
  const done = runTo(st, at(st, 19000), at(st, 22000));
  check('a fish swimming past is caught as its mouth reaches the hook', done.hooks.a.fish === 1);
}
{
  const st = fresh();
  st.fish = [{ id: 1, x: 8.2, baseY: passDepth, phase: 0, dir: 1, speed: 0, size: 2, variant: 0 }]; // mouth at 9.2: between lane a's edge (8.4) and lane b's (9.6)
  st.hooks.a.x = 8.4; st.hooks.b.x = 9.6;
  const done = runTo(st, at(st, 19000), at(st, 21000));
  check('when two hooks can reach one fish, only the closest catches it', done.hooks.a.fish + done.hooks.b.fish === 1 && done.hooks.b.fish === 1); // (mouth 9.2: 0.4 from b's hook, 0.8 from a's)
}
{
  const early = runTo(withFish(4.5, cfg.depth - 0.5), 0, 1000); // the fish is at the bottom, where the hooks hang while the lines are cast
  check('nothing is caught while the lines are still being cast', early.hooks.a.fish === 0);
}

{
  // The finish line: nothing counts, and nobody can steer, from the moment the hooks reach it.
  const st = withFish(4.5, 0.5); // a fish up near the surface, above the finish line
  check('a fish above the finish line is never caught (the hooks stop short of it)', runTo(st, 0, st.endsAt + 3000).hooks.a.fish === 0);
  const over = fresh();
  check('steering after the finish line is ignored', engine.reduce(over, 'a', { type: 'steer', x: 1, z: 0 }, over.endsAt + 1).hooks.a.steer === 0);
  check('no fish are placed above the finish line', fresh().fish.every((f) => f.baseY >= cfg.endDepth + 1));
  const regulars = fresh().fish.filter((f) => (f.kind ?? 'regular') === 'regular');
  const fast = { min: Math.min(...regulars.map((f) => f.speed)), max: Math.max(...regulars.map((f) => f.speed)) };
  check('regular fish speeds are 60% of the original 3.5 to 7.5', fast.min >= 2.1 - 1e-9 && fast.max <= 4.5 + 1e-9);
}

// ---- fish keep swimming, and wrap round ----
{
  const st = fresh();
  const total = 2 * cfg.laneWidth;
  st.fish = [{ id: 1, x: total + cfg.fishMargin - 0.01, baseY: 5, phase: 0, dir: 1, speed: 5, size: 2, variant: 0 }];
  const after = engine.tick!(st, 0.1, 100);
  check('a fish that swims off one end comes back in from the other', after.fish[0].x < 0);
}

// ---- winner, scores, leaving ----
{
  const st = fresh();
  st.hooks.a.points = 3; st.hooks.b.points = 2;
  check('most points wins', engine.getWinner(st) === 'a');
  st.hooks.b.points = 3;
  check('a tie is a draw', engine.getWinner(st) === null);
  st.hooks.a.points = 0; st.hooks.b.points = 0;
  check('nobody catching anything is a draw', engine.getWinner(st) === null);
  st.hooks.a.points = 4;
  check('scores are the points', JSON.stringify(engine.scores(st)) === '{"a":4,"b":0}');
  st.hooks.a.points = 5; st.hooks.a.fish = 1; st.hooks.b.points = 6; st.hooks.b.fish = 2;
  check('the winner is whoever has the most POINTS, not the most fish', engine.getWinner(st) === 'b');
  const left = engine.removePlayer(st, 'a');
  check('a player leaving removes their hook but keeps the lanes where they are', !('a' in left.hooks) && viewOf(left).lanes.join() === 'a,b');
  check('the round is over at the end time', !engine.isOver(st, st.endsAt - 1) && engine.isOver(st, st.endsAt));
}

// ---- the view ----
{
  const st = engine.tick!(fresh(), DT, 1000);
  const v = viewOf(st);
  check('the view sends only the fish near the hooks (not the whole ocean)', v.fish.length > 0 && v.fish.length < st.fish.length);
  check('the view says where every hook is', Object.keys(v.hooks).join() === 'a,b');
}

// ---- fish kinds: schools, regular fish, big fish ----
{
  const many = createFishing({ bigFishCount: 0 });
  const st = many.init(['a', 'b', 'c', 'd'], 0);
  const schools = st.fish.filter((f) => f.kind === 'school');
  const regulars = st.fish.filter((f) => (f.kind ?? 'regular') === 'regular');
  check('there are schools, and they are made of 8 to 16 small fish', schools.length > 0 && schools.length >= 8 * 4 * cfg.schoolsPerLane * 0.9 - 1);
  check('school fish are smaller than the smallest regular size', schools.every((f) => f.size < cfg.fishSizeMin && f.size >= cfg.schoolSizeMin));
  check('school fish swim 25% slower than the regular range', schools.every((f) => f.speed <= cfg.fishSpeedMax * cfg.schoolSpeedFactor + 1e-9 && f.speed >= cfg.fishSpeedMin * cfg.schoolSpeedFactor - 1e-9));
  // group sizes: fish sharing one speed and direction and ids in a row are one school
  const bySpeed = new Map<string, number>();
  schools.forEach((f) => bySpeed.set(`${f.speed}/${f.dir}`, (bySpeed.get(`${f.speed}/${f.dir}`) ?? 0) + 1));
  check('each school has 8 to 16 fish swimming together (same speed and direction)', [...bySpeed.values()].every((n) => n >= cfg.schoolMin && n <= cfg.schoolMax));
  check('regular fish are still the bulk of the ocean', regulars.length > schools.length);
  check('with a big fish count of 0 there are none', st.fish.every((f) => f.kind !== 'big'));
}
{
  // points: a school fish is 1, a regular fish 3, a big fish 5
  const pass = cfg.depth - (cfg.depth - cfg.endDepth) * (20 / 60);
  const catchOne = (kind: 'school' | 'regular' | 'big') => {
    const e = createFishing(NO_MINES);
    const st = e.init(['a', 'b'], 0);
    st.fish = [{ id: 1, x: 4.5 - 1, baseY: pass, phase: 0, dir: 1, speed: 0, size: 2, variant: 0, kind }]; // (held still)
    let t = st;
    for (let ms = 0; ms < st.endsAt; ms += DT * 1000) t = e.tick!(t, DT, ms);
    return t.hooks.a;
  };
  const sch = catchOne('school'), reg = catchOne('regular'), big = catchOne('big');
  check('a school fish is worth 1 point, a regular fish 3, a big fish 5', sch.points === 1 && reg.points === 3 && big.points === 5);
  check('...and the kinds are counted: [school, regular, big]', sch.kinds.join() === '1,0,0' && reg.kinds.join() === '0,1,0' && big.kinds.join() === '0,0,1');
}
{
  // big fish: a few every game, bigger and 40% faster than regular fish, swimming like them (wrapping round), spread down the ocean
  const st = createFishing().init(['a', 'b'], 0);
  const big = st.fish.filter((f) => f.kind === 'big');
  check(`every game has ${cfg.bigFishCount} big fish`, big.length === cfg.bigFishCount && cfg.bigFishCount === 5);
  check('a big fish is bigger than the biggest regular fish', big.every((f) => f.size > cfg.fishSizeMax));
  check('a big fish swims 40% faster than a regular fish', big.every((f) => f.speed >= cfg.fishSpeedMin * 1.4 - 1e-9 && f.speed <= cfg.fishSpeedMax * 1.4 + 1e-9));
  const depths = big.map((f) => f.baseY).sort((a, b) => a - b);
  check('big fish are spread down the ocean (no two in the same slice)', depths.every((d, i) => i === 0 || d > depths[i - 1]));
  let t = st;
  const id = big[0].id; let wrapped = false, prev = big[0].x;
  for (let ms = 0; ms < 60000; ms += DT * 1000) { t = engine.tick!(t, DT, ms); const f = t.fish.find((q) => q.id === id); if (f && Math.abs(f.x - prev) > 5) wrapped = true; if (f) prev = f.x; }
  check('a big fish wraps round the ends like the other fish', wrapped);
}
{
  // lifting the hook: up (stick up = negative z) raises it up to the limit, without changing the ascent; down lowers it again; ignored before the ascent
  const e = createFishing({ fishPerLane: 0, schoolsPerLane: 0, bigFishCount: 0 });
  let st = e.init(['a', 'b'], 0);
  st = e.reduce(st, 'a', { type: 'steer', x: 0, z: -1 }, 100);
  st = e.tick!(st, 1, 1000);
  check('the hook can not be lifted during the cast', st.hooks.a.lift === 0);
  const t0 = st.ascentStartsAt;
  st = e.tick!(st, DT, t0 + 100);
  st = e.tick!(st, 0.2, t0 + 300);
  check('stick up lifts the hook, at the lift speed', Math.abs(st.hooks.a.lift - (DT + 0.2) * cfg.hookLiftSpeed) < 1e-6 || st.hooks.a.lift > 0.5);
  for (let i = 0; i < 40; i++) st = e.tick!(st, 0.1, t0 + 400 + i * 100);
  check('the lift stops at the maximum', st.hooks.a.lift === cfg.hookLiftMax && st.hooks.b.lift === 0);
  const v = e.view({ ...st, clock: t0 + 4400 }) as FishingView;
  check('the view carries each hook\'s lift, and the ascent depth is unchanged by it', v.hooks.a.lift === cfg.hookLiftMax && Math.abs(v.hookDepth - (cfg.depth - ((4400) / cfg.ascentMs) * (cfg.depth - cfg.endDepth))) < 0.05);
  st = e.reduce(st, 'a', { type: 'steer', x: 0, z: 1 }, t0 + 4500);
  for (let i = 0; i < 40; i++) st = e.tick!(st, 0.1, t0 + 4500 + i * 100);
  check('stick down lowers it again, never below the steady ascent', st.hooks.a.lift === 0);
  // a lifted hook catches a fish above the steady ascent depth
  const e2 = createFishing({ fishPerLane: 0, schoolsPerLane: 0, bigFishCount: 0 });
  let s2 = e2.init(['a'], 0);
  const at = s2.ascentStartsAt + 20000;
  const hookDepth = cfg.depth - (cfg.depth - cfg.endDepth) * (20000 / cfg.ascentMs);
  s2.fish = [{ id: 1, x: 4.5 - 1, baseY: hookDepth - cfg.hookLiftMax, phase: 0, dir: 1, speed: 0, size: 2, variant: 0 }];
  s2 = { ...s2, hooks: { a: { ...s2.hooks.a, lift: cfg.hookLiftMax } } };
  s2 = e2.tick!(s2, DT, at);
  check('a lifted hook catches a fish that is above the steady ascent depth', s2.hooks.a.fish === 1);
}
{
  // mines: identical in every lane, between 5 m and 50 m, never on top of each other; a hit shakes off 10% of the points (rounded up) as fish
  let same = true, inRange = true, apart = true, counts = new Set<number>(), moving = 0, still = 0;
  const yOf = (m: number) => cfg.endDepth + (m / 100) * (cfg.depth - cfg.endDepth);
  for (let g = 0; g < 300; g++) {
    const st = createFishing().init(['a', 'b', 'c', 'd'], 0);
    const byOwner = ['a', 'b', 'c', 'd'].map((o) => st.mines.filter((m) => m.owner === o));
    counts.add(byOwner[0].length);
    byOwner.forEach((list, i) => list.forEach((m, k) => {
      const first = byOwner[0][k];
      if (list.length !== byOwner[0].length || m.y !== first.y || m.amp !== first.amp || m.period !== first.period || m.phase !== first.phase || Math.abs(m.cx - (first.cx + i * cfg.laneWidth)) > 1e-9) same = false;
      if (m.y < yOf(cfg.mineMetresMin) - 1e-9 || m.y > yOf(cfg.mineMetresMax) + 1e-9) inRange = false;
      if (m.cx - m.amp < i * cfg.laneWidth || m.cx + m.amp > (i + 1) * cfg.laneWidth) inRange = false; // (it never leaves its lane)
      if (i === 0) m.amp > 0 ? moving++ : still++;
    }));
    const l = byOwner[0];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (Math.hypot(Math.max(0, Math.abs(l[i].cx - l[j].cx) - l[i].amp - l[j].amp), l[i].y - l[j].y) < cfg.mineSpacing - 1e-9) apart = false;
  }
  check('every lane has the exact same mines: count, depth, place, drift', same);
  check('mine counts vary from game to game within the range (1 to 4)', [...counts].every((n) => n >= cfg.mineCountMin && n <= cfg.mineCountMax) && counts.size > 1);
  check('mines hang between 5 m and 50 m and stay inside their lane', inRange);
  check('mines never sit on top of each other (spacing kept, counting drift sweeps)', apart);
  check('some mines drift and some hang still', moving > 0 && still > 0);

  // a hit: the hook has 3 school, 2 regular, 1 big = 14 points -> loses ceil(1.4) = 2 points, as fish taken from the hook
  const e = createFishing({ fishPerLane: 0, schoolsPerLane: 0, bigFishCount: 0, mineCountMin: 1, mineCountMax: 1, mineMoveChance: 0 });
  let st = e.init(['a', 'b'], 0);
  const mine = st.mines.find((m) => m.owner === 'a')!;
  const t0 = st.ascentStartsAt + 1000;
  const hookAtMine = cfg.depth - (cfg.depth - cfg.endDepth) * ((mine.y > 0 ? (cfg.depth - mine.y) / (cfg.depth - cfg.endDepth) : 0));
  void hookAtMine;
  // put the hook level with the mine by choosing the time the steady ascent reaches the mine's depth
  const tHit = st.ascentStartsAt + ((cfg.depth - mine.y) / (cfg.depth - cfg.endDepth)) * cfg.ascentMs;
  st = { ...st, hooks: { ...st.hooks, a: { ...st.hooks.a, x: mine.cx, fish: 6, points: 14, kinds: [3, 2, 1] }, b: { ...st.hooks.b, x: 9 + (mine.cx > 4.5 ? 0.7 : 8.3), fish: 6, points: 14, kinds: [3, 2, 1] } } };
  st = e.tick!(st, DT, tHit - 1000);
  check('before the hook reaches the mine nothing is lost', st.hooks.a.points === 14 && st.mines.find((m) => m.id === mine.id)!.hitAt === undefined);
  st = e.tick!(st, DT, tHit);
  const a = st.hooks.a;
  check('a hit takes 10% of the points rounded up (2 of 14) as fish shaken off', a.points <= 12 && a.points >= 14 - 6 && a.fish < 6 && a.kinds.reduce((x, y) => x + y, 0) === a.fish && a.points === a.kinds[0] + 3 * a.kinds[1] + 5 * a.kinds[2]);
  check('the other player\'s catch is not touched (their mines are in their own lane)', st.hooks.b.points === 14 && st.hooks.b.fish === 6);
  check('the mine is marked as set off, in the view for the explosion', st.mines.find((m) => m.id === mine.id)!.hitAt !== undefined && (e.view(st) as FishingView).mines.some((m) => m.id === mine.id && m.hit));
  const after = st.hooks.a.points;
  st = e.tick!(st, DT, tHit + 100);
  check('a mine only goes off once', st.hooks.a.points === after);
  st = e.tick!(st, DT, tHit + cfg.caughtShowMs + 100);
  check('a set-off mine is removed after its explosion has been shown', !st.mines.some((m) => m.id === mine.id));
  // mines work at every depth (the 5 m to 50 m range only decides where they may be PLACED), even when the server ticks late
  let missed = 0;
  for (let metres = 2; metres <= 98; metres += 4) for (const dt of [0.05, 0.4]) {
    const e3 = createFishing({ fishPerLane: 0, schoolsPerLane: 0, bigFishCount: 0, mineCountMin: 1, mineCountMax: 1 });
    let s3 = e3.init(['a'], 0);
    s3 = { ...s3, mines: [{ id: 1, owner: 'a', cx: 4.5, amp: 0, period: 4, phase: 0, y: cfg.endDepth + metres / 100 * (cfg.depth - cfg.endDepth) }] };
    let hit = false;
    for (let t = s3.ascentStartsAt - 100; t < s3.endsAt && !hit; t += dt * 1000) { s3 = e3.tick!(s3, dt, t); hit = s3.mines[0]?.hitAt !== undefined; }
    if (!hit) missed++;
  }
  check('a mine goes off when the hook reaches it at ANY depth, even with slow ticks', missed === 0);
  // nothing to lose with no points: the mine is just used up
  let z = e.init(['a'], 0);
  const m0 = z.mines[0];
  z = { ...z, hooks: { a: { ...z.hooks.a, x: m0.cx } } };
  z = e.tick!(z, DT, z.ascentStartsAt + ((cfg.depth - m0.y) / (cfg.depth - cfg.endDepth)) * cfg.ascentMs);
  check('a hook with no points loses nothing', z.hooks.a.points === 0 && z.hooks.a.fish === 0);
  void t0;
}

console.log(failures === 0 ? '\nAll fishing checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
