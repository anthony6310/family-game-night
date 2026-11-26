// Mountain Goats: the platforms, the swinging indicator and the judging, as PURE functions of the round's seed and of time.
// The server judges every jump with these; the phones draw with the same ones (so what a player sees lined up is what the server measures).

/** The goat jumps along +x. Platform 0 (where every goat starts) is at x = 0; platform n+1 is gapAt(seed, n) further on. */
export const GAP_MIN = 4;
export const GAP_MAX = 9;
/** How far the indicator can stretch. It sweeps from LEN_MIN out to LEN_MAX and back. */
export const LEN_MIN = 1.5;
export const LEN_MAX = GAP_MAX + 2;
/** After a good jump the goat is in the air this long, then the next indicator starts. After a miss the goat falls and climbs back for FALL_MS. */
export const JUMP_MS = 550;
export const FALL_MS = 1500;
/** A phone says WHEN it tapped (its idea of the server clock): the server believes it up to this much in the past (network lag), never in the future. */
export const LAG_MAX_MS = 400;
/** Taps closer together than this are ignored. */
export const JUMP_TAP_GAP_MS = 120;
/** The first platform's size (radius), and the ramp: the ledges get smaller over the first RAMP_JUMPS jumps (the marker's speed never changes). */
export const START_RADIUS = 1.8;
export const RAMP_JUMPS = 15;

const ramp = (n: number) => Math.min(1, Math.max(0, n / RAMP_JUMPS));

/** A repeatable number 0..1 from a seed and an index. */
export function rand01(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Distance from platform n to platform n+1. */
export function gapAt(seed: number, n: number): number { return GAP_MIN + (GAP_MAX - GAP_MIN) * rand01(seed, n); }
/** How far off the indicator may be and still land: also the radius of the platform being jumped TO (platform n+1). */
export function tolAt(n: number): number { return 1.4 - 0.6 * ramp(n); }
/** Platform n's radius (platform 0 is the big starting ledge). */
export function radiusOf(n: number): number { return n <= 0 ? START_RADIUS : tolAt(n - 1); }
/** Seconds for the indicator to go out and back: always the same. (A function of n only so a later change can ramp it again.) */
export const SWEEP_SECONDS = 2.2;
export function periodAt(_n: number): number { return SWEEP_SECONDS; }
/** Where platform n stands along x. */
export function platformX(seed: number, n: number): number { let x = 0; for (let k = 0; k < n; k++) x += gapAt(seed, k); return x; }

/** The indicator's length `sinceMs` after it started (it starts short, grows to LEN_MAX, shrinks back, and so on at a steady speed). */
export function indicatorLen(n: number, sinceMs: number): number {
  const x = Math.max(0, sinceMs) / 1000 / periodAt(n), f = x - Math.floor(x), tri = 1 - Math.abs(2 * f - 1);
  return LEN_MIN + (LEN_MAX - LEN_MIN) * tri;
}
/** How high a leap of this length arcs (the goat and the bird's height are both drawn from this). */
export function arcHeight(dist: number): number { return 0.6 + 0.12 * dist; }

// THE BIRD. From jump BIRD_FROM on, a bird may be patrolling across the gap, flying back and forth over the goat's path. The goat's leap lasts JUMP_MS: if the goat meets the bird
// in the air, they collide and both fall; otherwise the goat snakes past. The bird is a pure function of the seed, the jump and the time since the marker started.
export const BIRD_FROM = 4;
// HITBOXES. The goat and the bird each have a box (half sizes along x = the way the goat leaps, y = up, z = across the gap) about as big as what is drawn: the goat is a long body with a head, the
// bird flies along z with its wings spread along x. They collide when the two boxes overlap, wherever the goat's leap takes it (a goat that leaps short or long into the bird hits it too).
export const GOAT_BOX = { x: 0.7, y: 0.6, z: 0.3 };
export const BIRD_BOX = { x: 0.6, y: 0.35, z: 0.3 };
export const GOAT_BODY_Y = 0.9; // the height of the goat's body above the ground it stands on (the bird flies at the height of the goat's arc plus this)
export const BIRD_AMP = 3.7; // how far either side of the goat's path the bird flies. With the period below, a correctly aimed leap at a random moment meets the bird about 1 time in 4 (measured)
/** The bird's swing time (seconds for out and back): about the speed the bird has always had (peak 7.2 to 7.7 units a second). It is kept where the bird can never fall into lockstep with the 2.2 s sweep:
 *  the marker is on target at the same point of every sweep, and the bird passes the middle twice a swing, so between two sweeps its pattern has moved on by 2 * SWEEP_SECONDS / period swings.
 *  For periods in this range that is 1.37 to 1.46 (never close to a whole number), so a blocked moment is always followed by a clear one within a sweep or two. */
export const BIRD_PERIOD_MIN = 3.01;
export const BIRD_PERIOD_MAX = 3.22;
export interface Bird { fx: number; periodS: number; phase: number }
/** The bird patrolling the gap for the jump from platform n, if there is one (more likely the further you get). `fx` is how far along the gap it flies (0..1). */
export function birdAt(seed: number, n: number): Bird | null {
  if (n < BIRD_FROM || rand01(seed, n + 5000) >= Math.min(0.9, 0.4 + 0.05 * (n - BIRD_FROM))) return null;
  return { fx: 0.35 + 0.3 * rand01(seed, n + 6000), periodS: BIRD_PERIOD_MIN + (BIRD_PERIOD_MAX - BIRD_PERIOD_MIN) * rand01(seed, n + 7000), phase: 2 * Math.PI * rand01(seed, n + 8000) };
}
/** How far to the side of the goat's path the bird is, `elapsedMs` after the ROUND started (the bird flies on the round's clock, not the marker's, so it is already flying before the goat gets to its gap). */
export function birdZ(b: Bird, elapsedMs: number): number { return BIRD_AMP * Math.sin((2 * Math.PI * (elapsedMs / 1000)) / b.periodS + b.phase); }
/** Where, 0..1 along its leap, the goat meets the bird if it taps `elapsedMs` after the round started and leaps `len` (the whole gap if it is on target); null if it gets past. */
export function birdCollision(seed: number, n: number, elapsedMs: number, len: number = gapAt(seed, n)): number | null {
  const b = birdAt(seed, n);
  if (!b) return null;
  const gap = gapAt(seed, n), by = 4 * arcHeight(gap) * b.fx * (1 - b.fx) + GOAT_BODY_Y, h = arcHeight(len);
  for (let u = 0; u <= 1; u += 0.0125) {
    const dx = len * u - gap * b.fx, dy = 4 * h * u * (1 - u) + GOAT_BODY_Y - by, dz = birdZ(b, elapsedMs + u * JUMP_MS);
    if (Math.abs(dx) <= GOAT_BOX.x + BIRD_BOX.x && Math.abs(dy) <= GOAT_BOX.y + BIRD_BOX.y && Math.abs(dz) <= GOAT_BOX.z + BIRD_BOX.z) return u;
  }
  return null;
}

/** Judges a tap `sinceMs` after the indicator started (and `elapsedMs` after the round started, which is the bird's clock), on the jump from platform n: where the goat would land, whether it lands (on the platform, and past the bird), and where it met the bird. */
export function judgeJump(seed: number, n: number, sinceMs: number, elapsedMs: number): { ok: boolean; len: number; birdU: number | null } {
  const len = indicatorLen(n, sinceMs), onTarget = Math.abs(len - gapAt(seed, n)) <= tolAt(n);
  const birdU = birdCollision(seed, n, elapsedMs, onTarget ? gapAt(seed, n) : len); // (an on-target goat lands in the middle of the next ledge; one that is off leaps as far as the marker was: either can meet the bird)
  return { ok: onTarget && birdU === null, len, birdU };
}
