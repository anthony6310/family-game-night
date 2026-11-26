import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  type Ack, type ClientToServerEvents, type CreateRoomOptions, type GameAction, type GameId, type JoinResult, type RoomError, type RoomListing, type RoomState,
  type ServerToClientEvents, type TeamId,
} from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';
import { ClockSync } from '../lib/clockSync';
import { SERVER_URL } from '../lib/serverUrl';
import { supabase } from '../lib/supabase';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const GUEST_TOKEN_KEY = 'fgn.guestToken';
const PING_BURST = 5; // clock pings straight after connecting
const PING_EVERY_MS = 2000; // then one every 2 s (a few bytes)
const PING_TIMEOUT_MS = 3000;
const readGuestToken = () => { try { return localStorage.getItem(GUEST_TOKEN_KEY) ?? undefined; } catch { return undefined; } };

const ERROR_TEXT: Record<RoomError, string> = {
  ROOM_NOT_FOUND: 'That room is gone. Try another one.',
  WRONG_PASSWORD: 'Wrong password.',
  TOO_MANY_ATTEMPTS: 'Too many tries in a short time. Wait a minute and try again.',
  TOO_MANY_ROOMS: 'Too many rooms right now, or you made rooms too fast. Try again in a bit.',
  ROOM_FULL: 'That room is full.',
  NO_SEAT: "You're a spectator, and you can't take a seat on your own: you get one automatically when a seat opens up and it's your turn.",
  NOT_A_SPECTATOR: 'Only spectators (people without a seat) can bet. Seat holders are playing for the win!',
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
  TEAMS_LOCKED: 'The host has turned team swapping off.',
  NOT_A_TEAM_GAME: 'That is not a team game.',
  TEAMS_NOT_FILLED: 'Each team needs at least one player before the game can start.',
};

interface RoomContextValue {
  /** The room I'm in, kept fresh by the server's `room:state` broadcasts. Null when not in one. */
  room: RoomState | null;
  /** My player id, to find "me" in room.players. */
  selfId: string | null;
  /** Each returns an error message to display, or null on success. */
  createRoom: (options?: CreateRoomOptions) => Promise<string | null>;
  /** Join a room from the list (its id), with its password if it has one. */
  joinRoom: (code: string, password?: string, asSpectator?: boolean) => Promise<string | null>;
  /** The rooms that can be joined right now. */
  listRooms: () => Promise<{ rooms: RoomListing[] } | { error: string }>;
  /** Switch between playing and watching (between rounds). Points are kept either way. */
  setWatching: (watching: boolean) => Promise<string | null>;
  /** Pick my color (one nobody else has). It is my color in every game. */
  setColor: (color: string) => Promise<string | null>;
  /** Team games: pick my team (while the host allows it). */
  setTeam: (team: TeamId) => Promise<string | null>;
  /** The team step (the Random tile landed on a team game), host only: start the round. */
  startFromTeams: () => Promise<string | null>;
  /** The team step, host only: cancel the start countdown. */
  cancelTeamStart: () => Promise<string | null>;
  /** Spectators: bet on a player to win (null = take the bet back), with `stake` extra victory points. */
  placeBet: (targetId: string | null, stake: number) => Promise<string | null>;
  leaveRoom: () => void;
  /** Host, step 1: lock in how many rounds the session lasts (once per session). */
  endSession: () => Promise<string | null>;
  /** Host, step 2: pick the game. */
  updateSettings: (change: { gameId?: GameId | 'random'; teamSwap?: boolean; name?: string; password?: string | null }) => Promise<string | null>;
  setReady: (ready: boolean) => Promise<string | null>;
  /** Tell the server the round's game is on this phone's screen and drawing smoothly (during the 'starting' step; the round's GO waits for every phone: GAME_RULES.md #8). */
  reportLoaded: () => Promise<string | null>;
  /** Host: end the current game and go back to the lobby. */
  returnToLobby: () => Promise<string | null>;
  /** Send an in-game action (a tap). Fire-and-forget: the server's count is what matters. */
  sendAction: (action: GameAction) => void;
  /** Host: start a fresh session in the same room (scores wiped), or close the room for everyone. */
  resetRoom: () => Promise<string | null>;
  closeRoom: () => Promise<string | null>;
  /** True while the page is finding out whether the player still has a seat in a room (right after a refresh): show a loading state, do not send them away yet. */
  restoring: boolean;
  /** One-off message to show on the Play page (e.g. "The host closed the room"). */
  notice: string | null;
  clearNotice: () => void;
  /** The server's current time (ms), as this phone estimates it (see lib/clockSync.ts). */
  serverNow: () => number;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const { session, guestName, loading } = useAuth();
  const socketRef = useRef<ClientSocket | null>(null);
  const guestNameRef = useRef(guestName);
  guestNameRef.current = guestName;
  const [room, setRoom] = useState<RoomState | null>(null);
  // serverTime - localTime. Phone clocks can be seconds off, so everything timed across phones (countdowns, the loading page lifting, GO) is drawn on the SERVER's clock and every
  // phone sees the same zero. It is measured by pinging the server (and from the stamp on every message), and smoothed so it never jumps: see lib/clockSync.ts.
  const clock = useRef(new ClockSync());
  const applyState = useCallback((state: RoomState) => {
    clock.current.update(state.serverTime);
    setRoom(state);
  }, []);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true); // (until we know whether a refreshed page still has a seat)
  const inRoomRef = useRef(false); // true once we hold a seat: a reconnect then asks for it back

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
            send(data.session ? { token: data.session.access_token } : { guestName: guestNameRef.current ?? '', guestToken: readGuestToken() }),
          );
        },
      });
      socket.on('room:state', applyState); // the server is the source of truth: just mirror it
      // Continuous games (Snowball) stream their state here many times a second. Merge it into the room.
      socket.on('game:view', (view, serverTime) => {
        clock.current.update(serverTime);
        setRoom((prev) => (prev && prev.phase === 'playing' ? { ...prev, game: view, serverTime } : prev));
      });
      socket.on('room:closed', () => {
        setRoom(null);
        setSelfId(null);
        setNotice('The room was closed.');
      });
      // A guest's signed identity: kept, so after a refresh the server knows it is the same guest.
      socket.on('guest:token', (token) => { try { localStorage.setItem(GUEST_TOKEN_KEY, token); } catch { /* (private mode: a refresh then makes a new guest) */ } });
      // Another connection of ours took over (a second tab): this one stops, and says why.
      socket.on('session:replaced', () => {
        inRoomRef.current = false;
        setRoom(null);
        setSelfId(null);
        setNotice('You joined from another tab or window, so this one was closed.');
      });
      // A dropped connection (a bad signal, or a refresh): the server holds the seat for a while. Keep showing the room; the connection comes back by itself and asks for the seat back (below).
      socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect' || reason === 'io client disconnect') { inRoomRef.current = false; setRoom(null); setSelfId(null); }
      });
      // Every (re)connection while we hold a seat: ask for it back and take the fresh state.
      socket.on('connect', () => { if (inRoomRef.current) rejoin(socket, true); });
      // Clock sync: a few pings straight after every (re)connection, then one every PING_EVERY_MS for as long as this connection is the current one.
      const ping = () => {
        if (!socket.connected) return;
        const sentAt = Date.now();
        socket.timeout(PING_TIMEOUT_MS).emit('clock:ping', (err, serverTime) => { if (!err && typeof serverTime === 'number') clock.current.ping(sentAt, serverTime); }); // (an old server never answers: the timeout drops it)
      };
      socket.on('connect', () => { for (let i = 0; i < PING_BURST; i++) setTimeout(ping, i * 150); });
      const pinger = window.setInterval(() => { if (socketRef.current !== socket) window.clearInterval(pinger); else ping(); }, PING_EVERY_MS);
      socketRef.current = socket;
    }
    return socketRef.current;
  }

  // Asks the server to put us back in the room we were in. `known`: we were showing a room when the connection dropped (so if the seat is gone, say so).
  function rejoin(socket: ClientSocket, known: boolean) {
    socket.emit('room:rejoin', (res) => {
      if (res.ok) {
        inRoomRef.current = true;
        applyState(res.data.room);
        setSelfId(res.data.playerId);
      } else {
        inRoomRef.current = false;
        if (known) { setRoom(null); setSelfId(null); setNotice('You were away too long, so you were removed from the room.'); }
        else { socketRef.current?.disconnect(); socketRef.current = null; } // (nothing to restore: do not hold a connection for nothing)
      }
      setRestoring(false);
    });
  }

  // Right after a refresh: if the server is still holding our seat, take it back (and land in the room). Nothing is shown as "leaving".
  const triedRestore = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!hasIdentity || triedRestore.current || socketRef.current) { setRestoring(false); return; } // (nobody to restore, or a connection already exists: a room was made or joined)
    triedRestore.current = true;
    const socket = getSocket();
    const giveUp = () => { socket.off('connect_error', giveUp); disconnect(); setRestoring(false); };
    socket.once('connect_error', giveUp);
    socket.once('connect', () => socket.off('connect_error', giveUp));
    rejoin(socket, false);
    socket.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasIdentity]);

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
        inRoomRef.current = true;
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
    joinRoom: (code, password, asSpectator) => request((s, ack) => s.emit('room:join', password || asSpectator ? { code, ...(password ? { password } : {}), ...(asSpectator ? { asSpectator: true } : {}) } : code, ack)),
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
    setTeam: (team) => command((s, ack) => s.emit('player:team', team, ack)),
    startFromTeams: () => command((s, ack) => s.emit('room:start-teams', ack)),
    cancelTeamStart: () => command((s, ack) => s.emit('room:cancel-start', ack)),
    placeBet: (targetId, stake) => command((s, ack) => s.emit('player:bet', targetId, stake, ack)),
    endSession: () => command((s, ack) => s.emit('session:end', ack)),
    updateSettings: (change) => command((s, ack) => s.emit('room:settings', change, ack)),
    setReady: (ready) => command((s, ack) => s.emit('player:ready', ready, ack)),
    reportLoaded: () => command((s, ack) => s.emit('player:loaded', ack)),
    returnToLobby: () => command((s, ack) => s.emit('room:return-to-lobby', ack)),
    sendAction: (action) => socketRef.current?.emit('game:action', action),
    resetRoom: () => command((s, ack) => s.emit('room:reset', ack)),
    closeRoom: () => command((s, ack) => s.emit('room:close', ack)),
    restoring,
    notice,
    clearNotice: () => setNotice(null),
    serverNow: () => Date.now() + clock.current.offset,
    leaveRoom: () => {
      inRoomRef.current = false;
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
