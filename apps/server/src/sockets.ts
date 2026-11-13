import type { Server } from 'socket.io';
import type { Ack, ClientToServerEvents, Player, RoomState, ServerToClientEvents } from '@fgn/shared';
import { AuthError, authenticate } from './auth';
import { RoomManager, type Outcome, type Result, type RoundRecord, type SessionRecord } from './rooms';

/** Per-connection data the server keeps on each socket. */
interface SocketData {
  player: Player;
  roomCode?: string; // set while THIS socket is in a room
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Taps arrive far faster than phones need updates, so live tap counts go out in batches. */
const TAP_BROADCAST_MS = 100;

/** Physics games advance 40 times a second; every 2nd step is streamed to phones (20 snapshots/s). */
const TICK_MS = 25;
const SNAPSHOT_EVERY_N_TICKS = 2;

interface ScheduledTimer {
  endsAt: number; // identifies WHICH countdown/round this timer belongs to
  timer: NodeJS.Timeout;
}

/** What to do when something permanent happens (the server wires these to the database). */
export interface SocketDeps {
  onRound: (round: RoundRecord) => void;
  onSession: (session: SessionRecord) => void;
}

/** Returns a function that stops the game loop (the server calls it when it closes). */
export function registerSockets(io: GameServer, rooms: RoomManager, { onRound, onSession }: SocketDeps): () => void {
  const countdownTimers = new Map<string, ScheduledTimer>(); // room code -> timer
  const roundTimers = new Map<string, ScheduledTimer>();
  const finishTimers = new Map<string, ScheduledTimer>();
  const resultsTimers = new Map<string, ScheduledTimer>();
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
    syncTimer(finishTimers, state.code, state.phase === 'finish' ? state.finishEndsAt : null, (endsAt) => {
      const results = rooms.finishFinish(state.code, endsAt);
      if (results) publish(results); // the you-won / you-lost sequence is over: show the summary
    });
    syncTimer(resultsTimers, state.code, state.phase === 'results' ? state.resultsEndsAt : null, (endsAt) => {
      const outcome = rooms.finishResults(state.code, endsAt);
      if (outcome) publishOutcome(outcome); // results shown long enough: next round, tie-breaker or session end
    });
  }

  function clearTimers(code: string) {
    for (const timers of [countdownTimers, roundTimers, finishTimers, resultsTimers]) syncTimer(timers, code, null, () => {});
  }

  function publishOutcome({ room, round, session }: Outcome) {
    publish(room);
    if (round) onRound(round); // persist the decided round
    if (session) onSession(session); // persist the finished session
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

  // The game loop for physics games (Snowball). Tap Race has no `tick`, so rooms playing it are skipped.
  let tickCount = 0;
  const loop = setInterval(() => {
    tickCount++;
    try {
      for (const { code, view, ended } of rooms.tick(Date.now())) {
        if (ended) publishOutcome(ended); // time's up: the usual results flow takes over
        else if (view && tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
          // volatile: if a phone is lagging, drop this snapshot rather than queueing stale ones.
          io.to(code).volatile.emit('game:view', view, Date.now());
        }
      }
    } catch (err) {
      console.error('Game loop error:', err); // never let one bad tick kill the server
    }
  }, TICK_MS);
  loop.unref(); // don't keep the process alive just for this timer

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
      if (result.room) publishOutcome({ room: result.room, session: result.session });
      else {
        clearTimers(result.code); // room emptied: drop its timers
        if (result.session) onSession(result.session); // ...and save the winner if the host never ended the session
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
      if (result.ok) publishOutcome(result);
      if (typeof ack === 'function') ack(result.ok ? { ok: true, data: null } : result);
    };

    socket.on('room:create', (ack) => {
      if (typeof ack === 'function') enter(rooms.create(player), ack);
    });
    socket.on('room:join', (code, ack) => {
      if (typeof ack === 'function') enter(rooms.join(String(code), player), ack);
    });
    socket.on('player:watching', (watching, ack) => command(rooms.setWatching(player.id, watching === true), ack));
    socket.on('room:leave', leave);
    socket.on('session:end', (ack) => command(rooms.endSession(player.id), ack));
    socket.on('room:settings', (settings, ack) => {
      command(rooms.setSettings(player.id, settings && typeof settings === 'object' ? settings : {}), ack);
    });
    socket.on('player:ready', (ready, ack) => command(rooms.setReady(player.id, ready === true), ack));
    socket.on('room:return-to-lobby', (ack) => command(rooms.returnToLobby(player.id), ack));
    socket.on('room:reset', (ack) => command(rooms.reset(player.id), ack));
    socket.on('room:close', async (ack) => {
      const result = rooms.close(player.id);
      if (!result.ok) return typeof ack === 'function' && ack(result);
      clearTimers(result.code);
      if (result.session) onSession(result.session);
      io.to(result.code).emit('room:closed');
      // Take every member's socket out of the Socket.io group and forget their room.
      for (const member of await io.in(result.code).fetchSockets()) {
        member.data.roomCode = undefined;
        member.leave(result.code);
      }
      if (typeof ack === 'function') ack({ ok: true, data: null });
    });
    socket.on('game:action', (action) => {
      // Never trust the payload shape: accept only the two known actions with sane numbers.
      const valid = action?.type === 'tap' || (action?.type === 'steer' && Number.isFinite(action.x) && Number.isFinite(action.z));
      if (!valid) return;
      const outcome = rooms.gameAction(player.id, action);
      if (!outcome) return;
      if (outcome.room.phase !== 'playing') publishOutcome(outcome); // the action ended the round
      else if (!rooms.isTicking(outcome.room.code)) scheduleTapBroadcast(outcome.room.code); // tick games stream by themselves
    });
    socket.on('disconnect', leave); // closing the tab or losing signal counts as leaving (for now)
  });

  return () => clearInterval(loop);
}
