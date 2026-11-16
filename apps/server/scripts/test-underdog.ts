/**
 * The underdog rule (room manager only, no sockets):  npm run test:underdog -w @fgn/server
 * With 3+ players, if exactly one player has no bets on them and every other player has one, that player is the underdog:
 * everyone sees an announcement, and if they win (or are tied for first in a draw) they get +1 plus 1 per bettor.
 */
import type { Player } from '@fgn/shared';
import { RoomManager, personalize } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });

/** A room with `players` playing and `spectators` watching, on Tap Race. `bets` = [spectator, target, stake][]. Returns the manager and code. */
function setup(players: string[], spectators: string[], bets: [string, string, number][]) {
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0 });
  const made = rooms.create(player(players[0]));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  for (const id of [...players.slice(1), ...spectators]) rooms.join(code, player(id));
  rooms.setSettings(players[0], { gameId: 'tap-race' });
  for (const id of spectators) rooms.setWatching(id, true);
  const wins = (rooms as unknown as { rooms: Map<string, { wins: Record<string, number> }> }).rooms.get(code)!.wins;
  for (const id of spectators) wins[id] = 10; // points to stake
  for (const [who, target, stake] of bets) if (!rooms.setBet(who, target, stake).ok) throw new Error(`bet failed: ${who}`);
  for (const id of [...players, ...spectators]) rooms.setReady(id, true);
  return { rooms, code, wins };
}
/** Ends the countdown and (if there is an announcement) the announcement, returning the room state once the round is playing. */
function toPlaying(r: ReturnType<typeof setup>) {
  const state = r.rooms.stateOf(r.code)!;
  const afterCountdown = r.rooms.finishCountdown(r.code, state.countdownEndsAt!)!;
  if (afterCountdown.phase !== 'underdog') return { afterCountdown, playing: afterCountdown };
  return { afterCountdown, playing: r.rooms.finishUnderdog(r.code, afterCountdown.underdogEndsAt!)! };
}
/** Ends the countdown only: the room is now showing the underdog announcement (or has started, if there is none). */
function toAnnouncement(r: ReturnType<typeof setup>) {
  return r.rooms.finishCountdown(r.code, r.rooms.stateOf(r.code)!.countdownEndsAt!)!;
}
const finish = (r: ReturnType<typeof setup>, endsAt: number) => r.rooms.finishRound(r.code, endsAt)!;

const FOUR = ['A', 'B', 'C', 'D'];

// ---- an underdog: D has no bets, everyone else does ----
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 0], ['S2', 'B', 2], ['S3', 'C', 0]]);
  const { afterCountdown, playing } = toPlaying(r);
  check('after the countdown there is an underdog announcement before the round', afterCountdown.phase === 'underdog' && afterCountdown.game === null && afterCountdown.underdogEndsAt !== null);
  check('the underdog is the unbacked player, with 1 point per bettor against them as the bonus', afterCountdown.underdog?.playerId === 'D' && afterCountdown.underdog.bonus === 3);
  check('the announcement is shown to everyone: it is in the shared state', Boolean(personalize(afterCountdown, 'A').underdog) && Boolean(personalize(afterCountdown, 'S1').underdog));
  check('nothing can be changed during the announcement', r.rooms.setBet('S1', 'B', 0).ok === false && r.rooms.setWatching('A', true).ok === false);
  check('a stale announcement timer does nothing', r.rooms.finishUnderdog(r.code, 1) === null);
  check('then the round starts', playing.phase === 'playing' && playing.game !== null);
  r.rooms.gameAction('D', { type: 'tap' });
  const ended = finish(r, playing.game!.endsAt);
  const res = ended.room.result!;
  check('the underdog wins outright: +1 for the win and +3 bonus = 4', res.winnerId === 'D' && ended.room.scores.D === 4 && res.underdog?.bonus === 3 && res.underdog.byDraw === false);
  check('the bonus is not taken from the bettors (their stakes are lost only because they bet wrong)', ended.room.scores.S1 === 10 && ended.room.scores.S2 === 8 && ended.room.scores.S3 === 10);
  check('nobody backed the winner, so there are no winning bettors', res.winningBettors.length === 0);
}

// ---- a draw with the underdog in the tie: the underdog wins it ----
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 3], ['S2', 'B', 0], ['S3', 'C', 4]]);
  const { playing } = toPlaying(r); // nobody taps: everyone is tied at zero, the underdog included
  const ended = finish(r, playing.game!.endsAt);
  const res = ended.room.result!;
  check('a draw that includes the underdog is won by the underdog (+1 and the +3 bonus)', res.winnerId === 'D' && res.underdog?.byDraw === true && ended.room.scores.D === 4);
  check('...and that is a round played', ended.room.roundsPlayed === 1);
  check('...the bets are lost (nobody they backed won)', ended.room.scores.S1 === 7 && ended.room.scores.S3 === 6 && ended.room.scores.S2 === 10);
}

// ---- a draw that does NOT include the underdog is just a draw ----
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 3], ['S2', 'B', 0], ['S3', 'C', 4]]);
  const { playing } = toPlaying(r);
  r.rooms.gameAction('A', { type: 'tap' });
  r.rooms.gameAction('B', { type: 'tap' }); // A and B tie at 1, the underdog D has 0
  const ended = finish(r, playing.game!.endsAt);
  check('a tie among others leaves the underdog out: no winner, no bonus', ended.room.result!.winnerId === null && ended.room.result!.underdog === null && ended.room.scores.D === undefined);
  check('and every bet on a drawn round is lost (stakes only: free bets lose nothing)', ended.room.scores.S1 === 7 && ended.room.scores.S2 === 10 && ended.room.scores.S3 === 6);
}

// ---- when there is no underdog ----
{
  const twoPlayers = setup(['A', 'B'], ['S1'], [['S1', 'A', 0]]);
  check('fewer than 3 players: no underdog, the round starts straight after the countdown', toPlaying(twoPlayers).afterCountdown.phase === 'playing');
  const three = setup(['A', 'B', 'C'], ['S1', 'S2'], [['S1', 'A', 0], ['S2', 'B', 0]]);
  check('3 players is enough: C is the underdog with a bonus of 2', toAnnouncement(three).underdog?.playerId === 'C' && three.rooms.stateOf(three.code)!.underdog!.bonus === 2);
  const two = setup(FOUR, ['S1', 'S2'], [['S1', 'A', 0], ['S2', 'B', 0]]);
  check('two players with no bets: no underdog', toPlaying(two).afterCountdown.phase === 'playing');
  const all = setup(FOUR, ['S1', 'S2', 'S3', 'S4'], [['S1', 'A', 0], ['S2', 'B', 0], ['S3', 'C', 0], ['S4', 'D', 0]]);
  check('everyone has a bet: no underdog', toPlaying(all).afterCountdown.phase === 'playing');
  const none = setup(FOUR, [], []);
  check('nobody bet at all: no underdog', toPlaying(none).afterCountdown.phase === 'playing');
  const draw = setup(['A', 'B'], ['S1'], [['S1', 'A', 4]]);
  const { playing } = toPlaying(draw);
  const ended = finish(draw, playing.game!.endsAt); // nobody taps
  check('a plain draw: no winner, and the bet on a player who did not win is lost', ended.room.result!.winnerId === null && ended.room.scores.S1 === 6);
}

// ---- people leaving ----
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 0], ['S2', 'B', 0], ['S3', 'C', 5]]);
  const afterCountdown = toAnnouncement(r);
  r.rooms.leave('S1'); // a bettor leaves during the announcement: the announced bonus stays 3
  const playing = r.rooms.finishUnderdog(r.code, afterCountdown.underdogEndsAt!)!;
  check('the announced bonus is fixed even if a bettor leaves', playing.underdog?.bonus === 3);
  r.rooms.leave('B'); // a player that was bet on leaves mid-round: that bet is void
  r.rooms.gameAction('D', { type: 'tap' });
  const ended = finish(r, playing.game!.endsAt);
  check('the underdog still wins and gets the full bonus', ended.room.result!.winnerId === 'D' && ended.room.scores.D === 4);
  check('a bet on a player who left is void (S2 keeps their points); other bets still settle', ended.room.scores.S2 === 10 && ended.room.scores.S3 === 5);
}
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 0], ['S2', 'B', 0], ['S3', 'C', 0]]);
  const afterCountdown = toAnnouncement(r);
  r.rooms.leave('D'); // the underdog leaves during the announcement
  const playing = r.rooms.finishUnderdog(r.code, afterCountdown.underdogEndsAt!)!;
  check('if the underdog leaves there is no underdog', playing.underdog === null);
}
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 0], ['S2', 'B', 0], ['S3', 'C', 0]]);
  const during = toAnnouncement(r);
  r.rooms.leave('B'); r.rooms.leave('C'); r.rooms.leave('D'); // only one player is left (Tap Race needs 2)
  check('too few players left in the announcement: the round is called off and bets are void', during.phase === 'underdog' && r.rooms.stateOf(r.code)!.phase === 'lobby' && Object.keys(r.rooms.stateOf(r.code)!.bets).length === 0);
}

// ---- bets are private ----
{
  const r = setup(FOUR, ['S1', 'S2', 'S3'], [['S1', 'A', 0], ['S2', 'B', 2], ['S3', 'C', 0]]);
  const state = r.rooms.stateOf(r.code)!;
  check('the room state knows every bet (server side)', Object.keys(state.bets).length === 3);
  check('a spectator is only ever sent their own bet', JSON.stringify(Object.keys(personalize(state, 'S2').bets)) === '["S2"]' && personalize(state, 'S2').bets.S2.stake === 2);
  check('a player is sent no bets at all', Object.keys(personalize(state, 'A').bets).length === 0);
  const { playing } = toPlaying(r);
  r.rooms.gameAction('A', { type: 'tap' });
  const ended = finish(r, playing.game!.endsAt);
  check('bet results are private too: you only get your own', personalize(ended.room, 'S1').result!.bets.length === 1 && personalize(ended.room, 'S1').result!.bets[0].bettorId === 'S1'
    && personalize(ended.room, 'B').result!.bets.length === 0);
  check('...while the winning bettors are public, with what they won', ended.room.result!.winningBettors.length === 1 && ended.room.result!.winningBettors[0].bettorId === 'S1' && ended.room.result!.winningBettors[0].delta === 1);
}
console.log(failures === 0 ? '\nAll underdog checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
