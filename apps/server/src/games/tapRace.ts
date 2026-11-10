import type { GameEngine } from './types';

/** Humans can't tap faster than this; ignoring quicker taps blunts auto-clickers and double-fires. */
const MIN_TAP_INTERVAL_MS = 40;

interface TapRaceState {
  startsAt: number;
  endsAt: number;
  taps: Record<string, number>;
  lastTapAt: Record<string, number>;
}

/** Tap Race: most taps before time runs out wins. A tie for the most taps is a draw. */
export function createTapRace(durationMs: number): GameEngine<TapRaceState> {
  return {
    id: 'tap-race',

    init: (playerIds, now) => ({
      startsAt: now,
      endsAt: now + durationMs,
      taps: Object.fromEntries(playerIds.map((id) => [id, 0])),
      lastTapAt: {},
    }),

    reduce(state, playerId, action, now) {
      if (action.type !== 'tap') return state;
      if (!(playerId in state.taps)) return state; // not playing this round
      if (now < state.startsAt || now >= state.endsAt) return state; // outside the window: server clock decides
      if (now - (state.lastTapAt[playerId] ?? -Infinity) < MIN_TAP_INTERVAL_MS) return state; // too fast
      return {
        ...state,
        taps: { ...state.taps, [playerId]: state.taps[playerId] + 1 },
        lastTapAt: { ...state.lastTapAt, [playerId]: now },
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
