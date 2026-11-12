import { SNOWBALL_SECONDS, type SnowballBall } from '@fgn/shared';
import type { GameEngine } from './types';

/**
 * Every number that shapes how Snowball FEELS lives here. Tweak these while playtesting; nothing
 * else needs to change. Units: distances in "world units" (the start ball has radius 1), times in seconds.
 */
export interface SnowballConfig {
  durationMs: number;
  arenaRadius: number; // the circular arena, walls included
  startRadius: number;
  /** Growth: radius² = startRadius² + 2 · growthPerUnit · (distance rolled). Bigger = faster growth. */
  growthPerUnit: number;
  maxSpeed: number; // top speed of a starting-size ball
  /** Top speed ∝ (startRadius / radius) ^ speedFalloff: bigger balls roll slower. 0 = no slowdown. */
  speedFalloff: number;
  accelRate: number; // how quickly a ball's velocity catches up with the steering (per second)
  frictionRate: number; // how quickly it coasts to a stop when not steering (per second)
  ballRestitution: number; // bounciness between balls (0 = dead stop, 1 = perfect bounce)
  wallRestitution: number; // bounciness off the arena wall
  /** After a ball-ball collision they leave each other at least this fast, so they can't get stuck. */
  minSeparateSpeed: number;
  /** Share of the smaller ball's snow stolen by the bigger ball per hit. */
  damageFraction: number;
  minImpactSpeed: number; // slower touches bounce but don't steal snow
  immunityMs: number; // a ball that was just hit can't be hit again for this long
  minRadius: number; // a ball can never shrink below this
  /** Balls this close in size (relative) are "equal": they bounce but nobody steals. */
  sizeTieEpsilon: number;
}

export const DEFAULT_SNOWBALL_CONFIG: SnowballConfig = {
  durationMs: SNOWBALL_SECONDS * 1000,
  arenaRadius: 30,
  startRadius: 1,
  growthPerUnit: 0.02,
  maxSpeed: 6,
  speedFalloff: 0.5,
  accelRate: 3,
  frictionRate: 1.5,
  ballRestitution: 0.8,
  wallRestitution: 0.6,
  minSeparateSpeed: 4.5,
  damageFraction: 0.05,
  minImpactSpeed: 1,
  immunityMs: 200,
  minRadius: 0.5,
  sizeTieEpsilon: 0.02,
};

/**
 * "Snow" is stored as area (radius²) because growth is linear in it: each unit rolled adds a fixed
 * amount of snow. Stealing snow is then plain subtraction/addition, so the total is always conserved.
 */
interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
  snow: number; // = radius²; also used as the ball's mass in collisions
  steerX: number; // the player's latest steering input (length <= 1)
  steerZ: number;
  immuneUntil: number; // server clock (ms)
  immune: boolean; // mirrors `now < immuneUntil`, refreshed every tick (what phones draw)
}

export interface SnowballState {
  startsAt: number;
  endsAt: number;
  balls: Record<string, Ball>;
}

const radiusOf = (b: Ball) => Math.sqrt(b.snow);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function createSnowball(overrides: Partial<SnowballConfig> = {}): GameEngine<SnowballState> {
  const cfg: SnowballConfig = { ...DEFAULT_SNOWBALL_CONFIG, ...overrides };
  const maxSpeedFor = (radius: number) => cfg.maxSpeed * (cfg.startRadius / radius) ** cfg.speedFalloff;

  /** Resolves one overlapping pair: push apart, rebound, and (maybe) steal snow. Mutates both balls. */
  function collide(a: Ball, b: Ball, now: number) {
    const ra = radiusOf(a);
    const rb = radiusOf(b);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const minDist = ra + rb;
    if (dist >= minDist) return;

    // Collision normal, pointing from a to b. Perfectly stacked balls get an arbitrary one.
    const nx = dist > 1e-6 ? dx / dist : 1;
    const nz = dist > 1e-6 ? dz / dist : 0;
    const total = a.snow + b.snow;

    // 1) Un-overlap: the lighter ball is moved more than the heavier one.
    const overlap = minDist - dist;
    a.x -= nx * overlap * (b.snow / total);
    a.z -= nz * overlap * (b.snow / total);
    b.x += nx * overlap * (a.snow / total);
    b.z += nz * overlap * (a.snow / total);

    // 2) Rebound: an impulse along the normal (relative velocity < 0 means they are closing in).
    const closing = -((b.vx - a.vx) * nx + (b.vz - a.vz) * nz);
    if (closing > 0) {
      const j = ((1 + cfg.ballRestitution) * closing) / (1 / a.snow + 1 / b.snow);
      a.vx -= (nx * j) / a.snow;
      a.vz -= (nz * j) / a.snow;
      b.vx += (nx * j) / b.snow;
      b.vz += (nz * j) / b.snow;
    }

    // 3) Never stay stuck: guarantee they leave each other at least `minSeparateSpeed`.
    const leaving = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (leaving < cfg.minSeparateSpeed) {
      const kick = cfg.minSeparateSpeed - leaving;
      a.vx -= nx * kick * (b.snow / total);
      a.vz -= nz * kick * (b.snow / total);
      b.vx += nx * kick * (a.snow / total);
      b.vz += nz * kick * (a.snow / total);
    }

    // 4) Damage: a hard enough hit lets the BIGGER ball steal snow from the smaller one,
    //    unless they're equal in size or the victim was just hit (immunity).
    if (closing < cfg.minImpactSpeed) return;
    const [bigger, smaller] = a.snow >= b.snow ? [a, b] : [b, a];
    if (bigger.snow - smaller.snow <= cfg.sizeTieEpsilon * bigger.snow) return;
    if (now < smaller.immuneUntil) return;
    const stolen = Math.min(cfg.damageFraction * smaller.snow, smaller.snow - cfg.minRadius ** 2);
    if (stolen <= 0) return;
    smaller.snow -= stolen;
    bigger.snow += stolen;
    smaller.immuneUntil = now + cfg.immunityMs;
    smaller.immune = true;
  }

  return {
    id: 'snowball',

    init(playerIds, now) {
      // Spread everyone evenly around a ring inside the arena.
      const balls: Record<string, Ball> = {};
      playerIds.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / playerIds.length;
        balls[id] = {
          x: Math.cos(angle) * cfg.arenaRadius * 0.7,
          z: Math.sin(angle) * cfg.arenaRadius * 0.7,
          vx: 0, vz: 0,
          snow: cfg.startRadius ** 2,
          steerX: 0, steerZ: 0,
          immuneUntil: 0, immune: false,
        };
      });
      return { startsAt: now, endsAt: now + cfg.durationMs, balls };
    },

    reduce(state, playerId, action, now) {
      if (action.type !== 'steer') return state;
      const ball = state.balls[playerId];
      if (!ball || now >= state.endsAt) return state; // not in this round, or too late
      // Never trust the payload: ignore non-numbers and clamp the length to 1.
      if (!Number.isFinite(action.x) || !Number.isFinite(action.z)) return state;
      const length = Math.hypot(action.x, action.z);
      const scale = length > 1 ? 1 / length : 1;
      return { ...state, balls: { ...state.balls, [playerId]: { ...ball, steerX: action.x * scale, steerZ: action.z * scale } } };
    },

    tick(state, dt, now) {
      // Work on copies so the previous state is never mutated.
      const balls: Record<string, Ball> = {};
      for (const [id, b] of Object.entries(state.balls)) balls[id] = { ...b };
      const list = Object.values(balls);

      for (const b of list) {
        // Velocity eases toward "steering direction × top speed" (or toward 0 when not steering).
        const radius = radiusOf(b);
        const steering = Math.hypot(b.steerX, b.steerZ) > 0.01;
        const targetSpeed = steering ? maxSpeedFor(radius) : 0;
        const targetVx = steering ? b.steerX * targetSpeed : 0;
        const targetVz = steering ? b.steerZ * targetSpeed : 0;
        const rate = steering ? cfg.accelRate / Math.sqrt(radius) : cfg.frictionRate; // big balls pick up speed slower
        const k = Math.min(1, rate * dt);
        b.vx += (targetVx - b.vx) * k;
        b.vz += (targetVz - b.vz) * k;

        // Move, and grow from the distance rolled.
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.snow += 2 * cfg.growthPerUnit * Math.hypot(b.vx, b.vz) * dt;
      }

      // Two passes so a ball squeezed between neighbours settles properly.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) collide(list[i], list[j], now);
      }

      for (const b of list) {
        // Solid wall: keep the whole ball inside, and rebound off it.
        const limit = cfg.arenaRadius - radiusOf(b);
        const dist = Math.hypot(b.x, b.z);
        if (dist > limit && dist > 1e-6) {
          const nx = b.x / dist;
          const nz = b.z / dist;
          b.x = nx * limit;
          b.z = nz * limit;
          const outward = b.vx * nx + b.vz * nz;
          if (outward > 0) {
            b.vx -= (1 + cfg.wallRestitution) * outward * nx;
            b.vz -= (1 + cfg.wallRestitution) * outward * nz;
          }
        }
        b.immune = now < b.immuneUntil;
      }
      return { ...state, balls };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      // Compare the same rounded sizes players see on screen, so a "tie" is a visible tie.
      const sizes = Object.entries(state.balls).map(([id, b]) => [id, Math.round(radiusOf(b) * 100)] as const);
      const best = Math.max(0, ...sizes.map(([, s]) => s));
      const leaders = sizes.filter(([, s]) => s === best);
      return leaders.length === 1 ? leaders[0][0] : null; // an exact tie is a draw
    },

    // Round score = diameter-ish size in cm: the start ball (radius 1) scores 100.
    scores: (state) => Object.fromEntries(Object.entries(state.balls).map(([id, b]) => [id, Math.round(radiusOf(b) * 100)])),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...balls } = state.balls;
      return { ...state, balls };
    },

    view(state) {
      const balls: Record<string, SnowballBall> = {};
      for (const [id, b] of Object.entries(state.balls)) {
        // Rounded: smaller messages, and nobody needs more precision than this.
        balls[id] = { x: round(b.x), z: round(b.z), vx: round(b.vx), vz: round(b.vz), radius: round(radiusOf(b), 3), immune: b.immune };
      }
      return { gameId: 'snowball', startsAt: state.startsAt, endsAt: state.endsAt, arenaRadius: cfg.arenaRadius, balls };
    },
  };
}
