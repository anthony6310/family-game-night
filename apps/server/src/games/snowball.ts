import { SNOWBALL_SECONDS, createTerrain, type ItemKind, type SnowballBall, type Terrain, type TerrainFeature } from '@fgn/shared';
import { placeItems, type Item, type PlacementRules } from './items';
import { DEFAULT_FEATURE_SPECS, arenaRadiusFor, generateTerrainFeatures, spawnPoints, type FeatureSpec } from './terrain';
import type { GameEngine } from './types';

/**
 * A batch of pick-ups of `kind`, which appears once `at` (a fraction of the match, 0 = the start, 0.5 = half way) has passed.
 * It holds `count` items for the base number of players (SnowballConfig.basePlayers), plus `perExtraPlayer` more for every
 * additional player in the round, so a bigger room gets a bigger wave.
 */
export interface ItemWave {
  at: number;
  count: number;
  perExtraPlayer: number;
  kind: ItemKind;
}

/**
 * Every number that shapes how Snowball FEELS lives here. Tweak these while playtesting; nothing
 * else needs to change. Units: distances in "world units" (the start ball has radius 1), times in seconds.
 */
export interface SnowballConfig {
  durationMs: number;
  /**
   * Radius of the circular arena (walls included) for `basePlayers` players. The arena grows with the player
   * count: its AREA is proportional to the number of players (see arenaRadiusFor), and each extra player also adds one hill or ditch.
   */
  arenaRadius: number;
  basePlayers: number; // the minimum number of players: the base map (one big hill, one small hill, one ditch)
  startRadius: number;
  /** Growth: radius² = startRadius² + 2 · growthPerUnit · (distance rolled), then damage takes size off. Bigger = faster growth. */
  growthPerUnit: number;
  maxSpeed: number; // top speed on flat ground, in world units per second
  /** Top speed ∝ (startRadius / radius) ^ speedFalloff: bigger balls roll slower. 0 = size never slows you (current default). */
  speedFalloff: number;
  accelRate: number; // how quickly a ball's velocity catches up with the steering (per second)
  /** Acceleration ∝ 1 / radius ^ accelFalloff: bigger balls speed up more sluggishly. 0 = size has no effect (current default). */
  accelFalloff: number;
  frictionRate: number; // how quickly it coasts to a stop when not steering (per second)

  // ----- bouncing -----
  ballRestitution: number; // bounciness between balls (0 = dead stop, 1 = perfect bounce)
  /**
   * After a ball-ball collision EACH ball leaves the other at least this fast PER UNIT OF ITS OWN RADIUS.
   * Rebound distance is (speed ÷ frictionRate), so it grows with size: bounces are always "about N radii",
   * and they can't get stuck together.
   */
  ballReboundPerRadius: number;
  wallRestitution: number; // bounciness off the arena wall (kept weaker than ball-ball)
  wallReboundPerRadius: number; // minimum bounce off the wall, per unit of the ball's radius...
  wallReboundMinImpact: number; // ...but only for hits at least this hard (so steering into a wall doesn't buzz)

  // ----- damage: a flat amount of SIZE, dealt by BOTH balls -----
  /**
   * Every counted hit takes this much off the victim's size, whatever the speeds and sizes involved. A ball's size is
   * its radius × 100, the number players see on screen (a fresh ball is 100), so 5 means 5 of those points.
   */
  damage: number;
  /** The single biggest ball ("the leader") hits harder: this much instead. */
  leaderDamage: number;
  /** false = damage simply removes the victim's size. true = the attacker gains the snow the victim loses. */
  damageIsStolen: boolean;
  minImpactSpeed: number; // a touch must close in at least this fast to count as a hit
  immunityMs: number; // a ball that just took damage can't take damage again for this long
  minRadius: number; // a ball can never shrink below this
  /** A ball is "bigger" (or the leader) only if it leads by more than this share. Prevents buff flicker between near-equals. */
  sizeMargin: number;

  // ----- sprint and stamina -----
  /** Holding sprint multiplies top speed by this (1.5 = +50%) while there is stamina. */
  sprintFactor: number;
  staminaMax: number;
  staminaDrainPerSecond: number; // used up while sprinting
  staminaRegenPerSecond: number; // refilled while not sprinting...
  staminaRegenDelaySeconds: number; // ...but only after this long since the last sprint (so you can't tap-sprint forever)
  /** A sprint can only be STARTED with at least this much stamina, so it doesn't stutter on and off at empty. */
  staminaStartMin: number;

  // ----- small ball buff -----
  /**
   * When a SMALLER ball hits a bigger one, for this long its stamina refills straight away: the usual wait before refilling
   * (staminaRegenDelaySeconds) is skipped, so a small ball that has just been hit can recover and get away faster.
   */
  escapeSeconds: number;

  // ----- pick-ups (fish) -----
  /** Each fish stuck to a ball adds this much to the damage of its next hit (flat, like the base damage). */
  fishDamage: number;
  /** A ball that is SPRINTING when it hits deals this much extra damage (flat, like the base damage and the fish bonus). */
  sprintDamage: number;
  /** A ball can carry this many fish at once; at the limit it rolls over further ones without taking them. */
  fishCapacity: number;
  /** A ball collects an item when the two touch: the item counts as a disc of this radius lying on the ground. */
  itemRadius: number;
  /** A fish used up by a hit is thrown off the ball and lands this far from where the hit happened: somewhere between these two distances. */
  fishScatterMin: number;
  fishScatterMax: number;
  /** How long a thrown fish is in the air (it can't be picked up until it lands). */
  fishFlightSeconds: number;
  /** Thrown fish keep at least this far from each other and from fish already lying around. */
  fishDropSpacing: number;
  /** When pick-ups appear. The `at: 0` wave is the scatter at the start of the round; later waves drop in as the match goes on. */
  itemWaves: readonly ItemWave[];
  itemEdgeMargin: number; // a new item stays this far inside the wall...
  itemClearance: number; // ...and this far from the starting positions / balls...
  itemSpacing: number; // ...and this far from other items

  // ----- terrain: a little slower uphill, a little faster downhill -----
  /**
   * Hill and ditch size. 1 or 2 players get the base sizes in `featureSpecs`; every additional player adds this many
   * world units to EVERY feature's footprint radius (a fixed amount, not a percentage). Heights stay as they are.
   */
  featureRadiusPerPlayer: number;
  /** Optional fixed ground for tests. Normally each round gets its own random hills and ditch. */
  terrain?: Terrain;
  featureSpecs: readonly FeatureSpec[];
  /** The randomness behind the layout (Math.random by default; tests pass a seeded one). */
  random: () => number;
  /**
   * How much a slope changes top speed, at its most: going straight up a steep slope you are this much slower (0.15 = 15%), going straight
   * down you are this much faster. Gentler slopes change it proportionally less. It is instant: no building up, no wearing off.
   */
  hillSpeedEffect: number;
  slopeFullEffect: number; // a slope this steep (rise/run) gives the full effect; gentler slopes ramp proportionally slower
  slopeDeadzone: number; // slopes gentler than this count as flat
  slopeMinSpeed: number; // slower than this the ball is judged by the way it is steering instead of the way it is moving
}

export const DEFAULT_SNOWBALL_CONFIG: SnowballConfig = {
  durationMs: SNOWBALL_SECONDS * 1000,
  arenaRadius: 51.75, // (was 45: the map is 15% bigger at every player count, since the other sizes are worked out from this one)
  basePlayers: 2,
  startRadius: 1,
  growthPerUnit: 0.02,
  maxSpeed: 11,
  speedFalloff: 0,
  accelRate: 3,
  accelFalloff: 0,
  frictionRate: 1.5,

  ballRestitution: 1,
  ballReboundPerRadius: 4.5,
  wallRestitution: 0.3,
  wallReboundPerRadius: 0.8,
  wallReboundMinImpact: 1.5,

  damage: 5, // a flat 5 points of size per hit...
  leaderDamage: 10, // ...and 10 when the single biggest ball is the one hitting
  damageIsStolen: false,
  minImpactSpeed: 1,
  immunityMs: 200,
  minRadius: 0.5,
  sizeMargin: 0.02,

  sprintFactor: 1.5,
  staminaMax: 100,
  staminaDrainPerSecond: 40, // a full bar is 2.5 s of sprint
  staminaRegenPerSecond: 15, // and about 6.7 s to refill from empty
  staminaRegenDelaySeconds: 1,
  staminaStartMin: 20,
  escapeSeconds: 2,

  fishDamage: 5, // +5 damage per fish, used up on the hit
  sprintDamage: 5, // +5 for hitting while sprinting
  fishCapacity: 6,
  itemRadius: 0.9,
  fishScatterMin: 18, // fish used on a hit land well away from it, so whoever just lost theirs can't scoop them straight back up
  fishScatterMax: 36,
  fishFlightSeconds: 0.9,
  fishDropSpacing: 4,
  itemWaves: [
    // 3 fish scattered around the arena at the start, and 3 more half way through, for 2 players; every additional player adds 1 fish to each wave.
    { at: 0, count: 3, perExtraPlayer: 1, kind: 'fish' },
    { at: 0.5, count: 3, perExtraPlayer: 1, kind: 'fish' },
  ],
  itemEdgeMargin: 5,
  itemClearance: 8,
  itemSpacing: 10,

  terrain: undefined,
  featureSpecs: DEFAULT_FEATURE_SPECS,
  featureRadiusPerPlayer: 2,
  random: Math.random,
  hillSpeedEffect: 0.15,
  slopeFullEffect: 0.12,
  slopeDeadzone: 0.02,
  slopeMinSpeed: 0.5,
};

/**
 * "Snow" is stored as area (radius²) because growth is linear in it: each unit rolled adds a fixed
 * amount of snow, and damage is plain subtraction.
 */
interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
  snow: number; // = radius²; also used as the ball's mass in collisions
  lastHit: number; // size points the most recent hit took off this ball (for the impact effect; 0 = never hit)
  hillFactor: number; // the slope's effect on top speed right now (a little under 1 uphill, a little over downhill), refreshed every tick
  stamina: number; // 0..staminaMax
  sprintWanted: boolean; // the player is holding the sprint button
  sprinting: boolean; // actually sprinting: wanted, steering, and with stamina to spend
  lastSprintAt: number; // server clock (ms) of the last tick spent sprinting (the refill waits staminaRegenDelaySeconds after this)
  escapeUntil: number; // server clock (ms) when the small-ball instant-refill window ends
  escape: boolean; // mirrors `now < escapeUntil`, refreshed every tick
  leader: boolean; // the single biggest ball (refreshed every tick)
  steerX: number; // the player's latest steering input (length <= 1)
  steerZ: number;
  immuneUntil: number; // server clock (ms)
  immune: boolean; // mirrors `now < immuneUntil`, refreshed every tick (what phones draw)
  fish: number; // fish stuck to the ball (0..fishCapacity): +fishDamage each on the next hit that lands, then all are used up
}

export interface SnowballState {
  startsAt: number;
  endsAt: number;
  /** This round's arena radius: it depends on how many players are in the round. Chosen once in init(). */
  arenaRadius: number;
  /** This round's hills and ditches. Chosen once in init() and never changed. */
  features: TerrainFeature[];
  terrain: Terrain; // `features` turned into height/slope functions
  /** Pick-ups lying in the arena. A collected one is removed; new ones arrive with each wave of `itemWaves`. */
  items: Item[];
  nextItemId: number; // the id the next new item gets
  clock: number; // the server time of the latest tick: how the view works out how long a thrown fish has left in the air
  wavesDone: number; // how many entries of `itemWaves` have already been dropped
  extraPlayers: number; // players beyond basePlayers when the round began: every wave gets this many extra items (per ItemWave.perExtraPlayer)
  balls: Record<string, Ball>;
}

/** Fish a hit used up: where the ball was and how many, so they can be thrown back out as pick-ups. */
interface FishUsed {
  x: number;
  z: number;
  count: number;
}

const radiusOf = (b: Ball) => Math.sqrt(b.snow);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createSnowball(overrides: Partial<SnowballConfig> = {}): GameEngine<SnowballState> {
  const cfg: SnowballConfig = { ...DEFAULT_SNOWBALL_CONFIG, ...overrides };
  const maxSpeedFor = (radius: number) => cfg.maxSpeed * (cfg.startRadius / radius) ** cfg.speedFalloff;

  const waves = [...cfg.itemWaves].sort((p, q) => p.at - q.at); // in the order they happen

  const placementRules = (arenaRadius: number): PlacementRules => ({
    arenaRadius, edgeMargin: cfg.itemEdgeMargin, clearance: cfg.itemClearance, spacing: cfg.itemSpacing,
  });

  /** Drops every wave whose time has come (at the start of a round, those with `at: 0`). Returns the new item list. */
  function dropDueWaves(
    state: Pick<SnowballState, 'items' | 'nextItemId' | 'wavesDone' | 'extraPlayers'>, arenaRadius: number, fraction: number, avoid: { x: number; z: number }[],
  ) {
    let { items, nextItemId, wavesDone } = state;
    while (wavesDone < waves.length && fraction >= waves[wavesDone].at) {
      const wave = waves[wavesDone++];
      const count = wave.count + wave.perExtraPlayer * state.extraPlayers; // a bigger room gets a bigger wave
      const fresh = placeItems(cfg.random, wave.kind, count, nextItemId, placementRules(arenaRadius), avoid, items);
      items = [...items, ...fresh];
      nextItemId += fresh.length;
    }
    return { items, nextItemId, wavesDone };
  }

  /**
   * Throws the fish a hit used up back out into the arena: each lands between fishScatterMin and fishScatterMax from the
   * hit, inside the playable area (not too close to the wall) and clear of other fish. They are in the air for
   * fishFlightSeconds and can't be collected until they land. Returns the new items.
   */
  function scatterFish(used: FishUsed, arenaRadius: number, existing: Item[], firstId: number, now: number): Item[] {
    const limit = arenaRadius - cfg.itemEdgeMargin;
    const placed: Item[] = [];
    for (let n = 0; n < used.count; n++) {
      let spot: { x: number; z: number } | null = null;
      for (let attempt = 0; attempt < 60 && !spot; attempt++) {
        const angle = cfg.random() * Math.PI * 2;
        const distance = cfg.fishScatterMin + cfg.random() * (cfg.fishScatterMax - cfg.fishScatterMin);
        const x = used.x + Math.cos(angle) * distance;
        const z = used.z + Math.sin(angle) * distance;
        if (Math.hypot(x, z) > limit) continue; // off the playable area
        if ([...existing, ...placed].some((p) => Math.hypot(p.x - x, p.z - z) < cfg.fishDropSpacing)) continue;
        spot = { x, z };
      }
      if (!spot) {
        // Cramped (practically never): throw it towards the middle of the arena, as far as the minimum allows, kept inside the limit.
        const toMiddle = Math.hypot(used.x, used.z) > 1e-6 ? { x: -used.x, z: -used.z } : { x: 1, z: 0 };
        const length = Math.hypot(toMiddle.x, toMiddle.z);
        let x = used.x + (toMiddle.x / length) * cfg.fishScatterMin;
        let z = used.z + (toMiddle.z / length) * cfg.fishScatterMin;
        const reach = Math.hypot(x, z);
        if (reach > limit) { x *= limit / reach; z *= limit / reach; }
        spot = { x, z };
      }
      const flightMs = cfg.fishFlightSeconds * 1000;
      placed.push({ id: firstId + n, kind: 'fish', x: spot.x, z: spot.z, thrown: { fromX: used.x, fromZ: used.z, landsAt: now + flightMs, flightMs } });
    }
    return placed;
  }

  /** The ground's effect and sprint together: the multiplier on top speed (1 = normal). */
  const speedFactorOf = (b: Ball) => b.hillFactor * (b.sprinting ? cfg.sprintFactor : 1);

  /**
   * Looks at the slope the ball is heading up or down (the way it is moving, or the way it is steering if it is nearly still) and
   * sets its hill factor: a little slower uphill, a little faster downhill, in proportion to how steep it is. Instant.
   */
  function updateHill(b: Ball, terrain: Terrain) {
    const speed = Math.hypot(b.vx, b.vz);
    let dx = b.vx, dz = b.vz, length = speed;
    if (speed <= cfg.slopeMinSpeed) { dx = b.steerX; dz = b.steerZ; length = Math.hypot(dx, dz); }
    if (length < 1e-6) { b.hillFactor = 1; return; }
    const g = terrain.gradient(b.x, b.z);
    const along = (g.x * dx + g.z * dz) / length; // rise per unit run in the direction of travel (+ = uphill)
    if (Math.abs(along) <= cfg.slopeDeadzone) { b.hillFactor = 1; return; }
    b.hillFactor = 1 - cfg.hillSpeedEffect * clamp(along / cfg.slopeFullEffect, -1, 1);
  }

  /**
   * Sprint and stamina for one tick. Sprinting needs the button held, the ball steering, and stamina: a sprint can only START with at least
   * staminaStartMin, and ends when the button is let go or the stamina runs out. It uses stamina up; when not sprinting, stamina refills,
   * but only after staminaRegenDelaySeconds since the last sprint, EXCEPT for a small ball in its escape window (it hit a bigger ball a
   * moment ago): that refills straight away.
   */
  function updateStamina(b: Ball, steering: boolean, dt: number, now: number) {
    const wants = b.sprintWanted && steering;
    if (b.sprinting) { if (!wants || b.stamina <= 0) b.sprinting = false; }
    else if (wants && b.stamina >= cfg.staminaStartMin) b.sprinting = true;
    if (b.sprinting) {
      b.stamina = Math.max(0, b.stamina - cfg.staminaDrainPerSecond * dt);
      b.lastSprintAt = now;
      if (b.stamina <= 0) b.sprinting = false;
    } else if (b.escape || now - b.lastSprintAt >= cfg.staminaRegenDelaySeconds * 1000) {
      b.stamina = Math.min(cfg.staminaMax, b.stamina + cfg.staminaRegenPerSecond * dt);
    }
  }

  /** Resolves one overlapping pair: push apart, rebound, then damage both and give the smaller ball its escape boost. */
  function collide(a: Ball, b: Ball, now: number, used: FishUsed[]) {
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

    // 2) Rebound: an impulse along the normal. `closing` is how fast they were approaching.
    const closing = -((b.vx - a.vx) * nx + (b.vz - a.vz) * nz);
    if (closing > 0) {
      const j = ((1 + cfg.ballRestitution) * closing) / (1 / a.snow + 1 / b.snow);
      a.vx -= (nx * j) / a.snow;
      a.vz -= (nz * j) / a.snow;
      b.vx += (nx * j) / b.snow;
      b.vz += (nz * j) / b.snow;
    }

    // 3) Never stay stuck, and bounce relative to size: each ball must leave at least
    //    ballReboundPerRadius × its OWN radius, so a big ball is thrown back farther than a small one.
    const awayA = -(a.vx * nx + a.vz * nz);
    const wantA = cfg.ballReboundPerRadius * ra;
    if (awayA < wantA) {
      a.vx -= nx * (wantA - awayA);
      a.vz -= nz * (wantA - awayA);
    }
    const awayB = b.vx * nx + b.vz * nz;
    const wantB = cfg.ballReboundPerRadius * rb;
    if (awayB < wantB) {
      b.vx += nx * (wantB - awayB);
      b.vz += nz * (wantB - awayB);
    }

    // 4) Damage. BOTH balls deal it, and it is FLAT: a fixed number of size points off the victim, whatever the
    //    speeds and sizes (only the leader hits harder). A ball that is still immune from an earlier hit is spared.
    if (closing < cfg.minImpactSpeed) return;
    // The base hit (the leader's is bigger) plus a flat bonus for every fish the dealer carries, plus a flat bonus if the dealer is sprinting.
    const dealt = (dealer: Ball) => (dealer.leader ? cfg.leaderDamage : cfg.damage) + dealer.fish * cfg.fishDamage + (dealer.sprinting ? cfg.sprintDamage : 0);
    const canBeHurt = (v: Ball) => now >= v.immuneUntil;
    // Damage shrinks the RADIUS (size points / 100) but never below the minimum; this is how much snow that removes.
    const snowLost = (victim: Ball, points: number) => {
      const smaller = Math.max(cfg.minRadius, radiusOf(victim) - points / 100);
      return Math.max(0, victim.snow - smaller * smaller);
    };
    const hitOnA = dealt(b), hitOnB = dealt(a); // worked out now, while any fish are still on the balls (they are used up below)
    const lossA = canBeHurt(a) ? snowLost(a, hitOnA) : 0; // b hurts a
    const lossB = canBeHurt(b) ? snowLost(b, hitOnB) : 0; // a hurts b

    // A fish is used up by the hit it adds to, but only if that hit actually lands (a victim who is still immune is spared,
    // and then the fish stays on). The damage above has already counted them, so it is safe to remove them now.
    // The used fish don't just vanish: they are thrown off the ball and come back as pick-ups (see scatterFish).
    if (canBeHurt(a) && b.fish > 0) { used.push({ x: b.x, z: b.z, count: b.fish }); b.fish = 0; } // b's hit on a landed
    if (canBeHurt(b) && a.fish > 0) { used.push({ x: a.x, z: a.z, count: a.fish }); a.fish = 0; } // a's hit on b landed

    // 5) The small ball buff: the SMALLER ball of a fresh hit gets the escape boost to get away.
    const aIsSmaller = a.snow < b.snow * (1 - cfg.sizeMargin);
    const bIsSmaller = b.snow < a.snow * (1 - cfg.sizeMargin);
    const escapeUntil = now + cfg.escapeSeconds * 1000;
    if (aIsSmaller && canBeHurt(a)) { a.escapeUntil = escapeUntil; a.escape = true; }
    if (bIsSmaller && canBeHurt(b)) { b.escapeUntil = escapeUntil; b.escape = true; }

    if (canBeHurt(a)) { a.snow -= lossA; a.immuneUntil = now + cfg.immunityMs; a.immune = true; a.lastHit = hitOnA; }
    if (canBeHurt(b)) { b.snow -= lossB; b.immuneUntil = now + cfg.immunityMs; b.immune = true; b.lastHit = hitOnB; }
    if (cfg.damageIsStolen) { b.snow += lossA; a.snow += lossB; } // optional: the attacker keeps what the victim lost
  }

  return {
    id: 'snowball',

    init(playerIds, now) {
      // The map is sized for the number of players, with a fresh random layout every round: the base hill, small hill
      // and ditch plus one extra random feature per additional player. All of it is fixed from here on.
      const arenaRadius = arenaRadiusFor(playerIds.length, cfg.arenaRadius, cfg.basePlayers);
      const spawns = spawnPoints(playerIds.length, arenaRadius);
      const extraPlayers = Math.max(0, playerIds.length - cfg.basePlayers);
      const features = cfg.terrain
        ? []
        : generateTerrainFeatures(cfg.random, {
            arenaRadius, spawns, specs: cfg.featureSpecs, extraFeatures: extraPlayers,
            radiusBonus: cfg.featureRadiusPerPlayer * extraPlayers, // wider hills and ditches as the player count grows
          });
      const terrain = cfg.terrain ?? createTerrain(features);

      const balls: Record<string, Ball> = {};
      playerIds.forEach((id, i) => {
        balls[id] = {
          x: spawns[i].x,
          z: spawns[i].z,
          vx: 0, vz: 0,
          snow: cfg.startRadius ** 2,
          lastHit: 0, hillFactor: 1, stamina: cfg.staminaMax, sprintWanted: false, sprinting: false, lastSprintAt: -1e15,
          escapeUntil: 0, escape: false, leader: false,
          steerX: 0, steerZ: 0,
          immuneUntil: 0, immune: false,
          fish: 0,
        };
      });
      // The first wave(s) (those due at the very start) are scattered around the arena, away from where players begin.
      const { items, nextItemId, wavesDone } = dropDueWaves({ items: [], nextItemId: 1, wavesDone: 0, extraPlayers }, arenaRadius, 0, spawns);
      return { startsAt: now, endsAt: now + cfg.durationMs, arenaRadius, features, terrain, items, nextItemId, clock: now, wavesDone, extraPlayers, balls };
    },

    reduce(state, playerId, action, now) {
      const ball = state.balls[playerId];
      if (!ball || now >= state.endsAt) return state; // not in this round, or too late
      if (action.type === 'sprint') return { ...state, balls: { ...state.balls, [playerId]: { ...ball, sprintWanted: action.on === true } } }; // hold to sprint
      if (action.type !== 'steer') return state;
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

      // Who is the leader right now? The single biggest ball, if it clearly leads the second biggest.
      const bySize = [...list].sort((p, q) => q.snow - p.snow);
      const leader = bySize.length >= 2 && bySize[0].snow > bySize[1].snow * (1 + cfg.sizeMargin) ? bySize[0] : null;
      for (const b of list) {
        b.leader = b === leader;
        b.escape = now < b.escapeUntil;
      }

      for (const b of list) {
        // The ground first (a little slower uphill, faster downhill), then sprint and stamina.
        updateHill(b, state.terrain);
        const steering = Math.hypot(b.steerX, b.steerZ) > 0.01;
        updateStamina(b, steering, dt, now);

        // Velocity eases toward "steering direction × top speed" (or toward 0 when not steering).
        const radius = radiusOf(b);
        const targetSpeed = steering ? maxSpeedFor(radius) * speedFactorOf(b) : 0;
        const targetVx = steering ? b.steerX * targetSpeed : 0;
        const targetVz = steering ? b.steerZ * targetSpeed : 0;
        const rate = steering ? cfg.accelRate / radius ** cfg.accelFalloff : cfg.frictionRate; // (accelFalloff 0: size doesn't matter)
        const k = Math.min(1, rate * dt);
        b.vx += (targetVx - b.vx) * k;
        b.vz += (targetVz - b.vz) * k;

        // Move, and grow from the distance rolled.
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.snow += 2 * cfg.growthPerUnit * Math.hypot(b.vx, b.vz) * dt;
      }

      // Two passes so a ball squeezed between neighbours settles properly.
      const used: FishUsed[] = []; // fish used up by hits this tick (they come back as thrown pick-ups, below)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) collide(list[i], list[j], now, used);
      }

      for (const b of list) {
        // Solid wall: keep the whole ball inside, and bounce off it (gently, compared with ball-ball bounces).
        const radius = radiusOf(b);
        const limit = state.arenaRadius - radius;
        const dist = Math.hypot(b.x, b.z);
        if (dist > limit && dist > 1e-6) {
          const nx = b.x / dist;
          const nz = b.z / dist;
          b.x = nx * limit;
          b.z = nz * limit;
          const outward = b.vx * nx + b.vz * nz;
          if (outward > 0) {
            // Bounce back at a fraction of the impact speed; a hard hit also gets a small minimum
            // bounce that scales with the ball's size. Gentle touches use the fraction only.
            let inward = cfg.wallRestitution * outward;
            if (outward >= cfg.wallReboundMinImpact) inward = Math.max(inward, cfg.wallReboundPerRadius * radius);
            b.vx -= (outward + inward) * nx;
            b.vz -= (outward + inward) * nz;
          }
        }
        b.immune = now < b.immuneUntil;
        b.escape = now < b.escapeUntil;
      }

      // Pick-ups. First, waves whose time has come drop new items (e.g. 3 more fish half way through)...
      const fraction = (now - state.startsAt) / (state.endsAt - state.startsAt);
      let { items, nextItemId, wavesDone } = dropDueWaves(state, state.arenaRadius, fraction, list.map((b) => ({ x: b.x, z: b.z })));
      // Fish a hit just used are thrown back out into the arena (landing further away, and not collectable until they land).
      for (const drop of used) {
        const thrown = scatterFish(drop, state.arenaRadius, items, nextItemId, now);
        items = [...items, ...thrown];
        nextItemId += thrown.length;
      }
      // ...then every item a ball is touching is collected by it, unless that ball is already carrying as many as it can.
      // (If two balls reach one at once, the closer one gets it.)
      if (items.length > 0) {
        const left: Item[] = [];
        for (const item of items) {
          let taker: Ball | null = null;
          let nearest = Infinity;
          if (item.thrown && now < item.thrown.landsAt) { left.push(item); continue; } // still in the air: nobody can take it yet
          for (const b of list) {
            if (b.fish >= cfg.fishCapacity || item.kind !== 'fish') continue;
            const distance = Math.hypot(b.x - item.x, b.z - item.z);
            if (distance < radiusOf(b) + cfg.itemRadius && distance < nearest) { taker = b; nearest = distance; }
          }
          if (taker) taker.fish++;
          else left.push(item);
        }
        items = left;
      }
      return { ...state, balls, items, nextItemId, wavesDone, clock: now };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      // Compare the same rounded sizes players see on screen, so a "tie" is a visible tie.
      const sizes = Object.entries(state.balls).map(([id, b]) => [id, Math.round(radiusOf(b) * 100)] as const);
      const best = Math.max(0, ...sizes.map(([, s]) => s));
      const leaders = sizes.filter(([, s]) => s === best);
      return leaders.length === 1 ? leaders[0][0] : null; // an exact tie is a draw
    },

    // Round score = size: the ball's radius × 100, so the start ball scores 100.
    scores: (state) => Object.fromEntries(Object.entries(state.balls).map(([id, b]) => [id, Math.round(radiusOf(b) * 100)])),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...balls } = state.balls;
      return { ...state, balls };
    },

    view(state) {
      const balls: Record<string, SnowballBall> = {};
      for (const [id, b] of Object.entries(state.balls)) {
        // Rounded: smaller messages, and nobody needs more precision than this.
        balls[id] = {
          x: round(b.x), z: round(b.z), vx: round(b.vx), vz: round(b.vz), radius: round(radiusOf(b), 3), immune: b.immune,
          speedFactor: round(speedFactorOf(b), 3), hitDamage: b.lastHit, hillFactor: round(b.hillFactor, 3), stamina: round(b.stamina / cfg.staminaMax, 3), sprinting: b.sprinting,
          escape: b.escape, leader: b.leader, fish: b.fish,
        };
      }
      return {
        gameId: 'snowball', startsAt: state.startsAt, endsAt: state.endsAt, arenaRadius: state.arenaRadius,
        speedRange: { base: cfg.maxSpeed, max: cfg.maxSpeed * (1 + cfg.hillSpeedEffect) * cfg.sprintFactor }, // (fastest: straight downhill AND sprinting)
        staminaStart: cfg.staminaStartMin / cfg.staminaMax,
        terrain: state.features,
        items: state.items.map((item) => ({
          id: item.id, kind: item.kind, x: round(item.x), z: round(item.z),
          // while a thrown fish is still in the air, tell phones where it came from and how long it has left
          thrown: item.thrown && state.clock < item.thrown.landsAt
            ? { fromX: round(item.thrown.fromX), fromZ: round(item.thrown.fromZ), secondsLeft: round((item.thrown.landsAt - state.clock) / 1000, 3), totalSeconds: item.thrown.flightMs / 1000 }
            : undefined,
        })),
        balls,
      };
    },
  };
}
