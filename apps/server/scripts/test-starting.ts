/**
 * The "starting" (flash) step between the countdown and the round:  npm run test:starting -w @fgn/server
 * Rooms are driven directly (no sockets), the way test-finish-length does it.
 */
import { START_FLASH_IN_MS, START_FLASH_OUT_MS, START_FLASH_OVERLAP_MS, STARTING_MS, type Player } from '@fgn/shared';
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

// ---- the flash step's timing: the round starts a little before the flash has finished fading ----
check('config: the starting step is flash in + flash out - the overlap (0.6 + 1.4 - 0.3 = 1.7 s)', STARTING_MS === START_FLASH_IN_MS + START_FLASH_OUT_MS - START_FLASH_OVERLAP_MS && STARTING_MS === 1700);

// ---- with a flash step: countdown -> starting -> playing ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 });
  const s = rooms.finishCountdown(code, countdownEndsAt)!;
  check('after the countdown the room is in the "starting" step, not playing', s.phase === 'starting');
  check('...with no game yet (nobody can play during the flash)', s.game === null);
  check('...and a time for it to end, about 250 ms away', s.startingEndsAt !== null && Math.abs(s.startingEndsAt - Date.now() - 250) < 60);
  check('a stale timer (wrong end time) does nothing', rooms.finishStarting(code, (s.startingEndsAt ?? 0) + 1) === null && rooms.stateOf(code)!.phase === 'starting');
  const before = Date.now();
  const started = rooms.finishStarting(code, s.startingEndsAt!)!;
  check('when the step ends the round starts', started.phase === 'playing' && started.game !== null && started.startingEndsAt === null);
  check('...and the game\'s own clock starts only then, not at the start of the flash', (started.game as { startsAt: number }).startsAt >= before);
  check('it cannot end twice', rooms.finishStarting(code, s.startingEndsAt!) === null);
}

// ---- a player leaving during the flash step calls the round off ----
{
  const { rooms, code, countdownEndsAt } = ready({ countdownMs: 0, startingMs: 250 });
  rooms.finishCountdown(code, countdownEndsAt);
  rooms.leave('b');
  const s = rooms.stateOf(code)!;
  check('too few players left during the flash step: the round is called off, back to the lobby', s.phase === 'lobby' && s.startingEndsAt === null);
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
  check('...then the announcement leads to the flash step (not straight to the round)', afterAnnouncement.phase === 'starting' && afterAnnouncement.game === null);
  check('...and the underdog is still remembered through it', afterAnnouncement.underdog?.playerId === 'C');
  check('...then the round starts', rooms.finishStarting(code, afterAnnouncement.startingEndsAt!)!.phase === 'playing');
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
