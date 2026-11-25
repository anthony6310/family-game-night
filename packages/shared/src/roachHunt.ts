/**
 * Roach Rumble (GAME_RULES.md #26): the kitchen floor, the junk and the food on it, the speeds, the sandal's smack and the walking rules, shared by the server (which decides everything) and the phones (which move their
 * own character at once and then follow the server). The floor is a square, x east and z south, with the middle at 0, 0.
 */
export const ROACH_ARENA_HALF = 40; // the kitchen floor is 80 by 80
export const ROACH_SPEED = 9; // units a second: roaches are fast
export const SANDAL_SPEED = 5; // ...the sandal is slower
export const ROACH_RADIUS = 0.6;
export const SANDAL_RADIUS = 1.3;
export const SMACK_WINDUP_MS = 140; // from tapping to the sandal landing: a very quick swing
export const SMACK_MISS_ARREST_MS = 1000; // after a smack the sandal is out of your hands this long (it floats back up to its attack position)...
export const SMACK_HIT_ARREST_MS = 2500; // ...and this long if it squashed a roach (it is stuck in the guts and has to work itself free)
export const SMACK_REACH = 2.3; // how far in front of the sandal's middle the smack lands
export const SMACK_RADIUS = 2.0; // everything within this of the landing spot is squashed
export const FOOD_RADIUS = 1.2; // a piece of food is a solid disc this big: roaches cannot walk through it
export const FOOD_EAT_REACH = 0.7; // a roach is eating a piece of food when it is within this of touching it AND is not moving (any pull on the stick at all stops the eating)

/**
 * LIFETIME (the roaches' economy). Every roach has a lifetime in seconds that runs down by ROACH_LIFE_DRAIN a second; at 0 it starves and dies on the spot. Food is life: a piece holds a pool of FOOD_POOL seconds of it, and
 * every roach eating it takes FOOD_EAT_RATE seconds of life a second out of the pool (one eater empties a piece in FOOD_POOL / FOOD_EAT_RATE = 4 seconds, two in 2, ...). Life over the maximum is lost.
 */
export const ROACH_LIFE_START = 30; // roaches start with a full lifetime
export const ROACH_LIFE_MAX = 30;
export const ROACH_LIFE_DRAIN = 1; // seconds of life lost each second
export const FOOD_POOL = 10; // seconds of life in one piece of food
export const FOOD_EAT_RATE = 2.5; // seconds of life each eater takes from a piece, each second
export const FOOD_RESPAWN_MS = 2000; // a finished piece is replaced this long after (only if there is room: see `foodCap`)
export const FOOD_ROT_MS = 4000; // food caught in the spilled poison goes off and is gone this long after the poison reaches it (a replacement comes as for any piece)
export const FOOD_LANDMARK_SHARE = 0.4; // this share of new food appears next to a landmark
export const LANDMARK_RADIUS = 6; // ...within this of its middle
export const BOTTLE_RADIUS = 0.5; // the bottle of poison is a small solid disc; a smack that lands within SMACK_RADIUS of it breaks it
export const POISON_RADIUS = 6; // the poisoned patch round a landmark
export const POISON_DRAIN = 0.5; // extra seconds of life a roach loses each second it stands in the poison (on top of the usual 1)
export const ROACH_LOW_LIFE = 5; // below this many seconds a roach's bar flashes

/** How long a round is: the sandal gets more time for every roach it has to find. */
export const ROACH_BASE_SECONDS = 45;
export const ROACH_SECONDS_PER_ROACH = 7;
export const roachRoundSeconds = (roaches: number) => ROACH_BASE_SECONDS + ROACH_SECONDS_PER_ROACH * Math.max(1, roaches);
/** The most pieces of food there may be on the floor: one more than there are roaches still alive (food is never taken away if there is more: no new food comes until it is eaten down to this). */
export const foodCap = (roachesAlive: number) => roachesAlive + 1;
export const FOOD_KINDS = ['banana', 'potato', 'pizza', 'gravy'] as const; // spoiled old bananas, sprouting potatoes, mouldy pizza and gravy with a skin on it

/** A solid box on the floor: a kitchen island or a broom lying down (centre and half sizes). Roaches cannot pass; the sandal hovers over it. */
export interface Rect { x: number; z: number; hw: number; hd: number; kind: 'island' | 'broom' }
/** A shoe on the floor (a solid disc for roaches; `angle` and `style` are for drawing: 0 sneaker, 1 boot, 2 slipper). */
export interface Shoe { x: number; z: number; r: number; angle: number; style: 0 | 1 | 2 }
/** A circle that blocks roaches (a piece of food, a shoe, the trash can, the mop bucket, the bottle of poison). */
export interface Disc { x: number; z: number; r: number }
export interface Pt { x: number; z: number }

/** Where the roaches start: spots in the open, the first ones in opposite corners so a few roaches begin far apart. */
const START_SPOTS: [number, number][] = [[33, 33], [-33, -33], [-33, 33], [33, -33], [0, 35], [0, -35], [35, 0], [-35, 0]];
export function roachStart(index: number, _count: number): [number, number] {
  return START_SPOTS[index % START_SPOTS.length];
}

/** The lights: the kitchen is dark, and every 15 seconds the lights come on for 3. (A game's clock in seconds from its start.) */
export const LIGHTS_EVERY_S = 15;
export const LIGHTS_ON_S = 3;
export function lightsOn(seconds: number): boolean {
  return seconds >= LIGHTS_EVERY_S && seconds % LIGHTS_EVERY_S < LIGHTS_ON_S;
}

/** One step of walking: `sx, sz` is the steer (each -1..1, a stick pushed diagonally is no faster than straight), `radius` keeps the body inside the walls. */
export function stepMover(x: number, z: number, sx: number, sz: number, speed: number, dt: number, radius: number): [number, number] {
  const len = Math.hypot(sx, sz);
  const k = len > 1 ? 1 / len : 1;
  const lim = ROACH_ARENA_HALF - radius;
  return [Math.max(-lim, Math.min(lim, x + sx * k * speed * dt)), Math.max(-lim, Math.min(lim, z + sz * k * speed * dt))];
}

// ---------------------------------------------------------------- the layout: different every game

/**
 * The cooker stands against the north wall, in the same place every game (its front is the wall plane at z = -ROACH_ARENA_HALF); `x` is its middle and `width` how wide it is. The patch of floor in front of it is a landmark.
 */
export const COOKER = { x: -14, width: 7 };
const COOKER_LANDMARK = { id: 'cooker' as const, x: COOKER.x, z: -ROACH_ARENA_HALF + 6.5 };

export interface Landmark { id: 'trash' | 'mop' | 'cooker'; x: number; z: number }
/**
 * One game's kitchen: the islands, brooms and shoes, the trash can and the mop bucket, and the bottle of poison, all in different places each game (made from `seed`; the server and every phone make the SAME layout from it,
 * so the maths here sticks to + - * / and square roots, which every device does identically). The cooker is always where it is. `discs` are the fixed round things roaches cannot walk through (shoes, trash can, mop bucket).
 */
export interface Layout {
  seed: number;
  obstacles: Rect[];
  shoes: Shoe[];
  trash: Disc;
  mop: Disc;
  landmarks: Landmark[]; // the trash can, the mop bucket and the cooker: the middle of the patch of floor where food turns up
  discs: Disc[];
  /** The bottle of poison stands next to one landmark; if the sandal smacks it the landmark is doused: `x, z` is the bottle, `cx, cz` the middle of the patch of poison. */
  poison: { landmark: Landmark['id']; x: number; z: number; cx: number; cz: number };
}

const sq = (n: number) => n * n;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt(sq(ax - bx) + sq(az - bz));
/** How far a point is from a box (0 inside it). */
export function distToRect(x: number, z: number, o: Rect): number {
  return dist(x, z, Math.max(o.x - o.hw, Math.min(o.x + o.hw, x)), Math.max(o.z - o.hd, Math.min(o.z + o.hd, z)));
}
/** How far apart two boxes are (0 if they touch). */
function gapRects(a: Rect, b: Rect): number {
  return Math.sqrt(sq(Math.max(0, Math.abs(a.x - b.x) - a.hw - b.hw)) + sq(Math.max(0, Math.abs(a.z - b.z) - a.hd - b.hd)));
}
function seeded(seed: number): () => number { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kitchen as it used to be, the same every time (also what a layout falls back to if a random one cannot be made). */
const CLASSIC = {
  obstacles: [
    { x: 0, z: 0, hw: 8, hd: 3.5, kind: 'island' }, { x: -24, z: -20, hw: 3.5, hd: 8, kind: 'island' }, { x: 24, z: 20, hw: 3.5, hd: 8, kind: 'island' },
    { x: 22, z: -24, hw: 10, hd: 0.7, kind: 'broom' }, { x: -22, z: 24, hw: 10, hd: 0.7, kind: 'broom' }, { x: 0, z: -26, hw: 0.7, hd: 7, kind: 'broom' }, { x: 0, z: 26, hw: 0.7, hd: 7, kind: 'broom' },
  ] as Rect[],
  pairs: [[-12, 12, 0.4, 0], [12, -12, 2.2, 1], [-14, -8, 1.3, 2], [14, 8, 3.9, 0], [-30, 10, 0.9, 1], [30, -10, 5.1, 0], [-8, 30, 2.7, 2], [8, -30, 4.4, 1]] as [number, number, number, 0 | 1 | 2][],
};

function finishLayout(seed: number, obstacles: Rect[], shoes: Shoe[], trash: Disc, mop: Disc, pick: number, rand: () => number): Layout | null {
  const landmarks: Landmark[] = [{ id: 'trash', x: trash.x, z: trash.z }, { id: 'mop', x: mop.x, z: mop.z }, COOKER_LANDMARK];
  const discs: Disc[] = [...shoes.map((h) => ({ x: h.x, z: h.z, r: h.r })), trash, mop];
  const lm = landmarks[Math.min(2, Math.floor(pick * 3))];
  // the bottle: 2.6 to 4.2 from the landmark's middle, in the open
  for (let tries = 0; tries < 400; tries++) {
    const x = lm.x + (rand() * 2 - 1) * 4.2, z = lm.z + (rand() * 2 - 1) * 4.2, d = dist(x, z, lm.x, lm.z);
    if (d < 2.6 || d > 4.2 || Math.abs(x) > 35 || Math.abs(z) > 35) continue;
    if (obstacles.some((o) => distToRect(x, z, o) < BOTTLE_RADIUS + ROACH_RADIUS * 2 + 0.8)) continue;
    if (discs.some((c) => dist(x, z, c.x, c.z) < c.r + BOTTLE_RADIUS + ROACH_RADIUS * 2 + 0.8)) continue;
    if (START_SPOTS.some(([sx, sz]) => dist(x, z, sx, sz) < 5)) continue;
    return { seed, obstacles, shoes, trash, mop, landmarks, discs, poison: { landmark: lm.id, x, z, cx: lm.x, cz: lm.z } };
  }
  return null;
}

/** Can a roach get from every starting spot to every other, and is (almost) all the open floor joined up? (a flood fill) */
function connected(layout: Layout): boolean {
  const G = 0.5, N = Math.round((ROACH_ARENA_HALF * 2) / G), lim = ROACH_ARENA_HALF - ROACH_RADIUS;
  const all: Disc[] = [...layout.discs, { x: layout.poison.x, z: layout.poison.z, r: BOTTLE_RADIUS }];
  const cell = (v: number) => Math.floor((v + ROACH_ARENA_HALF) / G);
  const open = (a: number, b: number) => {
    const x = -ROACH_ARENA_HALF + (a + 0.5) * G, z = -ROACH_ARENA_HALF + (b + 0.5) * G;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (layout.obstacles.some((o) => Math.abs(x - o.x) < o.hw + ROACH_RADIUS && Math.abs(z - o.z) < o.hd + ROACH_RADIUS)) return false;
    return !all.some((c) => dist(x, z, c.x, c.z) < c.r + ROACH_RADIUS);
  };
  const seen = new Uint8Array(N * N), stack: number[] = [];
  const first = START_SPOTS[0];
  stack.push(cell(first[0]) * N + cell(first[1])); seen[stack[0]] = 1;
  let count = 1;
  while (stack.length) {
    const k = stack.pop()!, a = Math.floor(k / N), b = k % N;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const na = a + da, nb = b + db;
      if (na < 0 || nb < 0 || na >= N || nb >= N || seen[na * N + nb] || !open(na, nb)) continue;
      seen[na * N + nb] = 1; count++; stack.push(na * N + nb);
    }
  }
  let freeCells = 0;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (open(a, b)) freeCells++;
  return START_SPOTS.every(([x, z]) => seen[cell(x) * N + cell(z)] === 1) && count >= freeCells * 0.995;
}

/** The old fixed kitchen, with the trash can and the mop bucket where they used to be. */
export function classicLayout(): Layout {
  const shoes: Shoe[] = [];
  for (const [x, z, angle, style] of CLASSIC.pairs) { shoes.push({ x, z, r: 1.0, angle, style }); shoes.push({ x: x + 1.9 * 0.45, z: z + 1.9 * 0.89, r: 1.0, angle: angle + 0.5, style }); }
  return finishLayout(0, CLASSIC.obstacles, shoes, { x: 30, z: 6, r: 1.25 }, { x: -30, z: -6, r: 1.15 }, 0, seeded(7)) ?? (undefined as never);
}

/**
 * Make a game's kitchen from its seed: three islands, four brooms, eight pairs of shoes, the trash can and the mop bucket in different places every time, with the rules that keep it fair: everything well clear of the walls
 * (so a roach can get round), of the roaches' starting spots and of the cooker, a roach-sized gap between any two big things, and the whole floor joined up. If a layout cannot be made, the classic one is used.
 */
export function makeLayout(seed: number): Layout {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rand = seeded(seed * 7919 + attempt * 104729 + 12345);
    const cookerZone = (o: Rect) => o.z - o.hd < -27 && o.x + o.hw > COOKER.x - 9 && o.x - o.hw < COOKER.x + 9;
    const obstacles: Rect[] = [];
    const specs: { kind: 'island' | 'broom'; long: [number, number]; short: [number, number] }[] = [
      { kind: 'island', long: [6.5, 8.5], short: [3, 3.8] }, { kind: 'island', long: [6.5, 8.5], short: [3, 3.8] }, { kind: 'island', long: [6.5, 8.5], short: [3, 3.8] },
      { kind: 'broom', long: [7, 10], short: [0.7, 0.7] }, { kind: 'broom', long: [7, 10], short: [0.7, 0.7] }, { kind: 'broom', long: [7, 10], short: [0.7, 0.7] }, { kind: 'broom', long: [7, 10], short: [0.7, 0.7] },
    ];
    let ok = true;
    for (const sp of specs) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const long = sp.long[0] + rand() * (sp.long[1] - sp.long[0]), short = sp.short[0] + rand() * (sp.short[1] - sp.short[0]), flip = rand() < 0.5;
        const hw = flip ? long : short, hd = flip ? short : long;
        const o: Rect = { x: (rand() * 2 - 1) * (36 - hw), z: (rand() * 2 - 1) * (36 - hd), hw, hd, kind: sp.kind };
        if (cookerZone(o) || obstacles.some((p) => gapRects(o, p) < 3.4) || START_SPOTS.some(([sx, sz]) => distToRect(sx, sz, o) < 6)) continue;
        obstacles.push(o); placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;
    // the trash can and the mop bucket
    const spot = (r: number, others: Disc[]): Disc | null => {
      for (let tries = 0; tries < 400; tries++) {
        const x = (rand() * 2 - 1) * 33, z = (rand() * 2 - 1) * 33;
        if (obstacles.some((o) => distToRect(x, z, o) < r + 2.6) || START_SPOTS.some(([sx, sz]) => dist(x, z, sx, sz) < 9)) continue;
        if (dist(x, z, COOKER_LANDMARK.x, COOKER_LANDMARK.z) < 16 || others.some((c) => dist(x, z, c.x, c.z) < 24)) continue;
        return { x, z, r };
      }
      return null;
    };
    const trash = spot(1.25, []), mop = trash && spot(1.15, [trash]);
    if (!trash || !mop) continue;
    // the shoes, in pairs
    const shoes: Shoe[] = [], placedDiscs: Disc[] = [trash, mop];
    let shoesOk = true;
    for (let p = 0; p < 8 && shoesOk; p++) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const x = (rand() * 2 - 1) * 34, z = (rand() * 2 - 1) * 34;
        let dx = rand() * 2 - 1, dz = rand() * 2 - 1; const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.3) continue;
        dx = (dx / len) * 1.9; dz = (dz / len) * 1.9;
        const pair: Disc[] = [{ x, z, r: 1 }, { x: x + dx, z: z + dz, r: 1 }];
        const bad = pair.some((c) => Math.abs(c.x) > 36 || Math.abs(c.z) > 36 || obstacles.some((o) => distToRect(c.x, c.z, o) < c.r + ROACH_RADIUS * 2 + 0.6) || START_SPOTS.some(([sx, sz]) => dist(c.x, c.z, sx, sz) < 5)
          || placedDiscs.some((q) => dist(c.x, c.z, q.x, q.z) < q.r + c.r + ROACH_RADIUS * 2 + 0.8) || (c.z < -27 && Math.abs(c.x - COOKER.x) < 9));
        if (bad) continue;
        const angle = rand() * 6.28, style = Math.min(2, Math.floor(rand() * 3)) as 0 | 1 | 2;
        shoes.push({ x, z, r: 1, angle, style }, { x: x + dx, z: z + dz, r: 1, angle: angle + 0.5, style });
        placedDiscs.push(...pair); placed = true;
      }
      if (!placed) shoesOk = false;
    }
    if (!shoesOk) continue;
    const layout = finishLayout(seed, obstacles, shoes, trash, mop, rand(), rand);
    if (layout && connected(layout)) return layout;
  }
  return { ...classicLayout(), seed };
}

// ---------------------------------------------------------------- walking

/** Push a roach's centre out of every box and disc it overlaps (a few passes, so a corner between two is handled). `discs` are the extra round things (food, an unbroken bottle); the layout's own are added. */
export function pushOut(x: number, z: number, discs: Disc[], layout: Layout): [number, number] {
  for (let pass = 0; pass < 3; pass++) {
    for (const o of layout.obstacles) {
      const cx = Math.max(o.x - o.hw, Math.min(o.x + o.hw, x)), cz = Math.max(o.z - o.hd, Math.min(o.z + o.hd, z));
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d >= ROACH_RADIUS) continue;
      if (d > 1e-6) { x = cx + (dx / d) * ROACH_RADIUS; z = cz + (dz / d) * ROACH_RADIUS; }
      else { // the centre is inside the box: leave by the nearest side
        const left = x - (o.x - o.hw), right = o.x + o.hw - x, up = z - (o.z - o.hd), down = o.z + o.hd - z, m = Math.min(left, right, up, down);
        if (m === left) x = o.x - o.hw - ROACH_RADIUS; else if (m === right) x = o.x + o.hw + ROACH_RADIUS; else if (m === up) z = o.z - o.hd - ROACH_RADIUS; else z = o.z + o.hd + ROACH_RADIUS;
      }
    }
    for (const c of [...discs, ...layout.discs]) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + ROACH_RADIUS;
      if (d >= min) continue;
      if (d > 1e-6) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; } else x = c.x + min;
    }
  }
  const lim = ROACH_ARENA_HALF - ROACH_RADIUS;
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}

/** A roach's step: it walks (in small sub-steps, so it cannot tunnel through anything) and is stopped by the junk, the food and the walls. The sandal hovers over all of it and just uses `stepMover`. */
export function moveRoach(x: number, z: number, sx: number, sz: number, dt: number, discs: Disc[], layout: Layout): [number, number] {
  const steps = Math.max(1, Math.ceil((ROACH_SPEED * dt) / 0.25));
  for (let i = 0; i < steps; i++) {
    [x, z] = stepMover(x, z, sx, sz, ROACH_SPEED, dt / steps, ROACH_RADIUS);
    [x, z] = pushOut(x, z, discs, layout);
  }
  return [x, z];
}

/** Where the smack lands: in front of the sandal, in the way it faces (`facing` is an angle, 0 = towards +z, turning towards +x). */
export function smackSpot(x: number, z: number, facing: number): [number, number] {
  return [x + Math.sin(facing) * SMACK_REACH, z + Math.cos(facing) * SMACK_REACH];
}

/** Is this point in the poisoned patch (once the bottle has been smashed)? */
export function inPoison(layout: Layout, x: number, z: number): boolean {
  return Math.hypot(x - layout.poison.cx, z - layout.poison.cz) <= POISON_RADIUS;
}

// ---------------------------------------------------------------- food

/** Is this a good place for a piece of food: in the open, well clear of the junk (so a roach can get all the way round it), the bottle, the middle and the starting spots. */
function openSpot(layout: Layout, x: number, z: number): boolean {
  if (Math.abs(x) > 35.5 || Math.abs(z) > 35.5) return false;
  if (Math.hypot(x, z) < 12) return false;
  if (layout.obstacles.some((o) => distToRect(x, z, o) < FOOD_RADIUS + ROACH_RADIUS * 2 + 0.6)) return false;
  if (layout.discs.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + FOOD_RADIUS + ROACH_RADIUS * 2 + 0.4)) return false;
  if (Math.hypot(x - layout.poison.x, z - layout.poison.z) < BOTTLE_RADIUS + FOOD_RADIUS + ROACH_RADIUS * 2 + 0.4) return false;
  return !START_SPOTS.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 8);
}

/**
 * Where `count` more pieces of food go. Each one has a FOOD_LANDMARK_SHARE chance of being next to a landmark (one of the three picked at random, within LANDMARK_RADIUS of its middle) and otherwise goes anywhere in the open.
 * Never on the junk, even beside a landmark. Pieces keep clear of the food already there (`existing`: well spread out, the spacing relaxed if the room is too crowded) and of `avoid` (the roaches). Once the poison has been
 * spilled (`poisoned`) no food goes in the poisoned patch, and none is picked for that landmark. `rand` is a random function (0..1).
 */
export function placeFood(layout: Layout, count: number, rand: () => number = Math.random, existing: Pt[] = [], avoid: Pt[] = [], poisoned = false): Pt[] {
  const out: Pt[] = [];
  const clear = (x: number, z: number, spacing: number) =>
    openSpot(layout, x, z) && !(poisoned && Math.hypot(x - layout.poison.cx, z - layout.poison.cz) < POISON_RADIUS + FOOD_RADIUS)
    && !avoid.some((a) => Math.hypot(x - a.x, z - a.z) < 3.5) && ![...existing, ...out].some((f) => Math.hypot(x - f.x, z - f.z) < spacing);
  const usable = layout.landmarks.filter((l) => !(poisoned && l.id === layout.poison.landmark));
  for (let i = 0; i < count; i++) {
    let placed = false;
    if (rand() < FOOD_LANDMARK_SHARE) {
      const lm = usable[Math.floor(rand() * usable.length) % usable.length];
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * LANDMARK_RADIUS;
        const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
        if (clear(x, z, 6)) { out.push({ x, z }); placed = true; }
      }
    }
    let spacing = 16;
    for (let tries = 0; tries < 1500 && !placed; tries++) {
      if (tries > 0 && tries % 250 === 0) spacing -= 3; // (too crowded: allow them closer)
      const x = (rand() * 2 - 1) * 35.5, z = (rand() * 2 - 1) * 35.5;
      if (clear(x, z, spacing)) { out.push({ x, z }); placed = true; }
    }
    if (!placed) out.push({ x: 0, z: 14 + i * 0.01 }); // (cannot happen with these layouts: a spot in the open)
  }
  return out;
}
