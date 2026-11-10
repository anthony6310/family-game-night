import type { Server } from 'socket.io';
import type { Ack, ClientToServerEvents, Player, RoomState, ServerToClientEvents } from '@fgn/shared';
import { AuthError, authenticate } from './auth';
import { RoomManager, type Result } from './rooms';

/** Per-connection data the server keeps on each socket. */
interface SocketData {
  player: Player;
  roomCode?: string; // set while THIS socket is in a room
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function registerSockets(io: GameServer, rooms: RoomManager) {
  // One countdown timer per room. `endsAt` identifies which countdown the timer belongs to.
  const timers = new Map<string, { endsAt: number; timer: NodeJS.Timeout }>();

  // Broadcast the room to everyone in it, and keep that room's countdown timer in step with it.
  function publish(state: RoomState) {
    io.to(state.code).emit('room:state', state);

    const current = timers.get(state.code);
    if (state.phase === 'countdown' && state.countdownEndsAt !== null) {
      if (current?.endsAt === state.countdownEndsAt) return; // already scheduled
      if (current) clearTimeout(current.timer);
      const endsAt = state.countdownEndsAt;
      const timer = setTimeout(() => {
        timers.delete(state.code);
        const started = rooms.finishCountdown(state.code, endsAt);
        if (started) publish(started); // countdown hit zero: the game phase begins
      }, Math.max(0, endsAt - Date.now()));
      timers.set(state.code, { endsAt, timer });
    } else if (current) {
      clearTimeout(current.timer); // countdown was cancelled (or the room is gone)
      timers.delete(state.code);
    }
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
        const current = timers.get(result.code); // room emptied: drop its timer
        if (current) clearTimeout(current.timer);
        timers.delete(result.code);
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
    socket.on('disconnect', leave); // closing the tab or losing signal counts as leaving (for now)
  });
}
