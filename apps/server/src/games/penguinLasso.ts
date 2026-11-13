import { PENGUIN_SECONDS, type LoopView, type PenguinLassoView, type PenguinView, type SkaterView } from '@fgn/shared';
import { arenaRadiusFor, spawnPoints } from './terrain';
import type { GameEngine } from './types';

/**
 * Every number that shapes how Penguin Lasso FEELS lives here (tweak while playtesting). Units: world units and seconds.
 * The idea: you skate on flat ice leaving a trail. The trail is short and its old end keeps vanishing, so to lasso a
 * penguin you must skate a CLOSED LOOP around it before the start of the loop disappears.
 */
export interface PenguinLassoConfig {
  durationMs: number;
  /** Radius of the round rink for `basePlayers` players; it grows with the player count the same way Snowball's arena does (area ∝ players). */
  arenaRadius: number;
  basePlayers: number;
  skaterRadius: number;

  // ----- skating (slippery: slow to speed up, long glide) -----
  maxSpeed: number;
  accelRate: number;
  frictionRate: number;

  // ----- the trail -----
  /** The most trail a skater can have out at once. The oldest part fades away as new trail is laid, which is what limits loops. */
  trailMax: number;
  /** A new trail point is laid each time the skater has moved this far from the last one. */
  trailSpacing: number;
  /** Trail older than this disappears even if you stand still (so a loop can't be left lying around forever). */
  trailMaxAgeSeconds: number;
  /** A loop has to be at least this long (around its edge) to count: stops tiny wiggles from "closing" with the trail just behind you. */
  minLoopLength: number;
  /** Coming this close to your own older trail also closes the loop (a forgiving "close enough"). */
  closeDistance: number;

  // ----- penguins -----
  /** Penguins on the ice for `basePlayers` players, plus `penguinsPerExtraPlayer` for each additional player. */
  penguins: number;
  penguinsPerExtraPlayer: number;
  penguinSpeedMin: number;
  penguinSpeedMax: number;
  /** A penguin walks in one direction for this long, between these two values, then picks a new one (or stops to look around). */
  walkSecondsMin: number;
  walkSecondsMax: number;
  idleChance: number; // chance (0..1) that its next move is to stand still for a moment
  idleSecondsMin: number;
  idleSecondsMax: number;
  edgeMargin: number; // penguins turn back when this close to the wall
  /** A caught penguin is replaced by a new one this long afterwards, somewhere away from the skaters. */
  respawnSeconds: number;
  spawnClearance: number; // new penguins appear at least this far from every skater and from each other
  caughtShowSeconds: number; // how long a caught penguin stays in the view (for the collect animation)
  loopShowSeconds: number; // how long a closed loop stays in the view (for the flash)

  // ----- igloos (home bases) -----
  /** Each player's igloo stands at this fraction of the rink's radius, on the same side as their starting spot (just behind it). */
  iglooDistance: number;
  iglooRadius: number; // its size: solid, nobody skates or walks through it
  /** Skating within this distance of YOUR igloo cashes in everything in your bag. */
  cashRadius: number;

  random: () => number; // Math.random normally; tests pass a seeded one
}

export const DEFAULT_PENGUIN_CONFIG: PenguinLassoConfig = {
  durationMs: PENGUIN_SECONDS * 1000,
  arenaRadius: 45,
  basePlayers: 2,
  skaterRadius: 1,
  maxSpeed: 12, // (was 10: skaters are 20% faster)
  accelRate: 2.6, // ...and pick up speed 20% quicker to match
  frictionRate: 0.5,
  trailMax: 45, // (was 55)
  trailSpacing: 0.5,
  trailMaxAgeSeconds: 9, // (was 12)
  minLoopLength: 9,
  closeDistance: 0.9,
  penguins: 8,
  penguinsPerExtraPlayer: 4,
  penguinSpeedMin: 2.5,
  penguinSpeedMax: 4,
  walkSecondsMin: 1,
  walkSecondsMax: 2.6,
  idleChance: 0.25,
  idleSecondsMin: 0.6,
  idleSecondsMax: 1.6,
  edgeMargin: 3,
  respawnSeconds: 2,
  spawnClearance: 8,
  caughtShowSeconds: 1.2,
  loopShowSeconds: 0.8,
  iglooDistance: 0.8,
  iglooRadius: 2.6,
  cashRadius: 7,
  random: Math.random,
};

type Pt = [number, number];
interface TrailPoint { x: number; z: number; t: number }

interface Skater {
  x: number; z: number; vx: number; vz: number;
  steerX: number; steerZ: number;
  trail: TrailPoint[]; // oldest first; the skater is at the end
  carried: number; // penguins in the bag (not points yet)
  banked: number; // penguins cashed in at the igloo: the score
}
interface Penguin {
  id: number; x: number; z: number; heading: number; speed: number;
  walking: boolean; changeAt: number; // when it next decides what to do
  caughtBy?: string; caughtAt?: number;
}
interface Loop { id: number; playerId: string; points: Pt[]; at: number }

interface PenguinState {
  startsAt: number; endsAt: number; arenaRadius: number;
  skaters: Record<string, Skater>;
  igloos: Record<string, { x: number; z: number }>;
  penguins: Penguin[];
  loops: Loop[];
  respawns: number[]; // times (ms) at which a new penguin should appear
  nextId: number;
  clock: number;
}

const round = (n: number, places = 2) => { const f = 10 ** places; return Math.round(n * f) / f; };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Where the segments a→b and c→d cross, or null if they don't. */
function segmentCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * rz] : null;
}

/** The point on segment c→d that is nearest to p. */
function nearestOnSegment(p: Pt, c: Pt, d: Pt): Pt {
  const sx = d[0] - c[0], sz = d[1] - c[1];
  const len2 = sx * sx + sz * sz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - c[0]) * sx + (p[1] - c[1]) * sz) / len2));
  return [c[0] + t * sx, c[1] + t * sz];
}

/** Standard "ray casting" test: is the point inside the polygon? */
export function insidePolygon(x: number, z: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Penguin Lasso: catch the most penguins by skating loops around them. A tie for the most is a draw. */
export function createPenguinLasso(options: Partial<PenguinLassoConfig> = {}): GameEngine<PenguinState> {
  const cfg: PenguinLassoConfig = { ...DEFAULT_PENGUIN_CONFIG, ...options };
  const rand = (lo: number, hi: number) => lo + cfg.random() * (hi - lo);

  /** A free spot on the ice: inside the rink, away from the skaters and from the penguins already there. */
  function freeSpot(arenaRadius: number, avoid: { x: number; z: number }[]): { x: number; z: number } {
    const reach = arenaRadius - cfg.edgeMargin - 2;
    let best = { x: 0, z: 0 };
    let bestClear = -1;
    for (let tries = 0; tries < 40; tries++) {
      const angle = cfg.random() * Math.PI * 2;
      const r = Math.sqrt(cfg.random()) * reach; // sqrt = even spread over the area
      const spot = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      const clear = Math.min(Infinity, ...avoid.map((a) => dist(a, spot)));
      if (clear >= cfg.spawnClearance) return spot;
      if (clear > bestClear) { best = spot; bestClear = clear; } // crowded: keep the roomiest one tried
    }
    return best;
  }

  function newPenguin(id: number, spot: { x: number; z: number }, now: number): Penguin {
    return { id, ...spot, heading: cfg.random() * Math.PI * 2, speed: rand(cfg.penguinSpeedMin, cfg.penguinSpeedMax), walking: false, changeAt: now + rand(0, 1) * 1000 };
  }

  /** The loop made when a skater's newest trail point `q` comes back to its own older trail: returns the corners of the loop and the point it closed at, or null. */
  function findLoop(trail: TrailPoint[], q: Pt): { poly: Pt[]; at: Pt; index: number } | null {
    const n = trail.length;
    if (n < 4) return null;
    const last: Pt = [trail[n - 1].x, trail[n - 1].z];
    // Walk back from the newest end, adding up how much trail lies between each older segment and `q`.
    let around = Math.hypot(q[0] - last[0], q[1] - last[1]);
    for (let j = n - 2; j >= 0; j--) {
      const c: Pt = [trail[j].x, trail[j].z], d: Pt = [trail[j + 1].x, trail[j + 1].z];
      around += Math.hypot(d[0] - c[0], d[1] - c[1]);
      if (around < cfg.minLoopLength) continue; // that's just the trail right behind us
      let hit = segmentCross(last, q, c, d);
      if (!hit) {
        const near = nearestOnSegment(q, c, d);
        if (Math.hypot(near[0] - q[0], near[1] - q[1]) <= cfg.closeDistance) hit = near; // close enough counts
      }
      if (hit) {
        const poly: Pt[] = [hit, ...trail.slice(j + 1).map((p): Pt => [p.x, p.z]), q];
        return { poly, at: hit, index: j };
      }
    }
    return null;
  }

  /** Keep a trail within its length limit (the oldest end shrinks smoothly) and age limit. */
  function trimTrail(trail: TrailPoint[], now: number): TrailPoint[] {
    // Old points drop off, but the newest point always stays: the trail must never be empty (it ends at the skater).
    let pts = trail.filter((p, i) => i === trail.length - 1 || now - p.t <= cfg.trailMaxAgeSeconds * 1000);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
    let excess = length - cfg.trailMax;
    while (excess > 0 && pts.length >= 2) {
      const seg = dist(pts[0], pts[1]);
      if (seg <= excess) { excess -= seg; pts = pts.slice(1); } // the whole first piece is gone
      else { // part of it: slide the start along towards the next point
        const k = excess / seg;
        pts = [{ x: pts[0].x + (pts[1].x - pts[0].x) * k, z: pts[0].z + (pts[1].z - pts[0].z) * k, t: pts[0].t }, ...pts.slice(1)];
        excess = 0;
      }
    }
    return pts;
  }

  return {
    id: 'penguin-lasso',

    init(playerIds, now) {
      const arenaRadius = arenaRadiusFor(playerIds.length, cfg.arenaRadius, cfg.basePlayers);
      const spawns = spawnPoints(playerIds.length, arenaRadius);
      const skaters: Record<string, Skater> = {};
      const igloos: Record<string, { x: number; z: number }> = {};
      playerIds.forEach((id, i) => {
        const k = cfg.iglooDistance / 0.7; // spawnPoints puts players at 0.7 of the radius: the igloo is the same direction, further out
        igloos[id] = { x: spawns[i].x * k, z: spawns[i].z * k };
        skaters[id] = { x: spawns[i].x, z: spawns[i].z, vx: 0, vz: 0, steerX: 0, steerZ: 0, trail: [{ x: spawns[i].x, z: spawns[i].z, t: now }], carried: 0, banked: 0 };
      });
      // The penguin count grows with the player count, like the rink does.
      const extra = Math.max(0, playerIds.length - cfg.basePlayers);
      const count = cfg.penguins + cfg.penguinsPerExtraPlayer * extra;
      const penguins: Penguin[] = [];
      for (let i = 0; i < count; i++) penguins.push(newPenguin(i + 1, freeSpot(arenaRadius, [...spawns, ...Object.values(igloos), ...penguins]), now));
      return { startsAt: now, endsAt: now + cfg.durationMs, arenaRadius, skaters, igloos, penguins, loops: [], respawns: [], nextId: count + 1, clock: now };
    },

    reduce(state, playerId, action, now) {
      if (action.type !== 'steer') return state;
      const s = state.skaters[playerId];
      if (!s || now >= state.endsAt) return state;
      if (!Number.isFinite(action.x) || !Number.isFinite(action.z)) return state; // never trust the payload
      const length = Math.hypot(action.x, action.z);
      const scale = length > 1 ? 1 / length : 1;
      return { ...state, skaters: { ...state.skaters, [playerId]: { ...s, steerX: action.x * scale, steerZ: action.z * scale } } };
    },

    tick(state, dt, now) {
      const skaters: Record<string, Skater> = {};
      for (const [id, s] of Object.entries(state.skaters)) skaters[id] = { ...s };
      let penguins = state.penguins.map((p) => ({ ...p }));
      let loops = state.loops.filter((l) => now - l.at < cfg.loopShowSeconds * 1000);
      let { respawns, nextId } = state;

      // ----- skaters: glide, lay trail, close loops -----
      for (const [id, s] of Object.entries(skaters)) {
        const steering = Math.hypot(s.steerX, s.steerZ) > 0.01;
        const k = Math.min(1, (steering ? cfg.accelRate : cfg.frictionRate) * dt);
        s.vx += ((steering ? s.steerX * cfg.maxSpeed : 0) - s.vx) * k;
        s.vz += ((steering ? s.steerZ * cfg.maxSpeed : 0) - s.vz) * k;
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        // Wall: keep the skater on the ice and stop them sliding into it.
        const limit = state.arenaRadius - cfg.skaterRadius;
        const d = Math.hypot(s.x, s.z);
        if (d > limit) {
          const nx = s.x / d, nz = s.z / d;
          s.x = nx * limit; s.z = nz * limit;
          const outward = s.vx * nx + s.vz * nz;
          if (outward > 0) { s.vx -= outward * nx; s.vz -= outward * nz; }
        }

        // Igloos are solid: slide off them, never through.
        for (const igloo of Object.values(state.igloos)) {
          const away = Math.hypot(s.x - igloo.x, s.z - igloo.z);
          const min = cfg.iglooRadius + cfg.skaterRadius;
          if (away < min && away > 1e-6) {
            const nx = (s.x - igloo.x) / away, nz = (s.z - igloo.z) / away;
            s.x = igloo.x + nx * min; s.z = igloo.z + nz * min;
            const into = s.vx * nx + s.vz * nz;
            if (into < 0) { s.vx -= into * nx; s.vz -= into * nz; }
          }
        }
        // Home: skating near YOUR igloo cashes in everything in the bag. That is the only way penguins become points.
        const home = state.igloos[id];
        if (home && s.carried > 0 && Math.hypot(s.x - home.x, s.z - home.z) <= cfg.cashRadius) {
          s.banked += s.carried;
          s.carried = 0;
        }

        // Lay a trail point each time we've moved far enough from the last one.
        let trail = s.trail;
        const lastPt = trail[trail.length - 1];
        if (dist(lastPt, s) >= cfg.trailSpacing) {
          const q: Pt = [s.x, s.z];
          const loop = findLoop(trail, q);
          if (loop) {
            // CLOSED A LOOP: every free penguin inside it goes into the bag, and the loop is used up (its trail is removed).
            let got = 0;
            for (const p of penguins) {
              if (p.caughtBy || !insidePolygon(p.x, p.z, loop.poly)) continue;
              p.caughtBy = id; p.caughtAt = now; got++;
              respawns = [...respawns, now + cfg.respawnSeconds * 1000];
            }
            s.carried += got;
            loops = [...loops, { id: nextId++, playerId: id, points: loop.poly.map(([x, z]): Pt => [round(x), round(z)]), at: now }];
            trail = [...trail.slice(0, loop.index + 1), { x: loop.at[0], z: loop.at[1], t: now }, { x: q[0], z: q[1], t: now }];
          } else {
            trail = [...trail, { x: q[0], z: q[1], t: now }];
          }
        }
        s.trail = trimTrail(trail, now);
      }

      // ----- penguins: wander aimlessly -----
      for (const p of penguins) {
        if (p.caughtBy) continue;
        if (now >= p.changeAt) {
          if (cfg.random() < cfg.idleChance) {
            p.walking = false;
            p.changeAt = now + rand(cfg.idleSecondsMin, cfg.idleSecondsMax) * 1000;
          } else {
            p.walking = true;
            p.heading += rand(-1.4, 1.4);
            p.speed = rand(cfg.penguinSpeedMin, cfg.penguinSpeedMax);
            p.changeAt = now + rand(cfg.walkSecondsMin, cfg.walkSecondsMax) * 1000;
          }
        }
        if (p.walking) {
          p.x += Math.cos(p.heading) * p.speed * dt;
          p.z += Math.sin(p.heading) * p.speed * dt;
        }
        // Igloos are solid for penguins too.
        for (const igloo of Object.values(state.igloos)) {
          const away = Math.hypot(p.x - igloo.x, p.z - igloo.z);
          const min = cfg.iglooRadius + 0.7;
          if (away < min && away > 1e-6) { p.x = igloo.x + ((p.x - igloo.x) / away) * min; p.z = igloo.z + ((p.z - igloo.z) / away) * min; p.heading += Math.PI / 2; }
        }
        // Near the wall: turn back towards the middle.
        const d = Math.hypot(p.x, p.z);
        if (d > state.arenaRadius - cfg.edgeMargin) {
          const toCentre = Math.atan2(-p.z, -p.x);
          const diff = Math.atan2(Math.sin(toCentre - p.heading), Math.cos(toCentre - p.heading));
          p.heading += Math.max(-1, Math.min(1, diff)) * Math.min(1, 6 * dt) * 1.5;
          if (d > state.arenaRadius - 1) { p.x *= (state.arenaRadius - 1) / d; p.z *= (state.arenaRadius - 1) / d; }
        }
      }

      // ----- caught penguins leave the list after their little show; replacements arrive later -----
      penguins = penguins.filter((p) => !p.caughtBy || now - (p.caughtAt ?? 0) < cfg.caughtShowSeconds * 1000);
      const due = respawns.filter((t) => t <= now);
      if (due.length > 0) {
        respawns = respawns.filter((t) => t > now);
        const where = [...Object.values(skaters), ...Object.values(state.igloos), ...penguins.filter((p) => !p.caughtBy)];
        for (let i = 0; i < due.length; i++) {
          const fresh = newPenguin(nextId++, freeSpot(state.arenaRadius, where), now);
          penguins.push(fresh);
          where.push(fresh);
        }
      }
      return { ...state, skaters, penguins, loops, respawns, nextId, clock: now };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(state.skaters);
      // Only penguins cashed in at the igloo count: whatever is still in a bag when time runs out is worth nothing.
      const best = Math.max(0, ...entries.map(([, s]) => s.banked));
      const leaders = entries.filter(([, s]) => s.banked === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody banked one, or a tie: draw
    },

    scores: (state) => Object.fromEntries(Object.entries(state.skaters).map(([id, s]) => [id, s.banked])),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...skaters } = state.skaters;
      return { ...state, skaters };
    },

    view(state): PenguinLassoView {
      const skaters: Record<string, SkaterView> = {};
      for (const [id, s] of Object.entries(state.skaters)) {
        skaters[id] = { x: round(s.x), z: round(s.z), vx: round(s.vx), vz: round(s.vz), trail: s.trail.map((p): Pt => [round(p.x), round(p.z)]), carried: s.carried, banked: s.banked };
      }
      const penguins: PenguinView[] = state.penguins.map((p) => ({ id: p.id, x: round(p.x), z: round(p.z), heading: round(p.heading, 3), walking: p.walking, caughtBy: p.caughtBy }));
      const loops: LoopView[] = state.loops.map((l) => ({ id: l.id, playerId: l.playerId, points: l.points }));
      return { gameId: 'penguin-lasso', startsAt: state.startsAt, endsAt: state.endsAt, arenaRadius: state.arenaRadius, trailMax: cfg.trailMax, igloos: Object.fromEntries(Object.entries(state.igloos).map(([id, g]) => [id, { x: round(g.x), z: round(g.z) }])), iglooRadius: cfg.iglooRadius, cashRadius: cfg.cashRadius, skaters, penguins, loops };
    },
  };
}
