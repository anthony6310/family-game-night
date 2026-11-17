import { FISHING_CAST_SECONDS, FISHING_SECONDS, type FishView, type FishingView } from '@fgn/shared';
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
  caughtBy?: string;
  caughtAt?: number;
}

interface Hook { x: number; steer: number; fish: number }

interface FishingState {
  startsAt: number;
  ascentStartsAt: number;
  endsAt: number;
  lanes: string[];
  hooks: Record<string, Hook>;
  fish: Fish[];
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
  const fishDepth = (f: Fish, now: number) => f.baseY + cfg.bob * Math.sin(now / 1000 * 1.3 + f.phase);
  const mouthX = (f: Fish) => f.x + f.dir * f.size * 0.5; // the mouth is at the front

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
      const ascentStartsAt = now + cfg.castMs;
      return {
        startsAt: now,
        ascentStartsAt,
        endsAt: ascentStartsAt + cfg.ascentMs,
        lanes,
        hooks: Object.fromEntries(lanes.map((id, i) => [id, { x: (i + 0.5) * cfg.laneWidth, steer: 0, fish: 0 }])),
        fish,
        clock: now,
      };
    },

    /** Steering is only a direction: `x` from -1 (left) to 1 (right). Up and down mean nothing here: the hook rises by itself. */
    reduce(state, playerId, action, now) {
      if (action.type !== 'steer') return state;
      const hook = state.hooks[playerId];
      if (!hook || now >= state.endsAt) return state; // not playing, or the round is over
      if (!Number.isFinite(action.x)) return state; // never trust the payload
      return { ...state, hooks: { ...state.hooks, [playerId]: { ...hook, steer: clamp(action.x, -1, 1) } } };
    },

    tick(state, dt, now) {
      const total = state.lanes.length * cfg.laneWidth;
      const hooks: Record<string, Hook> = {};
      for (const [id, h] of Object.entries(state.hooks)) {
        const { lo, hi } = laneBounds(state, id);
        // Hooks can only be steered once the ascent has started (during the cast they hang at the lane's middle).
        hooks[id] = { ...h, x: now >= state.ascentStartsAt ? clamp(h.x + h.steer * cfg.hookSpeed * dt, lo, hi) : h.x };
      }
      // Fish swim on; off one end, they come back in from the other (the margin keeps that out of sight).
      let fish = state.fish
        .filter((f) => f.caughtAt === undefined || now - f.caughtAt < cfg.caughtShowMs)
        .map((f) => {
          if (f.caughtBy) return f; // a caught fish is reeled in: it no longer swims
          let x = f.x + f.dir * f.speed * dt;
          if (x > total + cfg.fishMargin) x -= total + 2 * cfg.fishMargin;
          if (x < -cfg.fishMargin) x += total + 2 * cfg.fishMargin;
          return { ...f, x };
        });

      // Catches: only while the hooks are rising and still in the water (the last stretch is the pull-out). A fish whose mouth is within reach of a hook is caught by the CLOSEST such hook
      // (two hooks side by side at a lane's edge can both reach it).
      const depth = hookDepthAt(state, now);
      if (now >= state.ascentStartsAt && now < state.endsAt) {
        fish = fish.map((f) => {
          if (f.caughtBy) return f;
          if (Math.abs(fishDepth(f, now) - depth) > cfg.catchY) return f;
          const mx = mouthX(f);
          let best: string | null = null;
          let bestGap = cfg.catchX;
          for (const [id, h] of Object.entries(hooks)) {
            const gap = Math.abs(h.x - mx);
            if (gap <= bestGap) { best = id; bestGap = gap; }
          }
          if (best === null) return f;
          hooks[best] = { ...hooks[best], fish: hooks[best].fish + 1 };
          return { ...f, caughtBy: best, caughtAt: now };
        });
      }
      return { ...state, hooks, fish, clock: now };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(state.hooks);
      const best = Math.max(0, ...entries.map(([, h]) => h.fish));
      const leaders = entries.filter(([, h]) => h.fish === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody caught one, or a tie: draw
    },

    scores: (state) => Object.fromEntries(Object.entries(state.hooks).map(([id, h]) => [id, h.fish])),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...hooks } = state.hooks;
      return { ...state, hooks }; // their lane stays (empty), so nobody else's lane moves
    },

    view(state): FishingView {
      const hookDepth = hookDepthAt(state, state.clock);
      // Only the fish anywhere near what the cameras can see are sent (the rest of the ocean is far above or below every hook).
      const fish: FishView[] = state.fish
        .filter((f) => f.baseY > hookDepth - 14 && f.baseY < hookDepth + 8)
        .map((f) => ({ id: f.id, x: round(f.x), y: round(fishDepth(f, state.clock)), dir: f.dir, speed: round(f.speed), size: round(f.size), variant: f.variant, caughtBy: f.caughtBy }));
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
        hooks: Object.fromEntries(Object.entries(state.hooks).map(([id, h]) => [id, { x: round(h.x), fish: h.fish }])),
        fish,
      };
    },
  };
}
