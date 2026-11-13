import { randomInt } from 'node:crypto';
import {
  COUNTDOWN_SECONDS, FINISH_SECONDS, GAMES, MAX_PLAYERS, MAX_SPECTATORS, RESULTS_SECONDS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROUND_OPTIONS,
  SNOWBALL_SECONDS, TAP_RACE_SECONDS, getGame,
  type GameAction, type GameId, type GameView, type Player, type RoomError, type RoomPhase, type RoomSettings, type RoomState,
  type RoundResult,
} from '@fgn/shared';
import { createSnowball } from './games/snowball';
import { createTapRace } from './games/tapRace';
import type { GameEngine } from './games/types';

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>; // a Map keeps insertion order = join order
  watching: Set<string>; // members (a subset of `players`) sitting rounds out: no slot, no Ready, not in the game, but their wins still count
  settings: RoomSettings;
  sessionConfirmed: boolean; // the host has locked in the number of rounds
  ready: Set<string>;
  phase: RoomPhase;
  countdownEndsAt: number | null;
  wins: Record<string, number>; // rounds won this session, by player id
  game: { engine: GameEngine; state: unknown; lastTickAt: number } | null; // set while phase is 'playing' or 'finish' (frozen in 'finish')
  result: RoundResult | null; // set while phase is 'finish' or 'results'
  finishEndsAt: number | null; // when the "you won / you lost" sequence ends
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
  private finishMs: number;
  private engines: Record<GameId, GameEngine>;

  /** Durations are injectable so tests can run fast. */
  constructor(options: { countdownMs?: number; roundMs?: number; snowballMs?: number; resultsMs?: number; finishMs?: number } = {}) {
    this.countdownMs = options.countdownMs ?? COUNTDOWN_SECONDS * 1000;
    this.resultsMs = options.resultsMs ?? RESULTS_SECONDS * 1000;
    this.finishMs = options.finishMs ?? FINISH_SECONDS * 1000;
    this.engines = {
      'tap-race': createTapRace(options.roundMs ?? TAP_RACE_SECONDS * 1000),
      snowball: createSnowball({ durationMs: options.snowballMs ?? SNOWBALL_SECONDS * 1000 }),
    };
  }

  create(host: Player): Result {
    if (this.roomOfPlayer.has(host.id)) return fail('ALREADY_IN_ROOM');
    const room: Room = {
      code: this.newCode(),
      hostId: host.id,
      players: new Map([[host.id, host]]),
      watching: new Set(),
      settings: { gameId: null, totalRounds: ROUND_OPTIONS[0] },
      sessionConfirmed: false,
      ready: new Set(),
      phase: 'lobby',
      countdownEndsAt: null,
      wins: {},
      game: null,
      result: null,
      finishEndsAt: null,
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

  /**
   * Anyone can join (until the room holds MAX_PLAYERS playing + MAX_SPECTATORS watching). Someone arriving mid-round
   * (the finish sequence still belongs to the round) or when every playing slot is taken simply starts out WATCHING;
   * they can switch to playing between rounds (see setWatching).
   */
  join(rawCode: string, player: Player): Result {
    if (this.roomOfPlayer.has(player.id)) return fail('ALREADY_IN_ROOM');
    const room = this.rooms.get(rawCode.trim().toUpperCase()); // codes are case-insensitive
    if (!room) return fail('ROOM_NOT_FOUND');
    if (room.players.size >= MAX_PLAYERS + MAX_SPECTATORS) return fail('ROOM_FULL');
    const midRound = room.phase === 'playing' || room.phase === 'finish';
    if (midRound || this.activeCount(room) >= MAX_PLAYERS) room.watching.add(player.id);
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
    room.watching.delete(playerId);
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

  /**
   * Step 1 of a session: the host locks in how many rounds it lasts. This happens ONCE per session;
   * after it the room moves on to picking a game, and only a reset (after the session) brings it back.
   */
  startSession(playerId: string, totalRounds: number): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'lobby' || room.sessionConfirmed) return fail('WRONG_PHASE');
    if (!(ROUND_OPTIONS as readonly number[]).includes(totalRounds)) return fail('INVALID_SETTING');
    room.settings = { ...room.settings, totalRounds };
    room.sessionConfirmed = true;
    return ok(room);
  }

  /** Step 2: the host picks the game (any time between rounds). A real change resets everyone's Ready. */
  setSettings(playerId: string, change: { gameId?: string | null }): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!room.sessionConfirmed) return fail('SESSION_NOT_STARTED');
    // The round count is only ever set by startSession(); it can't be sneaked in here.
    if ((change as Record<string, unknown>).totalRounds !== undefined) return fail('INVALID_SETTING');

    if (change.gameId !== undefined) {
      if (!GAMES.some((g) => g.id === change.gameId)) return fail('INVALID_SETTING');
      if (change.gameId !== room.settings.gameId) {
        room.settings = { ...room.settings, gameId: change.gameId as GameId };
        room.ready.clear(); // everyone must agree to the NEW game
        this.reconcile(room); // cancels a countdown, since nobody is ready any more
      }
    }
    return ok(room);
  }

  /**
   * Switch between playing and watching (lobby/countdown only, so a round is never disturbed). Points are kept either
   * way, and watchers still count when the session winner is decided: sitting rounds out never costs you the win.
   * Going to watch drops your Ready (which may let the others' countdown start); coming back is not-ready, so it
   * pauses a countdown until you ready up again.
   */
  setWatching(playerId: string, watching: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (watching) {
      if (room.contenders?.includes(playerId)) return fail('MUST_PLAY'); // the tie-breaker can't go ahead without them
      room.watching.add(playerId);
    } else if (room.watching.has(playerId)) {
      if (this.activeCount(room) >= MAX_PLAYERS) return fail('ROOM_FULL'); // every playing slot is taken
      room.watching.delete(playerId);
    }
    room.ready.delete(playerId);
    this.reconcile(room);
    return ok(room);
  }

  setReady(playerId: string, ready: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.watching.has(playerId)) return fail('NOT_A_PLAYER'); // watchers don't ready up
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!room.sessionConfirmed) return fail('SESSION_NOT_STARTED');
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
    const now = Date.now();
    room.game = { engine, state: engine.init(this.participants(room), now), lastTickAt: now };
    return toState(room);
  }

  /** A phone sent an in-game action (e.g. a tap). Returns null if it was ignored entirely. */
  gameAction(playerId: string, action: GameAction): Outcome | null {
    const room = this.roomFor(playerId);
    if (!room || room.phase !== 'playing' || !room.game) return null;
    if (room.watching.has(playerId)) return null; // watchers can't act, whatever they send
    const now = Date.now();
    room.game.state = room.game.engine.reduce(room.game.state, playerId, action, now);
    // Some games end early (first to N); Tap Race just waits for its timer.
    if (room.game.engine.isOver(room.game.state, now)) return this.endRound(room);
    return { room: toState(room) };
  }

  /**
   * Advances every running round whose game has continuous movement (an engine with `tick`).
   * Called ~40 times a second. For each such room it reports either the fresh `view` to stream to
   * phones, or the `ended` outcome if the round just finished.
   */
  tick(now: number): { code: string; view?: GameView; ended?: Outcome }[] {
    const results: { code: string; view?: GameView; ended?: Outcome }[] = [];
    for (const room of this.rooms.values()) {
      const game = room.game;
      if (room.phase !== 'playing' || !game?.engine.tick) continue;
      // Real elapsed time, capped so a stalled server can't make balls teleport.
      const dt = Math.min(0.1, Math.max(0, (now - game.lastTickAt) / 1000));
      game.lastTickAt = now;
      game.state = game.engine.tick(game.state, dt, now);
      if (game.engine.isOver(game.state, now)) results.push({ code: room.code, ended: this.endRound(room) });
      else results.push({ code: room.code, view: game.engine.view(game.state) });
    }
    return results;
  }

  /** True while this room's round is driven by the tick loop (so it streams snapshots itself). */
  isTicking(code: string): boolean {
    return Boolean(this.rooms.get(code)?.game?.engine.tick);
  }

  /** Round timer fired. Same stale-timer guard as the countdown. */
  finishRound(code: string, expectedEndsAt: number): Outcome | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing' || !room.game) return null;
    if (room.game.engine.view(room.game.state).endsAt !== expectedEndsAt) return null;
    return this.endRound(room);
  }

  /** Finish sequence over: show the round summary screen. Same stale-timer guard as the countdown. */
  finishFinish(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'finish' || room.finishEndsAt !== expectedEndsAt) return null;
    room.phase = 'results';
    room.finishEndsAt = null;
    room.game = null;
    room.resultsEndsAt = Date.now() + this.resultsMs;
    return toState(room);
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
    room.sessionConfirmed = false; // a new session starts with the rounds question again
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
    // The result is decided NOW, but players first get the short "you won / you lost" sequence over the frozen game
    // (input is ignored in this phase). `game` stays so phones can keep drawing the final moment; the summary comes next.
    room.phase = 'finish';
    room.finishEndsAt = Date.now() + this.finishMs;
    room.resultsEndsAt = null;
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
    const pool = this.scorePool(room); // everyone counts here, watchers included
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
    room.contenders = leaders; // a tie: only these players play the tie-breaker...
    for (const id of leaders) room.watching.delete(id); // ...so a tied player who was watching is put back in (they can't skip it)
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
    room.finishEndsAt = null;
    room.resultsEndsAt = null;
    room.countdownEndsAt = null;
    room.ready.clear();
  }

  /** Who plays the next round: everyone who isn't watching, or only the tied contenders still present. */
  private participants(room: Room): string[] {
    const present = [...room.players.keys()].filter((id) => !room.watching.has(id));
    if (!room.contenders) return present;
    const inTie = present.filter((id) => room.contenders!.includes(id));
    return inTie.length > 0 ? inTie : present;
  }

  /** Who is in the running for the session win: EVERYONE present (watchers keep their points), or the tied contenders. */
  private scorePool(room: Room): string[] {
    const present = [...room.players.keys()];
    if (!room.contenders) return present;
    const inTie = present.filter((id) => room.contenders!.includes(id));
    return inTie.length > 0 ? inTie : present;
  }

  /** How many members are playing (not watching): these are the ones that use the MAX_PLAYERS slots. */
  private activeCount(room: Room): number {
    return room.players.size - room.watching.size;
  }

  private minPlayers(room: Room): number {
    return getGame(room.settings.gameId)?.minPlayers ?? 1;
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
    watchingIds: [...room.watching],
    settings: { ...room.settings },
    sessionConfirmed: room.sessionConfirmed,
    readyIds: [...room.ready],
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    scores: { ...room.wins },
    game: room.game ? room.game.engine.view(room.game.state) : null,
    result: room.result,
    roundsPlayed: room.roundsPlayed,
    contenders: room.contenders ? [...room.contenders] : null,
    sessionWinner: room.sessionWinner,
    finishEndsAt: room.finishEndsAt,
    resultsEndsAt: room.resultsEndsAt,
    serverTime: Date.now(), // stamped at send time; phones use it to correct for clock differences
  };
}
