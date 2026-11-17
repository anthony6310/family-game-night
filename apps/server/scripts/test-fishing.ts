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

const engine = createFishing();
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
  check('no fish are placed above the finish line', fresh().fish.every((f) => f.baseY > cfg.endDepth + 1));
  const fast = { min: Math.min(...fresh().fish.map((f) => f.speed)), max: Math.max(...fresh().fish.map((f) => f.speed)) };
  check('fish speeds are 60% of the original 3.5 to 7.5', fast.min >= 2.1 - 1e-9 && fast.max <= 4.5 + 1e-9);
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
  st.hooks.a.fish = 3; st.hooks.b.fish = 2;
  check('most fish wins', engine.getWinner(st) === 'a');
  st.hooks.b.fish = 3;
  check('a tie is a draw', engine.getWinner(st) === null);
  st.hooks.a.fish = 0; st.hooks.b.fish = 0;
  check('nobody catching anything is a draw', engine.getWinner(st) === null);
  st.hooks.a.fish = 4;
  check('scores are the fish counts', JSON.stringify(engine.scores(st)) === '{"a":4,"b":0}');
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

console.log(failures === 0 ? '\nAll fishing checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
