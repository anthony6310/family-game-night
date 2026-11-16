/**
 * Penguin Lasso engine rules (pure, no sockets):  npm run test:penguin -w @fgn/server
 * The skater is driven along exact paths (we set its position each tick) so the loop rules can be checked precisely.
 */
import type { PenguinLassoView } from '@fgn/shared';
import { createPenguinLasso } from '../src/games/penguinLasso';
import { mulberry32 } from '../src/games/terrain';

/** Plain penguins only: no seals or bears, so the older checks (which count one point per animal) stay simple. */
const PLAIN = { sealChance: 0, bearChance: 0, guaranteeOneOfEach: false };
let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const DT = 0.025;

/** A round with 1 penguin held still at `penguin`, and skater "a" teleported to `start` with an empty trail. */
function setup(penguin: { x: number; z: number }, start: { x: number; z: number }) {
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
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
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(1) });
  const two = engine.view(engine.init(['a', 'b'], 0)) as { arenaRadius: number; penguins: unknown[] };
  const eight = engine.view(engine.init(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 0)) as { arenaRadius: number; penguins: unknown[] };
  check('the rink grows with the player count (area proportional)', Math.abs(eight.arenaRadius / two.arenaRadius - 2) < 0.01);
  check('more players, more penguins', two.penguins.length === 8 && eight.penguins.length === 8 + 4 * 6);
}

// ---- penguins wander but stay on the ice; skaters stay in the rink ----
{
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(3) });
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
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(1) });
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
// ---- seals and polar bears ----
{
  // A skater loops one still animal of `kind` (it is placed inside the loop and cannot move).
  const lasso = (kind: 'seal' | 'bear' | 'penguin') => {
    const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
    let state = engine.init(['a', 'b'], 0);
    state.penguins = [{ ...state.penguins[0], kind, x: 10, z: 10, walking: false, changeAt: 1e12 }];
    state.skaters.a = { ...state.skaters.a, x: 15, z: 10, trail: [{ x: 15, z: 10, t: 0 }] };
    const s = { engine, state, now: 0 } as Setup;
    drive(s, Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)), circle(10, 10, 5, 8));
    return s;
  };
  const seal = lasso('seal');
  check('a seal in the bag is worth 2 points (and does not slow you)', seal.state.skaters.a.carried === 2 && !seal.state.skaters.a.bag.includes('bear'));
  const bear = lasso('bear');
  check('a polar bear in the bag is worth 5 points, takes 3 of the 6 spaces and slows you (but does not fill the bag)', bear.state.skaters.a.carried === 5 && bear.state.skaters.a.carriedSpace === 3 && bear.state.skaters.a.bag.includes('bear') && !(bear.engine.view(bear.state) as PenguinLassoView).skaters.a.bagFull);
  const view = bear.engine.view(bear.state) as PenguinLassoView;
  check('everyone is told you are carrying a bear, and what is in the bag', view.skaters.a.carryingBear && view.skaters.a.carried === 5 && JSON.stringify(view.skaters.a.bag) === '["bear"]');
  // half speed: steer east for a while and compare with a skater with no bear
  const run = (bears: number) => {
    const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(2) });
    let state = engine.init(['a', 'b'], 0);
    state.skaters.a = { ...state.skaters.a, x: -20, z: 0, bag: Array(bears).fill('bear'), carried: bears * 5, carriedSpace: bears * 3 };
    state = engine.reduce(state, 'a', { type: 'steer', x: 1, z: 0 }, 0);
    let now = 0;
    for (let i = 0; i < 160; i++) { now += DT * 1000; state = engine.tick!(state, DT, now); }
    return Math.hypot(state.skaters.a.vx, state.skaters.a.vz);
  };
  const fast = run(0), half = run(1), third = run(2);
  check(`no bear: full speed; one bear: half speed (${half.toFixed(1)} vs ${fast.toFixed(1)}); two bears: a third (${third.toFixed(1)})`, Math.abs(half / fast - 0.5) < 0.02 && Math.abs(third / fast - 1 / 3) < 0.02);
  // cash in: the bear is handed over and the slowdown ends
  bear.state.skaters.a = { ...bear.state.skaters.a, x: bear.state.igloos.a.x - 3, z: bear.state.igloos.a.z, vx: 0, vz: 0 };
  bear.now += DT * 1000; bear.state = bear.engine.tick!(bear.state, DT, bear.now);
  check('cashing in banks all 5 points and ends the slowdown', bear.state.skaters.a.banked === 5 && bear.state.skaters.a.carried === 0 && bear.state.skaters.a.bag.length === 0);
  check('a seal cashed in is 2 points on the scoreboard', (() => { seal.state.skaters.a = { ...seal.state.skaters.a, x: seal.state.igloos.a.x - 3, z: seal.state.igloos.a.z, vx: 0, vz: 0 }; seal.now += DT * 1000; seal.state = seal.engine.tick!(seal.state, DT, seal.now); return seal.engine.scores(seal.state).a === 2; })());

  // Seals slide, pause, slide: watch one for 20 seconds
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(5), penguins: 1, penguinsPerExtraPlayer: 0, guaranteeOneOfEach: false, sealChance: 1 });
  let state = engine.init(['a', 'b'], 0);
  check('with a seal chance of 100% the spawn is a seal', state.penguins.every((p) => p.kind === 'seal'));
  let now = 0, slides = 0, pauses = 0, wasMoving = false, fastest = 0, still = true;
  for (let i = 0; i < 20 / DT; i++) {
    const before = { x: state.penguins[0].x, z: state.penguins[0].z };
    now += DT * 1000; state = engine.tick!(state, DT, now);
    const p = state.penguins[0];
    const speed = Math.hypot(p.x - before.x, p.z - before.z) / DT;
    fastest = Math.max(fastest, speed);
    const moving = speed > 0.5;
    if (moving && !wasMoving) slides++;
    if (!moving && wasMoving) pauses++;
    wasMoving = moving; still = still && Math.abs(speed) < 100;
  }
  check(`a seal slides and pauses over and over (${slides} slides, ${pauses} pauses in 20 s)`, slides >= 5 && pauses >= 5);
  check(`its slides are quick (up to ${fastest.toFixed(1)} units/s) but slower than a skater's top speed of 12 once they glide`, fastest > 8 && fastest <= 13.5);

  // The testing switch: always at least one seal and one bear
  const guaranteed = createPenguinLasso({ random: mulberry32(9), sealChance: 0, bearChance: 0, guaranteeOneOfEach: true });
  const g = guaranteed.init(['a', 'b'], 0);
  check('testing mode: there is at least one seal and one bear even at 0% chance', g.penguins.some((p) => p.kind === 'seal') && g.penguins.some((p) => p.kind === 'bear') && g.penguins.length === 8);
  // catch the seal and the bear: replacements keep the guarantee
  for (const p of g.penguins) if (p.kind !== 'penguin') { p.caughtBy = 'a'; p.caughtAt = 0; }
  g.respawns = [100, 100];
  let after = guaranteed.tick!(g, DT, 3000);
  check('...and when they are caught, new ones appear so there is always one of each', after.penguins.some((p) => p.kind === 'seal' && !p.caughtBy) && after.penguins.some((p) => p.kind === 'bear' && !p.caughtBy));
  // Without the switch the rarity rules (bears rarer than seals)
  const real = createPenguinLasso({ random: mulberry32(11), guaranteeOneOfEach: false });
  const counts = { penguin: 0, seal: 0, bear: 0 };
  for (let i = 0; i < 400; i++) for (const p of real.init(['a', 'b', 'c', 'd'], 0).penguins) counts[p.kind]++;
  check(`real rarity: mostly penguins, fewer seals, fewest bears (${counts.penguin} / ${counts.seal} / ${counts.bear})`, counts.penguin > counts.seal && counts.seal > counts.bear && counts.bear > 0);
}

// ---- the bag: size follows the number of animals, the head is the best one, and a bear blocks everything else ----
{
  const bagOf = (kinds: ('penguin' | 'seal' | 'bear')[], carryingBear = false) => {
    const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
    let state = engine.init(['a', 'b'], 0);
    // all the animals stand still close together in the middle of the loop
    state.penguins = kinds.map((kind, i) => ({ ...state.penguins[0], id: i + 1, kind, x: 10 + i * 0.6, z: 10, walking: false, changeAt: 1e12 }));
    state.skaters.a = { ...state.skaters.a, x: 15, z: 10, trail: [{ x: 15, z: 10, t: 0 }], bag: carryingBear ? ['bear'] : [], carried: carryingBear ? 5 : 0, carriedSpace: carryingBear ? 3 : 0, topCarried: carryingBear ? 'bear' : null };
    const s = { engine, state, now: 0 } as Setup;
    drive(s, Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)), circle(10, 10, 5, 8));
    return s.state;
  };
  const mixed = bagOf(['penguin', 'seal', 'penguin']).skaters.a;
  check('a seal takes the same room as a penguin: 3 animals = a count of 3, but worth 1 + 2 + 1 = 4 points', mixed.carriedSpace === 3 && mixed.carried === 4);
  check('the head shown in the sack is the most valuable animal inside (a seal here)', mixed.topCarried === 'seal');
  check('...and for a penguin on its own, a penguin', bagOf(['penguin']).skaters.a.topCarried === 'penguin');
  const withBear = bagOf(['penguin', 'bear', 'seal']);
  check('a loop with a bear, a penguin and a seal catches all three (3 + 1 + 1 = 5 spaces, 5 + 1 + 2 = 8 points)', withBear.skaters.a.carried === 8 && withBear.skaters.a.carriedSpace === 5 && withBear.skaters.a.topCarried === 'bear'
    && withBear.penguins.filter((p) => p.caughtBy).length === 3);
  const alongside = bagOf(['penguin', 'seal'], true).skaters.a; // already carrying a bear (3 spaces)
  check('carrying a bear does not stop you catching more (the bear took 3 spaces, so 3 are left)', alongside.carried === 8 && alongside.carriedSpace === 5);
}

// ---- the loop tells phones when animals did not fit; the bag lists its contents in order ----
{
  const bagOf = (kinds: ('penguin' | 'seal' | 'bear')[], spaceUsed: number) => {
    const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
    let state = engine.init(['a', 'b'], 0);
    state.penguins = kinds.map((kind, i) => ({ ...state.penguins[0], id: i + 1, kind, x: 10 + i * 0.6, z: 10, walking: false, changeAt: 1e12 }));
    state.skaters.a = { ...state.skaters.a, x: 15, z: 10, trail: [{ x: 15, z: 10, t: 0 }], carriedSpace: spaceUsed, carried: spaceUsed, bag: Array(spaceUsed).fill('penguin') };
    const s = { engine, state, now: 0 } as Setup;
    drive(s, Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)), circle(10, 10, 5, 8));
    return s.state;
  };
  const roomy = bagOf(['penguin', 'seal'], 0);
  check('a loop where everything fits reports nothing skipped', roomy.loops.length === 1 && roomy.loops[0].skipped === 0);
  check('the bag lists what is in it, in the order it was caught (the most valuable first within one loop)', JSON.stringify(roomy.skaters.a.bag) === '["seal","penguin"]');
  const tight = bagOf(['bear', 'penguin'], 4); // 2 spaces left: the bear does not fit
  check('a loop with an animal that does not fit reports it as skipped', tight.loops.length === 1 && tight.loops[0].skipped === 1);
  check('a polar bear that fits adds a bear to the bag list', JSON.stringify(bagOf(['bear'], 0).skaters.a.bag) === '["bear"]');
}

// ---- igloos grow with their owner's points ----
{
  const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(4) });
  const state = engine.init(['a', 'b'], 0);
  const scale = (st: typeof state) => (engine.view(st) as PenguinLassoView).igloos.a.scale;
  check('an igloo starts at its normal size', scale(state) === 1);
  state.skaters.a.banked = 5;
  check('each point makes it 6% bigger (5 points = 1.3x)', Math.abs(scale(state) - 1.3) < 0.001);
  state.skaters.a.banked = 100;
  check('it stops growing at 1.8x', scale(state) === 1.8);
  check("one player's points do not change the other's igloo", (engine.view(state) as PenguinLassoView).igloos.b.scale === 1);
  // a grown igloo is bigger to skate around
  state.skaters.a = { ...state.skaters.a, banked: 10, x: state.igloos.a.x + 0.5, z: state.igloos.a.z, vx: -3, vz: 0 };
  const after = engine.tick!(state, DT, 25);
  check('a grown igloo pushes a skater out to its bigger radius (2.6 x 1.6 + 1)', Math.hypot(after.skaters.a.x - state.igloos.a.x, after.skaters.a.z - state.igloos.a.z) >= 2.6 * 1.6 + 1 - 0.02);
}

// ---- a full bag: no trail, no more catches ----
{
  const fullBag = (count: number, kinds: ('penguin' | 'seal' | 'bear')[]) => {
    const engine = createPenguinLasso({ ...PLAIN, random: mulberry32(7), idleChance: 1, penguins: 1, penguinsPerExtraPlayer: 0 });
    let state = engine.init(['a', 'b'], 0);
    state.penguins = kinds.map((kind, i) => ({ ...state.penguins[0], id: i + 1, kind, x: 10 + i * 0.6, z: 10, walking: false, changeAt: 1e12 }));
    state.skaters.a = { ...state.skaters.a, x: 15, z: 10, trail: [{ x: 15, z: 10, t: 0 }], carriedSpace: count, carried: count, bag: Array(count).fill('penguin'), topCarried: count ? 'penguin' : null };
    const s = { engine, state, now: 0 } as Setup;
    drive(s, Math.ceil((2 * Math.PI * 5 + 3) / (8 * DT)), circle(10, 10, 5, 8));
    return s;
  };
  const room = fullBag(5, ['penguin', 'seal', 'penguin']); // one space left, three animals in the loop
  check('only as many animals as fit are caught (1 space left: the most valuable, the seal)', room.state.skaters.a.carriedSpace === 6 && room.state.penguins.filter((p) => p.caughtBy).length === 1 && room.state.penguins.find((p) => p.caughtBy)!.kind === 'seal');
  check('...and the bag is then full', (room.engine.view(room.state) as PenguinLassoView).skaters.a.bagFull && (room.engine.view(room.state) as PenguinLassoView).bagCapacity === 6);
  check('a full bag lays no trail (it is just the one point where the skater is)', room.state.skaters.a.trail.length === 1);
  const stuck = fullBag(6, ['penguin']);
  check('with a full bag, looping an animal catches nothing and still lays no trail', stuck.state.skaters.a.carriedSpace === 6 && stuck.state.penguins.every((p) => !p.caughtBy) && stuck.state.skaters.a.trail.length === 1);
  stuck.state.skaters.a = { ...stuck.state.skaters.a, x: stuck.state.igloos.a.x - 3, z: stuck.state.igloos.a.z, vx: 0, vz: 0 };
  stuck.now += DT * 1000; stuck.state = stuck.engine.tick!(stuck.state, DT, stuck.now);
  check('cashing in empties the bag, so it is no longer full', stuck.state.skaters.a.carriedSpace === 0 && !(stuck.engine.view(stuck.state) as PenguinLassoView).skaters.a.bagFull);
  drive(stuck, 40, (i) => ({ x: stuck.state.igloos.a.x - 3 - i * 0.3, z: stuck.state.igloos.a.z }));
  check('...and the trail is laid again', stuck.state.skaters.a.trail.length > 3);
  const bear = fullBag(0, ['bear']);
  check('a polar bear on its own leaves the bag half empty and the trail still laid', !(bear.engine.view(bear.state) as PenguinLassoView).skaters.a.bagFull && bear.state.skaters.a.trail.length > 1);
  const noRoomForBear = fullBag(4, ['bear', 'penguin']); // 2 spaces left: the bear (3) does not fit, but the penguin (1) does
  check('a bear that does not fit stays free while a penguin in the same loop is still caught', noRoomForBear.state.skaters.a.carriedSpace === 5 && noRoomForBear.state.penguins.find((p) => p.kind === 'bear')!.caughtBy === undefined && noRoomForBear.state.penguins.find((p) => p.kind === 'penguin')!.caughtBy === 'a');
  const twoBears = fullBag(0, ['bear', 'bear']);
  check('two bears fill the bag exactly (3 + 3 = 6), and they are 10 points', twoBears.state.skaters.a.carriedSpace === 6 && (twoBears.engine.view(twoBears.state) as PenguinLassoView).skaters.a.bagFull && twoBears.state.skaters.a.carried === 10 && twoBears.state.skaters.a.bag.length === 2);
}

console.log(failures === 0 ? '\nAll penguin checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
