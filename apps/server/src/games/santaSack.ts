import { SANTA_SECONDS, bagFrame, lobPlan, inScoringZone, outerZoneNormal, type SantaBagView, type SantaFlyingView, type SantaKickedView, type SantaLandedView, type SantaSackView } from '@fgn/shared';
import type { GameEngine } from './types';

/**
 * SANTA'S SACK. Santa's elves (the players) stand in a circle round the bags, in a snowy forest clearing, and throw gifts at big bags that float round a circular
 * route in the middle. The player who has put the MOST GIFTS into a bag controls it (a tie, or an empty bag, leaves it neutral), and the bag takes that player's color. Every bag is
 * worth the same: the player who controls the MOST BAGS when the round ends wins. There are always 9 bags and they stay on their route. They are all open for the first quarter of the
 * round; then for a quarter a random 3 to 6 of them are cinched shut (nothing can go in a shut bag and gifts bounce off it); then those open and the others shut for a quarter; and for
 * the last quarter all of them are open again. Each bag strobes for the 3 seconds before it shuts.
 *
 * Everything is decided here: where each bag is (a function of the clock, so it is exact and predictable), which bags are shut, where a throw goes, whether it goes in, bounces or lands.
 * Every elf has an endless pile of gifts and may throw them as fast as they like (a human can't throw faster than every 0.12 seconds).
 * A bag holds at most 5 gifts (the phones see them as a heap in the bag's mouth, each in its thrower's color). When a 6th goes in, a random gift of ANOTHER color (never the thrower's) is kicked out
 * to make room: it just tumbles out and falls (it takes no part in the physics).
 */
export interface SantaConfig {
  durationMs: number;
  minThrowGapMs: number; // gifts can't be thrown closer together than this (it only blunts auto-clickers; a human can't throw this fast)
  stationRadius: number; // the elves stand on a circle this far from the middle of the room (the same for everyone: fair)
  startAngleDeg: number; // the first elf stands at this angle round the circle (degrees; x east, z south: 180 is due west, the left); the others follow clockwise, evenly spaced
  orbitRadius: number; // the bags' route: a circle round the middle of the room
  orbitSpeedUnits: number; // how fast a bag travels along it (units per second); it never stops
  bagRadiusMin: number; // every bag's mouth radius is a random size between these (the bags are all close in size, with a little variance)
  bagRadiusMax: number;
  bagCount: number; // there are always this many bags (whatever the number of players)
  phaseMs: number; // the round is four equal phases: all open, one set closed, the other set closed, all open
  closedMin: number; // in the first closed phase, a random number of bags from min to max are closed (the rest of them are closed in the second closed phase)
  closedMax: number;
  warnMs: number; // a bag strobes for this long before it closes
  lobFactor: number; // a throw's arc peaks this many times as high as a direct flight over the same distance would (a lob)
  baseLobFactor: number; // the flight time is measured from a lob this high (the first version: 1.2 times a direct flight, at the gravity below)...
  flightTimeScale: number; // ...and then scaled by this (0.65 = 35% shorter). To be both high AND quick, each throw gets its own gravity (stronger gravity: a snappy lob)
  throwMinPower: number; // a drag shorter than this (0..1) is not a throw
  rangeMin: number; // power 0 throws this far, power 1 throws rangeMax (world units)
  rangeMax: number;
  throwSpeed: number; // how fast a gift flies sideways (units per second): farther throws take longer
  flightMinMs: number;
  gravity: number; // the gravity the flight times are worked out from (units per second squared, negative = down); a throw's own gravity follows from its height and time
  handHeight: number; // a gift leaves the elf's hands this high
  aimHeight: number; // a throw is aimed at a point this high in the air (about the height of a bag's mouth), over the spot the player aims at: the gift passes through it on its way down
  floorY: number; // a gift that falls this low has hit the floor
  restitution: number; // how much of its speed a gift keeps (along the surface's push) when it bounces off a bag
  maxBounces: number; // after this many bounces a gift just falls
  bagCapacity: number; // a bag holds at most this many gifts: a new one pushes out a random gift of another color
  stepMs: number; // gifts are simulated in steps of this length, so a result never depends on how often the server ticks
  landedShowMs: number; // a gift that has come down stays in the view this long (for the animation)
}

export const DEFAULT_SANTA: SantaConfig = {
  durationMs: SANTA_SECONDS * 1000,
  minThrowGapMs: 120,
  stationRadius: 22, // (the elves stand this far from the middle of the clearing)
  startAngleDeg: 180,
  orbitRadius: 12, // (wide enough for nine bags, the biggest ones included, without touching)
  orbitSpeedUnits: 3,
  bagRadiusMin: 2.07, // (the smallest bags are 15% bigger than they were: 1.8 x 1.15)
  bagRadiusMax: 2.7, // (the biggest bags are 10% smaller than they were: 3.0 x 0.9)
  bagCount: 9,
  phaseMs: 15000,
  closedMin: 3,
  closedMax: 6,
  warnMs: 3000,
  lobFactor: 1.26, // (1.2 in the first lob, then 1.8, then 30% lower)
  baseLobFactor: 1.2,
  flightTimeScale: 0.65, // (35% shorter flights)
  throwMinPower: 0.08,
  rangeMin: 3,
  rangeMax: 38, // (the farthest bag from the farthest elf is about 36 away)
  throwSpeed: 11,
  flightMinMs: 700,
  gravity: -18,
  handHeight: 2,
  aimHeight: 4.6, // (the bags' mouths are about 4 high (2.3 mouths up, leaning out), and the aim is 15% above that: the gift passes through the aim point and then falls into the mouth)
  floorY: 0.4,
  restitution: 0.45,
  maxBounces: 3,
  bagCapacity: 5,
  stepMs: 10,
  landedShowMs: 1600,
};

interface Bag {
  id: number;
  radius: number; // the radius of its mouth
  slot: number;
  gifts: { owner: string; kind: number }[]; // the gifts in the bag, oldest first (at most bagCapacity); the phones see them as a heap in the mouth
  closeAt: number; // the server time it is cinched shut...
  openAt: number; // ...and opens again
}
interface Vec { x: number; y: number; z: number }
/** A gift in the air: it moves by gravity from (p0, v0) at time t0 (a new segment starts at every bounce). */
interface Flying { id: number; owner: string; kind: number; p0: Vec; v0: Vec; g: number; t0: number; bounces: number }
/** A gift pushed out of a full bag: shown tumbling out of its mouth (a picture only: it is not simulated). */
interface Kicked { id: number; owner: string; kind: number; bag: number; at: number }
interface Landed { id: number; owner: string; kind: number; x: number; y: number; z: number; bag: number | null; at: number }

interface SantaState {
  startsAt: number;
  endsAt: number;
  stations: Record<string, { x: number; z: number; facing: number }>;
  lastThrowAt: Record<string, number>;
  bags: Bag[];
  flying: Flying[];
  landed: Landed[];
  kicked: Kicked[];
  simAt: number; // the time everything has been simulated up to (in steps of stepMs)
  nextId: number;
  clock: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export { lobPlan }; // (the sum is shared with the phones, packages/shared/src/santaThrow.ts; re-exported for the tests)

export function createSantaSack(options: Partial<SantaConfig> = {}): GameEngine<SantaState> {
  const cfg: SantaConfig = { ...DEFAULT_SANTA, ...options };
  const orbitSpeed = cfg.orbitSpeedUnits / cfg.orbitRadius; // radians per second

  /**
   * The elves stand in a circle round the bags, evenly spaced, as far across from each other as possible: with an even number of players every elf has another exactly opposite
   * (two are left and right, four add top and bottom, six, eight...), and with an odd number they are still evenly spaced. The first player is on the left.
   */
  function stationSpots(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const a = ((cfg.startAngleDeg + (i * 360) / n) * Math.PI) / 180; // (x = cos, z = sin: 180 degrees is due west, 90 is south)
      const x = Math.cos(a) * cfg.stationRadius, z = Math.sin(a) * cfg.stationRadius;
      return { x: round(x), z: round(z), facing: Math.atan2(-z, -x) }; // looking at the middle, where the bags are
    });
  }

  /** Where a bag's middle is at server time `at` (it travels round the route without ever stopping). */
  const bagPosition = (bag: Bag, startsAt: number, at: number) => {
    const angle = bag.slot + orbitSpeed * ((at - startsAt) / 1000);
    return { x: Math.cos(angle) * cfg.orbitRadius, z: Math.sin(angle) * cfg.orbitRadius };
  };

  const isClosed = (bag: Bag, t: number) => t >= bag.closeAt && t < bag.openAt;
  /** The player with strictly the most gifts in a bag; null if it is empty or the best is tied (neutral). */
  const countsOf = (gifts: Bag['gifts']) => { const counts: Record<string, number> = {}; for (const g of gifts) counts[g.owner] = (counts[g.owner] ?? 0) + 1; return counts; };
  function leaderOf(gifts: Bag['gifts']): string | null {
    const counts = countsOf(gifts);
    let best = 0, leader: string | null = null, tied = false;
    for (const [id, n] of Object.entries(counts)) {
      if (n > best) { best = n; leader = id; tied = false; } else if (n === best && n > 0) tied = true;
    }
    return tied ? null : leader;
  }
  /** How many bags each player controls (this is the score). */
  function controlled(state: SantaState): Record<string, number> {
    const result: Record<string, number> = Object.fromEntries(Object.keys(state.stations).map((id) => [id, 0]));
    for (const bag of state.bags) { const l = leaderOf(bag.gifts); if (l && l in result) result[l] += 1; }
    return result;
  }

  return {
    id: 'santa-sack',

    init(playerIds, now) {
      const spots = stationSpots(playerIds.length);
      const stations: SantaState['stations'] = {};
      playerIds.forEach((id, i) => { stations[id] = spots[i]; });
      // The bags: always 9, evenly spaced round the route, all close in size (a random mouth radius between bagRadiusMin and bagRadiusMax).
      const count = cfg.bagCount;
      const offset = rand(0, Math.PI * 2);
      // The lids: all open for the first phase; in the second a random 3 to 6 of the bags are closed; in the third those open and the OTHER bags close; in the last all are open again.
      const howMany = Math.floor(rand(cfg.closedMin, cfg.closedMax + 1));
      const first = new Set([...Array(count).keys()].sort(() => Math.random() - 0.5).slice(0, howMany));
      const bags: Bag[] = Array.from({ length: count }, (_, i) => {
        const phase = first.has(i) ? 1 : 2; // (phase 1 = the second quarter of the round, phase 2 = the third)
        return { id: i + 1, radius: round(rand(cfg.bagRadiusMin, cfg.bagRadiusMax), 3), slot: offset + (i * Math.PI * 2) / count, gifts: [], closeAt: now + phase * cfg.phaseMs, openAt: now + (phase + 1) * cfg.phaseMs };
      });
      const each = <T,>(v: T) => Object.fromEntries(playerIds.map((id) => [id, v])) as Record<string, T>;
      return {
        startsAt: now, endsAt: now + cfg.durationMs, stations,
        lastThrowAt: each(-Infinity),
        bags, flying: [], landed: [], kicked: [], simAt: now, nextId: 1, clock: now,
      };
    },

    reduce(state, playerId, action, now) {
      if (now < state.startsAt || now >= state.endsAt) return state;
      const station = state.stations[playerId];
      if (!station || action.type !== 'throw') return state; // not playing (or not a throw)
      if (now - state.lastThrowAt[playerId] < cfg.minThrowGapMs) return state;
      if (![action.x, action.z, action.power].every(Number.isFinite)) return state; // never trust the payload
      const len = Math.hypot(action.x, action.z);
      const power = clamp(action.power, 0, 1);
      if (len < 1e-6 || power < cfg.throwMinPower) return state; // not a real throw
      const range = cfg.rangeMin + (cfg.rangeMax - cfg.rangeMin) * power;
      const dirX = action.x / len, dirZ = action.z / len;
      // The throw is aimed at a point `range` away, `aimHeight` up: the gift is launched so that it is exactly there when it comes down through that height, then carries on falling.
      // It is a LOB: it peaks lobFactor times as high as a direct flight over the same distance would, and the flight takes flightTimeScale of the time the first lob (baseLobFactor) took.
      // To be both higher and quicker than that, the throw has its own gravity: from the peak height h (above the hands) and the time T, falling from the peak to the aim height gives
      // T = (sqrt(2h) + sqrt(2 (h - aim))) / sqrt(g), so g = ((sqrt(2h) + sqrt(2 (h - aim))) / T)^2, and the launch speed up is sqrt(2 g h).
      const plan = lobPlan(cfg, range);
      const flying: Flying = {
        id: state.nextId, owner: playerId, kind: Math.floor(Math.random() * 6),
        p0: { x: station.x, y: cfg.handHeight, z: station.z }, v0: { x: (dirX * range) / plan.flight, y: plan.vy, z: (dirZ * range) / plan.flight }, g: -plan.g, t0: now, bounces: 0,
      };
      return {
        ...state, nextId: state.nextId + 1, flying: [...state.flying, flying],
        lastThrowAt: { ...state.lastThrowAt, [playerId]: now },
      };
    },

    tick(state, _dt, now) {
      if (now < state.startsAt) return state;
      const bags = state.bags.map((b) => ({ ...b, gifts: [...b.gifts] }));
      let landed = state.landed.filter((l) => now - l.at < cfg.landedShowMs);
      const kicked = state.kicked.filter((k) => now - k.at < cfg.landedShowMs);
      let nextId = state.nextId;
      let flying = state.flying;
      let simAt = state.simAt;
      // Everything moves in fixed steps (so the outcome never depends on how often the server ticks): bags float round their route, lids go on and off, gifts fly and bounce.
      while (simAt + cfg.stepMs <= now) {
        simAt += cfg.stepMs;
        const t = simAt;
        // Where each bag is right now (its frame: the volumes of the bag) and whether its lid is on.
        const frames = bags.map((b) => { const p = bagPosition(b, state.startsAt, t); return { bag: b, frame: bagFrame(p.x, p.z, b.radius), closed: isClosed(b, t) }; });
        const stillFlying: Flying[] = [];
        for (const g of flying) {
          if (g.t0 > t) { stillFlying.push(g); continue; }
          const dt = (t - g.t0) / 1000;
          const pos = { x: g.p0.x + g.v0.x * dt, y: g.p0.y + g.v0.y * dt + 0.5 * g.g * dt * dt, z: g.p0.z + g.v0.z * dt };
          // Into an OPEN bag's scoring zone: the gift has gone in, and counts for whoever threw it (the player with the most gifts in a bag controls it).
          const scored = frames.find((f) => !f.closed && inScoringZone(f.frame, pos));
          if (scored) {
            const bag = scored.bag;
            let counted = g.owner in state.stations;
            if (counted && bag.gifts.length >= cfg.bagCapacity) {
              // The bag is full: a random gift of another color (never the thrower's) is pushed out to make room. If it holds only the thrower's own, nothing can be pushed out and this gift does not count.
              const others = bag.gifts.map((x, i) => i).filter((i) => bag.gifts[i].owner !== g.owner);
              if (others.length === 0) counted = false;
              else { const [out] = bag.gifts.splice(others[Math.floor(Math.random() * others.length)], 1); kicked.push({ id: nextId++, owner: out.owner, kind: out.kind, bag: bag.id, at: t }); }
            }
            if (counted) bag.gifts.push({ owner: g.owner, kind: g.kind });
            landed.push({ id: g.id, owner: g.owner, kind: g.kind, x: round(pos.x), y: round(pos.y), z: round(pos.z), bag: counted ? bag.id : null, at: t });
            continue;
          }
          // Hitting the outside of a bag (its neck or its belly, or the lid of a closed one: the neck cylinder is solid with the scoring zone switched off): it bounces off.
          let bounced = false;
          if (g.bounces < cfg.maxBounces) {
            for (const f of frames) {
              const n = outerZoneNormal(f.frame, pos, f.closed);
              if (!n) continue;
              const v = { x: g.v0.x, y: g.v0.y + g.g * dt, z: g.v0.z }; // (its velocity now)
              const vn = v.x * n.x + v.y * n.y + v.z * n.z;
              if (vn >= 0) continue; // already moving away from the bag
              const k = (1 + cfg.restitution) * vn;
              const out = { x: (v.x - k * n.x) * 0.9, y: (v.y - k * n.y) * 0.9, z: (v.z - k * n.z) * 0.9 };
              // Push it out of the bag so it does not hit the same spot again.
              const pushed = { ...pos };
              for (let i = 0; i < 40 && outerZoneNormal(f.frame, pushed, f.closed); i++) { pushed.x += n.x * 0.08; pushed.y += n.y * 0.08; pushed.z += n.z * 0.08; }
              stillFlying.push({ ...g, p0: pushed, v0: out, t0: t, bounces: g.bounces + 1 });
              bounced = true;
              break;
            }
          }
          if (bounced) continue;
          if (pos.y <= cfg.floorY && g.v0.y + g.g * dt < 0) { // it has hit the floor
            landed.push({ id: g.id, owner: g.owner, kind: g.kind, x: round(pos.x), y: cfg.floorY, z: round(pos.z), bag: null, at: t });
            continue;
          }
          stillFlying.push(g);
        }
        flying = stillFlying;
      }
      return { ...state, bags, flying, landed, kicked, nextId, simAt, clock: now };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(controlled(state));
      const best = Math.max(0, ...entries.map(([, n]) => n));
      const leaders = entries.filter(([, n]) => n === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody controls a bag, or a tie for the most: a draw
    },

    scores: (state) => controlled(state),

    removePlayer(state, playerId) {
      const drop = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => id !== playerId)) as Record<string, T>;
      return { ...state, stations: drop(state.stations), lastThrowAt: drop(state.lastThrowAt), bags: state.bags.map((b) => ({ ...b, gifts: b.gifts.filter((x) => x.owner !== playerId) })), flying: state.flying.filter((f) => f.owner !== playerId) }; // (their gifts leave with them)
    },

    view(state): SantaSackView {
      const bags: SantaBagView[] = state.bags.map((b) => ({
        id: b.id, radius: b.radius, slot: round(b.slot, 4), leader: leaderOf(b.gifts), gifts: b.gifts.map((x) => ({ owner: x.owner, kind: x.kind })), lid: { closeAt: b.closeAt, openAt: b.openAt },
      }));
      const flying: SantaFlyingView[] = state.flying.map((f) => ({ id: f.id, owner: f.owner, kind: f.kind, x0: round(f.p0.x), y0: round(f.p0.y), z0: round(f.p0.z), vx: round(f.v0.x), vy: round(f.v0.y), vz: round(f.v0.z), g: round(f.g, 3), t0: f.t0, bounces: f.bounces }));
      const landed: SantaLandedView[] = state.landed.map((l) => ({ ...l }));
      const kicked: SantaKickedView[] = state.kicked.map((k) => ({ ...k }));
      const own = controlled(state);
      return {
        gameId: 'santa-sack',
        startsAt: state.startsAt,
        endsAt: state.endsAt,
        stations: state.stations,
        orbit: { radius: cfg.orbitRadius, speed: round(orbitSpeed, 5) },
        bags,
        warnMs: cfg.warnMs,
        rangeMin: cfg.rangeMin,
        rangeMax: cfg.rangeMax,
        lob: { throwSpeed: cfg.throwSpeed, flightMinMs: cfg.flightMinMs, gravity: cfg.gravity, handHeight: cfg.handHeight, aimHeight: cfg.aimHeight, lobFactor: cfg.lobFactor, baseLobFactor: cfg.baseLobFactor, flightTimeScale: cfg.flightTimeScale },
        throwMinPower: cfg.throwMinPower,
        players: Object.fromEntries(Object.keys(state.stations).map((id) => [id, { controlled: own[id] ?? 0 }])),
        flying, landed, kicked,
      };
    },
  };
}
