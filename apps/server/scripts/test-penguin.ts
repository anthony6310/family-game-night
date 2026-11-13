/**
 * Penguin Lasso engine rules (pure, no sockets):  npm run test:penguin -w @fgn/server
 * The skater is driven along exact paths (we set its position each tick) so the loop rules can be checked precisely.
 */
import type { PenguinLassoView } from '@fgn/shared';
import { createPenguinLasso } from '../src/games/penguinLasso';
import { mulberry32 } from '../src/games/terrain';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const DT = 0.025;

/** A round with 1 penguin held still at `penguin`, and skater "a" teleported to `start` with an empty trail. */
function setup(penguin: { x: number; z: number }, start: { x: number; z: number }) {
  const engine = createPenguinLasso({ random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
  let state = engine.init(['a', 'b'], 0);
  state.penguins = [{ ...state.penguins[0], ...penguin, walking: false, changeAt: 1e12 }];
  state.skaters.a = { ...state.skaters.a, ...start, trail: [{ ...start, t: 0 }] };
  return { engine, state, now: 0 };
}
type Setup = ReturnType<typeof setup>;
/** Moves skater "a" along `pos(i)` for i = 0..steps (one tick each), at the speed implied by the path. */
function drive(s: Setup, steps: number, pos: (i: number) => { x: number; z: number }) {
  for (let i = 0; i <= steps; i++) {
    const p = pos(i), q = pos(i + 1);
    s.state.skaters.a = { ...s.state.skaters.a, x: p.x, z: p.z, vx: (q.x - p.x) / DT, vz: (q.z - p.z) / DT };
    s.now += DT * 1000;
    s.state = s.engine.tick!(s.state, DT, s.now);
  }
}
const circle = (cx: number, cz: number, r: number, speed: number) => (i: number) => {
  const theta = (i * DT * speed) / r;
  return { x: cx + r * Math.cos(theta), z: cz + r * Math.sin(theta) };
};
const trailLength = (s: Setup) => s.state.skaters.a.trail.reduce((n, p, i, a) => (i ? n + Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) : 0), 0);

// ---- a loop around a penguin catches it ----
{
  const s = setup({ x: 10, z: 10 }, { x: 15, z: 10 });
  const steps = Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)); // a bit more than one full lap at speed 8
  drive(s, steps, circle(10, 10, 5, 8));
  check('skating a closed loop around a penguin puts it in the bag', s.state.skaters.a.carried === 1 && s.state.penguins[0].caughtBy === 'a');
  check('the loop is reported for a flash, with its corners', s.state.loops.length === 1 && s.state.loops[0].points.length > 8 && s.state.loops[0].playerId === 'a');
  const view = s.engine.view(s.state) as PenguinLassoView;
  check('the view says who caught it and what they carry', view.penguins[0].caughtBy === 'a' && view.skaters.a.carried === 1);
  check('a caught penguin in the bag is NOT a point yet', s.state.skaters.a.banked === 0 && s.engine.scores(s.state).a === 0 && s.engine.getWinner(s.state) === null);
  // let time pass: the caught penguin leaves the list and a new one arrives
  for (let i = 0; i < 160; i++) { s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now); }
  check('a caught penguin leaves the ice and a replacement appears (the count stays the same)', s.state.penguins.length === 1 && !s.state.penguins[0].caughtBy);
  check('the used-up loop is gone: it cannot catch twice', s.state.skaters.a.carried === 1);

  // ---- cashing in at the igloo ----
  const home = s.state.igloos.a;
  const view2 = s.engine.view(s.state) as PenguinLassoView;
  check('every player has an igloo, solid and with a cash-in zone', Object.keys(view2.igloos).length === 2 && view2.iglooRadius > 0 && view2.cashRadius > view2.iglooRadius);
  s.state.skaters.a = { ...s.state.skaters.a, x: s.state.igloos.b.x + 5, z: s.state.igloos.b.z, vx: 0, vz: 0 };
  s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now);
  check("someone else's igloo does not cash you in", s.state.skaters.a.carried === 1 && s.state.skaters.a.banked === 0);
  s.state.skaters.a = { ...s.state.skaters.a, x: home.x - 20, z: home.z, vx: 0, vz: 0 };
  s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now);
  check('far from your igloo nothing is cashed in', s.state.skaters.a.carried === 1 && s.state.skaters.a.banked === 0);
  s.state.skaters.a = { ...s.state.skaters.a, x: home.x - 5, z: home.z, vx: 0, vz: 0 };
  s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now);
  check('skating near your own igloo cashes in the whole bag', s.state.skaters.a.carried === 0 && s.state.skaters.a.banked === 1 && s.engine.scores(s.state).a === 1);
  check('the winner is whoever banked the most', s.engine.getWinner(s.state) === 'a');
  // igloos are solid
  s.state.skaters.a = { ...s.state.skaters.a, x: home.x + 0.5, z: home.z, vx: -3, vz: 0 };
  s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now);
  check('igloos are solid: a skater is pushed out of one', Math.hypot(s.state.skaters.a.x - home.x, s.state.skaters.a.z - home.z) >= 2.6 + 1 - 0.01);
}

// ---- an open path does not ----
{
  const s = setup({ x: 10, z: 10 }, { x: 0, z: 10 });
  drive(s, 200, (i) => ({ x: i * DT * 8, z: 10 + (i % 2 ? 0.0 : 0) }));
  check('an open path past a penguin catches nothing', s.state.skaters.a.carried === 0);
}
// ---- a half circle does not close ----
{
  const s = setup({ x: 10, z: 10 }, { x: 15, z: 10 });
  drive(s, Math.floor((Math.PI * 5) / (8 * DT)), circle(10, 10, 5, 8));
  check('half a circle is not a loop', s.state.skaters.a.carried === 0);
}
// ---- a loop that misses the penguin ----
{
  const s = setup({ x: 30, z: 10 }, { x: 15, z: 10 });
  drive(s, Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)), circle(10, 10, 5, 8));
  check('a closed loop that does not enclose the penguin catches nothing', s.state.skaters.a.carried === 0 && s.state.loops.length === 1);
}
// ---- the trail is limited, so a loop that is too big never closes ----
{
  const s = setup({ x: 10, z: 10 }, { x: 22, z: 10 });
  drive(s, Math.ceil((2 * Math.PI * 12 + 5) / (8 * DT)), circle(10, 10, 12, 8)); // circumference ~75 > the 45 limit
  check('the trail never grows past its length limit', trailLength(s) <= 45 + 0.6);
  check('a loop bigger than the trail allows cannot be closed', s.state.skaters.a.carried === 0 && s.state.loops.length === 0);
}
// ---- standing still: the trail ages away ----
{
  const s = setup({ x: 10, z: 10 }, { x: 15, z: 10 });
  drive(s, 80, (i) => ({ x: 15 + Math.min(i, 40) * 0.25, z: 10 }));
  for (let i = 0; i < 12.5 / DT; i++) { s.now += DT * 1000; s.state = s.engine.tick!(s.state, DT, s.now); }
  check('trail older than its age limit disappears', s.state.skaters.a.trail.length <= 1);
}

// ---- map size and penguin numbers scale with the players, like Snowball ----
{
  const engine = createPenguinLasso({ random: mulberry32(1) });
  const two = engine.view(engine.init(['a', 'b'], 0)) as { arenaRadius: number; penguins: unknown[] };
  const eight = engine.view(engine.init(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 0)) as { arenaRadius: number; penguins: unknown[] };
  check('the rink grows with the player count (area proportional)', Math.abs(eight.arenaRadius / two.arenaRadius - 2) < 0.01);
  check('more players, more penguins', two.penguins.length === 8 && eight.penguins.length === 8 + 4 * 6);
}

// ---- penguins wander but stay on the ice; skaters stay in the rink ----
{
  const engine = createPenguinLasso({ random: mulberry32(3) });
  let state = engine.init(['a', 'b'], 0);
  state = engine.reduce(state, 'a', { type: 'steer', x: 1, z: 0 }, 0);
  const start = state.penguins.map((p) => [p.x, p.z]);
  let now = 0;
  let inside = true;
  for (let i = 0; i < 60 / DT; i++) {
    now += DT * 1000;
    state = engine.tick!(state, DT, now);
    for (const p of state.penguins) if (Math.hypot(p.x, p.z) > state.arenaRadius) inside = false;
    for (const s of Object.values(state.skaters)) if (Math.hypot(s.x, s.z) > state.arenaRadius) inside = false;
  }
  check('after a minute, penguins moved around aimlessly', state.penguins.some((p, i) => start[i] && Math.hypot(p.x - start[i][0], p.z - start[i][1]) > 3));
  check('penguins and skaters never leave the rink', inside);
  check('the skater who steered east is not stuck at the start', state.skaters.a.x !== engine.init(['a', 'b'], 0).skaters.a.x);
}

// ---- winner rules ----
{
  const engine = createPenguinLasso({ random: mulberry32(1) });
  const state = engine.init(['a', 'b'], 0);
  check('nobody banked anything: a draw', engine.getWinner(state) === null);
  state.skaters.a.banked = 2; state.skaters.b.banked = 2;
  check('a tie is a draw', engine.getWinner(state) === null);
  state.skaters.b.banked = 3;
  state.skaters.a.carried = 9; // a full bag that was never cashed in is worth nothing
  check('the most penguins wins', engine.getWinner(state) === 'b');
  check('the round is over once time is up', !engine.isOver(state, 59_000) && engine.isOver(state, 60_000));
  check('steering is validated: a bad payload is ignored', engine.reduce(state, 'a', { type: 'steer', x: NaN, z: 1 }, 1) === state);
}
console.log(failures === 0 ? '\nAll penguin checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
