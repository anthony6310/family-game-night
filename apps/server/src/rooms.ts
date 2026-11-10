import { randomInt } from 'node:crypto';
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  type Player, type RoomError, type RoomState,
} from '@fgn/shared';

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>; // a Map keeps insertion order = join order
}

type Result = { ok: true; room: RoomState } | { ok: false; error: RoomError };

/**
 * All room rules in one place, with no Socket.io in sight, so it is easy to reason about.
 * Rooms live only in memory: restart the server and they are gone (by design for now).
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomOfPlayer = new Map<string, string>(); // playerId -> room code

  create(host: Player): Result {
    if (this.roomOfPlayer.has(host.id)) return { ok: false, error: 'ALREADY_IN_ROOM' };
    const room: Room = { code: this.newCode(), hostId: host.id, players: new Map([[host.id, host]]) };
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(host.id, room.code);
    return { ok: true, room: toState(room) };
  }

  join(rawCode: string, player: Player): Result {
    if (this.roomOfPlayer.has(player.id)) return { ok: false, error: 'ALREADY_IN_ROOM' };
    const room = this.rooms.get(rawCode.trim().toUpperCase()); // codes are case-insensitive
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.players.size >= MAX_PLAYERS) return { ok: false, error: 'ROOM_FULL' };
    room.players.set(player.id, player);
    this.roomOfPlayer.set(player.id, room.code);
    return { ok: true, room: toState(room) };
  }

  /** Removes a player. Returns the updated room, or null if the room is now empty and deleted. */
  leave(playerId: string): { code: string; room: RoomState | null } | null {
    const code = this.roomOfPlayer.get(playerId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!code || !room) return null;

    room.players.delete(playerId);
    this.roomOfPlayer.delete(playerId);

    if (room.players.size === 0) {
      this.rooms.delete(code);
      return { code, room: null };
    }
    // Host left: promote whoever has been here longest (first in the Map).
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value!;
    return { code, room: toState(room) };
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
  return { code: room.code, hostId: room.hostId, players: [...room.players.values()] };
}
