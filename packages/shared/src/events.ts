import type { TerrainFeature } from './terrain';
import type { GameId } from './games';

/**
 * The Socket.io contract between phones and server. Both sides import these types, so
 * renaming an event or changing a payload becomes a compile error instead of a runtime bug.
 */

/** Someone in a room. Guests have `isGuest: true` and a temporary id. */
export interface Player {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

/** Host-controlled session settings. */
export interface RoomSettings {
  gameId: GameId | null; // null until the host picks a game
  totalRounds: number; // one of ROUND_OPTIONS; fixed once the host confirms the session (see `sessionConfirmed`)
}

/**
 * 'lobby'     choosing settings and readying up
 * 'countdown' everyone is ready; the game starts at `countdownEndsAt`
 * 'playing'   a round is running
 * 'finish'    the round just ended: the result is decided, input is stopped and a "you won / you lost" message
 *             plays over the frozen game for a few seconds
 * 'results'   the round summary screen (moves on by itself after a few seconds)
 * 'session-over' the last round (and any tie-breaker) is done; the session winner is crowned
 */
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'finish' | 'results' | 'session-over';

/**
 * What a phone may send during a round. The server decides what it actually means.
 * `steer` is a direction on the ground in world axes (x = east, z = south), each -1..1.
 * The server clamps its length to 1, so sending a bigger vector gains nothing.
 */
export type GameAction = { type: 'tap' } | { type: 'steer'; x: number; z: number };

/** Tap Race, as phones see it. */
export interface TapRaceView {
  gameId: 'tap-race';
  startsAt: number; // server clock (epoch ms)
  endsAt: number;
  taps: Record<string, number>; // playerId -> taps counted by the SERVER
}

/** One snowball, as phones see it. Positions are on the ground plane (x east, z south), y is up. */
export interface SnowballBall {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  immune: boolean; // briefly true after being hit (drawn as a flash)
  /** Current top-speed multiplier, everything included: 1 = normal, below 1 = climbing, above 1 = descending / escaping. */
  speedFactor: number;
  /** The part of `speedFactor` that comes from the ground alone (hills and the ditch). */
  hillFactor: number;
  slowStacks: number; // uphill slow stacks currently active
  boostStacks: number; // downhill speed-up stacks currently active
  /** True for 2 s after this (smaller) ball hit a bigger one: a speed boost to get away. */
  escape: boolean;
  /** True for the single biggest ball: its hits do double damage. */
  leader: boolean;
}

/** Snowball, as phones see it. Streamed ~20 times a second while the round runs. */
export interface SnowballView {
  gameId: 'snowball';
  startsAt: number;
  endsAt: number;
  arenaRadius: number;
  /**
   * The speeds the gauge is drawn against (world units per second): normal, slowest possible, fastest from
   * hills alone, fastest possible with the escape boost on top, and how much that escape boost adds (a fraction).
   */
  speedRange: { base: number; min: number; hillMax: number; max: number; escapeBonus: number };
  /** This round's hills and ditch. They are picked at random for each round and never move during it. */
  terrain: TerrainFeature[];
  balls: Record<string, SnowballBall>; // playerId -> ball (players outside a tie-breaker have none)
}

/** What phones are told about a running round: one shape per game, told apart by `gameId`. */
export type GameView = TapRaceView | SnowballView;

/** Outcome of a finished round. `winnerId` is null for a draw. */
export interface RoundResult {
  winnerId: string | null;
  winner: Player | null; // snapshot, so the screen still works if the winner leaves
  isTiebreaker: boolean;
  scores: Record<string, number>; // playerId -> that round's score (taps)
}

/** Everything a phone needs to draw the lobby. The server sends a fresh copy on every change. */
export interface RoomState {
  code: string;
  hostId: string;
  players: Player[]; // in join order
  settings: RoomSettings;
  /**
   * False until the host has confirmed how many rounds the session lasts ("Let's play!"). Until then the
   * room shows only that first step. It stays true until the session ends and the host resets the room.
   */
  sessionConfirmed: boolean;
  readyIds: string[]; // ids of players who tapped Ready
  phase: RoomPhase;
  /** Server clock (epoch ms) when the countdown hits zero, or null. */
  countdownEndsAt: number | null;
  /** Rounds won so far this session, by player id (players with none are absent). */
  scores: Record<string, number>;
  game: GameView | null; // while phase is 'playing' or 'finish' (frozen during the finish sequence)
  result: RoundResult | null; // while phase is 'finish' or 'results'
  /** Decided (non-tie-breaker) rounds played this session. Draws are replayed and don't count. */
  roundsPlayed: number;
  /** While a tie-breaker is pending: the tied players who may play. Everyone else spectates. */
  contenders: string[] | null;
  /** Set once the session is over (a snapshot of who won). */
  sessionWinner: Player | null;
  /** Server clock when the finish sequence (you won / you lost) ends and the summary appears, or null. */
  finishEndsAt: number | null;
  /** Server clock when the results screen moves on, or null. */
  resultsEndsAt: number | null;
  /** Server clock when this message was built. Phones compare it to their own clock to stay in sync. */
  serverTime: number;
}

export type RoomError =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ALREADY_IN_ROOM'
  | 'GAME_IN_PROGRESS'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'INVALID_SETTING'
  | 'WRONG_PHASE'
  | 'NO_GAME_SELECTED'
  | 'SESSION_NOT_STARTED';

/** Reply shape for events that expect an answer (Socket.io "acknowledgements"). */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

export interface JoinResult {
  playerId: string; // which entry in `room.players` is "me"
  room: RoomState;
}

/** Sent in the connection handshake: an account's access token OR a guest's chosen name. */
export interface HandshakeAuth {
  token?: string;
  guestName?: string;
}

export interface ClientToServerEvents {
  'room:create': (ack: (res: Ack<JoinResult>) => void) => void;
  'room:join': (code: string, ack: (res: Ack<JoinResult>) => void) => void;
  'room:leave': () => void;
  /**
   * Host only, step 1: choose how many rounds the session lasts (one of ROUND_OPTIONS) and lock it in.
   * Allowed once per session; the game can only be picked after this.
   */
  'session:start': (totalRounds: number, ack?: (res: Ack<null>) => void) => void;
  /** Host only, step 2 (after `session:start`): pick the game. Changing it cancels a countdown and clears every Ready. */
  'room:settings': (settings: { gameId?: GameId }, ack?: (res: Ack<null>) => void) => void;
  'player:ready': (ready: boolean, ack?: (res: Ack<null>) => void) => void;
  /** Fire-and-forget (no ack) because taps are frequent. */
  'game:action': (action: GameAction) => void;
  /** Host only, lobby or session-over: wipe the scores and start a fresh session in the same room. */
  'room:reset': (ack?: (res: Ack<null>) => void) => void;
  /** Host only, lobby or session-over: close the room and send everyone out. */
  'room:close': (ack?: (res: Ack<null>) => void) => void;
  /** Host only; ends the round early, or skips the results screen. */
  'room:return-to-lobby': (ack?: (res: Ack<null>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  /** The host closed the room: everyone has been removed from it. */
  'room:closed': () => void;
  /**
   * A live snapshot of a continuous game (e.g. Snowball), sent many times a second as "volatile"
   * (a phone on a bad connection just skips the ones it can't take). Carries the server clock too.
   */
  'game:view': (view: GameView, serverTime: number) => void;
}
