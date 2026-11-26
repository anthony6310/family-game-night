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
export const SMACK_HIT_ARREST_MS = 2000; // ...and this long if it squashed a roach (it is stuck in the guts and has to work itself free)
export const SMACK_REACH = 2.3; // how far in front of the sandal's middle the smack lands
export const SMACK_RADIUS = 2.0; // everything within this of the landing spot is squashed
export const FOOD_SCALE = 1.56; // all the food is drawn 56% bigger than first modelled (30%, then another 20%); its solid disc and its pick-up reach are scaled the same
export const FOOD_RADIUS = 1.2 * FOOD_SCALE; // a piece of food is a solid disc this big: roaches cannot walk through it
export const FOOD_EAT_REACH = 0.7 * FOOD_SCALE; // a roach is eating a piece of food when it is within this of touching it AND is not moving (any pull on the stick at all stops the eating)

/**
 * LIFETIME (the roaches' economy). Every roach has a lifetime in seconds that runs down by ROACH_LIFE_DRAIN a second; at 0 it starves and dies on the spot. Food is life: a piece holds a pool of FOOD_POOL seconds of it, and
 * every roach eating it takes FOOD_EAT_RATE seconds of life a second out of the pool (one eater empties a piece in FOOD_POOL / FOOD_EAT_RATE = 4 seconds, two in 2, ...). Life over the maximum is lost.
 */
export const ROACH_LIFE_MAX = 25;
export const ROACH_LIFE_START = ROACH_LIFE_MAX; // roaches start with a full lifetime
export const ROACH_LIFE_POISONED_MAX = 20; // a roach that has been in the spilled poison can never have more than this again (the bar shows the lost 5 seconds as a purple block)
export const ROACH_LIFE_DRAIN = 1; // seconds of life lost each second
export const FOOD_POOL = 10; // seconds of life in one piece of food
export const FOOD_EAT_RATE = 2.5; // seconds of life each eater takes from a piece, each second
export const FOOD_RESPAWN_MS = 2000; // a finished piece is replaced this long after (only if there is room: see `foodCap`)
export const FOOD_ROT_MS = 4000; // food caught in the spilled poison goes off and is gone this long after the poison reaches it (a replacement comes as for any piece)
export const FOOD_LANDMARK_SHARE = 0.4; // this share of new food appears next to a landmark
export const LANDMARK_RADIUS = 10; // ...within this of its middle (the trash heap and the mop bucket are big)
export const BOTTLE_RADIUS = 0.5; // the bottle of poison is a small solid disc; a smack that lands within SMACK_RADIUS of it breaks it
export const POISON_RADIUS = 10; // the poisoned patch round a landmark
export const POISON_DRAIN = 0.5; // extra seconds of life a roach loses each second it stands in the poison (on top of the usual 1)
export const ROACH_LOW_LIFE = 5; // below this many seconds a roach's bar flashes

/** How long a round is: the sandal gets more time for every roach it has to find. */
export const ROACH_BASE_SECONDS = 45;
export const ROACH_SECONDS_PER_ROACH = 7;
export const roachRoundSeconds = (roaches: number) => ROACH_BASE_SECONDS + ROACH_SECONDS_PER_ROACH * Math.max(1, roaches);
/** The most pieces of food there may be on the floor: one more than there are roaches still alive (food is never taken away if there is more: no new food comes until it is eaten down to this). */
export const foodCap = (roachesAlive: number) => roachesAlive + 1;
export const FOOD_KINDS = ['banana', 'potato', 'pizza', 'gravy'] as const; // spoiled old bananas, sprouting potatoes, mouldy pizza and gravy with a skin on it

/** A solid box on the floor: a kitchen island, the diner table with its chairs (the whole set is one rectangle), or a broom lying down (centre and half sizes). Roaches cannot pass; the sandal hovers over it. */
export interface Rect { x: number; z: number; hw: number; hd: number; kind: 'island' | 'broom' | 'table' }
/**
 * A pair of shoes kicked off, one solid obstacle: shoe A is at `x, z` and shoe B at `x + dx, z + dz` (always SHOE_PAIR_GAP apart), and the footprint is ONE solid capsule (a bar of width 2 SHOE_RADIUS between them with a round end
 * on each), so there is no gap between the two shoes for a roach to squeeze into. `style` is for drawing: 0 chunky sneakers, 1 rain boots.
 */
export interface ShoePair { x: number; z: number; dx: number; dz: number; style: 0 | 1 }
/** A solid capsule: every point within `r` of the segment from `ax, az` to `bx, bz`. */
export interface Capsule { ax: number; az: number; bx: number; bz: number; r: number }
/**
 * The pool of small obstacles lying about the kitchen besides the shoes: each game draws 3 to 6 from it (never more than two of one kind). Each is one solid disc of its own size (`PROP_RADIUS`), turned any way round (`ux, uz`
 * is a unit vector, for drawing). 0 cleaning products (a toppled stash of bottles), 1 a chrome diner stool, 2 a stack of cardboard boxes, 3 a toppled stockpot with a ladle.
 */
export type PropKind = 0 | 1 | 2 | 3;
export const PROP_RADIUS: Record<PropKind, number> = { 0: 2.64, 1: 1.68, 2: 2.4, 3: 2.04 };
export interface Prop { x: number; z: number; r: number; kind: PropKind; ux: number; uz: number }
export const SHOE_RADIUS = 1.68; // (a pair of shoes is 68% bigger than first drawn: 40%, then another 20%)
export const SHOE_PAIR_GAP = 4.15; // how far shoe B is from shoe A
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
 * so the maths here sticks to + - * / and square roots, which every device does identically). The cooker is always where it is. `discs` are the fixed round things roaches cannot walk through (the trash heap and the mop bucket) and `capsules` the shoe pairs.
 */
export interface Layout {
  seed: number;
  obstacles: Rect[];
  shoes: ShoePair[];
  capsules: Capsule[]; // the solid footprints of the shoe pairs
  props: Prop[]; // the small obstacles from the pool (cleaning products, a stool, boxes, a pot); each is also one of the solid `discs`
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
/** How far a point is from the segment A-B. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return dist(px, pz, ax + vx * t, az + vz * t);
}
const capsuleOf = (h: ShoePair): Capsule => ({ ax: h.x, az: h.z, bx: h.x + h.dx, bz: h.z + h.dz, r: SHOE_RADIUS });
/** How far a point is from the edge of the capsule (negative inside). */
const capDist = (x: number, z: number, c: Capsule) => distToSegment(x, z, c.ax, c.az, c.bx, c.bz) - c.r;

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
    { x: 0, z: 0, hw: 9.6, hd: 4.2, kind: 'island' }, // (just the one island)
    { x: 22, z: -24, hw: 10.9, hd: 1.45, kind: 'broom' }, // (just the one broom)
    { x: -25, z: -20, hw: 7.49, hd: 5.69, kind: 'table' }, // (and the one table with its chairs)
  ] as Rect[],
  pairs: [[-12, 12, 3.7, 1.85, 0], [12, -12, -1.85, 3.7, 1], [-14, -8, 3.7, -1.85, 0], [14, 8, 1.85, 3.7, 1], [-30, 10, 3.7, 1.85, 1], [30, -10, -3.7, 1.85, 0], [-8, 30, 3.7, -1.85, 1], [8, -30, 1.85, 3.7, 0]] as [number, number, number, number, 0 | 1][],
};

function finishLayout(seed: number, obstacles: Rect[], shoes: ShoePair[], props: Prop[], trash: Disc, mop: Disc, pick: number, rand: () => number): Layout | null {
  const landmarks: Landmark[] = [{ id: 'trash', x: trash.x, z: trash.z }, { id: 'mop', x: mop.x, z: mop.z }, COOKER_LANDMARK];
  const discs: Disc[] = [trash, mop, ...props.map((p) => ({ x: p.x, z: p.z, r: p.r }))];
  const capsules = shoes.map(capsuleOf);
  const lm = landmarks[Math.min(2, Math.floor(pick * 3))];
  // the bottle: 6.6 to 8.2 from the landmark's middle (just outside the big heap or bucket), in the open
  for (let tries = 0; tries < 400; tries++) {
    const x = lm.x + (rand() * 2 - 1) * 8.2, z = lm.z + (rand() * 2 - 1) * 8.2, d = dist(x, z, lm.x, lm.z);
    if (d < 6.6 || d > 8.2 || Math.abs(x) > 35 || Math.abs(z) > 35) continue;
    if (obstacles.some((o) => distToRect(x, z, o) < BOTTLE_RADIUS + ROACH_RADIUS * 2 + 0.8)) continue;
    if (discs.some((c) => dist(x, z, c.x, c.z) < c.r + BOTTLE_RADIUS + ROACH_RADIUS * 2 + 0.8) || capsules.some((c) => capDist(x, z, c) < BOTTLE_RADIUS + ROACH_RADIUS * 2 + 0.8)) continue;
    if (START_SPOTS.some(([sx, sz]) => dist(x, z, sx, sz) < 5)) continue;
    return { seed, obstacles, shoes, capsules, props, trash, mop, landmarks, discs, poison: { landmark: lm.id, x, z, cx: lm.x, cz: lm.z } };
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
    return !all.some((c) => dist(x, z, c.x, c.z) < c.r + ROACH_RADIUS) && !layout.capsules.some((c) => capDist(x, z, c) < ROACH_RADIUS);
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
  const shoes: ShoePair[] = CLASSIC.pairs.map(([x, z, dx, dz, style]) => ({ x, z, dx, dz, style }));
  return finishLayout(0, CLASSIC.obstacles, shoes, [], { x: 30, z: 6, r: 3.25 }, { x: -30, z: -6, r: 2.99 }, 0, seeded(7)) ?? (undefined as never);
}

/**
 * Make a game's kitchen from its seed: ONE island, ONE diner table with its chairs, one or two brooms, four to ten pairs of shoes, the trash can and the mop bucket in different places every time, with the rules that keep it fair: everything well clear of the walls
 * (so a roach can get round), of the roaches' starting spots and of the cooker, a roach-sized gap between any two big things, and the whole floor joined up. If a layout cannot be made, the classic one is used.
 */
export function makeLayout(seed: number): Layout {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rand = seeded(seed * 7919 + attempt * 104729 + 12345);
    const cookerZone = (o: Rect) => o.z - o.hd < -27 && o.x + o.hw > COOKER.x - 9 && o.x - o.hw < COOKER.x + 9;
    const obstacles: Rect[] = [];
    const specs: { kind: 'island' | 'broom' | 'table'; long: [number, number]; short: [number, number] }[] = [
      { kind: 'island', long: [7.8, 10.2], short: [3.6, 4.56] }, // (just one island)
      { kind: 'table', long: [7.49, 7.49], short: [5.69, 5.69] }, // (and just one diner table with its chairs: the footprint is the whole set, 15 by 11.4)
      { kind: 'broom', long: [10.9, 10.9], short: [1.45, 1.45] }, // (a broom, lying any way round; a second one half the time)
      ...(rand() < 0.5 ? [{ kind: 'broom' as const, long: [10.9, 10.9] as [number, number], short: [1.45, 1.45] as [number, number] }] : []),
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
    const trash = spot(3.25, []), mop = trash && spot(2.99, [trash]);
    if (!trash || !mop) continue;
    // the small obstacles from the pool: 3 to 6 of them, any kinds (at most two of each), each one solid disc
    const props: Prop[] = [], kindCount = [0, 0, 0, 0];
    const propTarget = 3 + Math.floor(rand() * 4);
    for (let q = 0; q < propTarget; q++) {
      for (let tries = 0, placed = false; tries < 300 && !placed; tries++) {
        const kind = Math.min(3, Math.floor(rand() * 4)) as PropKind;
        if (kindCount[kind] >= 2) continue;
        const r = PROP_RADIUS[kind], x = (rand() * 2 - 1) * (36 - r), z = (rand() * 2 - 1) * (36 - r);
        let ux = rand() * 2 - 1, uz = rand() * 2 - 1; const ul = Math.sqrt(ux * ux + uz * uz);
        if (ul < 0.3) continue;
        ux /= ul; uz /= ul;
        if (obstacles.some((o) => distToRect(x, z, o) < r + 2.0) || START_SPOTS.some(([sx, sz]) => dist(x, z, sx, sz) < r + 4) || (z - r < -27 && Math.abs(x - COOKER.x) < 9 + r)) continue;
        if ([trash, mop, ...props].some((c) => dist(x, z, c.x, c.z) < r + c.r + 2.0)) continue;
        props.push({ x, z, r, kind, ux, uz }); kindCount[kind]++; placed = true;
      }
    }
    // the shoes, in pairs: the one obstacle that can be any number (4 to 10 pairs), each pair one solid capsule
    const shoes: ShoePair[] = [], placedDiscs: Disc[] = [trash, mop, ...props];
    const pairCount = 4 + Math.floor(rand() * 7);
    let shoesOk = true;
    for (let p = 0; p < pairCount && shoesOk; p++) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const x = (rand() * 2 - 1) * 34, z = (rand() * 2 - 1) * 34;
        let dx = rand() * 2 - 1, dz = rand() * 2 - 1; const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.3) continue;
        dx = (dx / len) * SHOE_PAIR_GAP; dz = (dz / len) * SHOE_PAIR_GAP;
        const cap: Capsule = { ax: x, az: z, bx: x + dx, bz: z + dz, r: SHOE_RADIUS };
        const pts: [number, number][] = [[cap.ax, cap.az], [cap.bx, cap.bz], [x + dx / 2, z + dz / 2]];
        const gap = SHOE_RADIUS * 2 + ROACH_RADIUS * 2 + 0.8; // (a roach and a bit between two pairs)
        const bad = pts.some(([px, pz]) => Math.abs(px) > 36 || Math.abs(pz) > 36 || obstacles.some((o) => distToRect(px, pz, o) < SHOE_RADIUS + ROACH_RADIUS * 2 + 0.6) || START_SPOTS.some(([sx, sz]) => dist(px, pz, sx, sz) < 5)
          || placedDiscs.some((q) => dist(px, pz, q.x, q.z) < q.r + SHOE_RADIUS + ROACH_RADIUS * 2 + 0.8) || (pz < -27 && Math.abs(px - COOKER.x) < 9))
          || shoes.some((o) => pts.some(([px, pz]) => distToSegment(px, pz, o.x, o.z, o.x + o.dx, o.z + o.dz) < gap) || [[o.x, o.z], [o.x + o.dx, o.z + o.dz]].some(([qx, qz]) => distToSegment(qx, qz, cap.ax, cap.az, cap.bx, cap.bz) < gap));
        if (bad) continue;
        shoes.push({ x, z, dx, dz, style: rand() < 0.5 ? 0 : 1 }); placed = true;
      }
      if (!placed) shoesOk = false;
    }
    if (!shoesOk) continue;
    const layout = finishLayout(seed, obstacles, shoes, props, trash, mop, rand(), rand);
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
    for (const c of layout.capsules) { // a pair of shoes: one solid capsule
      const vx = c.bx - c.ax, vz = c.bz - c.az, len2 = vx * vx + vz * vz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * vx + (z - c.az) * vz) / len2)) : 0;
      const nx = c.ax + vx * t, nz = c.az + vz * t, dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz), min = c.r + ROACH_RADIUS;
      if (d >= min) continue;
      if (d > 1e-6) { x = nx + (dx / d) * min; z = nz + (dz / d) * min; } else { x = nx - vz / Math.sqrt(len2 || 1) * min; z = nz + vx / Math.sqrt(len2 || 1) * min; }
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

/**
 * Can a roach stand with its middle at this point? (not in the walls, an island, a broom, a shoe, the trash can or the mop bucket). Food and the bottle do not count: they come and go. The sandal may only smack where this is
 * true: it cannot attack over something a roach could never be on top of.
 */
export function canStandAt(layout: Layout, x: number, z: number): boolean {
  const [px, pz] = pushOut(x, z, [], layout);
  return Math.abs(px - x) < 1e-6 && Math.abs(pz - z) < 1e-6;
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
  if (layout.capsules.some((c) => capDist(x, z, c) < FOOD_RADIUS + ROACH_RADIUS * 2 + 0.4)) return false;
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
