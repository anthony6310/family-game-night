import {
  PIRATE_SECONDS, RELOAD_MS, makeWhaleSchedule, WICK_MS, AIM_START, clampAim, enemyOf, launchOf, shipPose, simulateShot,
  type PirateBroadsideView, type PiratePlayerView, type PirateShotView, type TeamId, type V3, type WhaleSchedule,
} from '@fgn/shared';
import type { GameEngine, TeamContext } from './types';

export interface PirateConfig {
  durationMs: number;
  /** The whale's three visits (seconds into the round): fixed for a test, or null for no whale. Left out, they are drawn at random for every game. */
  whale?: WhaleSchedule | null;
}
export const DEFAULT_PIRATE_CONFIG: PirateConfig = { durationMs: PIRATE_SECONDS * 1000 };

interface Pirate {
  team: TeamId;
  slot: number; // their place along their ship's rail
  yaw: number;
  pitch: number;
  wickAt: number | null; // the wick was lit at this time (it burns WICK_MS)
  launchAt: number | null; // ...and the cannon fires at this time
  readyAt: number; // the cannon can be fired again from this time
  hits: number;
}
interface Shot {
  id: number;
  owner: string;
  team: TeamId;
  launchAt: number;
  endAt: number;
  p0: V3;
  v0: V3;
  hit: boolean;
  hitLocal: V3 | null;
  splash: V3 | null;
  blocked: V3 | null;
  scored: boolean;
}
interface PirateState {
  startsAt: number;
  endsAt: number;
  teams: Record<string, TeamId>;
  crew: Record<TeamId, number>;
  players: Record<string, Pirate>;
  shots: Shot[];
  whale: WhaleSchedule | null;
  nextId: number;
  clock: number;
}

const round = (n: number, places = 3) => { const f = 10 ** places; return Math.round(n * f) / f; };
const round3 = (v: V3): V3 => [round(v[0]), round(v[1]), round(v[2])];

/**
 * PIRATE BROADSIDE: a team game (GAME_RULES.md #17). Two pirate ships rock on the sea; every player has their own cannon and aims it with the stick (the aim keeps working while the wick burns).
 * Fire lights the wick; WICK_MS later the cannon fires, and RELOAD_MS after that it can fire again. The ships' rocking is a pure function of the round's clock, so a whole shot (and whether it hits
 * the enemy ship) is worked out at the moment of launch; the hit scores when the ball arrives, one point for the team wherever it lands. The engine reports each player's hits; the room adds
 * them up per team and decides the winning team, so `getWinner` has no single winner to name. Only hits that arrive before the clock runs out count.
 */
export function createPirateBroadside(options: Partial<PirateConfig> = {}): GameEngine<PirateState> {
  const cfg: PirateConfig = { ...DEFAULT_PIRATE_CONFIG, ...options };

  const totalsOf = (s: PirateState): Record<TeamId, number> => {
    const totals: Record<TeamId, number> = { yellow: 0, purple: 0 };
    for (const p of Object.values(s.players)) totals[p.team] += p.hits;
    return totals;
  };

  return {
    id: 'pirate-broadside',

    init(playerIds, now, ctx?: TeamContext) {
      const teams: Record<string, TeamId> = {};
      playerIds.forEach((id, i) => { teams[id] = ctx?.teams[id] ?? (i % 2 === 0 ? 'yellow' : 'purple'); });
      const crew: Record<TeamId, number> = { yellow: 0, purple: 0 };
      const players: Record<string, Pirate> = {};
      for (const id of playerIds) {
        const team = teams[id];
        players[id] = { team, slot: crew[team]++, yaw: AIM_START.yaw, pitch: AIM_START.pitch, wickAt: null, launchAt: null, readyAt: 0, hits: 0 };
      }
      return { startsAt: now, endsAt: now + cfg.durationMs, teams, crew, players, shots: [], whale: cfg.whale === undefined ? makeWhaleSchedule() : cfg.whale, nextId: 1, clock: now };
    },

    reduce(state, playerId, action, now) {
      const p = state.players[playerId];
      if (!p || now < state.startsAt || now >= state.endsAt) return state;
      if (action.type === 'aim') {
        if (!Number.isFinite(action.yaw) || !Number.isFinite(action.pitch)) return state; // never trust the payload
        const a = clampAim(action);
        p.yaw = a.yaw; p.pitch = a.pitch; // (the aim keeps working while the wick burns)
        return state;
      }
      if (action.type === 'fire') {
        if (p.wickAt !== null || now < p.readyAt) return state; // already burning, or still reloading
        p.wickAt = now;
        p.launchAt = now + WICK_MS;
        p.readyAt = p.launchAt + RELOAD_MS; // fire, 1 second of wick, BOOM, then 2 seconds before the next
        return state;
      }
      return state;
    },

    tick(state, _dt, now) {
      // The cannons whose wick has burnt down fire now, each at its own moment (so the result does not depend on the tick rate), using the aim they have at that moment.
      for (const [id, p] of Object.entries(state.players)) {
        if (p.launchAt === null || now < p.launchAt) continue;
        const at = p.launchAt;
        p.wickAt = null; p.launchAt = null;
        if (at >= state.endsAt) continue; // too late: the round is over
        const seconds = (at - state.startsAt) / 1000;
        const launch = launchOf(p.team, p.slot, state.crew[p.team], shipPose(p.team, seconds), p.yaw, p.pitch);
        const result = simulateShot(launch, seconds, enemyOf(p.team), state.whale ? state.whale.breach : null); // (the leaping whale blocks shots)
        state.shots.push({
          id: state.nextId++, owner: id, team: p.team, launchAt: at, endAt: at + Math.round(result.tau * 1000), p0: round3(launch.p0), v0: round3(launch.v0),
          hit: result.hit, hitLocal: result.hitLocal ? round3(result.hitLocal) : null, splash: result.splash ? round3(result.splash) : null, blocked: result.blocked ? round3(result.blocked) : null, scored: false,
        });
      }
      // A hit scores the moment the ball arrives, if that is before the clock runs out.
      for (const s of state.shots) {
        if (s.scored || now < s.endAt) continue;
        s.scored = true;
        const owner = state.players[s.owner];
        if (s.hit && owner && s.endAt <= state.endsAt) owner.hits++;
      }
      state.shots = state.shots.filter((s) => now - s.endAt < 3000); // (phones need a ball for a few seconds after it lands, for the splash)
      state.clock = now;
      return state;
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner: () => null, // (a team game: the room picks the winning team from the scores)

    scores: (state) => Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.hits])),

    removePlayer(state, playerId) {
      delete state.players[playerId]; // (their cannon goes quiet; a ball already in the air still lands)
      return state;
    },

    view(state): PirateBroadsideView {
      const players: Record<string, PiratePlayerView> = {};
      for (const [id, p] of Object.entries(state.players)) players[id] = { team: p.team, slot: p.slot, yaw: round(p.yaw), pitch: round(p.pitch), wickAt: p.wickAt, launchAt: p.launchAt, readyAt: p.readyAt, hits: p.hits };
      const shots: PirateShotView[] = state.shots.map((s) => ({ id: s.id, owner: s.owner, team: s.team, launchAt: s.launchAt, endAt: s.endAt, p0: s.p0, v0: s.v0, hit: s.hit, hitLocal: s.hitLocal, splash: s.splash, blocked: s.blocked }));
      return { gameId: 'pirate-broadside', startsAt: state.startsAt, endsAt: state.endsAt, t: state.clock, teams: { ...state.teams }, totals: totalsOf(state), crew: { ...state.crew }, players, shots, whale: state.whale ? { ...state.whale } : null };
    },
  };
}
