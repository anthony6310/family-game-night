// Snowflake Match: the snowflake DESIGNS and the way the flakes fall, as pure functions of the round's seed and of time.
// A design is just a small number (a recipe of a few clear features), so the server only sends numbers and every phone draws the identical flake.
// The server judges every pick with these; the phones draw with the same ones.
import { rand01 } from './goat';

export const FLAKE_COUNT = 15; // flakes falling at once (the same field for every player). Must be 3 more than a multiple of FLAKE_LANES: then a flake that wraps lands exactly one lane over from the one that follows it
export const POOL_SIZE = 12; // how many different designs are in play in a round (every flake in the field is one of them)
export const HAND_SIZE = 1; // snowflakes in a player's hand: tapping a falling flake that matches it is a match
export const HAND_SWAP_MS = 500; // after a match the held flake pops and the next one shows this long after (picks are ignored meanwhile)
export const FLAKE_PICK_GAP_MS = 80; // picks closer together than this are ignored
export const FLAKE_LAG_MAX_MS = 400; // a phone says WHEN it tapped; the server believes it up to this long ago (never in the future)
/** A flake's radius as a fraction of the screen height (the scene works out what that is in the world). */
export const FLAKE_RADIUS_FRAC = 0.065;

// ---- designs: six identical arms round a hub; the arm has a stem, side branches, a tip and the hub has a shape. Each feature has only a few clear options, so two designs that differ in two features are easy to tell apart at a glance.
export const STEM_LENGTHS = [0.68, 0.84, 1.0]; // of the flake's radius
export const BRANCH_ANGLES_DEG = [35, 55, 75]; // how far the branches swing away from the stem
export const TIP_KINDS = 4; // 0 plain, 1 dot, 2 fork, 3 diamond
export const CENTER_KINDS = 3; // 0 plain hub, 1 hexagon ring, 2 big dot
export const DESIGN_COUNT = 3 * 3 * 3 * TIP_KINDS * CENTER_KINDS; // 324 designs

export interface FlakeDesign { stem: number; pairs: number; angle: number; tip: number; center: number } // stem/angle are indexes; pairs is 1..3 (side branches along the arm)
export function decodeDesign(id: number): FlakeDesign {
  let n = Math.max(0, Math.floor(id)) % DESIGN_COUNT;
  const center = n % CENTER_KINDS; n = Math.floor(n / CENTER_KINDS);
  const tip = n % TIP_KINDS; n = Math.floor(n / TIP_KINDS);
  const angle = n % 3; n = Math.floor(n / 3);
  const pairs = (n % 3) + 1; n = Math.floor(n / 3);
  return { stem: n % 3, pairs, angle, tip, center };
}
/** How many features two designs differ in (0..5). */
export function designDistance(a: number, b: number): number {
  const x = decodeDesign(a), y = decodeDesign(b);
  return (x.stem !== y.stem ? 1 : 0) + (x.pairs !== y.pairs ? 1 : 0) + (x.angle !== y.angle ? 1 : 0) + (x.tip !== y.tip ? 1 : 0) + (x.center !== y.center ? 1 : 0);
}
/** The designs in play in a round: POOL_SIZE of them, every two differing in at least two features (so no two look alike). Repeatable from the seed. */
export function makePool(seed: number, size: number = POOL_SIZE): number[] {
  const pool: number[] = [];
  for (let n = 0; pool.length < size && n < 5000; n++) {
    const id = Math.floor(rand01(seed, 2000 + n) * DESIGN_COUNT);
    if (pool.includes(id) || pool.some((p) => designDistance(p, id) < 2)) continue;
    pool.push(id);
  }
  for (let n = 0; pool.length < size; n++) { const id = (n * 37) % DESIGN_COUNT; if (!pool.includes(id)) pool.push(id); } // (never reached in practice)
  return pool;
}

// ---- falling. A flake falls down the screen and wraps back to the top in a different lane. Positions are in screen-shaped numbers: nx 0 (left) .. 1 (right), ny 0 (top of the screen) .. 1 (bottom).
// TO KEEP FLAKES FROM OVERLAPPING: they all fall at the SAME speed, in FLAKE_LANES lanes across the screen (a tall phone fits about 4 flakes across), and the start is staggered evenly down the screen, so
// neighbours in the fall are always in different lanes and the gaps never change. Each time a flake wraps it moves one lane across (for everyone, the same way). A flake that has been picked starts again at
// the top, which breaks the even pattern, so the server gives it a start that is clear (`chooseStart`): a lane, and if need be a short wait out of sight, found by looking ahead along the new flake's next few falls.
export const FLAKE_TOP = -0.1; // a flake starts just above the top of the screen...
export const FLAKE_LAP = 1.2; // ...and falls this far (just past the bottom) before it wraps
export const FLAKE_SPEED = 0.13; // screens a second (about 7.7 seconds to cross)
export const FLAKE_LANES = 4;
export const FLAKE_SEP = 0.14; // two flakes are kept at least this far apart, centre to centre (screen heights; a flake is 2 * FLAKE_RADIUS_FRAC = 0.13 across)
export const FLAKE_MIN_ASPECT = 0.46; // the narrowest phone (width / height) the lanes are made for: lanes are 1 / FLAKE_LANES of the width apart
/** How far apart vertically two flakes in lanes `laneGap` apart must be so they cannot overlap on the narrowest phone (flakes in lanes two apart can never touch). */
export function flakeClearance(laneGap: number): number {
  const across = (laneGap / FLAKE_LANES) * FLAKE_MIN_ASPECT;
  return Math.sqrt(Math.max(0, FLAKE_SEP * FLAKE_SEP - across * across));
}
/** The lane (0..FLAKE_LANES-1) a flake is in on its `lap`th fall, if its first fall was in lane `lane0`. */
export function flakeLane(lane0: number, lap: number): number { return (((lane0 + lap) % FLAKE_LANES) + FLAKE_LANES) % FLAKE_LANES; }
/** Where flake i is `now` if its current fall began at `born` in lane `lane0`. */
export function flakePose(i: number, born: number, lane0: number, now: number): { nx: number; ny: number; spin: number; lap: number } {
  const s = Math.max(0, (now - born) / 1000), dist = s * FLAKE_SPEED, lap = Math.floor(dist / FLAKE_LAP);
  return {
    nx: (flakeLane(lane0, lap) + 0.5) / FLAKE_LANES,
    ny: FLAKE_TOP + (dist - lap * FLAKE_LAP),
    spin: (i % 2 ? 1 : -1) * 0.35 * s + i, // (a slow turn: the design is six-fold, so it reads the same however it is turned)
    lap,
  };
}
/** Is the flake on the screen (so it can be tapped)? */
export function flakeOnScreen(ny: number): boolean { return ny >= 0 && ny <= 1; }

export const FLAKE_MAX_DELAY_MS = 900; // a respawning flake may wait this long at the top, out of sight, for a clear gap

/**
 * Where flake i should start its new fall at the top: the lane, and how long to wait out of sight first, that keep it furthest from every other flake along its whole first fall. It prefers no waiting, and
 * waits (up to FLAKE_MAX_DELAY_MS, in steps) only if no lane is clear right now: all flakes fall at one speed, so a spot that is only a little crowded stays that way for the whole round unless it waits for a better one.
 * `flakes` are the field as it is now (flake i's own entry is ignored). `tieBreak` (0..1) decides between equally good lanes.
 */
export function chooseStart(flakes: { born: number; lane: number }[], i: number, now: number, tieBreak = 0): { lane: number; delay: number } {
  let best = { lane: 0, delay: 0 }, bestScore = Infinity;
  for (let delay = 0; delay <= FLAKE_MAX_DELAY_MS; delay += 100) {
    const born = now + delay;
    for (let k = 0; k < FLAKE_LANES; k++) {
      const cand = (k + Math.floor(tieBreak * FLAKE_LANES)) % FLAKE_LANES; // (start the search at a random lane)
      let score = 0;
      for (let t = born; t <= born + FLAKE_LANES * (FLAKE_LAP / FLAKE_SPEED) * 1000; t += 150) { // (looks ahead FLAKE_LANES falls: lanes wrap round, so how two flakes sit next to each other only repeats after that many)
        const mine = flakePose(i, born, cand, t);
        for (let j = 0; j < flakes.length; j++) {
          if (j === i) continue;
          const other = flakePose(j, flakes[j].born, flakes[j].lane, t);
          const need = flakeClearance(Math.abs(flakeLane(flakes[j].lane, other.lap) - flakeLane(cand, mine.lap)));
          const gap = Math.abs(other.ny - mine.ny);
          if (gap < need) score += need - gap; // (how badly they would overlap, summed over the fall)
        }
      }
      if (score < bestScore - 1e-9) { bestScore = score; best = { lane: cand, delay }; }
      if (bestScore < 1e-9) return best; // (a clear start: take it, with the least waiting)
    }
  }
  return best;
}
