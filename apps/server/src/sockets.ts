import type { Server } from 'socket.io';
import type { Ack, ClientToServerEvents, Player, RoomState, ServerToClientEvents } from '@fgn/shared';
import { AuthError, authenticate } from './auth';
import { RoomManager, type Outcome, type Result, type RoundRecord } from './rooms';

/** Per-connection data the server keeps on each socket. */
interface SocketData {
  player: Player;
  roomCode?: string; // set while THIS socket is in a room
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Taps arrive far faster than phones need updates, so live tap counts go out in batches. */
const TAP_BROADCAST_MS = 100;

interface ScheduledTimer {
  endsAt: number; // identifies WHICH countdown/round this timer belongs to
  timer: NodeJS.Timeout;
}

export function registerSockets(io: GameServer, rooms: RoomManager, onRound: (round: RoundRecord) => void) {
  const countdownTimers = new Map<string, ScheduledTimer>(); // room code -> timer
  const roundTimers = new Map<string, ScheduledTimer>();
  const flushPending = new Set<string>(); // rooms with a batched tap broadcast already scheduled

  /**
   * Keeps one timer in step with the room: `endsAt` = when it should fire, or null = no timer.
   * Safe to call after every broadcast: it only reschedules if the target time changed.
   */
  function syncTimer(timers: Map<string, ScheduledTimer>, code: string, endsAt: number | null, onFire: (endsAt: number) => void) {
    const current = timers.get(code);
    if (endsAt === null) {
      if (current) clearTimeout(current.timer);
      timers.delete(code);
      return;
    }
    if (current?.endsAt === endsAt) return; // already scheduled
    if (current) clearTimeout(current.timer);
    const timer = setTimeout(() => {
      timers.delete(code);
      onFire(endsAt);
    }, Math.max(0, endsAt - Date.now()));
    timers.set(code, { endsAt, timer });
  }

  // Broadcast the room to everyone in it, then make sure the right timers exist for its phase.
  function publish(state: RoomState) {
    io.to(state.code).emit('room:state', state);
    syncTimer(countdownTimers, state.code, state.phase === 'countdown' ? state.countdownEndsAt : null, (endsAt) => {
      const started = rooms.finishCountdown(state.code, endsAt);
      if (started) publish(started); // countdown hit zero: the round begins
    });
    syncTimer(roundTimers, state.code, state.phase === 'playing' ? (state.game?.endsAt ?? null) : null, (endsAt) => {
      const outcome = rooms.finishRound(state.code, endsAt);
      if (outcome) publishOutcome(outcome); // time's up: decide the winner
    });
  }

  function publishOutcome({ room, round }: Outcome) {
    publish(room);
    if (round) onRound(round); // persist the decided round
  }

  // Batches live tap counts: many taps within 100 ms produce ONE broadcast.
  function scheduleTapBroadcast(code: string) {
    if (flushPending.has(code)) return;
    flushPending.add(code);
    setTimeout(() => {
      flushPending.delete(code);
      const state = rooms.stateOf(code);
      if (state?.phase === 'playing') publish(state);
    }, TAP_BROADCAST_MS);
  }

  // Middleware runs once per connection, before 'connection'. Calling next(error) rejects it,
  // and the client receives that message as a `connect_error`.
  io.use(async (socket, next) => {
    try {
      socket.data.player = await authenticate(socket.handshake.auth);
      next();
    } catch (err) {
      next(new Error(err instanceof AuthError ? err.message : 'Could not authenticate.'));
    }
  });

  io.on('connection', (socket) => {
    const { player } = socket.data;

    // Remove this socket's player from its room and tell everyone who remains.
    const leave = () => {
      // Only act if THIS socket joined (a rejected second tab must not evict the first).
      if (!socket.data.roomCode) return;
      const result = rooms.leave(player.id);
      socket.leave(socket.data.roomCode);
      socket.data.roomCode = undefined;
      if (!result) return;
      if (result.room) publish(result.room);
      else {
        // Room emptied: drop its timers.
        syncTimer(countdownTimers, result.code, null, () => {});
        syncTimer(roundTimers, result.code, null, () => {});
      }
    };

    // Joins this socket to the Socket.io room and replies with who "I" am.
    const enter = (result: Result, ack: (res: Ack<{ playerId: string; room: RoomState }>) => void) => {
      if (!result.ok) return ack(result);
      socket.data.roomCode = result.room.code;
      socket.join(result.room.code); // Socket.io "room" = a named group we can broadcast to
      ack({ ok: true, data: { playerId: player.id, room: result.room } });
      publish(result.room);
    };

    // For commands whose effect shows up through the broadcast: publish on success, ack either way.
    const command = (result: Result, ack?: (res: Ack<null>) => void) => {
      if (result.ok) publish(result.room);
      if (typeof ack === 'function') ack(result.ok ? { ok: true, data: null } : result);
    };

    socket.on('room:create', (ack) => {
      if (typeof ack === 'function') enter(rooms.create(player), ack);
    });
    socket.on('room:join', (code, ack) => {
      if (typeof ack === 'function') enter(rooms.join(String(code), player), ack);
    });
    socket.on('room:leave', leave);
    socket.on('room:settings', (settings, ack) => {
      command(rooms.setSettings(player.id, settings && typeof settings === 'object' ? settings : {}), ack);
    });
    socket.on('player:ready', (ready, ack) => command(rooms.setReady(player.id, ready === true), ack));
    socket.on('room:return-to-lobby', (ack) => command(rooms.returnToLobby(player.id), ack));
    socket.on('game:action', (action) => {
      if (action?.type !== 'tap') return; // never trust the payload shape
      const outcome = rooms.gameAction(player.id, action);
      if (!outcome) return;
      if (outcome.room.phase === 'playing') scheduleTapBroadcast(outcome.room.code);
      else publishOutcome(outcome); // the action ended the round
    });
    socket.on('disconnect', leave); // closing the tab or losing signal counts as leaving (for now)
  });
}
