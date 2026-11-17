import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  MAX_PLAYERS,
  type Ack, type ClientToServerEvents, type CreateRoomOptions, type GameAction, type GameId, type JoinResult, type RoomError, type RoomListing, type RoomState,
  type ServerToClientEvents,
} from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';
import { SERVER_URL } from '../lib/serverUrl';
import { supabase } from '../lib/supabase';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ERROR_TEXT: Record<RoomError, string> = {
  ROOM_NOT_FOUND: 'That room is gone. Try another one.',
  WRONG_PASSWORD: 'Wrong password.',
  TOO_MANY_ATTEMPTS: 'Too many tries in a short time. Wait a minute and try again.',
  TOO_MANY_ROOMS: 'Too many rooms right now, or you made rooms too fast. Try again in a bit.',
  ROOM_FULL: 'That room is full.',
  NO_SEAT: `The first ${MAX_PLAYERS} people in a room can play. You're a spectator until a seat opens up.`,
  NOT_A_SPECTATOR: 'Only spectators can bet. Players are playing for the win!',
  COLOR_TAKEN: 'Someone else already has that color.',
  INVALID_COLOR: "That isn't one of the colors.",
  INVALID_BET: "That bet isn't allowed (pick a player who is playing; a stake is 0 or at least 2 points, and no more than you have).",
  ALREADY_IN_ROOM: "You're already in a room (maybe in another tab).",
  GAME_IN_PROGRESS: 'That room is mid-game. Try again in a moment.', // (no longer sent: late joiners just watch)
  NOT_IN_ROOM: "You're not in a room.",
  NOT_HOST: 'Only the host can do that.',
  INVALID_SETTING: "That setting isn't allowed.",
  WRONG_PHASE: "That can't be changed right now.",
  NO_GAME_SELECTED: 'Wait for the host to pick a game.',
};

interface RoomContextValue {
  /** The room I'm in, kept fresh by the server's `room:state` broadcasts. Null when not in one. */
  room: RoomState | null;
  /** My player id, to find "me" in room.players. */
  selfId: string | null;
  /** Each returns an error message to display, or null on success. */
  createRoom: (options?: CreateRoomOptions) => Promise<string | null>;
  /** Join a room from the list (its id), with its password if it has one. */
  joinRoom: (code: string, password?: string) => Promise<string | null>;
  /** The rooms that can be joined right now. */
  listRooms: () => Promise<{ rooms: RoomListing[] } | { error: string }>;
  /** Switch between playing and watching (between rounds). Points are kept either way. */
  setWatching: (watching: boolean) => Promise<string | null>;
  /** Pick my color (one nobody else has). It is my color in every game. */
  setColor: (color: string) => Promise<string | null>;
  /** Spectators: bet on a player to win (null = take the bet back), with `stake` extra victory points. */
  placeBet: (targetId: string | null, stake: number) => Promise<string | null>;
  leaveRoom: () => void;
  /** Host, step 1: lock in how many rounds the session lasts (once per session). */
  endSession: () => Promise<string | null>;
  /** Host, step 2: pick the game. */
  updateSettings: (change: { gameId?: GameId; name?: string; password?: string | null }) => Promise<string | null>;
  setReady: (ready: boolean) => Promise<string | null>;
  /** Host: end the current game and go back to the lobby. */
  returnToLobby: () => Promise<string | null>;
  /** Send an in-game action (a tap). Fire-and-forget: the server's count is what matters. */
  sendAction: (action: GameAction) => void;
  /** Host: start a fresh session in the same room (scores wiped), or close the room for everyone. */
  resetRoom: () => Promise<string | null>;
  closeRoom: () => Promise<string | null>;
  /** One-off message to show on the Play page (e.g. "The host closed the room"). */
  notice: string | null;
  clearNotice: () => void;
  /** The server's current time (ms), estimated from the offset measured on the last update. */
  serverNow: () => number;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const { session, guestName } = useAuth();
  const socketRef = useRef<ClientSocket | null>(null);
  const guestNameRef = useRef(guestName);
  guestNameRef.current = guestName;
  const [room, setRoom] = useState<RoomState | null>(null);
  // serverTime - localTime, refreshed on every update. Phone clocks can be seconds off, so the
  // countdown is shown relative to the SERVER's clock and every phone sees the same zero.
  const clockOffset = useRef(0);
  const applyState = useCallback((state: RoomState) => {
    clockOffset.current = state.serverTime - Date.now();
    setRoom(state);
  }, []);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoom(null);
    setSelfId(null);
  }, []);

  // If the player logs out / leaves as guest, drop the connection.
  const hasIdentity = Boolean(session || guestName);
  useEffect(() => {
    if (!hasIdentity) disconnect();
  }, [hasIdentity, disconnect]);

  // The socket is created lazily on first use and reused afterwards.
  function getSocket(): ClientSocket {
    if (!socketRef.current) {
      const socket: ClientSocket = io(SERVER_URL, {
        autoConnect: false,
        // `auth` as a function runs on every (re)connect, so an account always sends a fresh token.
        auth: (send) => {
          supabase.auth.getSession().then(({ data }) =>
            send(data.session ? { token: data.session.access_token } : { guestName: guestNameRef.current ?? '' }),
          );
        },
      });
      socket.on('room:state', applyState); // the server is the source of truth: just mirror it
      // Continuous games (Snowball) stream their state here many times a second. Merge it into the room.
      socket.on('game:view', (view, serverTime) => {
        clockOffset.current = serverTime - Date.now();
        setRoom((prev) => (prev && prev.phase === 'playing' ? { ...prev, game: view, serverTime } : prev));
      });
      socket.on('room:closed', () => {
        setRoom(null);
        setSelfId(null);
        setNotice('The room was closed.');
      });
      socket.on('disconnect', () => {
        setRoom(null);
        setSelfId(null);
      });
      socketRef.current = socket;
    }
    return socketRef.current;
  }

  // Sends one room request. Resolves with an error message, or null on success.
  function request(send: (socket: ClientSocket, ack: (res: Ack<JoinResult>) => void) => void): Promise<string | null> {
    return new Promise((resolve) => {
      const socket = getSocket();
      // A rejected handshake (bad token, empty name) surfaces as `connect_error`, not as an ack.
      const onConnectError = (err: Error) => {
        disconnect();
        resolve(err.message);
      };
      socket.once('connect_error', onConnectError);
      send(socket, (res) => {
        socket.off('connect_error', onConnectError);
        if (!res.ok) return resolve(ERROR_TEXT[res.error]);
        applyState(res.data.room);
        setSelfId(res.data.playerId);
        resolve(null);
      });
      socket.connect(); // emits above are buffered until the connection is open
    });
  }

  // Sends a command on the existing connection; resolves with an error message or null.
  function command(send: (socket: ClientSocket, ack: (res: Ack<null>) => void) => void): Promise<string | null> {
    const socket = socketRef.current;
    if (!socket) return Promise.resolve('Not connected.');
    return new Promise((resolve) => send(socket, (res) => resolve(res.ok ? null : ERROR_TEXT[res.error])));
  }

  const value: RoomContextValue = {
    room,
    selfId,
    createRoom: (options) => request((s, ack) => (options ? s.emit('room:create', options, ack) : s.emit('room:create', ack))),
    joinRoom: (code, password) => request((s, ack) => s.emit('room:join', password ? { code, password } : code, ack)),
    listRooms: () => new Promise((resolve) => {
      const socket = getSocket(); // (the connection is made if there isn't one yet: being logged in is all it takes to see the list)
      const onConnectError = (err: Error) => { disconnect(); resolve({ error: err.message }); };
      socket.once('connect_error', onConnectError);
      socket.emit('rooms:list', (res) => {
        socket.off('connect_error', onConnectError);
        resolve(res.ok ? { rooms: res.data } : { error: ERROR_TEXT[res.error] });
      });
      socket.connect();
    }),
    setWatching: (watching) => command((s, ack) => s.emit('player:watching', watching, ack)),
    setColor: (color) => command((s, ack) => s.emit('player:color', color, ack)),
    placeBet: (targetId, stake) => command((s, ack) => s.emit('player:bet', targetId, stake, ack)),
    endSession: () => command((s, ack) => s.emit('session:end', ack)),
    updateSettings: (change) => command((s, ack) => s.emit('room:settings', change, ack)),
    setReady: (ready) => command((s, ack) => s.emit('player:ready', ready, ack)),
    returnToLobby: () => command((s, ack) => s.emit('room:return-to-lobby', ack)),
    sendAction: (action) => socketRef.current?.emit('game:action', action),
    resetRoom: () => command((s, ack) => s.emit('room:reset', ack)),
    closeRoom: () => command((s, ack) => s.emit('room:close', ack)),
    notice,
    clearNotice: () => setNotice(null),
    serverNow: () => Date.now() + clockOffset.current,
    leaveRoom: () => {
      socketRef.current?.emit('room:leave');
      setRoom(null);
      setSelfId(null);
    },
  };
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>');
  return ctx;
}
