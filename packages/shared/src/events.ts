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

/** Everything a phone needs to draw the lobby. The server sends a fresh copy on every change. */
export interface RoomState {
  code: string;
  hostId: string;
  players: Player[]; // in join order
}

export type RoomError = 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ALREADY_IN_ROOM';

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
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
}
