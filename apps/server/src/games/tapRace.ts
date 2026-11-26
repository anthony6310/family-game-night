import type { GameEngine } from './types';
import { spendTap, type TapBucket } from '@fgn/shared';

interface TapRaceState {
  startsAt: number;
  endsAt: number;
  taps: Record<string, number>;
  buckets: Record<string, TapBucket>; // each player's tap-rate bucket (tapLimit.ts)
}

/** Tap Race: most taps before time runs out wins. A tie for the most taps is a draw. */
export function createTapRace(durationMs: number): GameEngine<TapRaceState> {
  return {
    id: 'tap-race',

    init: (playerIds, now) => ({
      startsAt: now,
      endsAt: now + durationMs,
      taps: Object.fromEntries(playerIds.map((id) => [id, 0])),
      buckets: {},
    }),

    reduce(state, playerId, action, now) {
      if (action.type !== 'tap') return state;
      if (!(playerId in state.taps)) return state; // not playing this round
      if (now < state.startsAt || now >= state.endsAt) return state; // outside the window: server clock decides
      const bucket = spendTap(state.buckets[playerId], now);
      if (!bucket) return state; // tapping faster than a human can keep up (see tapLimit.ts)
      return {
        ...state,
        taps: { ...state.taps, [playerId]: state.taps[playerId] + 1 },
        buckets: { ...state.buckets, [playerId]: bucket },
      };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(state.taps);
      const best = Math.max(0, ...entries.map(([, n]) => n));
      const leaders = entries.filter(([, n]) => n === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody tapped, or a tie: draw
    },

    scores: (state) => ({ ...state.taps }),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...taps } = state.taps;
      return { ...state, taps };
    },

    view: (state) => ({ gameId: 'tap-race', startsAt: state.startsAt, endsAt: state.endsAt, taps: state.taps }),
  };
}
