import {
  CLIMB_COOLDOWN_MS, CLIMB_STEP, FROG_SECONDS, OBSTACLE_DROP, OBSTACLE_STUN_MS, POLE_TOP, SLIP_DROP, SLIP_RESET, SWAP_COOLDOWN_MS,
  leanRate, obstacleAt, obstaclesFor, type FrogClimbView, type Obstacle,
} from '@fgn/shared';
import type { GameEngine } from './types';

interface Frog { h: number; side: -1 | 1; lean: number; readyAt: number; climbAt: number; swapAt: number; slipAt: number; finishedAt: number | null }
export interface FrogState { startsAt: number; endsAt: number; seed: number; obstacles: Obstacle[]; finisher: string | null; players: Record<string, Frog> }

/**
 * FROG CLIMB (id frog-climb; GAME_RULES.md): every player has their own springy pole and a frog clinging to one side of it. Climb hops the frog up; Swap scrambles it to the other side.
 * The pole's lean (shared/pole.ts) builds toward the frog's side, faster the higher the frog is; at the limit the pole over-bends and the frog slips down. Clusters of thorns (shared/obstacles.ts, the same on every
 * pole) stick out of one side of the pole from 30% of the way up (2 to 5 thorns, more of them higher up; more thorns is a taller hitbox): climbing or swapping into one makes the frog fall.
 * The first frog to POLE_TOP wins at once; if nobody gets there by the end of the clock, the highest frog wins (equal heights are a draw). The lean builds with time, so this game has a tick; an action costs a short cooldown.
 */
export function createFrogClimb(options: { durationMs?: number; seed?: number } = {}): GameEngine<FrogState> {
  const durationMs = options.durationMs ?? FROG_SECONDS * 1000;
  /** A frog that has fallen to rest inside a thorn cluster on its own side is moved just below it (so it is never stuck in one). */
  const settle = (state: FrogState, f: Frog) => { const o = obstacleAt(state.obstacles, f.side, f.h); if (o) f.h = Math.max(0, o.y0 - 1); };
  const hitCheck = (state: FrogState, f: Frog, now: number) => {
    const o = obstacleAt(state.obstacles, f.side, f.h);
    if (!o) return;
    f.h = Math.max(0, Math.min(f.h - OBSTACLE_DROP, o.y0 - 1)); // (down past the thorns' foot)
    f.slipAt = now; f.readyAt = Math.max(f.readyAt, now + OBSTACLE_STUN_MS);
    settle(state, f);
  };
  return {
    id: 'frog-climb',

    init(playerIds, now) {
      const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
      return {
        startsAt: now, endsAt: now + durationMs, seed, obstacles: obstaclesFor(seed), finisher: null,
        players: Object.fromEntries(playerIds.map((id) => [id, { h: 0, side: (Math.random() < 0.5 ? -1 : 1) as -1 | 1, lean: 0, readyAt: now, climbAt: 0, swapAt: 0, slipAt: 0, finishedAt: null }])),
      };
    },

    reduce(state, playerId, action, now) {
      const f = state.players[playerId];
      if (!f || (action.type !== 'climb' && action.type !== 'swap')) return state;
      if (now < state.startsAt || now >= state.endsAt || state.finisher) return state;
      if (now < f.readyAt) return state; // (still hopping or scrambling: the cooldowns, 220 ms or more, also blunt auto-clickers)
      if (action.type === 'climb') {
        f.h = Math.min(POLE_TOP, f.h + CLIMB_STEP);
        f.climbAt = now; f.readyAt = now + CLIMB_COOLDOWN_MS;
        if (f.h >= POLE_TOP) { f.finishedAt = now; state.finisher = playerId; } // (the first to the top wins the round at once)
        else hitCheck(state, f, now);
      } else {
        f.side = f.side === 1 ? -1 : 1;
        f.swapAt = now; f.readyAt = now + SWAP_COOLDOWN_MS;
        hitCheck(state, f, now); // (swapping onto a thorn cluster is a hit too)
      }
      return state;
    },

    tick(state, dt, now) {
      if (now < state.startsAt || state.finisher) return state;
      for (const f of Object.values(state.players)) {
        f.lean += f.side * leanRate(f.h) * dt;
        if (f.side * f.lean >= 1) { // over-bent: the frog slips down and the pole springs back a little
          f.h = Math.max(0, f.h - SLIP_DROP);
          f.lean = f.side * SLIP_RESET;
          f.slipAt = now;
          settle(state, f);
        } else f.lean = Math.max(-1, Math.min(1, f.lean));
      }
      return state;
    },

    isOver: (state, now) => state.finisher !== null || now >= state.endsAt,

    getWinner(state) {
      if (state.finisher) return state.finisher;
      const ranked = Object.entries(state.players).sort((a, b) => b[1].h - a[1].h);
      if (ranked.length === 0 || ranked[0][1].h === 0) return null;
      if (ranked.length > 1 && ranked[1][1].h === ranked[0][1].h) return null; // (a draw: never invent a tiebreak)
      return ranked[0][0];
    },
    scores: (state) => Object.fromEntries(Object.entries(state.players).map(([id, f]) => [id, f.h])),
    removePlayer(state, playerId) { delete state.players[playerId]; if (state.finisher === playerId) state.finisher = null; return state; },

    view(state): FrogClimbView {
      return {
        gameId: 'frog-climb', startsAt: state.startsAt, endsAt: state.endsAt, seed: state.seed,
        players: Object.fromEntries(Object.entries(state.players).map(([id, f]) => [id, { h: f.h, side: f.side, lean: f.lean, readyAt: f.readyAt, climbAt: f.climbAt, swapAt: f.swapAt, slipAt: f.slipAt, finishedAt: f.finishedAt }])),
      };
    },
  };
}
