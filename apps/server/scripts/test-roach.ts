// Roach Rumble engine rules (no sockets). Run: npx tsx scripts/test-roach.ts
import {
  BOTTLE_RADIUS, COOKER, FOOD_LANDMARK_SHARE, FOOD_POOL, FOOD_RADIUS, FOOD_RESPAWN_MS, FOOD_ROT_MS, LANDMARK_RADIUS, LIGHTS_EVERY_S, LIGHTS_ON_S, POISON_DRAIN, POISON_RADIUS, classicLayout, distToRect, inPoison, lightsOn, makeLayout, ROACH_ARENA_HALF, ROACH_LIFE_MAX, ROACH_LIFE_START, ROACH_RADIUS,
  ROACH_SPEED, SANDAL_SPEED, SMACK_HIT_ARREST_MS, SMACK_MISS_ARREST_MS, SMACK_WINDUP_MS, foodCap, moveRoach, placeFood, pushOut, roachRoundSeconds, roachStart, smackSpot, type Layout,
  type RoachHuntView,
} from '@fgn/shared';
import { createRoachHunt } from '../src/games/roachHunt';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const T0 = 1_000_000;
const L = classicLayout(); // (the fixed old kitchen, so the tests can put things where they know what is; random kitchens are checked further down)
const OBSTACLES = L.obstacles, SHOES = L.shoes, TRASH_CAN = L.trash, MOP_BUCKET = L.mop, LANDMARKS = L.landmarks;
const eng = createRoachHunt({ durationMs: 90_000, layout: L });
const teams = { s: 'purple', a: 'yellow', b: 'yellow', c: 'yellow' } as const;
// (the real game starts every roach on a full 30; most of these checks want room to gain, so they start the roaches on 15)
const fresh = (ids = ['s', 'a', 'b', 'c']) => { const g = eng.init(ids, T0, { teams: { ...teams } }); for (const p of Object.values((g as unknown as { players: Record<string, { role: string; life: number }> }).players)) if (p.role === 'roach') p.life = 15; return g; };
type S = ReturnType<typeof fresh>;
const view = (s: S) => eng.view(s) as RoachHuntView;
const run = (s: S, from: number, ms: number, stepMs = 25) => { let t = from; for (let i = 0; i < ms / stepMs; i++) { t += stepMs; eng.tick!(s, stepMs / 1000, t); } return t; };
type Raw = { players: Record<string, { x: number; z: number; alive: boolean; life: number }>; foods: { x: number; z: number; pool: number }[] };
const raw = (s: S) => s as unknown as Raw;
const farFoods = (s: S) => raw(s).foods.forEach((f, i) => { f.x = -38 + i * 0.01; f.z = 38; }); // (out of the way: a corner)
const atOpen = (s: S) => { raw(s).players.s.x = 20; raw(s).players.s.z = 0; }; // (the sandal in a stretch of open floor: the smack spot is then clear of the island)

let s = fresh();
check('the purple player is the sandal, everyone else is a roach', view(s).sandalId === 's' && view(s).players.a.role === 'roach' && view(s).players.s.role === 'sandal' && view(s).total === 3 && view(s).alive === 3);
check('there is one more piece of food than there are roaches, in different places', view(s).foods.length === 4 && new Set(view(s).foods.map((f) => `${f.x},${f.z}`)).size === 4 && foodCap(3) === 4);
check('the food comes in all four kinds (bananas, potatoes, pizza, gravy)', new Set(view(s).foods.map((f) => f.kind)).size === 4);
check('with two players there is one roach and two pieces of food', (() => { const t = eng.init(['x', 'y'], T0); return (eng.view(t) as RoachHuntView).foods.length === 2; })());
check('the roaches start in different, open places and the sandal in the middle', new Set(['a', 'b', 'c'].map((id) => `${view(s).players[id].x},${view(s).players[id].z}`)).size === 3 && view(s).players.s.x === 0 && roachStart(0, 3)[0] > 10);
check('a fixed round length can be given (for tests)', view(s).endsAt - T0 === 90_000);
{
  const real = createRoachHunt();
  const len = (n: number) => { const ids = ['s', ...Array.from({ length: n }, (_, i) => `r${i}`)]; const v = real.view(real.init(ids, T0, { teams: Object.fromEntries(ids.map((id) => [id, id === 's' ? 'purple' : 'yellow'])) as never })) as RoachHuntView; return (v.endsAt - T0) / 1000; };
  check('the round is 45 seconds + 7 for every roach: 52 for 1, 66 for 3, 94 for 7', len(1) === 52 && len(3) === 66 && len(7) === 94 && roachRoundSeconds(3) === 66);
}
check('every roach starts with a FULL lifetime (30 seconds, the maximum), the sandal has none', (() => { const g = eng.view(eng.init(['s', 'a', 'b'], T0, { teams: { s: 'purple', a: 'yellow', b: 'yellow' } })) as RoachHuntView; return g.players.a.life === 30 && g.players.b.life === 30 && g.players.s.life === 0 && ROACH_LIFE_START === ROACH_LIFE_MAX && ROACH_LIFE_MAX === 30; })());

// the floor plan
{
  const free = (x: number, z: number) => !OBSTACLES.some((o) => Math.abs(x - o.x) < o.hw + ROACH_RADIUS && Math.abs(z - o.z) < o.hd + ROACH_RADIUS) && !SHOES.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + ROACH_RADIUS)
    && Math.hypot(x - TRASH_CAN.x, z - TRASH_CAN.z) >= TRASH_CAN.r + ROACH_RADIUS && Math.hypot(x - MOP_BUCKET.x, z - MOP_BUCKET.z) >= MOP_BUCKET.r + ROACH_RADIUS;
  const G = 0.5, N = Math.round((ROACH_ARENA_HALF * 2) / G);
  const cell = (v: number) => Math.floor((v + ROACH_ARENA_HALF) / G);
  const seen = new Set<number>(), queue: [number, number][] = [];
  const start = roachStart(0, 8);
  queue.push([cell(start[0]), cell(start[1])]); seen.add(cell(start[0]) * N + cell(start[1]));
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N || seen.has(a * N + b)) continue;
      const x = -ROACH_ARENA_HALF + (a + 0.5) * G, z = -ROACH_ARENA_HALF + (b + 0.5) * G;
      if (Math.abs(x) > ROACH_ARENA_HALF - ROACH_RADIUS || Math.abs(z) > ROACH_ARENA_HALF - ROACH_RADIUS || !free(x, z)) continue;
      seen.add(a * N + b); queue.push([a, b]);
    }
  }
  const reach = (x: number, z: number) => seen.has(cell(x) * N + cell(z));
  check('every roach starting spot can walk to every other (the junk makes a maze but never walls a roach in)', Array.from({ length: 8 }, (_, i) => roachStart(i, 8)).every(([x, z]) => reach(x, z)));
  let allFoodReachable = true;
  for (let i = 0; i < 300; i++) for (const f of placeFood(L, 8)) if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => reach(f.x + dx * (FOOD_RADIUS + ROACH_RADIUS + 0.3), f.z + dz * (FOOD_RADIUS + ROACH_RADIUS + 0.3)))) allFoodReachable = false;
  check('every piece of food, however it is placed, can be got to (300 random layouts of 8)', allFoodReachable);
  check('the three landmarks (trash can, mop bucket, cooker front) are in open floor a roach can reach, one of each', LANDMARKS.length === 3 && new Set(LANDMARKS.map((l) => l.id)).size === 3 && LANDMARKS.every((l) => { const o = l.id === 'trash' ? TRASH_CAN.r : l.id === 'mop' ? MOP_BUCKET.r : 0; const x = l.x + (o ? o + ROACH_RADIUS + 0.3 : 0); return reach(x, l.z) && free(x, l.z); }) && Math.abs(COOKER.x) < ROACH_ARENA_HALF - COOKER.width);
  let freeCells = 0;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { const x = -ROACH_ARENA_HALF + (a + 0.5) * G, z = -ROACH_ARENA_HALF + (b + 0.5) * G; if (Math.abs(x) <= ROACH_ARENA_HALF - ROACH_RADIUS && Math.abs(z) <= ROACH_ARENA_HALF - ROACH_RADIUS && free(x, z)) freeCells++; }
  check('no part of the floor is walled off: a roach can get to every bit of open floor from where it starts', seen.size === freeCells);
}

// movement
s = fresh(); farFoods(s);
eng.reduce(s, 'a', { type: 'steer', x: 1, z: 0 }, T0 - 100);
run(s, T0 - 200, 100);
check('nobody can move before the round starts', Math.abs(view(s).players.a.x - roachStart(0, 3)[0]) < 0.001);
// walk two roaches along a clear lane (z = 18 is clear of the junk, but food was moved to x = -18: use the lane z = -16.5 for the sandal test)
raw(s).players.a.x = 0; raw(s).players.a.z = -16.5; raw(s).players.s.x = 0; raw(s).players.s.z = -18;
eng.reduce(s, 'a', { type: 'steer', x: 1, z: 0 }, T0 + 10); eng.reduce(s, 's', { type: 'steer', x: 1, z: 0 }, T0 + 10);
run(s, T0 + 10, 1000);
check('a roach covers about ROACH_SPEED a second and the sandal about SANDAL_SPEED', Math.abs(view(s).players.a.x - ROACH_SPEED) < 0.5 && Math.abs(view(s).players.s.x - SANDAL_SPEED) < 0.4);
s = fresh(); farFoods(s);
eng.reduce(s, 's', { type: 'steer', x: 1, z: 0 }, T0 + 10);
run(s, T0 + 10, 12_000);
check('the walls stop everyone: you cannot leave the room', Math.abs(view(s).players.s.x) <= ROACH_ARENA_HALF);
eng.reduce(s, 'a', { type: 'steer', x: Number.NaN, z: 1 }, T0 + 20);
check('a bad steer is ignored', Number.isFinite(view(s).players.a.x));

// solid junk and food
{
  const wall = OBSTACLES[0]; // a long unit
  let [x, z] = [wall.x, wall.z - wall.hd - 3];
  for (let i = 0; i < 80; i++) [x, z] = moveRoach(x, z, 0, 1, 0.05, [], L);
  check('a roach cannot walk through a kitchen island: it stops at its edge', z <= wall.z - wall.hd - ROACH_RADIUS + 1e-6 && z > wall.z - wall.hd - ROACH_RADIUS - 0.2);
  [x, z] = [wall.x - 1, wall.z - wall.hd - 3];
  for (let i = 0; i < 14; i++) [x, z] = moveRoach(x, z, 1, 1, 0.05, [], L);
  check('...and slides along it when pushed at an angle', x > wall.x + 1 && z < wall.z - wall.hd);
  [x, z] = [0, 9.5];
  const food = [{ x: 0, z: 14, r: FOOD_RADIUS }];
  for (let i = 0; i < 100; i++) [x, z] = moveRoach(x, z, 0, 1, 0.05, food, L);
  check('food is solid too: a roach stops against it', Math.hypot(x - 0, z - 14) >= FOOD_RADIUS + ROACH_RADIUS - 1e-6);
  [x, z] = [0, 9.5]; for (let i = 0; i < 100; i++) [x, z] = moveRoach(x, z, 0, 1, 0.05, [], L);
  check('...and with the food eaten (gone) it walks through the spot', z > 14.5);
  const [px, pz] = pushOut(wall.x, wall.z, [], L);
  check('a roach that somehow ends up inside a cabinet is pushed out', Math.abs(px - wall.x) > wall.hw - 0.01 || Math.abs(pz - wall.z) > wall.hd - 0.01);
  [x, z] = moveRoach(0, -12, 0, 1, 1.5, [], L); // a long step (a big lag spike): it cannot jump over the island
  check('a long step cannot tunnel through the island', z < -3.5);
  const shoe = SHOES[0];
  [x, z] = [shoe.x, shoe.z - 4];
  for (let i = 0; i < 20; i++) [x, z] = moveRoach(x, z, 0, 1, 0.05, [], L);
  check('a roach cannot walk through a shoe either', Math.hypot(x - shoe.x, z - shoe.z) >= shoe.r + ROACH_RADIUS - 1e-6 || x !== shoe.x);
  const broom = OBSTACLES.find((o) => o.kind === 'broom')!;
  [x, z] = [broom.x, broom.z + broom.hd + 3];
  for (let i = 0; i < 40; i++) [x, z] = moveRoach(x, z, 0, -1, 0.05, [], L);
  check('...or a broom lying on the floor', z >= broom.z + broom.hd + ROACH_RADIUS - 1e-6);
}
{
  // the sandal hovers over the junk
  s = fresh(); farFoods(s);
  raw(s).players.s.x = 0; raw(s).players.s.z = 3;
  eng.reduce(s, 's', { type: 'steer', x: 0, z: 1 }, T0 + 10);
  run(s, T0 + 10, 1500);
  check('the sandal flies over the cabinets and the food (it is not blocked by anything)', view(s).players.s.z > 7.5 + 0.2);
}

// life and eating
const adjacentTo = (p: { x: number; z: number }, f: { x: number; z: number }) => { p.x = f.x + (FOOD_RADIUS + ROACH_RADIUS + 0.2); p.z = f.z; };
const START15 = 15; // (what `fresh` starts the roaches on)
const park = (m: S, keep: number) => raw(m).foods.forEach((f, i) => { if (i !== keep) { f.x = 38 - i * 3; f.z = -38; } }); // (every piece but one out of the way)
const adjacent = (p: { x: number; z: number }, f: { x: number; z: number }, side = 1) => { p.x = f.x + side * (FOOD_RADIUS + ROACH_RADIUS + 0.2); p.z = f.z; };
s = fresh();
{
  const m = fresh(); farFoods(m);
  run(m, T0 + 10, 3000);
  check('a roach loses a second of life every second (15 -> 12 after 3 seconds)', Math.abs(view(m).players.a.life - 12) < 0.05 && view(m).players.s.life === 0);
}
const f0 = raw(s).foods[0];
adjacent(raw(s).players.a, f0);
let t = run(s, T0 + 10, 100);
check('a roach that is not moving next to food starts eating at once and its life goes UP (net +1.5 a second)', view(s).foods[0].eating && view(s).foods[0].left < 1 && view(s).players.a.life > START15 - 0.05 + 0.1);
t = run(s, t, 1900);
check('one eater takes 2.5 seconds of life a second out of the pool: after 2 seconds the pool is half gone', Math.abs(view(s).foods[0].left - 0.5) < 0.03 && Math.abs(view(s).players.a.life - (START15 - 2 + 5)) < 0.1);
t = run(s, t, 2100);
check('one eater empties a piece in 4 seconds and has gained its 10 seconds (15 - 4 + 10 = 21); the piece is gone', view(s).foods.length === 3 && Math.abs(view(s).players.a.life - 21) < 0.15);
{
  // two at one piece: twice as fast, and the pool is split
  const m = fresh();
  const g = raw(m).foods[0];
  adjacent(raw(m).players.a, g, 1); adjacent(raw(m).players.b, g, -1);
  const u = run(m, T0 + 10, 1000);
  check('two eaters empty the pool twice as fast (half gone after 1 second)', Math.abs(view(m).foods[0].left - 0.5) < 0.04);
  run(m, u, 1200);
  check('...and split it: each gains 5 seconds (15 - 2 + 5 = 18)', view(m).foods.length === 3 && Math.abs(view(m).players.a.life - 18) < 0.2 && Math.abs(view(m).players.b.life - 18) < 0.2);
  // three at once: the last bit is split evenly, nobody is shortchanged or overpaid
  const n = fresh();
  const h = raw(n).foods[0];
  raw(n).players.a.x = h.x + 2.5; raw(n).players.a.z = h.z; raw(n).players.b.x = h.x - 2.5; raw(n).players.b.z = h.z; raw(n).players.c.x = h.x; raw(n).players.c.z = h.z + 2.5;
  run(n, T0 + 10, 2000);
  const gained = ['a', 'b', 'c'].map((id) => view(n).players[id].life + 2); // (they all ate for ~1.4 s and lost 2 s)
  check('three eaters share the pool evenly and the total taken is exactly the pool (10 seconds)', view(n).foods.length === 3 && Math.abs(gained.reduce((x, y) => x + y, 0) - (3 * START15 + FOOD_POOL)) < 0.35 && Math.max(...gained) - Math.min(...gained) < 0.1);
}
{
  // a full roach cannot hold more than 30; the extra is lost, but it still drains the pool
  const m = fresh(); park(m, 1);
  const g = raw(m).foods[1];
  raw(m).players.a.life = 29; adjacent(raw(m).players.a, g);
  const u = run(m, T0 + 10, 2000);
  check('life over the maximum is lost (a roach at 29 is held at 30, not 38) while it eats', view(m).players.a.life === ROACH_LIFE_MAX);
  run(m, u, 2050);
  check('...and the piece is still used up in the same 4 seconds', !view(m).foods.some((f) => f.id === 1) && view(m).players.a.life > 29.5 && view(m).players.a.life <= ROACH_LIFE_MAX);
}
{
  // standing still, then moving: eating stops, and the pool keeps what is left
  const m = fresh(); park(m, 1);
  const g = raw(m).foods[1];
  adjacent(raw(m).players.a, g);
  let u = run(m, T0 + 10, 1000);
  const left = view(m).foods.find((f) => f.id === 1)!.left;
  check('(a roach settled next to a piece is eating it)', view(m).foods.find((f) => f.id === 1)!.eating && left < 0.8);
  eng.reduce(m, 'a', { type: 'steer', x: 0.2, z: 0 }, u + 1);
  u = run(m, u + 1, 100);
  check('the slightest movement stops the eating at once, and what is left in the pool stays', !view(m).foods.find((f) => f.id === 1)!.eating && Math.abs(view(m).foods.find((f) => f.id === 1)!.left - left) < 0.06);
  eng.reduce(m, 'a', { type: 'steer', x: 0, z: 0 }, u + 1);
  u = run(m, u + 1, 100);
  check('...and as soon as it stops moving it eats again', view(m).foods.find((f) => f.id === 1)!.eating);
  const w = fresh(); farFoods(w);
  const h = raw(w).foods[0];
  raw(w).players.a.x = h.x + 6; raw(w).players.a.z = h.z + 0.01;
  eng.reduce(w, 'a', { type: 'steer', x: -1, z: 0 }, T0 + 10);
  run(w, T0 + 10, 1100);
  check('a roach that is walking up to food (moving) eats nothing', view(w).foods[0].left === 1);
}
check('a roach far from any food eats nothing', view(s).foods.every((f) => f.left === 1));
s = fresh();
raw(s).players.s.x = raw(s).foods[0].x + 1; raw(s).players.s.z = raw(s).foods[0].z;
run(s, T0 + 10, 3000);
check('the sandal cannot eat', view(s).foods[0].left === 1 && view(s).players.s.life === 0);

// starving
{
  const m = fresh(); farFoods(m);
  raw(m).players.a.life = 1.2; raw(m).players.a.x = 10; raw(m).players.a.z = 10;
  const u = run(m, T0 + 10, 1000);
  check('a roach with a second left is still alive...', view(m).players.a.alive && view(m).alive === 3);
  run(m, u, 400);
  const a = view(m).players.a;
  check('...and starves when its life hits zero: dead on the spot, cause "starved", with the time', !a.alive && a.cause === 'starved' && a.life === 0 && a.diedAt !== null && a.diedAt > T0 + 1000 && a.diedAt < T0 + 1500 && a.x === 10 && a.z === 10 && view(m).alive === 2);
  eng.reduce(m, 'a', { type: 'steer', x: 1, z: 0 }, T0 + 2000);
  run(m, T0 + 1500, 500);
  check('a starved roach does not move or come back', view(m).players.a.x === 10 && !view(m).players.a.alive);
  check('...and its body is not solid and not food (the list of food is unchanged)', view(m).foods.length === 4);
}
{
  // everyone starves: the round ends at once and the sandal wins
  const m = fresh(); farFoods(m);
  for (const id of ['a', 'b', 'c']) raw(m).players[id].life = 0.5;
  run(m, T0 + 10, 700);
  check('every roach starved: the round ends, the sandal wins (scores 1, the roaches 0)', view(m).alive === 0 && eng.isOver(m, T0 + 800) && eng.scores(m).s === 1 && eng.scores(m).a === 0 && eng.scores(m).c === 0);
  const q = fresh(); farFoods(q);
  raw(q).players.a.life = 0.5; raw(q).players.b.life = 0.5;
  adjacent(raw(q).players.c, raw(q).foods[0]); raw(q).foods[0].x = 38; raw(q).foods[0].z = -38; adjacent(raw(q).players.c, raw(q).foods[0]); raw(q).players.c.x = 35; raw(q).players.c.z = -38;
  run(q, T0 + 10, 700);
  check('one roach eating while the others starve is enough: the roaches win', view(q).alive === 1 && !eng.isOver(q, T0 + 800) && view(q).players.c.alive);
}

// the food count and the replacements
{
  const m = fresh();
  const g = raw(m).foods[0];
  adjacent(raw(m).players.a, g);
  let u = T0 + 10;
  while (view(m).foods.length === 4 && u < T0 + 8000) u = run(m, u, 25);
  const gone = u;
  check('the piece is gone after about 4 seconds of one roach eating it', gone > T0 + 3900 && gone < T0 + 4200 && view(m).foods.length === 3);
  raw(m).players.a.x = 0; raw(m).players.a.z = 14; // away from the new food
  u = run(m, u, FOOD_RESPAWN_MS - 600);
  check('there is no replacement yet 1.4 seconds later...', view(m).foods.length === 3);
  u = run(m, u, 1200);
  check('...and a new piece appears 2 seconds after the old one was finished (back to roaches + 1 = 4)', view(m).foods.length === 4 && new Set(view(m).foods.map((f) => f.id)).size === 4);
  check('the new piece is full and in the open (not inside any junk)', view(m).foods.every((f) => f.left === 1) && view(m).foods.every((f) => Math.abs(f.x) <= 35.6 && Math.abs(f.z) <= 35.6));
}
{
  // the cap goes down with the roaches, nothing already there is taken away, and nothing new comes until it is below the cap
  const m = fresh(); farFoods(m);
  raw(m).players.b.alive = false; raw(m).players.c.alive = false; // one roach alive: the cap is 2, there are 4 pieces
  let u = run(m, T0 + 10, 6000);
  check('with fewer roaches the extra food is not taken away (4 pieces, cap 2)', view(m).foods.length === 4 && foodCap(1) === 2);
  const [f1, f2, f3] = [raw(m).foods[0], raw(m).foods[1], raw(m).foods[2]];
  raw(m).players.a.life = 20; raw(m).players.a.x = 0; raw(m).players.a.z = 14;
  f1.x = 0; f1.z = 14 - (FOOD_RADIUS + ROACH_RADIUS + 0.2); void f2; void f3;
  while (view(m).foods.length === 4 && u < T0 + 30_000) { raw(m).players.a.life = 25; u = run(m, u, 25); }
  u = run(m, u, 6000);
  check('eat one (3 left, cap 2): no new food comes', view(m).foods.length === 3);
  const g2 = raw(m).foods[0]; raw(m).players.a.x = g2.x + FOOD_RADIUS + ROACH_RADIUS + 0.2; raw(m).players.a.z = g2.z; raw(m).players.a.life = 25;
  const before = view(m).foods.length;
  while (view(m).foods.length === before && u < T0 + 60_000) { raw(m).players.a.life = 25; u = run(m, u, 25); }
  u = run(m, u, 6000);
  check('eat another (2 left, cap 2): still none; the food count settles at the cap and stays there', view(m).foods.length === 2);
}

// where new food goes: a share next to the landmarks
{
  let near = 0, total = 0;
  const per = new Map<string, number>(), all: { x: number; z: number }[] = [];
  for (let i = 0; i < 600; i++) for (const f of placeFood(L, 4)) {
    total++; all.push(f);
    const lm = LANDMARKS.find((l) => Math.hypot(f.x - l.x, f.z - l.z) <= LANDMARK_RADIUS);
    if (lm) { near++; per.set(lm.id, (per.get(lm.id) ?? 0) + 1); }
  }
  check(`about ${FOOD_LANDMARK_SHARE * 100}% of the food is within ${LANDMARK_RADIUS} of a landmark (and the rest anywhere)`, near / total > 0.36 && near / total < 0.55);
  check('...each of the three landmarks gets a share', LANDMARKS.every((l) => (per.get(l.id) ?? 0) > total * 0.08));
  check('...and the rest is spread over the floor (some far from every landmark and from the middle)', all.some((f) => LANDMARKS.every((l) => Math.hypot(f.x - l.x, f.z - l.z) > 20)));
  check('food is never inside the trash can or the mop bucket', all.every((f) => Math.hypot(f.x - TRASH_CAN.x, f.z - TRASH_CAN.z) > TRASH_CAN.r + FOOD_RADIUS && Math.hypot(f.x - MOP_BUCKET.x, f.z - MOP_BUCKET.z) > MOP_BUCKET.r + FOOD_RADIUS));
  const spaced = placeFood(L, 1, Math.random, [{ x: 30, z: 12 }], [{ x: 20, z: -20 }]);
  check('new food keeps clear of the roaches and of the food already there', Math.hypot(spaced[0].x - 20, spaced[0].z + 20) >= 3.5 && Math.hypot(spaced[0].x - 30, spaced[0].z - 12) >= 1);
}
{
  const [x0, z0] = [TRASH_CAN.x - TRASH_CAN.r - 3, TRASH_CAN.z];
  let [x, z] = [x0, z0];
  for (let i = 0; i < 80; i++) [x, z] = moveRoach(x, z, 1, 0, 0.05, [], L);
  check('a roach cannot walk through the trash can', Math.hypot(x - TRASH_CAN.x, z - TRASH_CAN.z) >= TRASH_CAN.r + ROACH_RADIUS - 1e-6 || z !== z0);
  [x, z] = [MOP_BUCKET.x + 3, MOP_BUCKET.z];
  for (let i = 0; i < 80; i++) [x, z] = moveRoach(x, z, -1, 0, 0.05, [], L);
  check('...or the mop bucket', Math.hypot(x - MOP_BUCKET.x, z - MOP_BUCKET.z) >= MOP_BUCKET.r + ROACH_RADIUS - 1e-6 || z !== MOP_BUCKET.z);
}

// the smack
s = fresh(); farFoods(s); atOpen(s);
eng.reduce(s, 's', { type: 'steer', x: 0, z: 1 }, T0 + 5); // face +z
eng.tick!(s, 0.001, T0 + 6); eng.reduce(s, 's', { type: 'steer', x: 0, z: 0 }, T0 + 7);
const [sx, sz] = smackSpot(20, 0, 0);
raw(s).players.a.x = sx + 0.5; raw(s).players.a.z = sz; raw(s).players.b.x = sx + 6; raw(s).players.b.z = sz;
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000);
check('a smack does not land at once: there is a wind-up', view(s).players.a.alive && view(s).players.s.smackAt === T0 + 1000);
eng.tick!(s, 0.04, T0 + 1000 + SMACK_WINDUP_MS - 10);
check('...it has not landed just before the wind-up ends', view(s).players.a.alive);
eng.tick!(s, 0.04, T0 + 1000 + SMACK_WINDUP_MS + 5);
check('it lands, and squashes the roach under it', !view(s).players.a.alive && view(s).alive === 2 && view(s).players.a.diedAt === T0 + 1000 + SMACK_WINDUP_MS);
check('...and spares the roach out of reach', view(s).players.b.alive);
check('a hit leaves the sandal stuck for 2.5 seconds from the press', view(s).players.s.smackHit && view(s).players.s.readyAt === T0 + 1000 + SMACK_HIT_ARREST_MS);
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000 + SMACK_MISS_ARREST_MS + 100);
check('...so it cannot smack again at 1.5 seconds', view(s).players.s.smackAt === T0 + 1000);
const px = view(s).players.s.x;
eng.reduce(s, 's', { type: 'steer', x: 1, z: 0 }, T0 + 1500);
run(s, T0 + 1500, 800);
check('while stuck the sandal cannot walk', view(s).players.s.x === px);
t = run(s, T0 + 2300, 2000);
check('...it walks on at once when it is free (the stick is still held)', view(s).players.s.x > px + 1);
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000 + SMACK_HIT_ARREST_MS + 5);
check('...and can smack again', view(s).players.s.smackAt === T0 + 1000 + SMACK_HIT_ARREST_MS + 5);
// a miss: shorter
s = fresh(); farFoods(s); atOpen(s);
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000);
run(s, T0 + 1000, 300);
check('a miss leaves the sandal out of your hands for 1.5 seconds', !view(s).players.s.smackHit && view(s).players.s.readyAt === T0 + 1000 + SMACK_MISS_ARREST_MS);
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000 + SMACK_MISS_ARREST_MS - 20);
check('...it cannot smack until then', view(s).players.s.smackAt === T0 + 1000);
eng.reduce(s, 's', { type: 'smack' }, T0 + 1000 + SMACK_MISS_ARREST_MS + 5);
check('...then it can', view(s).players.s.smackAt === T0 + 1000 + SMACK_MISS_ARREST_MS + 5);
s = fresh(); farFoods(s); atOpen(s);
raw(s).players.a.alive = false;
eng.reduce(s, 'a', { type: 'steer', x: 1, z: 0 }, T0 + 3000);
eng.reduce(s, 'a', { type: 'smack' }, T0 + 3000);
check('a squashed roach cannot move, and roaches cannot smack', view(s).players.a.smackAt === null);
// one smack, several roaches
s = fresh(); farFoods(s);
const sp = raw(s).players;
atOpen(s); sp.a.x = 21; sp.a.z = 2.2; sp.b.x = 20.5; sp.b.z = 2.8; sp.c.x = 30; sp.c.z = 30;
eng.reduce(s, 's', { type: 'steer', x: 0, z: 1 }, T0 + 5); eng.reduce(s, 's', { type: 'steer', x: 0, z: 0 }, T0 + 6);
eng.reduce(s, 's', { type: 'smack' }, T0 + 100);
run(s, T0 + 100, 200);
check('one smack squashes every roach within reach', !view(s).players.a.alive && !view(s).players.b.alive && view(s).players.c.alive);

// the lights: dark, and on for 3 seconds every 15
check('the kitchen is dark at the start, and the lights come on for 3 seconds every 15 (at 15, 30, 45, 60, 75)', !lightsOn(0) && !lightsOn(14.9) && lightsOn(15) && lightsOn(17.9) && !lightsOn(18) && lightsOn(30.5) && lightsOn(75) && !lightsOn(89) && LIGHTS_EVERY_S === 15 && LIGHTS_ON_S === 3);

// a different kitchen every game
const flood = (lay: Layout) => {
  const G = 0.5, N = Math.round((ROACH_ARENA_HALF * 2) / G), lim = ROACH_ARENA_HALF - ROACH_RADIUS;
  const discs = [...lay.discs, { x: lay.poison.x, z: lay.poison.z, r: BOTTLE_RADIUS }];
  const cell = (v: number) => Math.floor((v + ROACH_ARENA_HALF) / G);
  const open = (a: number, b: number) => { const x = -ROACH_ARENA_HALF + (a + 0.5) * G, z = -ROACH_ARENA_HALF + (b + 0.5) * G; return Math.abs(x) <= lim && Math.abs(z) <= lim && !lay.obstacles.some((o) => Math.abs(x - o.x) < o.hw + ROACH_RADIUS && Math.abs(z - o.z) < o.hd + ROACH_RADIUS) && !discs.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + ROACH_RADIUS); };
  const seen = new Set<number>(), stack = [cell(33) * N + cell(33)]; seen.add(stack[0]);
  while (stack.length) { const k = stack.pop()!, a = Math.floor(k / N), b = k % N; for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const na = a + da, nb = b + db; if (na < 0 || nb < 0 || na >= N || nb >= N || seen.has(na * N + nb) || !open(na, nb)) continue; seen.add(na * N + nb); stack.push(na * N + nb); } }
  let free = 0; for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (open(a, b)) free++;
  return { joined: seen.size >= free * 0.995, starts: Array.from({ length: 8 }, (_, i) => roachStart(i, 8)).every(([x, z]) => seen.has(cell(x) * N + cell(z))) };
};
{
  const layouts = Array.from({ length: 80 }, (_, i) => makeLayout(1000 + i * 37));
  check('the same seed makes the very same kitchen (so the server and every phone agree)', JSON.stringify(makeLayout(4242)) === JSON.stringify(makeLayout(4242)) && makeLayout(4242).seed === 4242);
  check('different seeds make different kitchens: the islands, shoes, trash can and mop bucket all move', new Set(layouts.map((l) => JSON.stringify(l.obstacles))).size === 80 && new Set(layouts.map((l) => JSON.stringify(l.shoes))).size === 80 && new Set(layouts.map((l) => `${l.trash.x}`)).size === 80 && new Set(layouts.map((l) => `${l.mop.x}`)).size === 80);
  check('every kitchen has 3 islands, 4 brooms, 8 pairs of shoes, one trash can, one mop bucket and the cooker landmark', layouts.every((l) => l.obstacles.filter((o) => o.kind === 'island').length === 3 && l.obstacles.filter((o) => o.kind === 'broom').length === 4 && l.shoes.length === 16 && l.landmarks.length === 3 && l.landmarks[2].id === 'cooker' && l.landmarks[2].x === COOKER.x));
  const inside = (l: Layout) => l.obstacles.every((o) => o.x - o.hw >= -36.01 && o.x + o.hw <= 36.01 && o.z - o.hd >= -36.01 && o.z + o.hd <= 36.01) && [...l.shoes, l.trash, l.mop].every((c) => Math.abs(c.x) <= 36 && Math.abs(c.z) <= 36);
  check('everything is well inside the walls', layouts.every(inside));
  const apart = (l: Layout) => l.obstacles.every((o, i) => l.obstacles.every((p, j) => i === j || Math.hypot(Math.max(0, Math.abs(o.x - p.x) - o.hw - p.hw), Math.max(0, Math.abs(o.z - p.z) - o.hd - p.hd)) >= 3.39)) && [...l.shoes, l.trash, l.mop].every((c) => l.obstacles.every((o) => distToRect(c.x, c.z, o) >= c.r + ROACH_RADIUS * 2));
  check('a roach can always squeeze between any two big things, and round the shoes, can and bucket', layouts.every(apart));
  check('nothing sits on a roach starting spot or in front of the cooker', layouts.every((l) => Array.from({ length: 8 }, (_, i) => roachStart(i, 8)).every(([x, z]) => l.obstacles.every((o) => distToRect(x, z, o) > 5) && [...l.shoes, l.trash, l.mop].every((c) => Math.hypot(x - c.x, z - c.z) > 4)) && l.obstacles.every((o) => !(o.z - o.hd < -27 && o.x + o.hw > COOKER.x - 9 && o.x - o.hw < COOKER.x + 9))));
  check('the whole floor is joined up in every kitchen: all eight starts can reach each other, no walled-off pockets', layouts.every((l) => { const f = flood(l); return f.joined && f.starts; }));
  check('the bottle of poison stands 2.6-4.2 from one of the three landmarks, in the open', layouts.every((l) => { const lm = l.landmarks.find((x) => x.id === l.poison.landmark)!; const d = Math.hypot(l.poison.x - lm.x, l.poison.z - lm.z); return d >= 2.6 - 1e-9 && d <= 4.2 + 1e-9 && l.poison.cx === lm.x && l.poison.cz === lm.z && l.obstacles.every((o) => distToRect(l.poison.x, l.poison.z, o) > BOTTLE_RADIUS + ROACH_RADIUS * 2); }));
  const counts = new Map<string, number>(); for (const l of layouts) counts.set(l.poison.landmark, (counts.get(l.poison.landmark) ?? 0) + 1);
  check('...and which landmark gets the poison changes from game to game (all three come up)', counts.size === 3 && [...counts.values()].every((n) => n >= 10));
  let overlap = false;
  for (const l of layouts.slice(0, 40)) for (let i = 0; i < 10; i++) for (const f of placeFood(l, 6)) {
    const near = (c: { x: number; z: number; r: number }) => Math.hypot(f.x - c.x, f.z - c.z) < c.r + FOOD_RADIUS + ROACH_RADIUS * 2;
    if (l.obstacles.some((o) => distToRect(f.x, f.z, o) < FOOD_RADIUS + ROACH_RADIUS * 2) || l.discs.some(near) || near({ x: l.poison.x, z: l.poison.z, r: BOTTLE_RADIUS })) overlap = true;
  }
  check('food never turns up on an island, a broom, a shoe, the trash can, the mop bucket or the bottle, even beside a landmark (2400 pieces in 40 kitchens)', !overlap);
  const eng2 = createRoachHunt({ seed: 77 });
  const st = eng2.init(['s', 'a', 'b'], T0, { teams: { s: 'purple', a: 'yellow', b: 'yellow' } });
  const v2 = eng2.view(st) as RoachHuntView;
  check('the view carries the seed, and a phone making the layout from it gets the very kitchen the server uses', v2.layoutSeed === 77 && JSON.stringify(makeLayout(v2.layoutSeed)) === JSON.stringify((st as unknown as { layout: Layout }).layout) && v2.poisonAt === null);
  const g1 = JSON.stringify((eng2.init(['s', 'a', 'b'], T0) as unknown as { layout: Layout }).layout), g2 = JSON.stringify((createRoachHunt().init(['s', 'a', 'b'], T0) as unknown as { layout: Layout }).layout), g3 = JSON.stringify((createRoachHunt().init(['s', 'a', 'b'], T0) as unknown as { layout: Layout }).layout);
  check('each new game draws a new kitchen', g2 !== g3 && g1 === JSON.stringify(makeLayout(77)));
}

// the poison
{
  const P = L.poison, lm = L.landmarks.find((l) => l.id === P.landmark)!;
  const smackAt = (m: S, x: number, z: number, now = T0 + 1000) => { // the sandal smacks so that it lands on (x, z)
    raw(m).players.s.x = x; raw(m).players.s.z = z - 2.3;
    eng.reduce(m, 's', { type: 'steer', x: 0, z: 1 }, now - 20); eng.tick!(m, 0.001, now - 10); eng.reduce(m, 's', { type: 'steer', x: 0, z: 0 }, now - 5);
    eng.reduce(m, 's', { type: 'smack' }, now);
    run(m, now, 300);
  };
  const m = fresh(); farFoods(m);
  check('before it is smashed the bottle is solid: a roach cannot walk through it', (() => { let [x, z] = [P.x - 2, P.z]; const d = [{ x: P.x, z: P.z, r: BOTTLE_RADIUS }]; for (let i = 0; i < 40; i++) [x, z] = moveRoach(x, z, 1, 0, 0.05, d, L); return Math.hypot(x - P.x, z - P.z) >= BOTTLE_RADIUS + ROACH_RADIUS - 1e-6 || z !== P.z; })());
  smackAt(m, P.x + 8, P.z + 8);
  check('a smack that lands away from the bottle leaves it standing', view(m).poisonAt === null);
  const m2 = fresh(); farFoods(m2);
  raw(m2).players.a.x = 0; raw(m2).players.a.z = 14;
  smackAt(m2, P.x, P.z);
  check('a smack on the bottle smashes it: the poison is spilled at that moment', view(m2).poisonAt === T0 + 1000 + SMACK_WINDUP_MS && !view(m2).players.s.smackHit);
  check('...and breaking a bottle is a miss for the sandal (1 second), not a squashed roach', view(m2).players.s.readyAt === T0 + 1000 + SMACK_MISS_ARREST_MS);
  check('the poison covers 6 units round the landmark', inPoison(L, lm.x + POISON_RADIUS - 0.01, lm.z) && !inPoison(L, lm.x + POISON_RADIUS + 0.01, lm.z) && POISON_DRAIN === 0.5 && POISON_RADIUS === 6);
  // life in the poison
  const spot = (() => { for (let a = 0; a < 40; a++) { const x = lm.x + Math.cos(a) * 3.3, z = lm.z + Math.sin(a) * 3.3; if (Math.hypot(x - P.x, z - P.z) > 2 && Math.hypot(x - lm.x, z - lm.z) > 2.5 && Math.abs(x) < 36 && Math.abs(z) < 36 && !OBSTACLES.some((o) => distToRect(x, z, o) < 2)) return { x, z }; } return { x: lm.x, z: lm.z + 3 }; })();
  const safe = fresh(); farFoods(safe);
  raw(safe).players.a.x = spot.x; raw(safe).players.a.z = spot.z; raw(safe).players.b.x = 0; raw(safe).players.b.z = 14;
  run(safe, T0 + 10, 2000);
  check('without poison, standing at the landmark costs the usual 1 second a second', Math.abs(view(safe).players.a.life - 13) < 0.05);
  const pz = fresh(); farFoods(pz);
  (pz as unknown as { poisonAt: number }).poisonAt = T0 + 5;
  raw(pz).players.a.x = spot.x; raw(pz).players.a.z = spot.z; raw(pz).players.b.x = 0; raw(pz).players.b.z = 14;
  run(pz, T0 + 10, 2000);
  check('standing in the spilled poison costs 1.5 seconds of life a second (15 -> 12 after 2 seconds); a roach outside it still loses 1', Math.abs(view(pz).players.a.life - 12) < 0.05 && Math.abs(view(pz).players.b.life - 13) < 0.05);
  raw(pz).players.a.life = 1; run(pz, T0 + 2010, 800);
  check('...so it starves sooner there', !view(pz).players.a.alive && view(pz).players.a.cause === 'starved');
  // food and the poison
  let inPatch = false, atPoisoned = 0, atOthers = 0;
  for (let i = 0; i < 600; i++) for (const f of placeFood(L, 4, Math.random, [], [], true)) {
    if (Math.hypot(f.x - lm.x, f.z - lm.z) < POISON_RADIUS) inPatch = true;
  }
  void atPoisoned; void atOthers;
  check('once the poison is spilled no food turns up anywhere in the poisoned patch (2400 pieces)', !inPatch);
  let near = 0, total = 0;
  for (let i = 0; i < 600; i++) for (const f of placeFood(L, 4, Math.random, [], [], true)) { total++; if (L.landmarks.some((l) => l.id !== P.landmark && Math.hypot(f.x - l.x, f.z - l.z) <= LANDMARK_RADIUS)) near++; }
  check('...but the other two landmarks keep getting their share', near / total > 0.3);
  const respawn = fresh(); park(respawn, 0); // (the other pieces out of the way, and out of the patch)
  (respawn as unknown as { poisonAt: number }).poisonAt = T0 + 5;
  raw(respawn).players.a.x = 0; raw(respawn).players.a.z = 14;
  let u = T0 + 10; const gone = raw(respawn).foods[0]; adjacentTo(raw(respawn).players.a, gone);
  while (view(respawn).foods.length === 4 && u < T0 + 8000) u = run(respawn, u, 25);
  run(respawn, u, 5000);
  check('a replacement piece after the spill (a new id) is not in the poisoned patch', view(respawn).foods.length === 4 && view(respawn).foods.filter((f) => f.id >= 4).length === 1 && view(respawn).foods.filter((f) => f.id >= 4).every((f) => Math.hypot(f.x - lm.x, f.z - lm.z) >= POISON_RADIUS));
  // food caught in the poison goes off
  {
    const m = fresh(); farFoods(m);
    raw(m).players.a.x = 0; raw(m).players.a.z = 14; raw(m).players.b.x = 0; raw(m).players.b.z = 15; raw(m).players.c.x = 0; raw(m).players.c.z = 16;
    const foods = raw(m).foods;
    foods[0].x = lm.x + 3; foods[0].z = lm.z + 1; foods[1].x = lm.x - 2; foods[1].z = lm.z + 2; // two pieces in the patch
    foods[2].x = lm.x + POISON_RADIUS + 3; foods[2].z = lm.z; // one just outside it (ids 2 and 3 are far away in the corner otherwise)
    foods[3].x = 38; foods[3].z = -38;
    check('nothing is poisoned before the bottle is smashed', view(m).foods.every((f) => f.poisonedAt === null));
    let u = run(m, T0 + 10, 500);
    check('(food in the patch is fine until the poison is spilled)', view(m).foods.length === 4 && view(m).foods.every((f) => f.poisonedAt === null));
    (m as unknown as { poisonAt: number }).poisonAt = u;
    u = run(m, u, 100);
    const inside = view(m).foods.filter((f) => f.id <= 1), outside = view(m).foods.filter((f) => f.id >= 2);
    check('when the poison is spilled the food lying in it is poisoned (marked with the time), and food outside is not', inside.length === 2 && inside.every((f) => f.poisonedAt !== null) && outside.every((f) => f.poisonedAt === null));
    u = run(m, u, FOOD_ROT_MS - 600);
    check('poisoned food is still there just before 4 seconds', view(m).foods.filter((f) => f.id <= 1).length === 2);
    u = run(m, u, 800);
    check('...and gone 4 seconds after the poison reached it (it has gone off); the food outside is untouched', FOOD_ROT_MS === 4000 && view(m).foods.filter((f) => f.id <= 1).length === 0 && view(m).foods.length === 2);
    u = run(m, u, FOOD_RESPAWN_MS + 600);
    const fresher = view(m).foods.filter((f) => f.id >= 4);
    check('two seconds later replacements come (the count goes back to roaches + 1), and not in the poisoned patch', FOOD_RESPAWN_MS === 2000 && view(m).foods.length === 4 && fresher.length === 2 && fresher.every((f) => Math.hypot(f.x - lm.x, f.z - lm.z) >= POISON_RADIUS && f.poisonedAt === null));
  }
}

// how it ends
check('the round is not over while roaches are alive and there is time', !eng.isOver(s, T0 + 5000));
check('time runs out with a roach alive: the ROACHES win (the survivor scores 1, the sandal 0): there is no draw', eng.isOver(s, T0 + 90_000) && eng.scores(s).c === 1 && eng.scores(s).s === 0 && eng.scores(s).a === 0);
sp.c.x = 21; sp.c.z = 2.4;
eng.reduce(s, 's', { type: 'smack' }, T0 + 3000);
run(s, T0 + 3000, 200);
check('every roach squashed: the round ends at that moment and the sandal wins (it scores 1, the roaches 0)', view(s).alive === 0 && eng.isOver(s, T0 + 3300) && eng.scores(s).s === 1 && eng.scores(s).c === 0);
check('a squashed roach records how it died', view(s).players.a.cause === 'squashed' && view(s).players.c.cause === 'squashed' && view(s).players.a.life === 0);
s = fresh(); raw(s).players.b.alive = false;
check('a squashed roach does not score for them', eng.scores(s).b === 0 && eng.scores(s).a === 1);
check('there is no single winner (the room picks the winning team)', eng.getWinner(s) === null);
s = fresh();
eng.removePlayer(s, 'a');
check('a roach who leaves is gone and does not count as a survivor', view(s).alive === 2 && eng.scores(s).a === 0 && view(s).players.a.cause === 'left');
check('the view is a copy', (() => { const v = view(s); v.players.b.x = 99; v.foods[0].left = 0.1; return view(s).players.b.x !== 99 && view(s).foods[0].left !== 0.1; })());

console.log(failed === 0 ? '\nAll Roach Rumble engine checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
