import { shiftTimes } from './games/shiftTime';
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords';
import {
  PLAYER_COLORS, MIN_STAKE, UNDERDOG_MIN_PLAYERS, UNDERDOG_SECONDS,
  COUNTDOWN_SECONDS, FINISH_SECONDS, RANDOM_GAME, ROULETTE_SECONDS, GAME_INTRO_COUNT_SECONDS, GAME_INTRO_HOLD_SECONDS, ACTIVE_GAMES, GAMES, MAX_PLAYERS, MAX_SPECTATORS, RESULTS_SECONDS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  FLAKE_SECONDS, FROG_SECONDS, GOAT_SECONDS, PIRATE_SECONDS, SHELTER_SECONDS, PENGUIN_SECONDS, SANTA_SECONDS, SNOWBALL_SECONDS, REVEAL_LEAD_MS, STARTING_MAX_MS, STARTING_MS, TAP_RACE_SECONDS, TUG_SECONDS, getGame,
  DEFAULT_ROOM_NAME, MAX_ROOMS, ROOM_NAME_MAX, ROOM_PASSWORD_MAX, type RoomListing,
  type GameAction, type GameId, type GameView, type Player, type RoomError, type RoomPhase, type RoomSettings, type RoomState,
  type RoundResult, type Bet, type BetResult, type Underdog, TEAM_IDS, TEAM_NAMES, isTeamId, type TeamId,
} from '@fgn/shared';
import { createAdoptionDay } from './games/adoptionDay';
import { createFrogClimb } from './games/frogClimb';
import { createMountainGoat } from './games/mountainGoat';
import { createPenguinLasso } from './games/penguinLasso';
import { createPirateBroadside } from './games/pirateBroadside';
import { createRoachHunt } from './games/roachHunt';
import { createSantaSack } from './games/santaSack';
import { createFishing } from './games/fishing';
import { createSnowflakeMatch } from './games/snowflakeMatch';
import { createSnowball } from './games/snowball';
import { createTapRace } from './games/tapRace';
import { createTugOfWar } from './games/tugOfWar';
import type { GameEngine } from './games/types';

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>; // a Map keeps insertion order = join order
  colors: Map<string, string>; // each member's color (from PLAYER_COLORS), different for everyone; freed when they leave
  roster: Map<string, Player>; // EVERYONE who has joined this session, kept after they leave, so a departed player's wins can still crown them
  watching: Set<string>; // members (a subset of `players`) not in this round: no slot, no Ready, not in the game, but their wins still count. Every spectator is in here; a seat holder who joined mid-round is too, until the round is over
  spectators: Set<string>; // members with NO SEAT, in line order (a Set keeps insertion order): they only watch, and they are the only ones who bet. The seat count is players - spectators (at most MAX_PLAYERS)
  settings: RoomSettings;
  teams: Map<string, TeamId>; // every member's team (picked at random when they join; they may change it if the host allows)
  loneRound: boolean; // the teams were drawn for a one-against-all round and must be shuffled again afterwards
  loneTurns: Set<string>; // a one-against-all game: who has been the lone player since everyone last had a turn (so the turns go round fairly)
  bets: Record<string, Bet>; // spectators' bets on who wins the coming round (stakes are locked in when it starts)
  ready: Set<string>;
  phase: RoomPhase;
  name: string; // what the room is called in the list
  passwordHash: string | null; // a salted hash of the room's password, or null for none (the password itself is never kept)
  badGuesses: number[]; // when wrong passwords were tried on this room (to slow down guessing)
  countdownEndsAt: number | null;
  underdog: Underdog | null; // this round's underdog (decided when the countdown ends), if there is one
  underdogEndsAt: number | null; // when the underdog announcement ends
  offline: Set<string>; // players whose connection dropped: their seat is held (the server's timer removes them if they do not come back)
  roulette: { gameId: GameId; startsAt: number; endsAt: number } | null; // the Random tile's roulette step: the chosen game and when the spin ends
  teamCountdownEndsAt: number | null; // the team step: the host pressed Start and the countdown is running (they can cancel it)
  startingEndsAt: number | null; // when the MINIMUM time of the 'starting' (flash + loading) step is over (null once it has passed)
  startingDeadline: number | null; // the latest the 'starting' step can last: the round begins then even if some phone never reported it had loaded
  startingMinPassed: boolean; // the minimum time is over: from now on the round begins as soon as everyone has loaded
  loaded: Set<string>; // players whose phone reported (`player:loaded`) that the picked game is ready, this round
  wins: Record<string, number>; // rounds won this session, by player id (kept when a player leaves)
  sessionSaved: boolean; // this session's winner has already been handed out for saving (never save twice)
  // (playStartsAt: GO, when the start countdown ends and the round really begins.) Made when the 'starting' step begins, with a PROVISIONAL clock: phones build the game under the loading page meanwhile,
  // nothing moves and nobody can act, and when the step's wait is over (`beginPlay`) the whole state is moved so that GO is one reveal lead plus one intro from then.
  game: { engine: GameEngine; state: unknown; lastTickAt: number; playStartsAt: number } | null; // set while phase is 'starting', 'playing' or 'finish' (frozen in 'finish')
  revealAt: number | null; // when the loading page lifts on every phone (set when the round begins; see RoomState.revealAt)
  roundSeq: number; // counts the rounds this room has started (the screens' key: see RoomState.roundId)
  result: RoundResult | null; // set while phase is 'finish' or 'results'
  finishEndsAt: number | null; // when the "you won / you lost" sequence ends
  resultsEndsAt: number | null;
  roundsPlayed: number; // decided rounds
  sessionWinner: Player | null;
}

/** A decided round, for the caller to persist. Draws produce no record. */
export interface RoundRecord {
  roomCode: string;
  gameType: GameId;
  winner: Player;
}

/** A finished session, for the caller to persist. */
export interface SessionRecord {
  roomCode: string;
  winner: Player;
  winnerWins: number;
  roundsPlayed: number;
}

/** What a change produced: the new room state, plus records to persist if anything was decided. */
export interface Outcome {
  room: RoomState;
  round?: RoundRecord;
  rounds?: RoundRecord[]; // a TEAM game's round: one record for every member of the winning team
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
  private forceRandom: GameId | null;
  private countdownMs: number;
  private rouletteMs: number; // how long the Random tile's roulette step lasts (0 in tests that shorten the countdown, unless they ask)
  private resultsMs: number;
  private introMsOverride: number | undefined; // set by tests: the in-game start countdown lasts this long for every game
  private startingMs: number; // how long the flash step before every round lasts AT LEAST (0 = none)
  private startingMaxMs: number; // the most it can last while waiting for slow phones to load
  private finishMsOverride: number | undefined; // set by tests: every game's finish sequence lasts this long
  private engines: Record<GameId, GameEngine>;

  /** Durations are injectable so tests can run fast. */
  constructor(options: { countdownMs?: number; roundMs?: number; snowballMs?: number; resultsMs?: number; finishMs?: number; startingMs?: number; startingMaxMs?: number; introMs?: number; rouletteMs?: number; forceRandom?: GameId | null } = {}) {
    this.forceRandom = options.forceRandom ?? null; // (only tests use this: it makes the Random tile land on one game, even a team game)
    this.countdownMs = options.countdownMs ?? COUNTDOWN_SECONDS * 1000;
    this.rouletteMs = options.rouletteMs ?? (options.countdownMs !== undefined ? 0 : ROULETTE_SECONDS * 1000);
    this.resultsMs = options.resultsMs ?? RESULTS_SECONDS * 1000;
    // The flash step lasts STARTING_MS, except in tests: a test that shortens the countdown wants fast rounds too, so it gets no flash step unless it asks for one.
    this.startingMs = options.startingMs ?? (options.countdownMs !== undefined ? 0 : STARTING_MS);
    this.startingMaxMs = options.startingMaxMs ?? STARTING_MAX_MS;
    // The in-game start countdown (GAME_INTRO_SECONDS, or the game's own): none in tests that shorten the countdown, unless they ask for one.
    this.introMsOverride = options.introMs ?? (options.countdownMs !== undefined ? 0 : undefined);
    this.finishMsOverride = options.finishMs;
    this.engines = {
      'pirate-broadside': createPirateBroadside({ durationMs: options.snowballMs ?? PIRATE_SECONDS * 1000 }),
      'roach-hunt': createRoachHunt({ durationMs: options.snowballMs }),
      'adoption-day': createAdoptionDay({ durationMs: options.snowballMs ?? SHELTER_SECONDS * 1000 }),
      'frog-climb': createFrogClimb({ durationMs: options.snowballMs ?? FROG_SECONDS * 1000 }),
      'mountain-goat': createMountainGoat({ durationMs: options.snowballMs ?? GOAT_SECONDS * 1000 }),
      'snowflake-match': createSnowflakeMatch({ durationMs: options.snowballMs ?? FLAKE_SECONDS * 1000 }),
      'tap-race': createTapRace(options.roundMs ?? TAP_RACE_SECONDS * 1000),
      'tug-of-war': createTugOfWar(options.roundMs ?? TUG_SECONDS * 1000),
      snowball: createSnowball({ durationMs: options.snowballMs ?? SNOWBALL_SECONDS * 1000 }),
      'santa-sack': createSantaSack({ durationMs: options.snowballMs ?? SANTA_SECONDS * 1000 }),
      'penguin-lasso': createPenguinLasso({ durationMs: options.snowballMs ?? PENGUIN_SECONDS * 1000 }),
      // (tests shorten the rise and the cast the same way they shorten the other games' rounds)
      fishing: createFishing(options.snowballMs !== undefined ? { ascentMs: options.snowballMs, castMs: Math.min(1000, options.snowballMs / 4) } : {}),
    };
  }

  create(host: Player, options: { name?: unknown; password?: unknown } = {}): Result {
    if (this.roomOfPlayer.has(host.id)) return fail('ALREADY_IN_ROOM');
    if (this.rooms.size >= MAX_ROOMS) return fail('TOO_MANY_ROOMS');
    const password = cleanPassword(options.password);
    if (password === false) return fail('INVALID_SETTING');
    const room: Room = {
      code: this.newCode(),
      name: cleanName(options.name),
      passwordHash: password ? hashPassword(password) : null,
      badGuesses: [],
      hostId: host.id,
      players: new Map([[host.id, host]]),
      colors: new Map([[host.id, PLAYER_COLORS[0]]]), // the host gets the first color
      roster: new Map([[host.id, host]]),
      watching: new Set(),
      spectators: new Set(),
      settings: { gameId: null, random: true, teamSwap: false },
      teams: new Map(),
      loneTurns: new Set(),
      loneRound: false,
      bets: {},
      ready: new Set(),
      phase: 'lobby',
      countdownEndsAt: null,
      underdog: null,
      underdogEndsAt: null,
      offline: new Set(),
      roulette: null,
      teamCountdownEndsAt: null,
      startingEndsAt: null,
      startingDeadline: null,
      startingMinPassed: false,
      loaded: new Set(),
      wins: {},
      sessionSaved: false,
      game: null,
      roundSeq: 0,
      revealAt: null,
      result: null,
      finishEndsAt: null,
      resultsEndsAt: null,
      roundsPlayed: 0,
      sessionWinner: null,
    };
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(host.id, room.code);
    this.assignTeam(room, host.id);
    return ok(room);
  }

  /**
   * Anyone can join (until the room holds MAX_PLAYERS seats + MAX_SPECTATORS spectators). A free seat is taken by the next person to join; with
   * no free seat they are a spectator (see `spectators`). Nobody can move from spectator to player on their own: a spectator gets a seat only
   * when one opens up (someone leaves, or gives theirs up: see `promoteSeats`, `setWatching`). Someone arriving mid-round with a free seat
   * watches the rest of that round (the finish sequence still belongs to the round) and plays from the next. `asSpectator` is a choice
   * that can only be made HERE, on joining: the newcomer takes no seat and waits in line like anyone else (there is no switching later).
   */
  join(rawCode: string, player: Player, password?: unknown, asSpectator = false): Result {
    if (this.roomOfPlayer.has(player.id)) return fail('ALREADY_IN_ROOM');
    const room = this.rooms.get(rawCode.trim().toUpperCase()); // codes are case-insensitive
    if (!room) return fail('ROOM_NOT_FOUND');
    if (room.players.size >= MAX_PLAYERS + MAX_SPECTATORS) return fail('ROOM_FULL');
    if (room.passwordHash) {
      // Whoever is guessing, only so many wrong guesses are allowed against one room in a minute (on top of the per-connection limit in sockets.ts).
      const now = Date.now();
      room.badGuesses = room.badGuesses.filter((t) => now - t < 60_000);
      if (room.badGuesses.length >= 12) return fail('TOO_MANY_ATTEMPTS');
      if (typeof password !== 'string' || password.length > ROOM_PASSWORD_MAX || !verifyPassword(password, room.passwordHash)) {
        room.badGuesses.push(now);
        return fail('WRONG_PASSWORD');
      }
    }
    const midRound = room.phase === 'teams' || room.phase === 'roulette' || room.phase === 'underdog' || room.phase === 'starting' || room.phase === 'playing' || room.phase === 'finish';
    if (asSpectator || this.seatsTaken(room) >= MAX_PLAYERS) { room.spectators.add(player.id); room.watching.add(player.id); } // (they chose to only watch, or no seat is free: a spectator, at the back of the line)
    else if (midRound) room.watching.add(player.id); // (a seat, but the round is already running: they watch the rest of it and play from the next one)
    room.players.set(player.id, player);
    room.roster.set(player.id, player);
    room.colors.set(player.id, this.freeColor(room)); // everyone starts with a color nobody has; they can change it
    this.roomOfPlayer.set(player.id, room.code);
    this.assignTeam(room, player.id);
    this.reconcile(room); // the newcomer isn't ready, so a running countdown is cancelled
    return ok(room);
  }

  /**
   * The rooms anyone can try to join, for the list. Only public things go in it: never the password, only whether there is one. Rooms that are
   * open to joining come first, then full ones; within each, the oldest first.
   */
  list(): RoomListing[] {
    const listings = [...this.rooms.values()].map((room): RoomListing => ({
      code: room.code,
      name: room.name,
      hasPassword: room.passwordHash !== null,
      hostName: room.players.get(room.hostId)?.name ?? '',
      members: room.players.size,
      capacity: MAX_PLAYERS + MAX_SPECTATORS,
      full: room.players.size >= MAX_PLAYERS + MAX_SPECTATORS,
      gameName: getGame(room.settings.gameId)?.name ?? null,
      phase: room.phase,
    }));
    return listings.sort((a, b) => Number(a.full) - Number(b.full)).slice(0, 100);
  }

  /** Removes a player. `room` is null if the room is now empty and deleted. */
  leave(playerId: string): { code: string; room: RoomState | null; session?: SessionRecord } | null {
    const code = this.roomOfPlayer.get(playerId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!code || !room) return null;

    const wasFull = this.seatsTaken(room) >= MAX_PLAYERS; // (a seat only opens for the line if every seat was taken: free seats are for newcomers)
    room.players.delete(playerId);
    room.watching.delete(playerId);
    room.spectators.delete(playerId);
    room.ready.delete(playerId);
    delete room.bets[playerId]; // a leaver's bet is void
    room.colors.delete(playerId); // their color is free for someone else
    // NOTE: their wins (and roster entry) stay, so they can still be named the session winner.
    this.roomOfPlayer.delete(playerId);

    if (room.players.size === 0) {
      // Nobody is left: the room closes. If the host never ended the session properly, save its winner now.
      const session = this.saveWinner(room);
      this.rooms.delete(code);
      return { code, room: null, session };
    }
    // Host left: promote whoever has been here longest (first in the Map), so the room always has a host.
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value!;

    room.offline.delete(playerId);
    room.teams.delete(playerId);
    if (wasFull) this.promoteSeats(room); // (their seat, if they had one, goes to whoever has waited longest)
    if (room.underdog?.playerId === playerId) room.underdog = null; // the underdog left: there is nobody to win the bonus
    // Between the countdown and the start (the underdog announcement, the flash): too few players left means the round is called off.
    if ((room.phase === 'teams' || room.phase === 'roulette' || room.phase === 'underdog' || room.phase === 'starting') && (this.participants(room).length < this.minPlayers(room) || (this.isTeamGame(room) && !this.teamsFilled(room)))) this.abortRound(room);
    // Mid-round (or while the round is being loaded): the leaver forfeits. If too few players remain for the game, call the round off.
    if ((room.phase === 'playing' || room.phase === 'starting') && room.game) {
      room.game.state = room.game.engine.removePlayer(room.game.state, playerId);
      if (this.participants(room).length < this.minPlayers(room) || (this.isTeamGame(room) && !this.teamsFilled(room))) this.abortRound(room); // (a team with nobody left in it ends the round too)
    }
    this.reconcile(room);
    return { code, room: toState(room) };
  }

  /**
   * Host ends the session (from the lobby): the player with the most wins, counting everyone who ever played
   * (even people who have since left), is crowned and saved. The room stays open on the winner screen.
   */
  endSession(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'lobby') return fail('WRONG_PHASE'); // not mid-round or mid-countdown
    const session = this.saveWinner(room);
    room.phase = 'session-over';
    room.ready.clear();
    room.countdownEndsAt = null;
    return { ok: true, room: toState(room), session };
  }

  /** The host picks the game (any time between rounds). A real change resets everyone's Ready. */
  setSettings(playerId: string, change: { gameId?: string | null; teamSwap?: unknown; name?: unknown; password?: unknown }): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    const teamStep = room.phase === 'teams'; // (the team step lets the host change only team swapping)
    if (room.phase !== 'lobby' && room.phase !== 'countdown' && !teamStep) return fail('WRONG_PHASE');
    if (teamStep && (change.gameId !== undefined || change.name !== undefined || change.password !== undefined)) return fail('WRONG_PHASE');

    if (change.teamSwap !== undefined) { // (team games: may players choose their team?)
      if (typeof change.teamSwap !== 'boolean') return fail('INVALID_SETTING');
      room.settings = { ...room.settings, teamSwap: change.teamSwap };
      if (teamStep) room.teamCountdownEndsAt = null;
    }
    // The room's name and password. (An empty name goes back to the default; an empty password, or null, removes it.)
    if (change.name !== undefined) room.name = cleanName(change.name);
    if (change.password !== undefined) {
      const password = change.password === null ? '' : cleanPassword(change.password);
      if (password === false) return fail('INVALID_SETTING');
      room.passwordHash = password ? hashPassword(password) : null;
      room.badGuesses = [];
    }
    if (change.gameId !== undefined) {
      if (change.gameId === RANDOM_GAME) {
        // The Random tile: no game is chosen yet. Once everyone is ready and the countdown ends, the server picks one and everyone watches the roulette (see finishCountdown).
        if (!room.settings.random || room.settings.gameId !== null) {
          room.settings = { ...room.settings, gameId: null, random: true };
          room.ready.clear(); this.reconcile(room);
        }
      } else {
        if (!GAMES.some((g) => g.id === change.gameId)) return fail('INVALID_SETTING');
        const changed = change.gameId !== room.settings.gameId;
        room.settings = { ...room.settings, gameId: change.gameId as GameId, random: false };
        if (changed) {
          room.ready.clear(); // everyone must agree to the NEW game
          this.reconcile(room); // cancels a countdown, since nobody is ready any more
        }
      }
    }
    return ok(room);
  }

  /**
   * Give up your seat (lobby/countdown only, so a round is never disturbed). You become a spectator at the BACK of the line: you can watch and bet,
   * and you only get a seat again when one opens up and you are the one who has waited longest. There is no way back on your own: asking to play
   * (`watching` false) as a spectator is refused. Your points stay yours either way, and spectators still count when the session winner is decided.
   * Giving up your seat drops your Ready (which may let the others' countdown start). If the room was full, the seat goes to the earliest waiting
   * spectator; if there was already a free seat, it stays free for the next person to join (it never just comes back to you).
   */
  setWatching(playerId: string, watching: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!watching) return room.spectators.has(playerId) ? fail('NO_SEAT') : ok(room); // (a spectator cannot choose to play; a seat holder is playing already)
    if (room.spectators.has(playerId)) return ok(room); // (already a spectator)
    const wasFull = this.seatsTaken(room) >= MAX_PLAYERS;
    room.spectators.add(playerId); // (the back of the line)
    room.watching.add(playerId);
    room.ready.delete(playerId);
    delete room.bets[playerId];
    if (wasFull) this.promoteSeats(room, playerId); // (with free seats already, nobody was waiting for this one: it is for the next newcomer)
    this.reconcile(room);
    return ok(room);
  }

  /** How many seats are taken: everyone who is not a spectator. */
  private seatsTaken(room: Room): number {
    return room.players.size - room.spectators.size;
  }

  /**
   * Fill free seats from the front of the line, automatically (the earliest spectator first). `skipId` is someone who has just given up a seat, who
   * must not get it straight back. A new seat holder is not ready and has no bet (they are a player now); if a round is running they watch the rest of it.
   */
  private promoteSeats(room: Room, skipId?: string) {
    while (this.seatsTaken(room) < MAX_PLAYERS) {
      const next = [...room.spectators].find((id) => id !== skipId);
      if (!next) break;
      room.spectators.delete(next);
      if (room.phase === 'lobby' || room.phase === 'countdown') room.watching.delete(next); // (between rounds: they play the next one; mid-round: they watch this one out)
      room.ready.delete(next);
      delete room.bets[next];
    }
  }

  /**
   * Pick your color: one of PLAYER_COLORS that nobody else in the room has. It is your color in every game (colors are not chosen
   * per round any more). Lobby/countdown only, so it never changes under a round that is running.
   */
  setColor(playerId: string, color: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!(PLAYER_COLORS as readonly string[]).includes(color)) return fail('INVALID_COLOR');
    for (const [id, taken] of room.colors) if (taken === color && id !== playerId) return fail('COLOR_TAKEN');
    room.colors.set(playerId, color);
    return ok(room);
  }

  /** The first color in the list that nobody in the room has (a room never holds more people than there are colors). */
  private freeColor(room: Room): string {
    const used = new Set(room.colors.values());
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }

  /**
   * A spectator bets on a player to win the coming round, optionally putting up `stake` of their own victory points on top.
   * Lobby/countdown only. Changing a bet drops your Ready (you ready up again with the bet you want), which may cancel a
   * countdown. `targetId` null takes the bet back.
   */
  setBet(playerId: string, targetId: string | null, stake: number): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (!room.spectators.has(playerId)) return fail('NOT_A_SPECTATOR'); // only spectators (people with no seat) bet; seat holders play (or wait for the next round)
    if (room.phase !== 'lobby' && room.phase !== 'countdown' && room.phase !== 'teams') return fail('WRONG_PHASE');
    if (targetId === null) {
      delete room.bets[playerId];
    } else {
      if (!this.betTargetOk(room, targetId)) return fail('INVALID_BET'); // must be someone who is playing (in a team game: a team with a player in it)
      // A stake is whole points, no more than you have, and either nothing (a free bet) or at least MIN_STAKE.
      if (!Number.isInteger(stake) || stake < 0 || stake > this.points(room, playerId) || (stake > 0 && stake < MIN_STAKE)) return fail('INVALID_BET');
      room.bets[playerId] = { targetId, stake };
    }
    if (room.phase !== 'teams') { room.ready.delete(playerId); this.reconcile(room); } else room.teamCountdownEndsAt = null;
    return ok(room);
  }

  /**
   * A player's connection dropped (a refresh, a bad signal): they are NOT removed. Their seat, color, bets and score are held (the server removes them with `leave` if they have not
   * come back after the grace period). Meanwhile: they are no longer ready (so a countdown they were holding up is cancelled), and in a round their character stands still (their steering
   * and sprint are let go) while the round carries on for everyone else. The host stays host until they actually leave.
   */
  setOffline(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    room.offline.add(playerId);
    room.ready.delete(playerId);
    if (room.phase === 'playing' && room.game) { // (let go of the controls: no one should keep skating on their last steer)
      this.gameAction(playerId, { type: 'steer', x: 0, z: 0 });
      this.gameAction(playerId, { type: 'sprint', on: false });
    }
    this.reconcile(room);
    return ok(room);
  }

  /** Team games: a player picks their team (only while the host allows swapping). Changing teams drops everyone's Ready: the teams everyone agreed to have changed. */
  setTeam(playerId: string, team: unknown): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown' && room.phase !== 'teams') return fail('WRONG_PHASE');
    if (!this.isTeamGame(room)) return fail('NOT_A_TEAM_GAME');
    if (!isTeamId(team)) return fail('INVALID_SETTING');
    if (!room.settings.teamSwap || this.isLoneGame(room)) return fail('TEAMS_LOCKED'); // (a one-against-all game draws its sides itself)
    if (room.teams.get(playerId) === team) return ok(room);
    room.teams.set(playerId, team);
    if (room.phase !== 'teams') { room.ready.clear(); this.reconcile(room); } // (a countdown is cancelled: nobody is ready any more; the team step has no Ready)
    else room.teamCountdownEndsAt = null; // (in the team step a change cancels its start countdown)
    return ok(room);
  }

  /** The player is back (their new connection asks to be put back in their room): the seat is theirs again. */
  rejoin(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    room.offline.delete(playerId);
    return ok(room);
  }

  isOffline(playerId: string): boolean {
    return this.roomFor(playerId)?.offline.has(playerId) ?? false;
  }

  setReady(playerId: string, ready: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('WRONG_PHASE');
    if (!room.settings.gameId && !room.settings.random) return fail('NO_GAME_SELECTED'); // (the Random tile counts: the game is chosen when everyone is ready)

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
    room.countdownEndsAt = null;
    this.lockStakes(room);
    // The Random tile: the server picks the game now (one that can be played with this many players), and everyone watches the roulette spin onto it.
    if (room.settings.random) {
      const pool = this.randomPool(room);
      const picked = pool[Math.floor(Math.random() * pool.length)].id as GameId;
      room.settings = { ...room.settings, gameId: picked };
      if (this.rouletteMs > 0) {
        room.phase = 'roulette';
        const startsAt = Date.now();
        room.roulette = { gameId: picked, startsAt, endsAt: startsAt + this.rouletteMs };
        return toState(room);
      }
      if (this.isTeamGame(room)) { this.toTeamStep(room); return toState(room); }
    }
    this.afterPicking(room);
    return toState(room);
  }

  /**
   * The Random tile landed on a TEAM game: the round PAUSES in its own step (phase 'teams') so the players can manage the teams (no Ready step: the HOST starts it). Bets placed before the game was
   * known were on players, so they are cleared; spectators bet on a team in this step.
   */
  private toTeamStep(room: Room) {
    room.phase = 'teams';
    room.bets = {};
    room.ready.clear();
  }

  /**
   * Host only, in the team step: the teams are set, start the round. Each team needs a player. A simple countdown runs first (the host may cancel it, and any change to the teams or bets
   * cancels it too, like a change in the lobby cancels the ready countdown); with no countdown configured (the tests) it starts at once.
   */
  startFromTeams(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'teams') return fail('WRONG_PHASE');
    if (!this.teamsFilled(room) || this.participants(room).length < this.minPlayers(room)) return fail('TEAMS_NOT_FILLED');
    if (room.teamCountdownEndsAt !== null) return ok(room); // (already counting down)
    if (this.countdownMs <= 0) { this.lockStakes(room); this.afterPicking(room); return ok(room); }
    room.teamCountdownEndsAt = Date.now() + this.countdownMs;
    return ok(room);
  }

  /** The host cancels the team step's countdown (back to managing the teams). */
  cancelTeamStart(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'teams') return fail('WRONG_PHASE');
    room.teamCountdownEndsAt = null;
    return ok(room);
  }

  /** The team step's countdown ended: the round starts. Same stale-timer guard as the other countdowns. */
  finishTeamCountdown(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'teams' || room.teamCountdownEndsAt !== expectedEndsAt) return null;
    room.teamCountdownEndsAt = null;
    if (!this.teamsFilled(room)) return toState(room); // (a team emptied just now: stay in the step)
    this.lockStakes(room);
    this.afterPicking(room);
    return toState(room);
  }

  /** The stakes are locked in (never more than a bettor has; a stake below the minimum is just a free bet). */
  private lockStakes(room: Room) {
    for (const [id, bet] of Object.entries(room.bets)) {
      bet.stake = Math.min(bet.stake, this.points(room, id));
      if (bet.stake < MIN_STAKE) bet.stake = 0;
    }
  }

  /** The games a Random pick may land on: every game this many players can play. */
  private randomPool(room: Room) {
    const n = this.participants(room).length;
    if (this.forceRandom) { const forced = GAMES.filter((g) => g.id === this.forceRandom); if (forced.length) return forced; } // (tests only)
    const pool = ACTIVE_GAMES.filter((g) => !getGame(g.id)?.teams && n >= g.minPlayers && n <= g.maxPlayers); // (the Random tile never picks a team game, or an archived one)
    return pool.length > 0 ? pool : ACTIVE_GAMES;
  }

  /** The roulette is over: carry on as a normal start. Same stale-timer guard as the countdown. */
  finishRoulette(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'roulette' || room.roulette?.endsAt !== expectedEndsAt) return null;
    room.roulette = null;
    if (this.isTeamGame(room)) this.toTeamStep(room);
    else this.afterPicking(room);
    return toState(room);
  }

  /** The game is known (picked by the host, or by the roulette): is there an underdog? If so, everyone is shown them for a few seconds; then the flash step and the round. */
  private afterPicking(room: Room) {
    room.underdog = this.findUnderdog(room);
    if (room.underdog) {
      room.phase = 'underdog';
      room.underdogEndsAt = Date.now() + UNDERDOG_SECONDS * 1000;
      return;
    }
    this.beginStarting(room);
  }

  /** The underdog announcement is over: the flash step begins. Same stale-timer guard as the countdown. */
  finishUnderdog(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'underdog' || room.underdogEndsAt !== expectedEndsAt) return null;
    room.underdogEndsAt = null;
    this.beginStarting(room);
    return toState(room);
  }

  /**
   * The flash step (see START_FLASH_* in config.ts), which is also the LOADING step (GAME_RULES.md #8). Phones flash and fade to a loading page, and the round is CREATED now, with a provisional
   * clock (its GO the latest it could be), so every phone gets the real game and builds it on its own screen under the page. The step lasts at least `startingMs`, then until every phone has
   * reported (`setLoaded`) that the game is on its screen and drawing smoothly, but never longer than `startingMaxMs` (a stuck phone cannot hold the room). Then `beginPlay` sets the real clock.
   * With no flash time configured (the tests turn it off) the round simply starts.
   */
  private beginStarting(room: Room) {
    if (this.startingMs <= 0) { this.createRound(room, Date.now() + this.introMsFor(room)); room.phase = 'playing'; room.revealAt = Date.now(); return; }
    const now = Date.now();
    room.phase = 'starting';
    room.startingEndsAt = now + this.startingMs;
    room.startingDeadline = now + Math.max(this.startingMs, this.startingMaxMs);
    room.startingMinPassed = false;
    room.loaded.clear();
    this.createRound(room, room.startingDeadline + REVEAL_LEAD_MS + this.introMsFor(room)); // (provisional: moved forward by `beginPlay`)
  }

  /** The minimum time of the flash step is over. The round begins now if everyone has loaded; otherwise it waits (for `setLoaded`, or for the deadline). Returns the new state only if the round began. Same stale-timer guard as the countdown. */
  finishStarting(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'starting' || room.startingEndsAt !== expectedEndsAt) return null;
    room.startingEndsAt = null;
    room.startingMinPassed = true;
    return this.startIfLoaded(room) ? toState(room) : null;
  }

  /** The safety net: the deadline passed with some phone still not ready, so the round begins anyway. Same stale-timer guard. */
  forceStarting(code: string, expectedDeadline: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'starting' || room.startingDeadline !== expectedDeadline) return null;
    this.beginPlay(room);
    return toState(room);
  }

  /** A phone reports that the round's game is on its screen and drawing smoothly. Anyone in the room may report (spectators build the game too); a report outside the 'starting' step is simply refused. */
  setLoaded(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'starting') return fail('WRONG_PHASE');
    room.loaded.add(playerId);
    this.startIfLoaded(room);
    return ok(room);
  }

  /** Once the minimum time is over, the round begins as soon as everyone still connected has reported (returns true if it just began). (Someone whose connection dropped is not waited for.) */
  private startIfLoaded(room: Room): boolean {
    if (room.phase !== 'starting' || !room.startingMinPassed) return false;
    if (![...room.players.keys()].every((id) => room.offline.has(id) || room.loaded.has(id))) return false;
    this.beginPlay(room);
    return true;
  }

  private clearStarting(room: Room) {
    room.startingEndsAt = null;
    room.startingDeadline = null;
    room.startingMinPassed = false;
    room.loaded.clear();
  }

  /** How long the in-game start lasts for this room's game: the still buffer, then the 3, 2, 1 (or the game's own opening). */
  private introMsFor(room: Room): number {
    return this.introMsOverride ?? (GAME_INTRO_HOLD_SECONDS + (getGame(room.settings.gameId)?.introSeconds ?? GAME_INTRO_COUNT_SECONDS)) * 1000; // (every game gets the static buffer; then the usual 3, 2, 1, or none for a game with its own opening)
  }

  /** Makes the round's game, with its GO (the moment the round's own clock starts: every time in the engine's state counts from it) at `playStartsAt`. The lone player, if any, is drawn now. */
  private createRound(room: Room, playStartsAt: number) {
    const engine = this.engines[room.settings.gameId!];
    room.countdownEndsAt = null;
    room.underdogEndsAt = null;
    if (this.isLoneGame(room)) this.pickLone(room);
    room.roundSeq++;
    room.game = { engine, state: engine.init(this.participants(room), playStartsAt, { teams: Object.fromEntries(room.teams) }), lastTickAt: playStartsAt, playStartsAt };
  }

  /**
   * The wait is over: the round begins. ONE moment is announced to every phone, `revealAt` (REVEAL_LEAD_MS from now, so the message is there before it), when each phone lifts its loading page
   * by the server's clock; GO is one intro after it. The game was made with a provisional clock, so its whole state is moved in time to match (exactly as if it had been made now).
   */
  private beginPlay(room: Room) {
    const game = room.game;
    if (room.phase !== 'starting' || !game) return;
    const revealAt = Date.now() + REVEAL_LEAD_MS;
    const playStartsAt = revealAt + this.introMsFor(room);
    game.state = shiftTimes(game.state, playStartsAt - game.playStartsAt);
    game.playStartsAt = playStartsAt;
    game.lastTickAt = playStartsAt;
    room.phase = 'playing';
    room.revealAt = revealAt;
    this.clearStarting(room);
  }

  /** A phone sent an in-game action (e.g. a tap). Returns null if it was ignored entirely. */
  gameAction(playerId: string, action: GameAction): Outcome | null {
    const room = this.roomFor(playerId);
    if (!room || room.phase !== 'playing' || !room.game) return null;
    if (room.watching.has(playerId)) return null; // watchers can't act, whatever they send
    const now = Date.now();
    if (now < room.game.playStartsAt) return null; // the start countdown is still running: no one can act yet
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
      if (room.phase !== 'playing' || !game?.engine.tick || now < game.playStartsAt) continue; // (nothing moves during the start countdown)
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
    if (room.phase === 'playing' || room.phase === 'teams' || room.phase === 'roulette' || room.phase === 'underdog' || room.phase === 'starting') {
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
    room.sessionWinner = null;
    room.sessionSaved = false;
    room.roster = new Map(room.players); // the new session starts with whoever is here now
    this.toLobby(room);
    return ok(room);
  }

  /** Host closes the room. Returns the code so the caller can disband the Socket.io group. */
  close(playerId: string): { ok: true; code: string; session?: SessionRecord } | { ok: false; error: RoomError } {
    const room = this.roomFor(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.phase !== 'lobby' && room.phase !== 'session-over') return { ok: false, error: 'WRONG_PHASE' };
    const session = this.saveWinner(room); // closing straight from the lobby still saves the session
    for (const id of room.players.keys()) this.roomOfPlayer.delete(id);
    this.rooms.delete(room.code);
    return { ok: true, code: room.code, session };
  }

  // ---------- internals ----------

  private endRound(room: Room): Outcome {
    const { engine, state } = room.game!;
    const scores = engine.scores(state);
    if (this.isTeamGame(room)) return this.endTeamRound(room, scores);
    let winnerId = engine.getWinner(state);
    // A draw: nobody won... unless the underdog is among the players tied for first, in which case the underdog wins it.
    let byDraw = false;
    if (winnerId === null && room.underdog && room.players.has(room.underdog.playerId)) {
      const top = Math.max(...Object.values(scores));
      const tied = Object.keys(scores).filter((id) => scores[id] === top);
      if (tied.length >= 2 && tied.includes(room.underdog.playerId)) { winnerId = room.underdog.playerId; byDraw = true; }
    }
    room.roundsPlayed++; // every round counts, draws included (nobody is forced to replay: the players can just pick the game again)
    if (winnerId) room.wins[winnerId] = (room.wins[winnerId] ?? 0) + 1;
    // The underdog collects their bonus whenever they win (outright or by the draw), on top of the usual point.
    let underdog: RoundResult['underdog'] = null;
    if (winnerId && room.underdog && winnerId === room.underdog.playerId) {
      room.wins[winnerId] += room.underdog.bonus;
      underdog = { ...room.underdog, byDraw };
    }
    const winner = winnerId ? (room.players.get(winnerId) ?? null) : null;
    const bets = this.settleBets(room, winnerId);
    room.underdog = null;
    room.result = { winnerId, winner, scores, team: null, bets, winningBettors: bets.filter((b) => b.delta > 0).map((b) => ({ bettorId: b.bettorId, delta: b.delta })), underdog };
    // The result is decided NOW, but players first get the short winner sequence over the frozen game
    // (input is ignored in this phase). `game` stays so phones can keep drawing the final moment; the summary comes next.
    room.phase = 'finish';
    room.finishEndsAt = Date.now() + this.finishMsFor(room);
    room.resultsEndsAt = null;
    return {
      room: toState(room),
      round: winner ? { roomCode: room.code, gameType: room.settings.gameId!, winner } : undefined,
    };
  }

  /**
   * The end of a TEAM game's round (GAME_RULES.md #17): each team's total is the sum of its players' scores; the higher total wins (equal = a draw), and EVERY member of the
   * winning team gets a victory point. There is no underdog; bets were on a team. One database record is made for each winning member.
   */
  private endTeamRound(room: Room, scores: Record<string, number>): Outcome {
    const members = this.teamMembers(room);
    const totals = { yellow: 0, purple: 0 };
    for (const t of TEAM_IDS) for (const id of members[t]) totals[t] += scores[id] ?? 0;
    const winnerTeam: TeamId | null = totals.yellow > totals.purple ? 'yellow' : totals.purple > totals.yellow ? 'purple' : null;
    room.roundsPlayed++;
    const winners = winnerTeam ? members[winnerTeam] : [];
    for (const id of winners) room.wins[id] = (room.wins[id] ?? 0) + 1;
    const bets = this.settleBets(room, winnerTeam, true);
    room.underdog = null;
    room.result = {
      winnerId: null, winner: null, scores, team: { winner: winnerTeam, totals, members, names: { ...(getGame(room.settings.gameId)?.teamNames ?? TEAM_NAMES) } }, bets,
      winningBettors: bets.filter((b) => b.delta > 0).map((b) => ({ bettorId: b.bettorId, delta: b.delta })), underdog: null,
    };
    room.phase = 'finish';
    room.finishEndsAt = Date.now() + this.finishMsFor(room);
    room.resultsEndsAt = null;
    const rounds = winners.map((id) => room.players.get(id)).filter((p): p is Player => Boolean(p)).map((winner) => ({ roomCode: room.code, gameType: room.settings.gameId!, winner }));
    return { room: toState(room), rounds };
  }

  /** Leaves the results screen: back to the lobby for the next round. The session carries on until the host ends it. */
  private advanceAfterResults(room: Room): Outcome {
    this.toLobby(room);
    return { room: toState(room) };
  }

  /**
   * Crowns the session's winner: whoever has the most wins among EVERYONE who played this session, including players
   * who have left. A tie goes to whoever joined first. Returns the record to persist (once per session), or nothing
   * if nobody won a round.
   */
  private saveWinner(room: Room): SessionRecord | undefined {
    if (room.sessionSaved) return undefined;
    let winner: Player | null = null;
    let best = 0;
    for (const [id, player] of room.roster) {
      const wins = room.wins[id] ?? 0;
      if (wins > best) { best = wins; winner = player; }
    }
    room.sessionSaved = true;
    room.sessionWinner = winner;
    if (!winner) return undefined;
    return { roomCode: room.code, winner, winnerWins: best, roundsPlayed: room.roundsPlayed };
  }

  private abortRound(room: Room) {
    this.toLobby(room);
    this.reconcile(room);
  }

  private toLobby(room: Room) {
    room.phase = 'lobby';
    if (room.loneRound) { // the one-against-all sides were for that round only: shuffle everyone onto balanced random teams again for the next team game
      room.loneRound = false;
      room.teams.clear();
      for (const id of room.players.keys()) this.assignTeam(room, id);
    }
    for (const id of [...room.watching]) if (!room.spectators.has(id)) room.watching.delete(id); // (a seat holder who sat this round out, or got a seat during it, plays the next)
    room.game = null;
    room.result = null;
    room.finishEndsAt = null;
    room.resultsEndsAt = null;
    room.countdownEndsAt = null;
    room.bets = {}; // bets are for one round only
    room.underdog = null;
    room.underdogEndsAt = null;
    this.clearStarting(room);
    room.revealAt = null;
    room.roulette = null;
    room.teamCountdownEndsAt = null;
    if (room.settings.random) room.settings = { ...room.settings, gameId: null }; // (the Random tile stays chosen: the next round rolls again)
    room.ready.clear();
  }

  /** How long this room's end-of-round sequence lasts: the game's own length if it has one (Tap Race), else the usual one. */
  private finishMsFor(room: Room): number {
    return this.finishMsOverride ?? (getGame(room.settings.gameId)?.finishSeconds ?? FINISH_SECONDS) * 1000;
  }

  /** Who plays the next round: everyone who isn't watching. */
  /** A new member gets a random team, but the smaller one if the teams are uneven (the first members are shared out evenly; after that people may swap, if the host allows). */
  private assignTeam(room: Room, playerId: string) {
    const count = (t: TeamId) => this.participants(room).filter((id) => id !== playerId && room.teams.get(id) === t).length;
    const [a, b] = [count('yellow'), count('purple')];
    room.teams.set(playerId, a < b ? 'yellow' : b < a ? 'purple' : TEAM_IDS[randomInt(2)]);
  }

  /** The players (not watchers) on each team. */
  private teamMembers(room: Room): Record<TeamId, string[]> {
    const members: Record<TeamId, string[]> = { yellow: [], purple: [] };
    for (const id of this.participants(room)) { const t = room.teams.get(id); if (t) members[t].push(id); }
    return members;
  }

  /** A one-against-all game (Roach Rumble): each round one random player is the lone team (purple) and everyone else is the other (yellow). */
  private isLoneGame(room: Room): boolean {
    return getGame(room.settings.gameId)?.lone === true;
  }

  /** Has this round's lone player been picked yet? (When the round is made, at the start of the 'starting' step; before that, any two players will do.) */
  private loneDrawn(room: Room): boolean {
    return room.loneRound;
  }

  /**
   * Picks the lone player for the round at random, fairly: nobody is picked twice until everyone has had a turn. The lone one is purple, everyone else yellow
   * (for this round only: the teams are drawn afresh when the round ends, see `toLobby`).
   */
  private pickLone(room: Room) {
    const ids = this.participants(room);
    let candidates = ids.filter((id) => !room.loneTurns.has(id));
    if (candidates.length === 0) { room.loneTurns.clear(); candidates = ids; }
    const lone = candidates[randomInt(candidates.length)];
    room.loneTurns.add(lone);
    for (const id of ids) room.teams.set(id, id === lone ? 'purple' : 'yellow');
    room.loneRound = true;
  }

  /** A team game needs at least one player on EACH team. */
  private teamsFilled(room: Room): boolean {
    if (this.isLoneGame(room) && !this.loneDrawn(room)) return this.participants(room).length >= 2; // (the lone player is picked when the round starts)
    const m = this.teamMembers(room);
    return m.yellow.length > 0 && m.purple.length > 0;
  }

  private isTeamGame(room: Room): boolean {
    return getGame(room.settings.gameId)?.teams === true;
  }

  private participants(room: Room): string[] {
    return [...room.players.keys()].filter((id) => !room.watching.has(id));
  }

  /** Victory points (rounds won this session, plus bet winnings) a member has right now. */
  private points(room: Room, id: string): number {
    return room.wins[id] ?? 0;
  }

  /**
   * Pays out the round's bets and clears them. A free bet (no stake) wins 1 point and can't lose any; a staked bet wins exactly its
   * stake, or loses exactly its stake. A draw (nobody won) counts as a loss for every bet: that is just part of the risk. The one
   * way a bet is void (nothing changes) is when the player it was on has left the room. Spectators who left are skipped.
   */
  private settleBets(room: Room, winnerId: string | null, teamGame = false): BetResult[] {
    const results: BetResult[] = [];
    for (const [bettorId, bet] of Object.entries(room.bets)) {
      if (!room.players.has(bettorId)) continue;
      const void_ = teamGame ? !isTeamId(bet.targetId) : !room.players.has(bet.targetId);
      const delta = void_ ? 0 : bet.targetId === winnerId ? Math.max(1, bet.stake) : 0 - bet.stake;
      if (delta !== 0) room.wins[bettorId] = Math.max(0, this.points(room, bettorId) + delta);
      results.push({ bettorId, targetId: bet.targetId, stake: bet.stake, delta });
    }
    room.bets = {};
    return results;
  }

  /**
   * Is there an underdog for the round about to start? Only with at least UNDERDOG_MIN_PLAYERS players, and only when exactly one
   * of them has no bets on them while every other player has at least one (any bet counts, free ones too). The bonus they can
   * win is 1 point per person who bet (all of those bets are against them), and it is fixed now, whoever leaves later.
   */
  private findUnderdog(room: Room): Underdog | null {
    if (this.isTeamGame(room)) return null; // (no underdog in team games: bets are on teams)
    const players = this.participants(room);
    if (players.length < UNDERDOG_MIN_PLAYERS) return null;
    const backers = (id: string) => Object.entries(room.bets).filter(([bettor, bet]) => bet.targetId === id && room.players.has(bettor)).length;
    const unbacked = players.filter((id) => backers(id) === 0);
    if (unbacked.length !== 1) return null;
    const bonus = Object.values(room.bets).length;
    return bonus > 0 ? { playerId: unbacked[0], bonus } : null;
  }

  /** Drops bets that can no longer stand: the bettor is no longer a spectator, or their player stopped playing / left. Their Ready goes too (they must choose again). */
  /** Can this be bet on right now? A player who is playing, or, in a team game, a team that has a player in it. */
  private betTargetOk(room: Room, targetId: string): boolean {
    if (this.isLoneGame(room) && !this.loneDrawn(room)) return isTeamId(targetId) && this.participants(room).length >= 2; // (the sides are drawn at the start)
    if (this.isTeamGame(room)) return isTeamId(targetId) && this.teamMembers(room)[targetId].length > 0;
    return this.participants(room).includes(targetId);
  }

  private cleanBets(room: Room) {
    for (const [bettorId, bet] of Object.entries(room.bets)) {
      if (room.spectators.has(bettorId) && this.betTargetOk(room, bet.targetId)) continue;
      delete room.bets[bettorId];
      room.ready.delete(bettorId);
    }
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
    if (room.phase === 'lobby' || room.phase === 'countdown') this.cleanBets(room);
    const game = getGame(room.settings.gameId);
    const ids = this.participants(room);
    const randomOk = room.settings.random && ids.length >= Math.min(...ACTIVE_GAMES.filter((g) => !getGame(g.id)?.teams).map((g) => g.minPlayers)); // (the Random tile: any game that fits will do)
    // EVERYONE has to be ready: the players, and the spectators too (they are choosing their bets).
    const everyoneReady = [...room.players.keys()].every((id) => room.ready.has(id));
    const canStart = (randomOk || (Boolean(game) && ids.length >= game!.minPlayers && (!game!.teams || this.teamsFilled(room)))) && everyoneReady; // (a team game also needs a player on each team)

    if (room.phase === 'lobby' && canStart) {
      room.phase = 'countdown';
      room.countdownEndsAt = Date.now() + this.countdownMs;
    } else if (room.phase === 'countdown' && !canStart) {
      room.phase = 'lobby';
      room.countdownEndsAt = null;
    }
    if (room.phase === 'starting') this.startIfLoaded(room); // (someone who has not loaded dropped or left: the rest need not wait for them)
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
    name: room.name,
    hasPassword: room.passwordHash !== null,
    hostId: room.hostId,
    players: [...room.players.values()],
    watchingIds: [...room.watching],
    colors: Object.fromEntries(room.colors),
    spectatorOnlyIds: [...room.spectators], // (in line order: the first gets the next free seat)
    bets: { ...room.bets }, // (everyone's, for the server's own use: `personalize` cuts it down to the recipient's before it is sent)
    underdog: room.underdog,
    underdogEndsAt: room.underdogEndsAt,
    offlineIds: [...room.offline],
    roulette: room.roulette,
    teamCountdownEndsAt: room.teamCountdownEndsAt,
    startingEndsAt: room.startingEndsAt,
    startingDeadline: room.startingDeadline,
    revealAt: room.revealAt,
    roundId: room.roundSeq,
    settings: { ...room.settings },
    teams: Object.fromEntries(room.teams),
    readyIds: [...room.ready],
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    scores: { ...room.wins },
    game: room.game ? room.game.engine.view(room.game.state) : null,
    result: room.result,
    roundsPlayed: room.roundsPlayed,
    sessionWinner: room.sessionWinner,
    finishEndsAt: room.finishEndsAt,
    resultsEndsAt: room.resultsEndsAt,
    serverTime: Date.now(), // stamped at send time; phones use it to correct for clock differences
  };
}

/**
 * Bets are private. The room state is built with everyone's bets in it, and this cuts it down to what ONE person may see before
 * it is sent: their own bet, and their own bet's result. (The winning bettors and the underdog are public by design.)
 */
export function personalize(state: RoomState, playerId: string): RoomState {
  const mine = state.bets[playerId];
  return {
    ...state,
    bets: mine ? { [playerId]: mine } : {},
    result: state.result ? { ...state.result, bets: state.result.bets.filter((b) => b.bettorId === playerId) } : null,
  };
}


/**
 * A room name from whatever a phone sent: only text, with control characters and the invisible direction-changing ones removed (so a name can't
 * be hidden or flipped), whitespace tidied, cut to ROOM_NAME_MAX. Nothing usable left (or not text at all) means the default name. (Names are
 * always drawn as plain text, never as markup.)
 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ROOM_NAME;
  const name = raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ROOM_NAME_MAX)
    .trim();
  return name || DEFAULT_ROOM_NAME;
}

/** A password from whatever a phone sent: '' (none), the text, or false if it isn't text or is too long. */
function cleanPassword(raw: unknown): string | false {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string' || raw.length > ROOM_PASSWORD_MAX) return false;
  return raw;
}
