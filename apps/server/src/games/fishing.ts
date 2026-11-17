import { FISH_KINDS, FISH_POINTS, FISHING_CAST_SECONDS, FISHING_SECONDS, type FishKind, type FishView, type FishingView } from '@fgn/shared';
import type { GameEngine } from './types';

/**
 * Every number that shapes how Fishing FEELS lives here. Units: world units and seconds.
 * The ocean is a flat cross-section: x runs along its width (each player has a LANE), y is the depth (0 = the surface).
 * All hooks start at the bottom and rise together at one speed; fish swim sideways across every lane; a hook that is lined up with
 * a fish's mouth catches it. Players steer their hook left and right only, and only inside their own lane.
 */
export interface FishingConfig {
  castMs: number; // the opening cast sequence (phones play it; no input counts and nothing can be caught until it is over)
  ascentMs: number; // how long the hooks rise
  depth: number; // how deep the ocean is (the hooks rise from here to `endDepth` in `ascentMs`)
  endDepth: number; // THE FINISH LINE: the hooks rise from `depth` to this depth (a little under the surface: "0 m") in `ascentMs`. The moment they get there the round is over: control stops and the closing sequence takes over (the hooks are carried the rest of the way up and out of the water by the phones' animation)
  laneWidth: number;
  hookMargin: number; // a hook stays this far from its lane's edges
  hookSpeed: number; // sideways speed at full steer
  fishPerLane: number; // how many fish there are for each player in the room
  fishSpeedMin: number;
  fishSpeedMax: number;
  fishSizeMin: number;
  fishSizeMax: number;
  bob: number; // fish bob up and down by this much (cosmetic, but the catch follows what is drawn)
  fishMargin: number; // fish swim this far beyond the ends of the ocean before they come back in from the other side (off every screen)
  catchX: number; // a hook catches a fish when it is within this far of its mouth sideways...
  catchY: number; // ...and this far in depth
  caughtShowMs: number; // a caught fish stays in the view this long (for the reel-in animation)

  // ----- schools of small fish -----
  schoolsPerLane: number; // how many schools for each player in the room (a school is 8..16 fish, so they are the rarer, lighter catch)
  schoolMin: number;
  schoolMax: number;
  schoolSpeedFactor: number; // a school swims at this fraction of a regular fish's speed (0.75 = 25% slower)
  schoolSizeMin: number; // smaller than the smallest regular fish
  schoolSizeMax: number;
  schoolSpreadX: number; // the fish of a school are scattered this far (each way) sideways from its middle...
  schoolSpreadY: number; // ...and this far in depth

  // ----- the big fish -----
  bigFishCount: number; // how many big fish are in every game (spread evenly down the ocean, like the regular fish)
  bigSize: number; // bigger than the biggest regular fish
  bigSpeedFactor: number; // it swims like a regular fish, but this many times faster (1.4 = 40% faster)
  bigCatchX: number; // a bigger mouth: it is caught within this far sideways and in depth
  bigCatchY: number;

  // ----- mines -----
  mineCountMin: number; // every game has this many mines IN EACH LANE (a random number between these), laid out EXACTLY the same in every lane (fair)...
  mineCountMax: number;
  mineMetresMin: number; // ...hanging between these depths on the on-screen gauge (0 = the finish line, 100 = the bottom): 5 m to 50 m
  mineMetresMax: number;
  mineMoveChance: number; // the chance a mine drifts side to side (within its lane)
  mineMoveAmpMin: number; // ...by this much each way (at least, at most)
  mineMoveAmpMax: number;
  mineMovePeriodMin: number; // ...one full there-and-back taking this many seconds (at least, at most)
  mineMovePeriodMax: number;
  mineHitX: number; // a hook sets a mine off when within this far sideways and in depth of its middle
  mineHitY: number;
  mineSpacing: number; // two mines in a lane are kept at least this far apart (they can be close, but never on top of each other)
  mineLossFraction: number; // a hit shakes off this fraction of the player's points, rounded up (10%)

  // ----- lifting the hook -----
  hookLiftMax: number; // while rising, a player can lift their hook this far above the steady ascent (world units; about halfway up a landscape screen)...
  hookLiftSpeed: number; // ...moving it up or down at this speed (the ascent itself is not affected)
}

export const DEFAULT_FISHING: FishingConfig = {
  castMs: FISHING_CAST_SECONDS * 1000,
  ascentMs: FISHING_SECONDS * 1000,
  depth: 198, // (think of it as 100 m: the screen shows depth in metres, see FishingScreen). Deep, so the hooks rise fast: about 3.3 units a second
  endDepth: 2, // (2 units under the surface)
  laneWidth: 9,
  hookMargin: 0.6,
  hookSpeed: 10,
  fishPerLane: 72, // (about one fish per 2.75 units of depth per player)
  fishSpeedMin: 2.1, // (60% of the original 3.5...)
  fishSpeedMax: 4.5, // (...and 7.5: each fish keeps its own speed, the whole range is just slower)
  fishSizeMin: 1.3,
  fishSizeMax: 2.6,
  bob: 0.35,
  fishMargin: 8,
  catchX: 0.45, // (about the size of the drawn hook's opening: a fish is only caught when its mouth is really on the hook)
  catchY: 0.75,
  caughtShowMs: 1200,

  schoolsPerLane: 2,
  schoolMin: 8,
  schoolMax: 16,
  schoolSpeedFactor: 0.75,
  schoolSizeMin: 0.75,
  schoolSizeMax: 1.05,
  schoolSpreadX: 2.2,
  schoolSpreadY: 1.1,

  bigFishCount: 5,
  bigSize: 3.6,
  bigSpeedFactor: 1.4,
  bigCatchX: 0.525, // (was 0.7: reduced by 25%)
  bigCatchY: 0.825, // (was 1.1: reduced by 25%)

  mineCountMin: 1,
  mineCountMax: 4,
  mineMetresMin: 5,
  mineMetresMax: 50,
  mineMoveChance: 0.5,
  mineMoveAmpMin: 1.2,
  mineMoveAmpMax: 3,
  mineMovePeriodMin: 3,
  mineMovePeriodMax: 6,
  mineHitX: 1.0, // (about as big as the drawn mine plus the hook, so anything that visibly touches it sets it off)
  mineHitY: 1.0,
  mineSpacing: 2.4,
  mineLossFraction: 0.1,

  hookLiftMax: 4,
  hookLiftSpeed: 6,
};

interface Fish {
  id: number;
  x: number;
  baseY: number; // its depth, before the bobbing
  phase: number;
  dir: 1 | -1;
  speed: number;
  size: number;
  variant: number;
  kind?: FishKind; // (missing = regular)
  caughtBy?: string;
  caughtAt?: number;
}

interface Hook { x: number; steer: number; vsteer: number; lift: number; fish: number; points: number; kinds: [number, number, number] }

/** A mine hangs in one player's lane. It may drift side to side about `cx`. Hit once, it goes off (and is then shown for a moment before it is removed). */
interface Mine {
  id: number;
  owner: string; // the player whose lane it is in (only that player's hook can reach it)
  cx: number; // its middle sideways
  amp: number; // how far it drifts each way (0 = it hangs still)
  period: number; // seconds for one full drift there and back
  phase: number;
  y: number; // its depth
  hitAt?: number;
}

interface FishingState {
  startsAt: number;
  ascentStartsAt: number;
  endsAt: number;
  lanes: string[];
  hooks: Record<string, Hook>;
  fish: Fish[];
  mines: Mine[];
  clock: number; // the `now` of the last tick (so bobbing and the like follow the server clock)
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createFishing(overrides: Partial<FishingConfig> = {}): GameEngine<FishingState> {
  const cfg: FishingConfig = { ...DEFAULT_FISHING, ...overrides };
  const ascentSpeed = (cfg.depth - cfg.endDepth) / (cfg.ascentMs / 1000);

  /** How deep the hooks are at `now`: at the bottom until the ascent starts, then rising steadily to the finish line (`endDepth`). */
  const hookDepthAt = (state: FishingState, now: number) =>
    cfg.depth - (cfg.depth - cfg.endDepth) * clamp((now - state.ascentStartsAt) / cfg.ascentMs, 0, 1);
  const laneBounds = (state: FishingState, id: string) => {
    const i = state.lanes.indexOf(id);
    return { lo: i * cfg.laneWidth + cfg.hookMargin, hi: (i + 1) * cfg.laneWidth - cfg.hookMargin };
  };
  const mineX = (m: Mine, now: number) => m.cx + m.amp * Math.sin(now / 1000 * (2 * Math.PI / m.period) + m.phase);
  const kindOf = (f: Fish): FishKind => f.kind ?? 'regular';
  const fishDepth = (f: Fish, now: number) => f.baseY + cfg.bob * Math.sin(now / 1000 * 1.3 + f.phase);
  const catchBox = (f: Fish) => (kindOf(f) === 'big' ? { x: cfg.bigCatchX, y: cfg.bigCatchY } : { x: cfg.catchX, y: cfg.catchY });
  const mouthX = (f: Fish) => f.x + f.dir * f.size * 0.5; // the mouth is at the front

  /** A mine goes off at a hook: take 10% of its points (rounded up) away, as fish chosen at random. Returns the hook with its fish, points and kinds lowered to match. */
  function shakeOff(h: Hook): Hook {
    const target = Math.ceil(h.points * cfg.mineLossFraction - 1e-9);
    if (target <= 0) return h;
    const kinds = [...h.kinds] as [number, number, number];
    let lost = 0, fish = h.fish;
    while (lost < target && fish > 0) {
      let pick = Math.floor(Math.random() * fish); // a random fish: walk the kinds' counts to find which kind it is
      const i = pick < kinds[0] ? 0 : pick < kinds[0] + kinds[1] ? 1 : 2;
      kinds[i] -= 1; fish -= 1; lost += FISH_POINTS[FISH_KINDS[i]];
    }
    return { ...h, kinds, fish, points: h.points - lost };
  }

  return {
    id: 'fishing',

    init(playerIds, now) {
      const lanes = [...playerIds];
      const total = lanes.length * cfg.laneWidth;
      const count = Math.max(8, lanes.length * cfg.fishPerLane);
      const fish: Fish[] = [];
      // Depths are spread evenly down the ocean (one fish per slice, jittered inside it), so every depth has fish; sideways positions are random.
      const usable = cfg.depth - cfg.endDepth - 3; // (no fish above the finish line, where nothing can be caught)
      for (let i = 0; i < count; i++) {
        fish.push({
          id: i + 1,
          x: rand(-cfg.fishMargin, total + cfg.fishMargin),
          baseY: cfg.endDepth + 1.5 + ((i + Math.random()) / count) * usable,
          phase: rand(0, Math.PI * 2),
          dir: Math.random() < 0.5 ? 1 : -1,
          speed: rand(cfg.fishSpeedMin, cfg.fishSpeedMax),
          size: rand(cfg.fishSizeMin, cfg.fishSizeMax),
          variant: Math.floor(Math.random() * 6),
        });
      }
      // SCHOOLS: a few groups of small fish that swim together (same direction, same slower speed), each fish scattered a little round the school's middle.
      // Their depths are spread evenly down the ocean too (one school per slice of depth), so no part of the ocean is without them.
      const schools = Math.max(1, Math.round(lanes.length * cfg.schoolsPerLane));
      let nextId = count + 1;
      for (let i = 0; i < schools; i++) {
        const middleY = cfg.endDepth + 1.5 + ((i + Math.random()) / schools) * usable;
        const middleX = rand(-cfg.fishMargin, total + cfg.fishMargin);
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        const speed = rand(cfg.fishSpeedMin, cfg.fishSpeedMax) * cfg.schoolSpeedFactor;
        const members = Math.round(rand(cfg.schoolMin, cfg.schoolMax));
        for (let m = 0; m < members; m++) {
          fish.push({
            id: nextId++, kind: 'school',
            x: middleX + rand(-cfg.schoolSpreadX, cfg.schoolSpreadX),
            baseY: clamp(middleY + rand(-cfg.schoolSpreadY, cfg.schoolSpreadY), cfg.endDepth + 1, cfg.depth - 1),
            phase: rand(0, Math.PI * 2), dir, speed,
            size: rand(cfg.schoolSizeMin, cfg.schoolSizeMax), variant: 0,
          });
        }
      }
      // BIG FISH: a few in every game. They swim exactly like regular fish (sideways, wrapping round), only bigger and 40% faster, and are worth 5 points.
      // Their depths are spread evenly down the ocean too (one per slice).
      for (let b = 0; b < cfg.bigFishCount; b++) {
        fish.push({
          id: nextId++, kind: 'big',
          x: rand(-cfg.fishMargin, total + cfg.fishMargin),
          baseY: cfg.endDepth + 1.5 + ((b + Math.random()) / cfg.bigFishCount) * usable,
          phase: rand(0, Math.PI * 2), dir: Math.random() < 0.5 ? 1 : -1,
          speed: rand(cfg.fishSpeedMin, cfg.fishSpeedMax) * cfg.bigSpeedFactor, size: cfg.bigSize, variant: 0,
        });
      }
      // MINES: ONE layout is made, and every lane gets an exact copy of it (same number, same depths, same places across the lane, same ones drifting, with the
      // same drift), so no player has an easier lane. It is made inside the first lane, between 5 m and 50 m on the gauge; some mines drift side to side.
      // Two mines are kept `mineSpacing` apart (counting a drifting mine's whole sweep), so none overlaps another, though they can be near.
      const mineCount = Math.floor(rand(cfg.mineCountMin, cfg.mineCountMax + 1));
      const yOf = (metres: number) => cfg.endDepth + (metres / 100) * (cfg.depth - cfg.endDepth);
      const lo = cfg.hookMargin + 0.4, hi = cfg.laneWidth - cfg.hookMargin - 0.4;
      type MineShape = Omit<Mine, 'id' | 'owner'>;
      const layout: MineShape[] = [];
      for (let n = 0; n < mineCount; n++) {
        for (let attempt = 0; attempt < 60; attempt++) {
          const moves = Math.random() < cfg.mineMoveChance;
          const amp = moves ? Math.min(rand(cfg.mineMoveAmpMin, cfg.mineMoveAmpMax), (hi - lo) / 2) : 0;
          const m: MineShape = { cx: rand(lo + amp, hi - amp), amp, period: rand(cfg.mineMovePeriodMin, cfg.mineMovePeriodMax), phase: rand(0, Math.PI * 2), y: yOf(rand(cfg.mineMetresMin, cfg.mineMetresMax)) };
          const clear = layout.every((o) => Math.hypot(Math.max(0, Math.abs(o.cx - m.cx) - o.amp - m.amp), o.y - m.y) >= cfg.mineSpacing);
          if (clear || attempt === 59) { layout.push(m); break; } // (a crowded lane gives up after 60 tries rather than loop for ever)
        }
      }
      const mines: Mine[] = lanes.flatMap((owner, laneIndex) => layout.map((m) => ({ ...m, id: nextId++, owner, cx: m.cx + laneIndex * cfg.laneWidth })));
      const ascentStartsAt = now + cfg.castMs;
      return {
        startsAt: now,
        ascentStartsAt,
        endsAt: ascentStartsAt + cfg.ascentMs,
        lanes,
        hooks: Object.fromEntries(lanes.map((id, i) => [id, { x: (i + 0.5) * cfg.laneWidth, steer: 0, vsteer: 0, lift: 0, fish: 0, points: 0, kinds: [0, 0, 0] as [number, number, number] }])),
        fish,
        mines,
        clock: now,
      };
    },

    /** Steering is only a direction: `x` from -1 (left) to 1 (right). Up and down mean nothing here: the hook rises by itself. */
    reduce(state, playerId, action, now) {
      if (action.type !== 'steer') return state;
      const hook = state.hooks[playerId];
      if (!hook || now >= state.endsAt) return state; // not playing, or the round is over
      if (!Number.isFinite(action.x)) return state; // never trust the payload
      return { ...state, hooks: { ...state.hooks, [playerId]: { ...hook, steer: clamp(action.x, -1, 1), vsteer: Number.isFinite(action.z) ? clamp(-action.z, -1, 1) : 0 } } }; // (z is down on the stick, so up is -z)
    },

    tick(state, dt, now) {
      const total = state.lanes.length * cfg.laneWidth;
      const hooks: Record<string, Hook> = {};
      for (const [id, h] of Object.entries(state.hooks)) {
        const { lo, hi } = laneBounds(state, id);
        // Hooks can only be steered once the ascent has started (during the cast they hang at the lane's middle).
        const rising = now >= state.ascentStartsAt;
        hooks[id] = { ...h, x: rising ? clamp(h.x + h.steer * cfg.hookSpeed * dt, lo, hi) : h.x, lift: rising ? clamp(h.lift + h.vsteer * cfg.hookLiftSpeed * dt, 0, cfg.hookLiftMax) : 0 }; // (lift: the hook is held a little above the steady ascent)
      }
      const depth = hookDepthAt(state, now);
      // Fish swim on; off one end, they come back in from the other (the margin keeps that out of sight).
      let fish = state.fish
        .filter((f) => f.caughtAt === undefined || now - f.caughtAt < cfg.caughtShowMs)
        .map((f) => {
          if (f.caughtBy) return f; // a caught fish is reeled in: it no longer swims
          const next = f;
          let x = next.x + next.dir * next.speed * dt;
          if (x > total + cfg.fishMargin) x -= total + 2 * cfg.fishMargin;
          if (x < -cfg.fishMargin) x += total + 2 * cfg.fishMargin;
          return { ...next, x };
        });

      // Catches: only while the hooks are rising and still in the water (the last stretch is the pull-out). A fish whose mouth is within reach of a hook is caught by the CLOSEST such hook
      // (two hooks side by side at a lane's edge can both reach it).
      if (now >= state.ascentStartsAt && now < state.endsAt) {
        fish = fish.map((f) => {
          if (f.caughtBy) return f;
          const box = catchBox(f);
          const fy = fishDepth(f, now);
          const mx = mouthX(f);
          let best: string | null = null;
          let bestGap = box.x;
          for (const [id, h] of Object.entries(hooks)) {
            if (Math.abs(fy - (depth - h.lift)) > box.y) continue; // (each hook may be lifted a different amount above the steady ascent)
            const gap = Math.abs(h.x - mx);
            if (gap <= bestGap) { best = id; bestGap = gap; }
          }
          if (best === null) return f;
          const kind = kindOf(f);
          const kinds = [...hooks[best].kinds] as [number, number, number];
          kinds[kind === 'school' ? 0 : kind === 'regular' ? 1 : 2] += 1;
          hooks[best] = { ...hooks[best], fish: hooks[best].fish + 1, points: hooks[best].points + FISH_POINTS[kind], kinds };
          return { ...f, caughtBy: best, caughtAt: now };
        });
      }
      // Mines: a hook that touches one sets it off. The player loses `mineLossFraction` of their points (rounded up) as fish shaken off the hook: fish are taken at random
      // (so any kind can go) until at least that many points are gone. A mine is used up by its first hit, and removed once the explosion has been shown.
      const prevDepth = Math.max(depth, hookDepthAt(state, state.clock)); // (where the hooks were at the last tick: deeper)
      let mines = state.mines.filter((m) => m.hitAt === undefined || now - m.hitAt < cfg.caughtShowMs);
      if (now >= state.ascentStartsAt && now < state.endsAt) {
        mines = mines.map((m) => {
          const h = hooks[m.owner];
          if (m.hitAt !== undefined || !h) return m;
          // Sideways: within reach of the mine's middle now. In depth: the hook rises, so it is checked over the whole stretch it moved since the last tick (a late tick can never
          // skip over a mine). This works the same at every depth: the depth range only decides where a mine may be PLACED, never whether one works.
          if (Math.abs(h.x - mineX(m, now)) > cfg.mineHitX) return m;
          if (m.y < depth - h.lift - cfg.mineHitY || m.y > prevDepth - h.lift + cfg.mineHitY) return m;
          hooks[m.owner] = shakeOff(h);
          return { ...m, hitAt: now };
        });
      }
      return { ...state, hooks, fish, mines, clock: now };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(state.hooks);
      const best = Math.max(0, ...entries.map(([, h]) => h.points));
      const leaders = entries.filter(([, h]) => h.points === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody scored, or a tie: draw (most POINTS wins, not most fish)
    },

    scores: (state) => Object.fromEntries(Object.entries(state.hooks).map(([id, h]) => [id, h.points])),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...hooks } = state.hooks;
      return { ...state, hooks, mines: state.mines.filter((m) => m.owner !== playerId) }; // their lane stays (empty), so nobody else's lane moves
    },

    view(state): FishingView {
      const hookDepth = hookDepthAt(state, state.clock);
      // Only the fish anywhere near what the cameras can see are sent (the rest of the ocean is far above or below every hook).
      const fish: FishView[] = state.fish
        .filter((f) => { const y = fishDepth(f, state.clock); return y > hookDepth - 14 && y < hookDepth + 8; })
        .map((f) => ({ id: f.id, x: round(f.x), y: round(fishDepth(f, state.clock)), dir: f.dir, speed: round(f.speed), size: round(f.size), kind: kindOf(f), variant: f.variant, caughtBy: f.caughtBy }));
      return {
        gameId: 'fishing',
        startsAt: state.startsAt,
        ascentStartsAt: state.ascentStartsAt,
        endsAt: state.endsAt,
        depth: cfg.depth,
        endDepth: cfg.endDepth,
        hookDepth: round(hookDepth),
        ascentSpeed: round(ascentSpeed, 3),
        laneWidth: cfg.laneWidth,
        lanes: state.lanes,
        hooks: Object.fromEntries(Object.entries(state.hooks).map(([id, h]) => [id, { x: round(h.x), lift: round(h.lift), fish: h.fish, points: h.points, kinds: h.kinds }])),
        fish,
        mines: state.mines
          .map((m) => ({ id: m.id, owner: m.owner, x: round(mineX(m, state.clock)), y: round(m.y), hit: m.hitAt !== undefined }))
          .filter((m) => m.y > hookDepth - 14 && m.y < hookDepth + 8),
      };
    },
  };
}
