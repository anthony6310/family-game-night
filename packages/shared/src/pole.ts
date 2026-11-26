// Frog Climb: the pole's rules and shape, as PURE functions. The server judges with the numbers; the phones draw the pole's bend with the same functions.
// A pole is POLE_TOP "metres" tall (the frog's height `h` runs 0..POLE_TOP), drawn POLE_WORLD_HEIGHT world units tall. The frog clings to the left (-1) or right (+1) of its pole and the pole bends toward that side.

/** The height that wins the race. */
export const POLE_TOP = 182;
/** One climb hops this far up. */
export const CLIMB_STEP = 3;
/** After a climb the frog cannot act for this long; after a side swap, for this long (the swap is a quick scramble round the pole). */
export const CLIMB_COOLDOWN_MS = 280;
export const SWAP_COOLDOWN_MS = 220;

/**
 * THE LEAN. Each frog's pole has a lean from -1 (fully bent left) to +1 (fully bent right). While the frog clings to a side, the lean grows toward that side at a steady rate, faster the
 * higher the frog is (a long whippy pole near its tip is far easier to over-bend). Swapping sides turns the lean round: it eases back through the middle and builds up on the other side.
 * Reaching the frog's own side's limit (`LEAN_LIMIT` toward the frog) over-bends the pole: the frog slips down SLIP_DROP and the lean springs back to SLIP_RESET.
 */
/** The most a pole can lean either way (and so how far it bends before the frog slides down): 10% more than the 1 it first was, so the pole bends further, in either direction, before it over-bends. */
export const LEAN_LIMIT = 1.1;
export const LEAN_RATE_BOTTOM = 0.22; // lean per second at height 0 (about 4.5 s from straight to the limit)
export const LEAN_RATE_TOP = 0.62; // lean per second at the top of the pole (about 1.6 s)
export const SLIP_DROP = 5;
export const SLIP_RESET = 0.55;
/** How fast the lean builds at this height. */
export function leanRate(h: number): number { return LEAN_RATE_BOTTOM + (LEAN_RATE_TOP - LEAN_RATE_BOTTOM) * Math.min(1, Math.max(0, h / POLE_TOP)); }

// SHAPE (for drawing). World units: the pole stands at y = 0 (the ground) up to POLE_WORLD_HEIGHT; it bends sideways (local x) like a springy rod pushed at the frog's height.
export const POLE_WORLD_HEIGHT = 109.2; // (0.6 world units a metre)
export const POLE_MAX_DEFLECT = 18; // how far the frog is pushed sideways at the top of the pole at full lean
/** World height of a frog at height h. */
export function worldY(h: number): number { return (Math.min(POLE_TOP, Math.max(0, h)) / POLE_TOP) * POLE_WORLD_HEIGHT; }
/**
 * How far sideways (world units) the frog at height h is pushed by a lean: more the higher it is. It must grow faster than the frog's height: above the frog the pole carries on in a straight line
 * with slope 3d / 2a, so a deflection with a floor (as it once had) gave a low frog a huge slope and swung the whole pole sideways on the first hop. With d growing as height^1.6 the slope stays small low down.
 */
export function frogDeflection(h: number, lean: number): number {
  const f = Math.min(1, Math.max(0, h / POLE_TOP));
  return lean * POLE_MAX_DEFLECT * Math.pow(f, 1.6);
}
/**
 * The pole's sideways offset at world height y, with the frog at world height `a` pushed sideways by `d`: a rod fixed at the ground and pushed at `a` (below `a` it curves, above `a` it carries on in a straight line from the curve's end).
 * Also returns the slope dx/dy there (to tilt things that sit on the pole).
 */
export function poleCurve(y: number, a: number, d: number): { x: number; slope: number } {
  if (a < 0.5) return { x: 0, slope: 0 };
  if (y <= a) { const u = y / a; return { x: d * (3 * u * u - u * u * u) / 2, slope: (d / a) * (6 * u - 3 * u * u) / 2 }; }
  const slope = (3 * d) / (2 * a);
  return { x: d + slope * (y - a), slope };
}

// OBSTACLES (see obstacles.ts for where they are).
/** A frog that climbs into an obstacle on its side (or swaps onto one) falls this far. */
export const OBSTACLE_DROP = 6;
/** After a fall from an obstacle the frog cannot act for this long. */
export const OBSTACLE_STUN_MS = 350;

/** How hard a pole is straining, 0 (fine) .. 1 (at the limit, `LEAN_LIMIT`), from its lean: nothing until the lean passes 0.4. Wavy tremble lines fly off the pole and the screen edges redden by this much. */
export function bendStress(lean: number): number {
  const u = Math.min(1, Math.max(0, (Math.abs(lean) - 0.4) / (LEAN_LIMIT - 0.4)));
  return u * u * (3 - 2 * u);
}
