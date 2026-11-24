import {
  FLAKE_COUNT, FLAKE_LAG_MAX_MS, FLAKE_PICK_GAP_MS, FLAKE_SECONDS, FLAKE_LAP, FLAKE_LANES, FLAKE_SPEED, HAND_SIZE, HAND_SWAP_MS, chooseStart, flakeOnScreen, flakePose, makePool,
  type FlakeView, type SnowflakeMatchView,
} from '@fgn/shared';
import type { GameEngine } from './types';

interface Player { points: number; hand: number[]; flakes: FlakeView[]; lastPickAt: number; handReadyAt: number }
export interface FlakeState { startsAt: number; endsAt: number; seed: number; pool: number[]; players: Record<string, Player> }

const shuffled = <T,>(xs: T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * The design the hand shows next (shown at `showAt`): one of the pool's other designs that has a flake WELL on the screen at that moment (not just rising in from the top or about to drop off the bottom),
 * so the player is never handed something they have to wait to see ("well on screen" = between 8% and 80% of the way down: a wider window gives blind spells back, a narrower one bunches the respawns at the top and makes flakes overlap more). Falls back to a design with any flake on screen, then to any other design.
 */
function nextDesign(state: FlakeState, hand: number[], flakes: FlakeView[], showAt: number): number {
  const others = state.pool.filter((d) => !hand.includes(d));
  const rank = (d: number) => { // where its best-placed flake is on the screen when it is shown: 0 = well placed, 1 = on screen but near an edge, 2 = not on screen
    let best = 2;
    flakes.forEach((f, i) => { if (f.design !== d) return; const ny = flakePose(i, f.born, f.lane, showAt).ny; best = Math.min(best, ny >= 0.08 && ny <= 0.8 ? 0 : flakeOnScreen(ny) ? 1 : 2); });
    return best;
  };
  const ranks = others.map(rank), top = Math.min(...ranks), pool = others.filter((_, k) => ranks[k] === top);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * SNOWFLAKE MATCH: every player has their OWN field of falling snowflakes (the same one at the start, drawn from a pool of designs: every design is always in the field, some twice), so what one player
 * does never moves another's flakes (a shared field left players with nothing to tap whenever someone else matched the only flake of their design). Each player holds one design;
 * tapping a flake that matches it is a point and the next design (shown HAND_SWAP_MS later: picks are ignored meanwhile), tapping a wrong one costs a point (never below 0). A picked flake falls again from the top,
 * in a lane the server keeps clear of the other flakes so they never overlap. Flake positions are pure functions of time (shared/flakes.ts), so the server only judges the tap: which flake, and (the phone's own
 * time) when. No tick: the view changes only on picks.
 */
export function createSnowflakeMatch(options: { durationMs?: number; seed?: number } = {}): GameEngine<FlakeState> {
  const durationMs = options.durationMs ?? FLAKE_SECONDS * 1000;
  return {
    id: 'snowflake-match',

    init(playerIds, now) {
      const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff), pool = makePool(seed);
      // every design is in the field once (so every hand always has something to match), and the rest of the flakes repeat random designs
      const designs = shuffled([...pool, ...Array.from({ length: FLAKE_COUNT - pool.length }, () => pool[Math.floor(Math.random() * pool.length)])]);
      // already falling since before the countdown, spaced EVENLY down the screen (flake j is j steps behind flake 0), flake j in lane j: neighbours are always in different lanes
      const offset = Math.floor(Math.random() * (FLAKE_LAP / FLAKE_SPEED) * 1000), step = (FLAKE_LAP / FLAKE_COUNT / FLAKE_SPEED) * 1000;
      const field = designs.map((design, j) => ({ design, born: now - 10_000 - offset - Math.round(j * step), lane: j % FLAKE_LANES }));
      const players = Object.fromEntries(playerIds.map((id) => [id, { points: 0, hand: shuffled(pool).slice(0, HAND_SIZE), flakes: field.map((f) => ({ ...f })), lastPickAt: 0, handReadyAt: 0 }]));
      return { startsAt: now, endsAt: now + durationMs, seed, pool, players };
    },

    reduce(state, playerId, action, now) {
      const p = state.players[playerId];
      if (!p || action.type !== 'pick' || !Number.isFinite(action.at) || !Number.isInteger(action.flake)) return state;
      if (now < state.startsAt || now >= state.endsAt) return state;
      if (now < p.handReadyAt) return state; // (the hand is changing its snowflake: nothing to match yet, and no penalty)
      if (now - p.lastPickAt < FLAKE_PICK_GAP_MS) return state; // (blunts auto-clickers)
      p.lastPickAt = now;
      const f = p.flakes[action.flake];
      if (!f) return state;
      const at = Math.min(now, Math.max(action.at, now - FLAKE_LAG_MAX_MS)); // (the phone's own time, within the lag we allow, never in the future)
      if (at < f.born) return state; // (that flake has already been taken and is a new fall now: too late, no penalty)
      if (!flakeOnScreen(flakePose(action.flake, f.born, f.lane, at).ny)) return state; // (not on the screen: it could not have been tapped)
      const slot = p.hand.indexOf(f.design);
      if (slot >= 0) {
        p.points++;
        const start = chooseStart(p.flakes, action.flake, now, Math.random()); // (it falls again from the top: in a lane, and after a short wait out of sight if need be, that keep it clear of the others)
        f.lane = start.lane; f.born = now + start.delay;
        p.handReadyAt = now + HAND_SWAP_MS;
        p.hand[slot] = nextDesign(state, p.hand, p.flakes, now + HAND_SWAP_MS);
      } else p.points = Math.max(0, p.points - 1);
      return state;
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const ranked = Object.entries(state.players).sort((a, b) => b[1].points - a[1].points);
      if (ranked.length === 0 || ranked[0][1].points === 0) return null;
      if (ranked.length > 1 && ranked[1][1].points === ranked[0][1].points) return null; // (a draw: never invent a tiebreak)
      return ranked[0][0];
    },
    scores: (state) => Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.points])),
    removePlayer(state, playerId) { delete state.players[playerId]; return state; },

    view(state): SnowflakeMatchView {
      return {
        gameId: 'snowflake-match', startsAt: state.startsAt, endsAt: state.endsAt, seed: state.seed,
        players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { points: p.points, hand: [...p.hand], flakes: p.flakes.map((f) => ({ design: f.design, born: f.born, lane: f.lane })) }])),
      };
    },
  };
}
