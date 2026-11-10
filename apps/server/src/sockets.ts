import type { Server } from 'socket.io';
import type { ClientToServerEvents, Player, ServerToClientEvents } from '@fgn/shared';
import { AuthError, authenticate } from './auth';
import { RoomManager } from './rooms';

/** Per-connection data the server keeps on each socket. */
interface SocketData {
  player: Player;
  roomCode?: string; // set while THIS socket is in a room
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function registerSockets(io: GameServer) {
  const rooms = new RoomManager();

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
      if (result?.room) io.to(result.code).emit('room:state', result.room);
    };

    socket.on('room:create', (ack) => {
      if (typeof ack !== 'function') return;
      const result = rooms.create(player);
      if (!result.ok) return ack(result);
      socket.data.roomCode = result.room.code;
      socket.join(result.room.code); // Socket.io "room" = a named group we can broadcast to
      ack({ ok: true, data: { playerId: player.id, room: result.room } });
    });

    socket.on('room:join', (code, ack) => {
      if (typeof ack !== 'function') return;
      const result = rooms.join(String(code), player);
      if (!result.ok) return ack(result);
      socket.data.roomCode = result.room.code;
      socket.join(result.room.code);
      ack({ ok: true, data: { playerId: player.id, room: result.room } });
      socket.to(result.room.code).emit('room:state', result.room); // tell everyone else
    });

    socket.on('room:leave', leave);
    socket.on('disconnect', leave); // closing the tab or losing signal counts as leaving (for now)
  });
}
