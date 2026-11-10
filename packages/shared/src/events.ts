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
  totalRounds: number; // one of ROUND_OPTIONS
}

/**
 * 'lobby'     choosing settings and readying up
 * 'countdown' everyone is ready; the game starts at `countdownEndsAt`
 * 'playing'   a round is running
 * 'results'   the round is over; the winner is on screen (moves on by itself after a few seconds)
 * 'session-over' the last round (and any tie-breaker) is done; the session winner is crowned
 */
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'results' | 'session-over';

/** What a phone may send during a round. The server decides what it actually means. */
export type GameAction = { type: 'tap' };

/** What phones are told about a running round (Tap Race for now; a union once there are more games). */
export interface GameView {
  gameId: GameId;
  startsAt: number; // server clock (epoch ms)
  endsAt: number;
  taps: Record<string, number>; // playerId -> taps counted by the SERVER
}

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
  readyIds: string[]; // ids of players who tapped Ready
  phase: RoomPhase;
  /** Server clock (epoch ms) when the countdown hits zero, or null. */
  countdownEndsAt: number | null;
  /** Rounds won so far this session, by player id (players with none are absent). */
  scores: Record<string, number>;
  game: GameView | null; // only while phase === 'playing'
  result: RoundResult | null; // only while phase === 'results'
  /** Decided (non-tie-breaker) rounds played this session. Draws are replayed and don't count. */
  roundsPlayed: number;
  /** While a tie-breaker is pending: the tied players who may play. Everyone else spectates. */
  contenders: string[] | null;
  /** Set once the session is over (a snapshot of who won). */
  sessionWinner: Player | null;
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
  | 'NO_GAME_SELECTED';

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
  /** Host only. Changing anything cancels a running countdown and clears every Ready. */
  'room:settings': (settings: Partial<RoomSettings>, ack?: (res: Ack<null>) => void) => void;
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
}
