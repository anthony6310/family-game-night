import { FALL_MS, GOAT_SECONDS, JUMP_MS, JUMP_TAP_GAP_MS, LAG_MAX_MS, judgeJump, type GoatJumpView, type MountainGoatView } from '@fgn/shared';
import type { GameEngine } from './types';

interface Goat { jumps: number; armedAt: number; lastTapAt: number; last: GoatJumpView | null }
export interface GoatState { startsAt: number; endsAt: number; seed: number; players: Record<string, Goat> }

/**
 * CLOSING THE GAP (id mountain-goat; GAME_RULES.md): every player is a goat crossing gaps. A marker sweeps out and back; a tap when it reaches the next ledge is a leap and a point.
 * The sweep is a pure function of time (shared/goat.ts), and every goat faces the same ledges (from the round's seed). A phone reports WHEN it tapped (its clock for
 * the server's), and the server believes it up to LAG_MAX_MS in the past, so network lag does not move the marker the player was looking at. No tick: the view changes only on taps.
 */
export function createMountainGoat(options: { durationMs?: number; seed?: number } = {}): GameEngine<GoatState> {
  const durationMs = options.durationMs ?? GOAT_SECONDS * 1000;
  return {
    id: 'mountain-goat',

    init(playerIds, now) {
      const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
      return { startsAt: now, endsAt: now + durationMs, seed, players: Object.fromEntries(playerIds.map((id) => [id, { jumps: 0, armedAt: now, lastTapAt: 0, last: null }])) };
    },

    reduce(state, playerId, action, now) {
      const p = state.players[playerId];
      if (!p || action.type !== 'jump' || !Number.isFinite(action.at)) return state;
      if (now < state.startsAt || now >= state.endsAt) return state;
      if (now - p.lastTapAt < JUMP_TAP_GAP_MS) return state; // (blunts auto-clickers)
      p.lastTapAt = now;
      const at = Math.min(now, Math.max(action.at, now - LAG_MAX_MS)); // (the phone's own time, within the lag we allow, never in the future)
      if (at < p.armedAt || at >= state.endsAt) return state; // (still in the air, or climbing back: the tap does nothing)
      const since = at - p.armedAt, { ok, len, birdU } = judgeJump(state.seed, p.jumps, since, at - state.startsAt);
      p.last = { ok, len, at, since, birdU };
      if (ok) { p.jumps++; p.armedAt = at + JUMP_MS; } else p.armedAt = at + FALL_MS;
      return state;
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const ranked = Object.entries(state.players).sort((a, b) => b[1].jumps - a[1].jumps);
      if (ranked.length === 0 || ranked[0][1].jumps === 0) return null;
      if (ranked.length > 1 && ranked[1][1].jumps === ranked[0][1].jumps) return null; // (a draw: never invent a tiebreak)
      return ranked[0][0];
    },
    scores: (state) => Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.jumps])),
    removePlayer(state, playerId) { delete state.players[playerId]; return state; },

    view(state): MountainGoatView {
      return {
        gameId: 'mountain-goat', startsAt: state.startsAt, endsAt: state.endsAt, seed: state.seed,
        players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { jumps: p.jumps, armedAt: p.armedAt, last: p.last ? { ...p.last } : null }])),
      };
    },
  };
}
