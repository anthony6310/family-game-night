import { randomInt } from 'node:crypto';
import {
  COUNTDOWN_SECONDS, GAMES, MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROUND_OPTIONS, getGame,
  type Player, type RoomError, type RoomPhase, type RoomSettings, type RoomState,
} from '@fgn/shared';

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>; // a Map keeps insertion order = join order
  settings: RoomSettings;
  ready: Set<string>;
  phase: RoomPhase;
  countdownEndsAt: number | null;
}

export type Result = { ok: true; room: RoomState } | { ok: false; error: RoomError };
const fail = (error: RoomError): Result => ({ ok: false, error });

/**
 * All room rules in one place, with no Socket.io in sight, so it is easy to reason about.
 * Rooms live only in memory: restart the server and they are gone (by design for now).
 * Timers are NOT in here either: this class only records *when* a countdown ends.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomOfPlayer = new Map<string, string>(); // playerId -> room code

  constructor(private countdownMs = COUNTDOWN_SECONDS * 1000) {}

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
    };
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(host.id, room.code);
    return { ok: true, room: toState(room) };
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
    return { ok: true, room: toState(room) };
  }

  /** Removes a player. Returns the updated room, or null if the room is now empty and deleted. */
  leave(playerId: string): { code: string; room: RoomState | null } | null {
    const code = this.roomOfPlayer.get(playerId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!code || !room) return null;

    room.players.delete(playerId);
    room.ready.delete(playerId);
    this.roomOfPlayer.delete(playerId);

    if (room.players.size === 0) {
      this.rooms.delete(code);
      return { code, room: null };
    }
    // Host left: promote whoever has been here longest (first in the Map).
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value!;
    this.reconcile(room);
    return { code, room: toState(room) };
  }

  /** Host picks the game and/or session length. Any real change resets everyone's Ready. */
  setSettings(playerId: string, change: Partial<RoomSettings>): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase === 'playing') return fail('WRONG_PHASE');

    // Validate everything first so a bad request changes nothing.
    const next = { ...room.settings };
    if (change.gameId !== undefined) {
      if (!GAMES.some((g) => g.id === change.gameId)) return fail('INVALID_SETTING');
      next.gameId = change.gameId;
    }
    if (change.totalRounds !== undefined) {
      if (!(ROUND_OPTIONS as readonly number[]).includes(change.totalRounds)) return fail('INVALID_SETTING');
      next.totalRounds = change.totalRounds;
    }

    if (next.gameId !== room.settings.gameId || next.totalRounds !== room.settings.totalRounds) {
      room.settings = next;
      room.ready.clear(); // everyone must agree to the NEW setup
      this.reconcile(room); // cancels a countdown, since nobody is ready any more
    }
    return { ok: true, room: toState(room) };
  }

  setReady(playerId: string, ready: boolean): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase === 'playing') return fail('WRONG_PHASE');
    if (!room.settings.gameId) return fail('NO_GAME_SELECTED');

    if (ready) room.ready.add(playerId);
    else room.ready.delete(playerId);
    this.reconcile(room); // may start the countdown (last player readied) or cancel it
    return { ok: true, room: toState(room) };
  }

  /**
   * Called by the timer when a countdown expires. `expectedEndsAt` guards against a stale timer
   * from a countdown that was cancelled and restarted. Returns null if there's nothing to do.
   */
  finishCountdown(code: string, expectedEndsAt: number): RoomState | null {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'countdown' || room.countdownEndsAt !== expectedEndsAt) return null;
    room.phase = 'playing';
    room.countdownEndsAt = null;
    return toState(room);
  }

  /** Host ends the current game and sends everyone back to the lobby, with settings kept. */
  returnToLobby(playerId: string): Result {
    const room = this.roomFor(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.phase !== 'playing') return fail('WRONG_PHASE');
    room.phase = 'lobby';
    room.ready.clear();
    return { ok: true, room: toState(room) };
  }

  /**
   * The one place that decides whether a countdown should be running:
   * a game is chosen, enough players are present, and EVERY player is ready.
   * Every change above funnels through here, so start/cancel rules can't get out of step.
   */
  private reconcile(room: Room) {
    const game = getGame(room.settings.gameId);
    const everyoneReady = [...room.players.keys()].every((id) => room.ready.has(id));
    const canStart = Boolean(game) && room.players.size >= game!.minPlayers && everyoneReady;

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

function toState(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()],
    settings: { ...room.settings },
    readyIds: [...room.ready],
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    serverTime: Date.now(), // stamped at send time; phones use it to correct for clock differences
  };
}
