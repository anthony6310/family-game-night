/**
 * How long each game's end-of-round sequence lasts, with the real defaults (no test overrides):
 *   npm run test:finish-length -w @fgn/server
 * Tap Race: 1.5 s on your own button + 3 s naming the winner = 4.5 s. Snowball: the usual 3 s.
 */
import { TAP_RACE_FINISH_SECONDS, TAP_RACE_OWN_BUTTON_SECONDS, TAP_RACE_WINNER_SECONDS, type GameId, type Player } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });

/** Runs one round of `game` in a fresh room and returns how long (ms) the finish sequence is scheduled to last. */
function finishLength(game: GameId, options: { finishMs?: number } = {}): number {
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 100, snowballMs: 100, ...options });
  const made = rooms.create(player('a'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  rooms.join(code, player('b'));
  rooms.setSettings('a', { gameId: game });
  rooms.setReady('a', true);
  const ready = rooms.setReady('b', true);
  if (!ready.ok || ready.room.countdownEndsAt === null) throw new Error('no countdown');
  const started = rooms.finishCountdown(code, ready.room.countdownEndsAt);
  if (!started || !started.game) throw new Error('round did not start');
  if (game === 'tap-race') rooms.gameAction('a', { type: 'tap' });
  const ended = rooms.finishRound(code, started.game.endsAt);
  if (!ended || ended.room.phase !== 'finish' || ended.room.finishEndsAt === null) throw new Error('round did not enter the finish phase');
  return ended.room.finishEndsAt - ended.room.serverTime;
}

check('config: Tap Race finish = 1.5 s own button + 3 s winner = 4.5 s', TAP_RACE_OWN_BUTTON_SECONDS === 1.5 && TAP_RACE_WINNER_SECONDS === 3 && TAP_RACE_FINISH_SECONDS === 4.5);
const tap = finishLength('tap-race');
check(`Tap Race: its finish sequence lasts 4.5 s (got ${tap} ms)`, Math.abs(tap - 4500) <= 30);
const snow = finishLength('snowball');
check(`Snowball: it now ends with the same winner sequence, 4.5 s (got ${snow} ms)`, Math.abs(snow - 4500) <= 30);
const lasso = finishLength('penguin-lasso');
check(`Penguin Lasso: the same 4.5 s winner sequence (got ${lasso} ms)`, Math.abs(lasso - 4500) <= 30);
const forced = finishLength('tap-race', { finishMs: 500 });
check(`a test override still applies to every game (got ${forced} ms)`, Math.abs(forced - 500) <= 30);

console.log(failures === 0 ? '\nAll finish-length checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
