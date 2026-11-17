/**
 * The in-game start countdown (GAME_INTRO_SECONDS):  npm run test:intro -w @fgn/server
 * The round's clock starts a few seconds after the scene is shown; until then nothing moves and nobody can act.
 */
import { GAME_INTRO_HOLD_SECONDS, GAME_INTRO_SECONDS, type GameId, type Player, type SnowballView, type TapRaceView } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Two ready players with `gameId`; runs the (zero-length) countdown/flash steps so the round is playing. */
function started(gameId: GameId, options: ConstructorParameters<typeof RoomManager>[0]) {
  const rooms = new RoomManager({ countdownMs: 0, startingMs: 0, ...options });
  const made = rooms.create(player('a'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  rooms.join(code, player('b'));
  rooms.setSettings('a', { gameId });
  rooms.setReady('a', true);
  const last = rooms.setReady('b', true);
  if (!last.ok || last.room.countdownEndsAt === null) throw new Error('no countdown');
  const state = rooms.finishCountdown(code, last.room.countdownEndsAt)!;
  return { rooms, code, state };
}

check('config: 3 seconds of start countdown, 2 of them hanging over the players before the camera moves in', GAME_INTRO_SECONDS === 3 && GAME_INTRO_HOLD_SECONDS === 2);

{
  // Tap Race: the scene is shown at once, the clock starts after the intro; taps before it are ignored
  const { rooms, state } = started('tap-race', { introMs: 400 });
  const v = state.game as TapRaceView;
  check('the round is "playing" at once, but its clock starts 0.4 s later', state.phase === 'playing' && v.startsAt - Date.now() > 250 && v.startsAt - Date.now() <= 420);
  rooms.gameAction('a', { type: 'tap' });
  const early = rooms.gameAction('a', { type: 'tap' });
  check('taps during the start countdown are ignored', early === null);
  await sleep(450);
  rooms.gameAction('a', { type: 'tap' });
  check('after GO a tap counts', (rooms.gameAction('b', { type: 'tap' })?.room.game as TapRaceView | undefined)?.taps.b === 1);
}
{
  // Snowball (an engine with a tick loop): nothing moves during the countdown
  const { rooms, code, state } = started('snowball', { introMs: 400 });
  const v = state.game as SnowballView;
  rooms.gameAction('a', { type: 'steer', x: 1, z: 0 });
  const early = rooms.tick(Date.now());
  check('the tick loop does not run during the start countdown (no snapshots, nothing moves)', early.length === 0);
  await sleep(450);
  rooms.gameAction('a', { type: 'steer', x: 1, z: 0 });
  await sleep(100);
  const late = rooms.tick(Date.now());
  const after = late.find((r) => r.code === code)?.view as SnowballView | undefined;
  const moved = after && Math.hypot(after.balls.a.x - v.balls.a.x, after.balls.a.z - v.balls.a.z) > 0.01;
  check('after GO the balls move again', Boolean(moved));
}
{
  // the real defaults: ordinary games get GAME_INTRO_SECONDS, Fishing (which has its own opening) gets none
  const real = started('tap-race', { countdownMs: undefined, startingMs: 0 });
  check('by default Tap Race starts GAME_INTRO_SECONDS after the scene is shown', Math.abs((real.state.game as TapRaceView).startsAt - Date.now() - GAME_INTRO_SECONDS * 1000) < 100);
  const fishing = started('fishing', { countdownMs: undefined, startingMs: 0 });
  check('by default Fishing has no extra intro (its cast is the opening)', Math.abs((fishing.state.game as { startsAt: number }).startsAt - Date.now()) < 100);
}

console.log(failures === 0 ? '\nAll start-countdown checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
