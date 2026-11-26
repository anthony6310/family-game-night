// Frog Climb obstacles: clusters of thorns sticking out of one side of the pole. Everyone's pole has the SAME obstacles (made from the round's seed), as pure functions, so the server judges and the phones draw the same ones.
// They start OBSTACLE_FROM of the way up and get harder with height: more thorns (so a taller hitbox), and more and more often on the opposite side to the last one (so you must swap, and quickly). They stay well apart.
import { rand01 } from './goat';
import { POLE_TOP } from './pole';

export const OBSTACLE_FROM = 0.3;
export const THORNS_MIN = 2;
export const THORNS_MAX = 5;
/** A cluster's hitbox is as tall as its thorns need: this much taller for every thorn (plus HITBOX_BASE), so more thorns means a taller hitbox. */
export const HITBOX_BASE = 2;
export interface Obstacle { y0: number; y1: number; side: -1 | 1; thorns: number } // a frog on `side` whose height is in y0..y1 is hit

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cache = new Map<number, Obstacle[]>();

/** How many thorns a cluster at progress t (0 at the first, 1 at the top) has: any of 2 to 5 can come up anywhere, but the higher you are the more likely it is to be a big one. */
function thornCount(seed: number, n: number, t: number): number {
  return Math.min(THORNS_MAX, Math.max(THORNS_MIN, Math.round(lerp(2.2, 4.6, t) + (rand01(seed, 8800 + n) - 0.5) * 3)));
}

/** All the obstacles of a round, lowest first. Integer heights (the frog's heights are whole numbers). */
export function obstaclesFor(seed: number): Obstacle[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const start = Math.round(POLE_TOP * OBSTACLE_FROM), end = POLE_TOP - 6, list: Obstacle[] = [];
  let y = start + 4, prev: -1 | 1 | 0 = 0, n = 0;
  for (;;) {
    const t = Math.min(1, Math.max(0, (y - start) / (end - start)));
    const thorns = thornCount(seed, n, t), len = thorns + HITBOX_BASE; // (never under 4: one hop is 3, so a frog can never hop clean over one)
    if (y + len > end) break;
    const flip: boolean = prev !== 0 && rand01(seed, 9000 + n) < lerp(0.2, 0.75, t); // (higher up, the next one is usually on the other side)
    const side: -1 | 1 = flip ? (prev === 1 ? -1 : 1) : rand01(seed, 9500 + n) < 0.5 ? -1 : 1;
    list.push({ y0: y, y1: y + len, side, thorns });
    prev = side; n++;
    y += len + Math.round(lerp(34, 16, t)) + Math.round(rand01(seed, 9900 + n) * 2); // (the gaps shrink with height, but stay wide)
  }
  if (cache.size > 20) cache.clear();
  cache.set(seed, list);
  return list;
}
/** The obstacle a frog on `side` at height `h` is touching, if any. */
export function obstacleAt(obstacles: Obstacle[], side: number, h: number): Obstacle | null {
  for (const o of obstacles) if (o.side === side && h >= o.y0 && h <= o.y1) return o;
  return null;
}
