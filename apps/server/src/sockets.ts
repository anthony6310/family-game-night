import type { Server } from 'socket.io';
import { RECONNECT_GRACE_SECONDS, type Ack, type ClientToServerEvents, type CreateRoomOptions, type JoinRequest, type Player, type RoomState, type ServerToClientEvents } from '@fgn/shared';
import { AuthError, authenticate, signGuestId } from './auth';
import { AttemptLimiter } from './limits';
import { RoomManager, personalize, type Outcome, type Result, type RoundRecord, type SessionRecord } from './rooms';

/** Per-connection data the server keeps on each socket. */
interface SocketData {
  player: Player;
  roomCode?: string; // set while THIS socket is in a room
  replaced?: boolean; // set when another connection of the same player took over
}

/** One player's connection. */
type GameSocket = ReturnType<GameServer['sockets']['sockets']['get']> extends infer T ? NonNullable<T> : never;
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
  /** How long a dropped player's seat is held before they count as having left (default RECONNECT_GRACE_SECONDS; tests shorten it). */
  reconnectGraceMs?: number;
}

/** Returns a function that stops the game loop (the server calls it when it closes). */
export function registerSockets(io: GameServer, rooms: RoomManager, { onRound, onSession, reconnectGraceMs = RECONNECT_GRACE_SECONDS * 1000 }: SocketDeps): () => void {
  const connections = new Map<string, GameSocket>(); // player id -> their current connection (a refreshed page or a second tab replaces the old one)
  const graceTimers = new Map<string, NodeJS.Timeout>(); // player id -> the timer that removes them if they do not come back
  const countdownTimers = new Map<string, ScheduledTimer>(); // room code -> timer
  const roundTimers = new Map<string, ScheduledTimer>();
  const finishTimers = new Map<string, ScheduledTimer>();
  const resultsTimers = new Map<string, ScheduledTimer>();
  const underdogTimers = new Map<string, ScheduledTimer>();
  const startingTimers = new Map<string, ScheduledTimer>();
  const rouletteTimers = new Map<string, ScheduledTimer>();
  const teamStartTimers = new Map<string, ScheduledTimer>();
  // Slowing down abuse (each keyed by the connection's network address, which a guest can't just change by making a new name):
  const wrongPasswords = new AttemptLimiter(8, 5 * 60_000); // wrong room passwords: 8 in 5 minutes
  const roomsMade = new AttemptLimiter(6, 10 * 60_000); // rooms created: 6 in 10 minutes
  const listRequests = new AttemptLimiter(60, 60_000); // refreshing the room list: 60 a minute
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
    // Bets are private, so everyone gets their OWN copy of the state (see `personalize`) instead of one shared broadcast.
    for (const socketId of io.sockets.adapter.rooms.get(state.code) ?? []) {
      const member = io.sockets.sockets.get(socketId);
      if (member) member.emit('room:state', personalize(state, member.data.player.id));
    }
    syncTimer(countdownTimers, state.code, state.phase === 'countdown' ? state.countdownEndsAt : null, (endsAt) => {
      const started = rooms.finishCountdown(state.code, endsAt);
      if (started) publish(started); // countdown hit zero: the round begins
    });
    syncTimer(rouletteTimers, state.code, state.phase === 'roulette' ? (state.roulette?.endsAt ?? null) : null, (endsAt) => {
      const started = rooms.finishRoulette(state.code, endsAt);
      if (started) publish(started); // the roulette has landed on a game: on to the underdog announcement or the flash step
    });
    syncTimer(teamStartTimers, state.code, state.phase === 'teams' ? state.teamCountdownEndsAt : null, (endsAt) => {
      const started = rooms.finishTeamCountdown(state.code, endsAt);
      if (started) publish(started); // the team step's countdown ended: the round begins
    });
    syncTimer(underdogTimers, state.code, state.phase === 'underdog' ? state.underdogEndsAt : null, (endsAt) => {
      const started = rooms.finishUnderdog(state.code, endsAt);
      if (started) publish(started); // the underdog announcement is over: the flash step begins (or the round, with no flash step)
    });
    syncTimer(startingTimers, state.code, state.phase === 'starting' ? state.startingEndsAt : null, (endsAt) => {
      const started = rooms.finishStarting(state.code, endsAt);
      if (started) publish(started); // the flash is almost over: the round begins
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
    for (const timers of [countdownTimers, rouletteTimers, teamStartTimers, underdogTimers, startingTimers, roundTimers, finishTimers, resultsTimers]) syncTimer(timers, code, null, () => {});
  }

  function publishOutcome({ room, round, rounds, session }: Outcome) {
    publish(room);
    if (round) onRound(round); // persist the decided round
    if (rounds) for (const r of rounds) onRound(r); // (a team game: one record for every member of the winning team)
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

    // Remove a player from their room and tell everyone who remains (used for a deliberate leave, and when a dropped player's grace period runs out).
    const removeFromRoom = (playerId: string) => {
      const result = rooms.leave(playerId);
      if (!result) return;
      if (result.room) publishOutcome({ room: result.room, session: result.session });
      else {
        clearTimers(result.code); // room emptied: drop its timers
        if (result.session) onSession(result.session); // ...and save the winner if the host never ended the session
      }
    };
    // This connection's player leaves on purpose: out of the room at once.
    const leave = () => {
      // Only act if THIS socket joined (a rejected second tab must not evict the first).
      if (!socket.data.roomCode) return;
      const code = socket.data.roomCode;
      socket.leave(code);
      socket.data.roomCode = undefined;
      removeFromRoom(player.id);
    };

    // A new connection for a player takes over from any old one (a second tab, or the refreshed page arriving before the old connection has timed out): the old one is closed, and it
    // never counts as the player leaving. (A pending grace-period timer is only cancelled once they have actually asked for their seat back: `room:rejoin`.)
    const old = connections.get(player.id);
    if (old && old.id !== socket.id) { old.data.replaced = true; old.emit('session:replaced'); old.disconnect(true); }
    connections.set(player.id, socket);
    if (player.isGuest) socket.emit('guest:token', signGuestId(player.id)); // (the browser keeps it, so a refresh is recognised as the same guest)

    // Joins this socket to the Socket.io room and replies with who "I" am.
    const enter = (result: Result, ack: (res: Ack<{ playerId: string; room: RoomState }>) => void) => {
      if (!result.ok) return ack(result);
      socket.data.roomCode = result.room.code;
      socket.join(result.room.code); // Socket.io "room" = a named group we can broadcast to
      ack({ ok: true, data: { playerId: player.id, room: personalize(result.room, player.id) } });
      publish(result.room);
    };

    // For commands whose effect shows up through the broadcast: publish on success, ack either way.
    const command = (result: Result, ack?: (res: Ack<null>) => void) => {
      if (result.ok) publishOutcome(result);
      if (typeof ack === 'function') ack(result.ok ? { ok: true, data: null } : result);
    };

    const address = socket.handshake.address; // (behind a proxy this is the proxy's address: see the note in the deployment docs)

    // After a refresh or a dropped connection: put this player back in the room they were in (their seat was held), or say they have none.
    socket.on('room:rejoin', (ack) => {
      if (typeof ack !== 'function') return;
      const result = rooms.rejoin(player.id);
      if (result.ok) { const pending = graceTimers.get(player.id); if (pending) { clearTimeout(pending); graceTimers.delete(player.id); } } // (they are back: the seat is theirs)
      enter(result, ack);
    });
    // Make a room: `room:create(ack)` (a default room) or `room:create({ name, password }, ack)`.
    socket.on('room:create', (optionsOrAck, maybeAck) => {
      const ack = typeof optionsOrAck === 'function' ? optionsOrAck : maybeAck;
      if (typeof ack !== 'function') return;
      const options: CreateRoomOptions = optionsOrAck && typeof optionsOrAck === 'object' ? optionsOrAck : {};
      if (roomsMade.blocked(address)) return ack({ ok: false, error: 'TOO_MANY_ROOMS' });
      const result = rooms.create(player, options);
      if (result.ok) roomsMade.record(address);
      enter(result, ack);
    });
    // Join a room from the list: `room:join(id, ack)` or `room:join({ code, password }, ack)`.
    socket.on('room:join', (target, ack) => {
      if (typeof ack !== 'function') return;
      const request: Partial<JoinRequest> = typeof target === 'string' ? { code: target } : target && typeof target === 'object' ? target : {};
      if (wrongPasswords.blocked(address)) return ack({ ok: false, error: 'TOO_MANY_ATTEMPTS' }); // (checked before the password is even looked at)
      const result = rooms.join(String(request.code ?? ''), player, request.password);
      if (!result.ok && result.error === 'WRONG_PASSWORD') wrongPasswords.record(address);
      enter(result, ack);
    });
    // The rooms anyone can try to join.
    socket.on('rooms:list', (ack) => {
      if (typeof ack !== 'function') return;
      if (listRequests.blocked(address)) return ack({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
      listRequests.record(address);
      ack({ ok: true, data: rooms.list() });
    });
    socket.on('player:watching', (watching, ack) => command(rooms.setWatching(player.id, watching === true), ack));
    socket.on('room:leave', leave);
    socket.on('session:end', (ack) => command(rooms.endSession(player.id), ack));
    socket.on('room:settings', (settings, ack) => {
      command(rooms.setSettings(player.id, settings && typeof settings === 'object' ? settings : {}), ack);
    });
    socket.on('room:cancel-start', (ack) => command(rooms.cancelTeamStart(player.id), ack));
    socket.on('room:start-teams', (ack) => command(rooms.startFromTeams(player.id), ack));
    socket.on('player:team', (team, ack) => command(rooms.setTeam(player.id, team), ack));
    socket.on('room:handicap', (team, value, ack) => command(rooms.setHandicap(player.id, team, value), ack));
    socket.on('player:color', (color, ack) => command(rooms.setColor(player.id, String(color)), ack));
    socket.on('player:bet', (target, stake, ack) => command(rooms.setBet(player.id, typeof target === 'string' ? target : null, Number(stake)), ack));
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
      // Never trust the payload shape: accept only the known actions with sane values.
      const valid = action?.type === 'tap' || (action?.type === 'steer' && Number.isFinite(action.x) && Number.isFinite(action.z)) || (action?.type === 'sprint' && typeof action.on === 'boolean')
        || (action?.type === 'pick' && Number.isInteger(action.flake) && Number.isFinite(action.at)) // (Snowflake Match; the engine checks everything again)
        || (action?.type === 'aim' && Number.isFinite(action.yaw) && Number.isFinite(action.pitch)) // (Broadside Battle; the engine clamps it)
        || action?.type === 'fire' // (Broadside Battle)
        || (action?.type === 'look' && Number.isFinite(action.yaw)) // (Zoo Adoption)
        || (action?.type === 'grab' && Number.isInteger(action.target)) // (Zoo Adoption; the engine checks the animal and the distance)
        || action?.type === 'give' // (Zoo Adoption)
        || (action?.type === 'jump' && Number.isFinite(action.at)) // (Mountain Goats; the engine checks the time again)
        || (action?.type === 'throw' && Number.isFinite(action.x) && Number.isFinite(action.z) && Number.isFinite(action.power)); // (Santa's Sack; the engine checks the values again)
      if (!valid) return;
      const outcome = rooms.gameAction(player.id, action);
      if (!outcome) return;
      if (outcome.room.phase !== 'playing') publishOutcome(outcome); // the action ended the round
      else if (!rooms.isTicking(outcome.room.code)) scheduleTapBroadcast(outcome.room.code); // tick games stream by themselves
    });
    // A dropped connection (a refresh, closing the tab, losing signal) does NOT remove the player at once: their seat is held for the grace period, shown to the others as "reconnecting".
    // If they have not come back by then (no new connection took the seat over), they leave exactly as if they had pressed Leave.
    socket.on('disconnect', () => {
      if (socket.data.replaced) return; // (another connection of theirs has taken over: nothing to do)
      if (connections.get(player.id) === socket) connections.delete(player.id);
      if (!socket.data.roomCode) return;
      const held = rooms.setOffline(player.id);
      if (held.ok) publish(held.room);
      graceTimers.set(player.id, setTimeout(() => {
        graceTimers.delete(player.id);
        if (!rooms.isOffline(player.id)) return; // (they came back and took their seat)
        removeFromRoom(player.id);
      }, reconnectGraceMs));
    });
  });

  return () => clearInterval(loop);
}
