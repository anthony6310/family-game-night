import type { V3 } from './pirate';
/**
 * Whale animations for Broadside Battle: pure functions of time (so a phone, the server and the review page all agree, and the review page can
 * scrub back and forth). Units are the game's: the ships run along x, the water is y = 0, and the whale lives in the gap between the ships (z = 0)
 * with its nose pointing towards +x. Shared by the server (the schedule, and the leap blocking cannonballs) and the phones (the picture).
 *
 *   peek   - a partial breach: the head and back rise, hang, and sink again
 *   blow   - the same, bigger, with a blow-hole spout at the top
 *   breach - the finale: rumble, one smooth arcing leap (the body bends like a jumping whale), and a huge splash
 */
export type WhaleKind = 'peek' | 'blow' | 'breach';

export interface WhaleTuning {
  // peek
  peekSeconds: number; peekCenter: number; peekPitch: number;
  bob: number; // how much the swimming bob and body ripple are (1 = normal, 0 = none)
  water: number; // the size of the water droplets and how far they are thrown (1 = the big splash)
  trail: number; // how far back (towards the stern, -x) the peek and the blow sit
  // blow
  blowSeconds: number; blowCenter: number; blowPitch: number; blowAt: number; blowDur: number; blowHeight: number;
  // breach
  antic: number; air: number; apex: number; launchDepth: number; travel: number; launchPitch: number; settle: number; rumble: number; bend: number;
}
// (the numbers tuned on the review page)
export const WHALE_TUNING: WhaleTuning = {
  peekSeconds: 7.5, peekCenter: -3.2, peekPitch: 0.18, trail: 3.5, bob: 2.5, water: 0.31,
  blowSeconds: 8, blowCenter: -2.5, blowPitch: 0.24, blowAt: 0.44, blowDur: 1.8, blowHeight: 14,
  antic: 2.8, air: 3.8, apex: 10, launchDepth: -15, travel: 25, launchPitch: 1.25, settle: 3.5, rumble: 0.7, bend: 3.4,
};

export interface WhalePose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; bend: number; swim: number } // bend: how far the nose and tail dip below the middle, in units (the body arches like a leaping whale)
export const WHALE_LENGTH = 28;
const YAW = Math.PI / 2; // nose towards +x

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOutSine = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(k));
const easeOutSine = (k: number) => Math.sin((Math.PI / 2) * clamp01(k));
const easeInSine = (k: number) => 1 - Math.cos((Math.PI / 2) * clamp01(k));

export function durationOf(kind: WhaleKind, tune: WhaleTuning): number {
  if (kind === 'peek') return tune.peekSeconds;
  if (kind === 'blow') return tune.blowSeconds;
  return tune.antic + tune.air + tune.settle;
}

/** How far through a surfacing the whale is: 0 deep, 1 up. Slow rise, a long hold with a gentle float, a slow sink. */
function surfacing(u: number): number {
  if (u < 0.34) return easeInOutSine(u / 0.34);
  if (u < 0.66) return 1;
  return 1 - easeInOutSine((u - 0.66) / 0.34);
}

export function whalePose(kind: WhaleKind, t: number, tune: WhaleTuning): WhalePose {
  if (kind === 'peek' || kind === 'blow') {
    const dur = durationOf(kind, tune), u = clamp01(t / dur);
    const e = surfacing(u);
    const peak = kind === 'peek' ? tune.peekCenter : tune.blowCenter, pitch = kind === 'peek' ? tune.peekPitch : tune.blowPitch;
    const float = e >= 1 ? 1 : e;
    return {
      x: -3 + 8 * u - tune.trail, z: 0, yaw: YAW + 0.04 * Math.sin(t * 0.9),
      y: lerp(-10, peak, e) + 0.18 * Math.sin(t * 1.3) * float + tune.bob * (0.45 * Math.sin(t * 2.1) + 0.15 * Math.sin(t * 3.4 + 1)),
      pitch: lerp(0.02, pitch, e) + 0.02 * Math.sin(t * 1.1) + tune.bob * 0.045 * Math.sin(t * 2.1 - 1.2),
      roll: 0.05 * Math.sin(t * 0.8), bend: 1.4 * e, swim: tune.bob,
    };
  }
  const { antic, air, apex, launchDepth: y0, travel } = tune;
  if (t < antic) { // gathering itself, far below
    const k = t / antic;
    return { x: -travel / 2, y: lerp(y0 - 12, y0, easeInSine(k)), z: 0, yaw: YAW, pitch: tune.launchPitch, roll: 0, bend: 0, swim: 0 };
  }
  if (t < antic + air) {
    // ONE smooth arc: the height is a sine over the whole flight, the nose swings from up to down with the same sine, and the body arches most at the top
    const u = (t - antic) / air, arc = Math.sin(Math.PI * u);
    return { x: (u - 0.5) * travel, y: lerp(y0, apex, arc), z: 0, yaw: YAW, pitch: tune.launchPitch * Math.cos(Math.PI * u), roll: 0.45 * (u - 0.5), bend: tune.bend * Math.pow(arc, 0.8), swim: 0 };
  }
  const k = clamp01((t - antic - air) / tune.settle);
  return { x: travel / 2, y: y0 - 22 * (1 - (1 - k) * (1 - k)), z: 0, yaw: YAW, pitch: -tune.launchPitch, roll: 0.25, bend: 0, swim: 0 };
}


/** Where a point of the whale's body (local: +z nose, +y up, +x its side) is in the world: rolled, pitched, turned to its heading, then moved. */
export function whalePointWorld(p: WhalePose, local: V3): V3 {
  const [x0, y0, z0] = local;
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll), a = -p.pitch, ca = Math.cos(a), sa = Math.sin(a), cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const x1 = x0 * cr - y0 * sr, y1 = x0 * sr + y0 * cr; // roll about the long axis (z)
  const y2 = y1 * ca - z0 * sa, z2 = y1 * sa + z0 * ca; // pitch about x
  return [x1 * cy + z2 * sy + p.x, y2 + p.y, -x1 * sy + z2 * cy + p.z]; // heading about y
}
/** The other way: a world point in the whale's own frame. */
export function whalePointLocal(p: WhalePose, world: V3): V3 {
  const dx = world[0] - p.x, dy = world[1] - p.y, dz = world[2] - p.z;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), a = -p.pitch, ca = Math.cos(a), sa = Math.sin(a), cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  const x1 = dx * cy - dz * sy, z2 = dx * sy + dz * cy; // undo the heading
  const y1 = dy * ca + z2 * sa, z0 = -dy * sa + z2 * ca; // undo the pitch
  return [x1 * cr + y1 * sr, -x1 * sr + y1 * cr, z0]; // undo the roll
}

export interface BreachEvents { launch: number; exit: number; apexAt: number; enter: number; end: number }
/** The moments the breach is built around: the whale breaking the surface going up, the top of the leap, and hitting the water going down. */
export function breachEvents(tune: WhaleTuning): BreachEvents {
  const air = tune.air, local: V3 = [0, 0, WHALE_LENGTH / 2], tail: V3 = [0, 0, -WHALE_LENGTH / 2];
  let exit = tune.antic, enter = tune.antic + air;
  for (let t = tune.antic; t < tune.antic + air; t += 0.02) { // the tail clears the water going up
    const p = whalePose('breach', t, tune);
    if (Math.min(whalePointWorld(p, local)[1], whalePointWorld(p, tail)[1]) > 0) { exit = t; break; }
  }
  for (let t = tune.antic + air; t > tune.antic; t -= 0.02) { // the tail leaves the air going down: the last moment any of it is above the water
    const p = whalePose('breach', t, tune);
    if (Math.max(whalePointWorld(p, local)[1], whalePointWorld(p, tail)[1]) > 0) { enter = t; break; }
  }
  return { launch: tune.antic, exit, apexAt: tune.antic + tune.air / 2, enter, end: durationOf('breach', tune) };
}

/** The camera shake level (in the scene's units: firing your own cannon is 0.455). */
export function shakeAt(kind: WhaleKind, t: number, tune: WhaleTuning): number {
  if (kind !== 'breach') return 0;
  const ev = breachEvents(tune);
  let s = 0;
  if (t < tune.antic) s = tune.rumble * Math.pow(t / tune.antic, 1.6) * (0.75 + 0.25 * Math.sin(t * 37)); // a growing rumble
  if (t >= tune.antic - 0.05 && t < tune.antic) s = Math.max(s, 0.2);
  if (t >= ev.exit - 0.15) s = Math.max(s, 1.3 * Math.exp(-(t - ev.exit + 0.15) * 3.2));
  if (t >= ev.enter) s = Math.max(s, 2.0 * Math.exp(-(t - ev.enter) * 1.7));
  return s;
}

// ================================================================ when the whale comes, and where it blocks
/** The whale always comes three times, in order: the peek, the blow, then the breach. Each starts at a random moment inside its window (seconds into the round). */
export const WHALE_WINDOWS = { peek: [15, 30], blow: [35, 55], breach: [65, 75] } as const;
export const WHALE_GAP = 3; // at least this long between the end of one visit and the start of the next (they are never back to back)
export interface WhaleSchedule { peek: number; blow: number; breach: number } // when each starts, in seconds since the round began

export function makeWhaleSchedule(rand: () => number = Math.random, tune: WhaleTuning = WHALE_TUNING): WhaleSchedule {
  const pick = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const peek = pick(...WHALE_WINDOWS.peek);
  const blow = pick(Math.max(WHALE_WINDOWS.blow[0], peek + durationOf('peek', tune) + WHALE_GAP), WHALE_WINDOWS.blow[1]);
  const breach = pick(Math.max(WHALE_WINDOWS.breach[0], blow + durationOf('blow', tune) + WHALE_GAP), WHALE_WINDOWS.breach[1]);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { peek: r(peek), blow: r(blow), breach: r(breach) };
}
/** Which visit is on at round time `seconds`, and how far into it, or null. */
export function whaleVisitAt(schedule: WhaleSchedule | null, seconds: number, tune: WhaleTuning = WHALE_TUNING): { kind: WhaleKind; t: number } | null {
  if (!schedule) return null;
  for (const kind of ['peek', 'blow', 'breach'] as const) {
    const t = seconds - schedule[kind];
    if (t >= 0 && t <= durationOf(kind, tune)) return { kind, t };
  }
  return null;
}

/** The whale's body as a chain of balls (local z along the body, y up, x its side; radius), the flukes at the tail, for cannonballs to hit. */
const WHALE_BODY: [number, number, number, number][] = [
  [0, 0.3, 12, 2.6], [0, 0.4, 9, 3.3], [0, 0.3, 5, 4.0], [0, 0.2, 1, 4.3], [0, 0.1, -3, 3.9], [0, 0, -7, 2.7], [0, 0, -10.5, 1.6], [0, 0, -13, 0.9],
  [3.5, 0, -15.5, 1.4], [-3.5, 0, -15.5, 1.4], [6.5, 0, -16.5, 1.2], [-6.5, 0, -16.5, 1.2],
];
/** A ball of radius `radius` at world point `p` is touching the whale if its leap is on (it blocks only while it is out of the water, flying). `breachSeconds` is when the breach started (round clock). */
export function whaleBlocks(p: V3, seconds: number, breachStart: number | null, radius: number, tune: WhaleTuning = WHALE_TUNING, events?: BreachEvents): boolean {
  if (breachStart === null) return false;
  const t = seconds - breachStart;
  const ev = events ?? breachEvents(tune);
  if (t < ev.exit || t > ev.enter) return false;
  const pose = whalePose('breach', t, tune);
  const [lx, ly, lz] = whalePointLocal(pose, p);
  for (const [bx, by, bz, br] of WHALE_BODY) {
    const zz = bz / (WHALE_LENGTH / 2), cy = by - pose.bend * zz * zz; // (the arched body: the middle is higher than the ends)
    if (Math.hypot(lx - bx, ly - cy, lz - bz) <= br + radius) return true;
  }
  return false;
}
