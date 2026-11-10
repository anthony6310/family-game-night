import { randomInt } from 'node:crypto';
import {
  COUNTDOWN_SECONDS, GAMES, MAX_PLAYERS, RESULTS_SECONDS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROUND_OPTIONS,
  TAP_RACE_SECONDS, getGame,
  type GameAction, type GameId, type Player, type RoomError, type RoomPhase, type RoomSettings, type RoomState,
  type RoundResult,
} from '@fgn/shared';
import { createTapRace } from './games/tapRace';
import type { GameEngine } from './games/types';

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>; // a Map keeps insertion order = join order
  settings: RoomSettings;
  ready: Set<string>;
  phase: RoomPhase;
  countdownEndsAt: number | null;
  wins: Record<string, number>; // rounds won this session, by player id
  game: { engine: GameEngine; state: unknown } | null; // set while phase === 'playing'
  result: RoundResult | null; // set while phase === 'results'
  resultsEndsAt: number | null;
  roundsPlayed: number; // decided, non-tie-breaker rounds
  tiebreakerRounds: number; // decided tie-breaker rounds
  contenders: string[] | null; // non-null = tie-breaker stage: only these players play
  sessionWinner: Player | null;
}

/** A decided round, for the caller to persist. Draws produce no record. */
export interface RoundRecord {
  roomCode: string;
  gameType: GameId;
  winner: Player;
  isTiebreaker: boolean;
}

/** A finished session, for the caller to persist. */
export interface SessionRecord {
  roomCode: string;
  winner: Player;
  winnerWins: number;
  totalRounds: number;
  tiebreakerRounds: number;
}

/** What a change produced: the new room state, plus records to persist if anything was decided. */
export interface Outcome {
  room: RoomState;
  round?: RoundRecord;
  session?: SessionRecord;
}

export type Result = ({ ok: true } & Outcome) | { ok: false; error: RoomError };
const fail = (error: RoomError): Result => ({ ok: false, error });

/**
 * All room rules in one place, with no Socket.io in sight, so it is easy to reason about.
 * Rooms live only in memory: restart the server and they are gone (by design for now).
 * Timers are NOT in here either: this class only records *when* things end.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomOfPlayer = new Map<string, string>(); // playerId -> room code
  private countdownMs: number;
  private resultsMs: number;
  private engines: Record<GameId, GameEngine>;

  /** Durations are injectable so tests can run fast. */
  constructor(options: { countdownMs?: number; roundMs?: number; resultsMs?: number } = {}) {
    this.countdownMs = options.countdownMs ?? COUNTDOWN_SECONDS * 1000;
    this.resultsMs = options.resultsMs ?? RESULTS_SECONDS * 1000;
    this.engines = { 'tap-race': createTapRace(options.roundMs ?? TAP_RACE_SECONDS * 1000) };
  }

  create(host: Player): Result {
    if (this.roomOfPlayer.has(host.id)) return fail('ALREADY_IN_ROOM');
    const room: Room = {
      code: this.newCode(),
      hostId: host.id,
      players: new Map([[host.id, host]]),
      settings: { gameId: null, totalRounds: ROUND_OPTIONS[0] },
      ready: new Set(),
      phase: 'lobby',
      countdownEndsAt: null,
      wins: {},
      game: null,
      result: null,
      resultsEndsAt: null,
      roundsPlayed: 0,
      tiebreakerRounds: 0,
      contenders: null,
      sessionWinner: null,
    };
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(host.id, room.code);
    return ok(room);
  }

  join(rawCode: string, player: Player): Result {
    if (this.roomOfPlayer.has(player.id)) return fail('ALREADY_IN_ROOM');
    const room = this.rooms.get(rawCode.trim().toUpperCase()); // codes are case-insensitive
    if (!room) return fail('ROOM_NOT_FOUND');
    if (room.phase === 'playing') return fail('GAME_IN_PROGRESS');
    if (room.players.size >= MAX_PLAYERS) return fail('ROOM_FULL');
    room.players.set(player.id, player);
    this.roomOfPlayer.set(player.id, room.code);
    this.reconcile(room); // the newcomer isn't ready, so a running countdown is cancelled
    return ok(room);
  }

  /** Removes a player. `room` is null if the room is now empty and deleted. */
  leave(playerId: string): { code: string; room: RoomState | null; session?: SessionRecord } | null {
    const code = this.roomOfPlayer.get(playerId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!code || !room) return null;

    room.players.delete(playerId);
    room.ready.delete(playerId);
    delete room.wins[playerId];
    this.roomOfPlayer.delete(playerId);

    if (room.players.size === 0) {
      this.rooms.delete(code);
      return { code, room: null };
    }
    // Host left: promote whoever has been here longest (first in the Map).
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value!;

    // Mid-round: the leaver forfeits. If too few players remain for the game, call the round off.
    if (room.phase === 'playing' && room.game) {
      room.game.state = room.game.engine.removePlayer(room.game.state, playerId);
      if (this.participants(room).length < this.minPlayers(room)) this.abortRound(room);
    }

    // Between rounds of a decided-or-tied session, a leaver can settle it (e.g. the other tied player left).
    let session: SessionRecord | undefined;
    if ((room.phase === 'lobby' || room.phase === 'countdown') && room.roundsPlayed >= room.settings.totalRounds) {
      session = this.settleSession(room);
    }
    this.reconcile(room);
    return { code, room: toState(room), session };
  }

  /** Host picks the game and/or session length. Any real change resets everyone's Ready. */
  setSettings(playerId: string, change: Partial<RoomSettings>): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');

    // Validate everything first so a bad request changes nothing.
    const next = { ...room.settings };
    if (change.gameId !== undefined) {
      if (!GAMES.some((g) => g.id === change.gameId)) return fail('INVALID_SETTING');
      next.gameId = change.gameId;
    }
    if (change.totalRounds !== undefined) {
      if (!(ROUND_OPTIONS as readonly number[]).includes(change.totalRounds)) return fail('INVALID_SETTING');
      // The session length is fixed once the first round has been played.
      if (change.totalRounds !== room.settings.totalRounds && this.sessionStarted(room)) return fail('WRONG_PHASE');
      next.totalRounds = change.totalRounds;
    }

    if (next.gameId !== room.settings.gameId || next.totalRounds !== room.settings.totalRounds) {
      room.settings = next;
      room.ready.clear(); // everyone must agree to the NEW setup
      this.reconcile(room); // cancels a countdown, since nobody is ready any more
    }
    return ok(room);
  }

  setReady(playerId: string, ready: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!room.settings.gameId) return fail('NO_GAME_SELECTED');

    if (ready) room.ready.add(playerId);
    else room.ready.delete(playerId);
    this.reconcile(room); // may start the countdown (last player readied) or cancel it
    return ok(room);
  }

  /**
   * Called by the timer when a countdown expires: the round starts NOW.
   * `expectedEndsAt` guards against a stale timer from a countdown that was cancelled and restarted.
   */
  finishCountdown(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'countdown' || room.countdownEndsAt !== expectedEndsAt) return null;
    const engine = this.engines[room.settings.gameId!];
    room.phase = 'playing';
    room.countdownEndsAt = null;
    room.game = { engine, state: engine.init(this.participants(room), Date.now()) };
    return toState(room);
  }

  /** A phone sent an in-game action (e.g. a tap). Returns null if it was ignored entirely. */
  gameAction(playerId: string, action: GameAction): Outcome | null {
    const room = this.roomFor(playerId);
    if (!room || room.phase !== 'playing' || !room.game) return null;
    const now = Date.now();
    room.game.state = room.game.engine.reduce(room.game.state, playerId, action, now);
    // Some games end early (first to N); Tap Race just waits for its timer.
    if (room.game.engine.isOver(room.game.state, now)) return this.endRound(room);
    return { room: toState(room) };
  }

  /** Round timer fired. Same stale-timer guard as the countdown. */
  finishRound(code: string, expectedEndsAt: number): Outcome | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing' || !room.game) return null;
    if (room.game.engine.view(room.game.state).endsAt !== expectedEndsAt) return null;
    return this.endRound(room);
  }

  /** Results timer fired: move on to the next round, a tie-breaker, or the end of the session. */
  finishResults(code: string, expectedEndsAt: number): Outcome | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'results' || room.resultsEndsAt !== expectedEndsAt) return null;
    return this.advanceAfterResults(room);
  }

  /** Current state of a room (used for batched broadcasts), or null if it no longer exists. */
  stateOf(code: string): RoomState | null {
    const room = this.rooms.get(code);
    return room ? toState(room) : null;
  }

  /** Host ends a running round early (it doesn't count), or skips the results screen. */
  returnToLobby(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase === 'playing') {
      this.abortRound(room);
      return ok(room);
    }
    if (room.phase === 'results') return { ok: true, ...this.advanceAfterResults(room) };
    return fail('WRONG_PHASE');
  }

  /** Host starts a fresh session in the same room: scores wiped, settings kept. */
  reset(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'lobby' && room.phase !== 'session-over') return fail('WRONG_PHASE');
    room.wins = {};
    room.roundsPlayed = 0;
    room.tiebreakerRounds = 0;
    room.contenders = null;
    room.sessionWinner = null;
    this.toLobby(room);
    return ok(room);
  }

  /** Host closes the room. Returns the code so the caller can disband the Socket.io group. */
  close(playerId: string): { ok: true; code: string } | { ok: false; error: RoomError } {
    const room = this.roomFor(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.phase !== 'lobby' && room.phase !== 'session-over') return { ok: false, error: 'WRONG_PHASE' };
    for (const id of room.players.keys()) this.roomOfPlayer.delete(id);
    this.rooms.delete(room.code);
    return { ok: true, code: room.code };
  }

  // ---------- internals ----------

  private endRound(room: Room): Outcome {
    const { engine, state } = room.game!;
    const winnerId = engine.getWinner(state);
    const isTiebreaker = room.contenders !== null;
    if (winnerId) {
      room.wins[winnerId] = (room.wins[winnerId] ?? 0) + 1;
      // A draw counts as "not played": the round is simply replayed.
      if (isTiebreaker) room.tiebreakerRounds++;
      else room.roundsPlayed++;
    }
    const winner = winnerId ? (room.players.get(winnerId) ?? null) : null;
    room.result = { winnerId, winner, isTiebreaker, scores: engine.scores(state) };
    room.phase = 'results';
    room.resultsEndsAt = Date.now() + this.resultsMs;
    room.game = null;
    return {
      room: toState(room),
      round: winner ? { roomCode: room.code, gameType: room.settings.gameId!, winner, isTiebreaker } : undefined,
    };
  }

  /** Leaves the results screen: next round (lobby), tie-breaker stage (lobby), or session over. */
  private advanceAfterResults(room: Room): Outcome {
    this.toLobby(room);
    const session = this.settleSession(room);
    return { room: toState(room), session };
  }

  /**
   * Decides whether the session is finished. Once the scheduled rounds are done, look at the
   * players still in the running (everyone, or only the tied contenders): a single leader is crowned,
   * several leaders become the contenders for a tie-breaker round.
   */
  private settleSession(room: Room): SessionRecord | undefined {
    if (room.roundsPlayed < room.settings.totalRounds) return undefined;
    const pool = this.participants(room);
    const best = Math.max(...pool.map((id) => room.wins[id] ?? 0));
    const leaders = pool.filter((id) => (room.wins[id] ?? 0) === best);

    if (leaders.length === 1) {
      const winner = room.players.get(leaders[0])!;
      room.sessionWinner = winner;
      room.contenders = null;
      room.phase = 'session-over';
      room.ready.clear();
      room.countdownEndsAt = null;
      return {
        roomCode: room.code, winner, winnerWins: best,
        totalRounds: room.settings.totalRounds, tiebreakerRounds: room.tiebreakerRounds,
      };
    }
    room.contenders = leaders; // a tie: only these players play the tie-breaker
    return undefined;
  }

  private abortRound(room: Room) {
    this.toLobby(room);
    this.reconcile(room);
  }

  private toLobby(room: Room) {
    room.phase = 'lobby';
    room.game = null;
    room.result = null;
    room.resultsEndsAt = null;
    room.countdownEndsAt = null;
    room.ready.clear();
  }

  /** Who plays the next round: everyone, or only the tied contenders still present. */
  private participants(room: Room): string[] {
    const present = [...room.players.keys()];
    if (!room.contenders) return present;
    const inTie = present.filter((id) => room.contenders!.includes(id));
    return inTie.length > 0 ? inTie : present;
  }

  private minPlayers(room: Room): number {
    return getGame(room.settings.gameId)?.minPlayers ?? 1;
  }

  private sessionStarted(room: Room): boolean {
    return room.roundsPlayed > 0 || room.contenders !== null || Object.keys(room.wins).length > 0;
  }

  /**
   * The one place that decides whether a countdown should be running:
   * a game is chosen, enough players take part, and EVERY participant is ready
   * (spectators of a tie-breaker don't need to be).
   */
  private reconcile(room: Room) {
    const game = getGame(room.settings.gameId);
    const ids = this.participants(room);
    const everyoneReady = ids.every((id) => room.ready.has(id));
    const canStart = Boolean(game) && ids.length >= game!.minPlayers && everyoneReady;

    if (room.phase === 'lobby' && canStart) {
      room.phase = 'countdown';
      room.countdownEndsAt = Date.now() + this.countdownMs;
    } else if (room.phase === 'countdown' && !canStart) {
      room.phase = 'lobby';
      room.countdownEndsAt = null;
    }
  }

  private roomFor(playerId: string): Room | undefined {
    const code = this.roomOfPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code; // retry on the (rare) collision
    }
  }
}

const ok = (room: Room): Result => ({ ok: true, room: toState(room) });

function toState(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()],
    settings: { ...room.settings },
    readyIds: [...room.ready],
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    scores: { ...room.wins },
    game: room.game ? room.game.engine.view(room.game.state) : null,
    result: room.result,
    roundsPlayed: room.roundsPlayed,
    contenders: room.contenders ? [...room.contenders] : null,
    sessionWinner: room.sessionWinner,
    resultsEndsAt: room.resultsEndsAt,
    serverTime: Date.now(), // stamped at send time; phones use it to correct for clock differences
  };
}
