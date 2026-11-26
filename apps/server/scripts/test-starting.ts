/**
 * The "starting" (flash) step between the countdown and the round:  npm run test:starting -w @fgn/server
 * Rooms are driven directly (no sockets), the way test-finish-length does it.
 */
import { REVEAL_LEAD_MS, START_FLASH_IN_MS, START_FLASH_OUT_MS, STARTING_MAX_MS, STARTING_MS, type Player } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });

/** A room of `n` players with fishing picked, everyone ready: returns the manager, the code and the countdown's end time. */
function ready(options: ConstructorParameters<typeof RoomManager>[0], n = 2) {
  const rooms = new RoomManager(options);
  const made = rooms.create(player('a'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  const ids = ['a', 'b', 'c', 'd'].slice(0, n);
  ids.slice(1).forEach((id) => rooms.join(code, player(id)));
  rooms.setSettings('a', { gameId: 'tap-race' });
  let last = null as ReturnType<RoomManager['setReady']> | null;
  for (const id of ids) last = rooms.setReady(id, true);
  if (!last || !last.ok || last.room.countdownEndsAt === null) throw new Error('no countdown');
  return { rooms, code, countdownEndsAt: last.room.countdownEndsAt };
}

// ---- the flash step's timing: the round starts after the flash and the loading page ----
check('config: the starting step lasts 3.5 s, and the flash (0.6 s in + 1.4 s out) is over well before it ends', STARTING_MS === 3500 && START_FLASH_IN_MS + START_FLASH_OUT_MS < STARTING_MS);

// ---- with a flash step: countdown -> starting -> playing ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 });
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  check('after the countdown the room is in the "starting" step, not playing', s.phase === 'starting');
  check('...with the round\'s game already made (phones build it under the loading page) but its GO still provisional, past the safety deadline', s.game !== null && s.startingDeadline !== null && (s.game as { startsAt: number }).startsAt > s.startingDeadline);
  check('...and nobody can act during the step', rooms.gameAction('a', { type: 'tap' } as never) === null && rooms.stateOf(code)!.phase === 'starting');
  check('...and a time for it to end, about 250 ms away', s.startingEndsAt !== null && Math.abs(s.startingEndsAt - Date.now() - 250) < 60);
  check('a stale timer (wrong end time) does nothing', rooms.finishStarting(code, (s.startingEndsAt ?? 0) + 1) === null && rooms.stateOf(code)!.phase === 'starting');
  const before = Date.now();
  rooms.setLoaded('a'); rooms.setLoaded('b');
  check('everyone loaded early: the round still waits for the minimum time', rooms.stateOf(code)!.phase === 'starting');
  const started = rooms.finishStarting(code, s.startingEndsAt!)!;
  check('when the minimum time is over and everyone has loaded, the round starts', started.phase === 'playing' && started.game !== null && started.startingEndsAt === null && started.startingDeadline === null);
  check('...with one reveal moment for every phone, just ahead (REVEAL_LEAD_MS), and GO no earlier than it', started.revealAt !== null && Math.abs(started.revealAt - Date.now() - REVEAL_LEAD_MS) < 60 && (started.game as { startsAt: number }).startsAt >= started.revealAt);
  check('...and it is the same round the phones were building (same roundId)', started.roundId === s.roundId);
  check('...and the game\'s own clock starts only then, not at the start of the flash', (started.game as { startsAt: number }).startsAt >= before);
  check('it cannot end twice', rooms.finishStarting(code, s.startingEndsAt!) === null);
}

// ---- a player leaving during the flash step calls the round off ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 });
  rooms.finishCountdown(code, countdownEndsAt);
  rooms.leave('b');
  const s = rooms.stateOf(code)!;
  check('too few players left during the flash step: the round is called off, back to the lobby', s.phase === 'lobby' && s.startingEndsAt === null && s.game === null && s.revealAt === null);
}

// ---- a player leaving during the flash step, with enough left: they are taken out of the game being loaded ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 }, 3);
  rooms.finishCountdown(code, countdownEndsAt);
  rooms.leave('c');
  const s = rooms.stateOf(code)!;
  check('one of three leaves during the flash step: the step goes on, without them in the game', s.phase === 'starting' && !('c' in (s.game as { taps: Record<string, number> }).taps) && 'a' in (s.game as { taps: Record<string, number> }).taps);
}

// ---- someone joining during the flash step watches ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 });
  rooms.finishCountdown(code, countdownEndsAt);
  const joined = rooms.join(code, player('late'));
  check('someone who joins during the flash step starts out watching', joined.ok && joined.room.watchingIds.includes('late'));
}

// ---- with an underdog: countdown -> underdog -> starting -> playing ----
{
  const rooms = new RoomManager({ countdownMs: 0, startingMs: 250 });
  const made = rooms.create(player('A'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  ['B', 'C', 'S1', 'S2'].forEach((id) => rooms.join(code, player(id)));
  rooms.setSettings('A', { gameId: 'tap-race' });
  ['S1', 'S2'].forEach((id) => rooms.setWatching(id, true));
  rooms.setBet('S1', 'A', 0); rooms.setBet('S2', 'B', 0); // (C has no bets: the underdog)
  let last = null as ReturnType<RoomManager['setReady']> | null;
  for (const id of ['A', 'B', 'C', 'S1', 'S2']) last = rooms.setReady(id, true);
  const afterCountdown = rooms.finishCountdown(code, (last as { room: { countdownEndsAt: number } }).room.countdownEndsAt)!;
  check('with an underdog, the countdown leads to the announcement first', afterCountdown.phase === 'underdog');
  const afterAnnouncement = rooms.finishUnderdog(code, afterCountdown.underdogEndsAt!)!;
  check('...then the announcement leads to the flash step (not straight to the round)', afterAnnouncement.phase === 'starting' && afterAnnouncement.underdogEndsAt === null);
  check('...and the underdog is still remembered through it', afterAnnouncement.underdog?.playerId === 'C');
  ['A', 'B', 'C', 'S1', 'S2'].forEach((id) => rooms.setLoaded(id)); // (spectators load the game too)
  check('...then the round starts', rooms.finishStarting(code, afterAnnouncement.startingEndsAt!)!.phase === 'playing');
}

// ---- the step is also a LOADING step: the round waits for slow phones ----
check('config: the safety net is longer than the minimum', STARTING_MAX_MS > STARTING_MS);
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 100, startingMaxMs: 2000 }, 3);
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  check('the step carries a deadline (the safety net), later than the minimum', s.startingDeadline !== null && s.startingEndsAt !== null && s.startingDeadline > s.startingEndsAt);
  check('nobody can report loaded unless the room is in the starting step', (() => { const r = new RoomManager({ countdownMs: 0 }); const m = r.create(player('x')); return m.ok && !r.setLoaded('x').ok; })());
  rooms.setLoaded('a'); rooms.setLoaded('b');
  check('minimum over but one phone is still loading: the round does NOT start', rooms.finishStarting(code, s.startingEndsAt!) === null && rooms.stateOf(code)!.phase === 'starting');
  check('...it keeps waiting (the minimum timer is spent, the deadline remains)', rooms.stateOf(code)!.startingEndsAt === null && rooms.stateOf(code)!.startingDeadline === s.startingDeadline);
  const r = rooms.setLoaded('c');
  check('the last phone reports: the round starts at once', r.ok && r.room.phase === 'playing' && r.room.game !== null && r.room.startingDeadline === null);
  check('a late report once it has started is refused and harmless', !rooms.setLoaded('a').ok && rooms.stateOf(code)!.phase === 'playing');
  check('the deadline timer is then stale and does nothing', rooms.forceStarting(code, s.startingDeadline!) === null);
}
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 100, startingMaxMs: 300 }, 3);
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  rooms.setLoaded('a');
  rooms.finishStarting(code, s.startingEndsAt!);
  check('a stale deadline (wrong time) does nothing', rooms.forceStarting(code, s.startingDeadline! + 1) === null && rooms.stateOf(code)!.phase === 'starting');
  const forced = rooms.forceStarting(code, s.startingDeadline!)!;
  check('the deadline starts the round even though two phones never reported', forced.phase === 'playing' && forced.game !== null);
}
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 100 }, 3);
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  rooms.setLoaded('a'); rooms.setLoaded('b');
  rooms.finishStarting(code, s.startingEndsAt!);
  const dropped = rooms.setOffline('c');
  check('the phone being waited for loses its connection: the rest do not wait for it', dropped.ok && dropped.room.phase === 'playing');
}
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 100 }, 3);
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  rooms.setLoaded('a'); rooms.setLoaded('b');
  rooms.finishStarting(code, s.startingEndsAt!);
  rooms.leave('c');
  check('the phone being waited for leaves (and two players are enough): the round starts', rooms.stateOf(code)!.phase === 'playing');
}
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 100 }, 2);
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  rooms.setLoaded('a'); rooms.setLoaded('b');
  const started = rooms.finishStarting(code, s.startingEndsAt!)!;
  check('a new round starts with a clean slate: no one counts as loaded from the last one', started.phase === 'playing' && (rooms as unknown as { rooms: Map<string, { loaded: Set<string> }> }).rooms.get(code)!.loaded.size === 0);
}

// ---- defaults ----
{
  const fast = ready({ countdownMs: 0 }); // a test that shortens the countdown gets no flash step...
  check('a test that shortens the countdown gets no flash step: it goes straight to playing', fast.rooms.finishCountdown(fast.code, fast.countdownEndsAt)!.phase === 'playing');
  const real = ready({}); // ...but the real defaults do have one
  const s = real.rooms.finishCountdown(real.code, real.countdownEndsAt)!;
  check('the real defaults have the flash step, STARTING_MS long', s.phase === 'starting' && s.startingEndsAt !== null && Math.abs(s.startingEndsAt - Date.now() - STARTING_MS) < 80);
}

console.log(failures === 0 ? '\nAll starting-step checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
