import type { TeamId } from '@fgn/shared';
import type { GameEngine, TeamContext } from './types';
import { spendTap, type TapBucket } from '@fgn/shared'; // (the same tap-rate limit as Tap Race, and the one the Tap Race phone uses to count your own taps)

interface TugState {
  startsAt: number;
  endsAt: number;
  taps: Record<string, number>;
  buckets: Record<string, TapBucket>; // each player's tap-rate bucket
  teams: Record<string, TeamId>; // who pulls for which team
}

/** A team's total: its players' taps plus its head start. */
const totalsOf = (s: TugState): Record<TeamId, number> => {
  const totals: Record<TeamId, number> = { yellow: 0, purple: 0 };
  for (const id of Object.keys(s.taps)) { const t = s.teams[id]; if (t) totals[t] += s.taps[id]; }
  return totals;
};

/**
 * TUG OF WAR (GAME_RULES.md #18): a team game. Two teams pull a rope by tapping, and every tap counts for the player's team. The team with the most taps (plus its head start) after the
 * round wins. The engine only counts each player's taps (and shows the team totals for the rope); the room decides the winning TEAM from the scores, and gives every
 * member of it a victory point (see rooms.ts `endTeamRound`), so `getWinner` has no single winner to name.
 */
export function createTugOfWar(durationMs: number): GameEngine<TugState> {
  return {
    id: 'tug-of-war',

    init: (playerIds, now, ctx?: TeamContext) => ({
      startsAt: now,
      endsAt: now + durationMs,
      taps: Object.fromEntries(playerIds.map((id) => [id, 0])),
      buckets: {},
      teams: { ...(ctx?.teams ?? {}) },
    }),

    reduce(state, playerId, action, now) {
      if (action.type !== 'tap') return state;
      if (!(playerId in state.taps)) return state; // not playing this round
      if (now < state.startsAt || now >= state.endsAt) return state; // outside the window: the server clock decides
      const bucket = spendTap(state.buckets[playerId], now);
      if (!bucket) return state; // tapping faster than a human can keep up (see tapLimit.ts)
      return { ...state, taps: { ...state.taps, [playerId]: state.taps[playerId] + 1 }, buckets: { ...state.buckets, [playerId]: bucket } };
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner: () => null, // (a team game: the room picks the winning team from the scores)

    scores: (state) => ({ ...state.taps }),

    removePlayer(state, playerId) {
      const { [playerId]: _gone, ...taps } = state.taps;
      return { ...state, taps };
    },

    view: (state) => ({ gameId: 'tug-of-war', startsAt: state.startsAt, endsAt: state.endsAt, taps: state.taps, teams: state.teams, totals: totalsOf(state) }),
  };
}

