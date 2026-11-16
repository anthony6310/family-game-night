/**
 * Spectator betting rules (room manager only, no sockets):  npm run test:betting -w @fgn/server
 * Spectators bet on a player to win; a win pays 1 point + their stake, a loss costs the stake, a draw counts as a loss for every bet.
 */
import type { Player, RoomState } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? 'none' : r.error);

const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0 });
const made = rooms.create(player('A'));
if (!made.ok) throw new Error('create failed');
const code = made.room.code;
for (const id of ['B', 'C', 'D', 'E']) rooms.join(code, player(id));
rooms.setSettings('A', { gameId: 'tap-race' });
// Give the spectators some victory points to bet with (test-only access to the room's scores).
const wins = (rooms as unknown as { rooms: Map<string, { wins: Record<string, number> }> }).rooms.get(code)!.wins;
Object.assign(wins, { C: 6, D: 0, E: 4 });
const state = (): RoomState => rooms.stateOf(code)!;

for (const id of ['C', 'D', 'E']) rooms.setWatching(id, true); // C, D, E spectate; A and B play

// ---- who can bet, and how ----
check('players cannot bet', errorOf(rooms.setBet('A', 'B', 0)) === 'NOT_A_SPECTATOR');
check('you can only bet on someone who is playing', errorOf(rooms.setBet('C', 'D', 0)) === 'INVALID_BET');
check('you cannot stake more points than you have', errorOf(rooms.setBet('C', 'A', 7)) === 'INVALID_BET' && errorOf(rooms.setBet('D', 'A', 1)) === 'INVALID_BET');
check('a stake of 1 is below the minimum (a stake is 0, or 2 or more)', errorOf(rooms.setBet('C', 'A', 1)) === 'INVALID_BET' && rooms.setBet('C', 'A', 2).ok);
check('a stake must be a whole number of points, not negative', errorOf(rooms.setBet('C', 'A', 1.5)) === 'INVALID_BET' && errorOf(rooms.setBet('C', 'A', -1)) === 'INVALID_BET');
check('a bet with no extra stake is fine (the free 1-point bet)', rooms.setBet('D', 'B', 0).ok && state().bets.D?.targetId === 'B' && state().bets.D.stake === 0);

// ---- the ready step includes spectators ----
rooms.setReady('A', true); rooms.setReady('B', true);
check('the round does not start while a spectator is not ready', state().phase === 'lobby');
check('spectators can ready up', rooms.setReady('D', true).ok && rooms.setReady('C', true).ok === true);
check('...and still it waits for the last spectator', state().phase === 'lobby');
check('C bets 5 of their 6 points on A (changing a bet drops C\'s ready)', rooms.setBet('C', 'A', 5).ok && state().bets.C.stake === 5 && !state().readyIds.includes('C'));
rooms.setBet('E', 'B', 3);
rooms.setReady('C', true);
check('the countdown starts once everyone, spectators included, is ready', rooms.setReady('E', true).ok && state().phase === 'countdown');
check('bets cannot be changed once the countdown is running... (changing one cancels it)', rooms.setBet('E', 'B', 4).ok && state().phase === 'lobby');
rooms.setReady('E', true);
const started = rooms.finishCountdown(code, state().countdownEndsAt!);
check('the round starts and the bets are kept', started?.phase === 'playing' && Object.keys(started.bets).length === 3);
check('bets cannot be changed mid-round', errorOf(rooms.setBet('C', 'B', 0)) === 'WRONG_PHASE');

// ---- settle: A wins ----
rooms.gameAction('A', { type: 'tap' });
const ended = rooms.finishRound(code, started!.game!.endsAt)!;
const bets = ended.room.result!.bets;
const byBettor = Object.fromEntries(bets.map((b) => [b.bettorId, b]));
check('a winning staked bet wins exactly the stake (no extra point): C had 6, put up 5 on A, now 11', byBettor.C.delta === 5 && ended.room.scores.C === 11);
check('a losing free bet costs nothing', byBettor.D.delta === 0 && (ended.room.scores.D ?? 0) === 0);
check('a losing bet costs the stake: E had 4, put 4 on B, now 0', byBettor.E.delta === -4 && (ended.room.scores.E ?? 0) === 0);
check('the player who won still gets their point', ended.room.scores.A === 1);
check('bets are cleared once settled', Object.keys(ended.room.bets).length === 0);
// finish -> results -> lobby
const results = rooms.finishFinish(code, ended.room.finishEndsAt!)!;
rooms.finishResults(code, results.resultsEndsAt!);
check('back in the lobby with no bets left over', state().phase === 'lobby' && Object.keys(state().bets).length === 0);

// ---- a free bet that wins pays 1 point ----
rooms.setBet('D', 'A', 0);
for (const id of ['A', 'B', 'C', 'D', 'E']) rooms.setReady(id, true);
const startedFree = rooms.finishCountdown(code, state().countdownEndsAt!);
rooms.gameAction('A', { type: 'tap' });
const endedFree = rooms.finishRound(code, startedFree!.game!.endsAt)!;
check('a free bet (no stake) that wins pays 1 point', endedFree.room.result!.bets.find((b) => b.bettorId === 'D')!.delta === 1 && endedFree.room.scores.D === 1);
const resultsFree = rooms.finishFinish(code, endedFree.room.finishEndsAt!)!;
rooms.finishResults(code, resultsFree.resultsEndsAt!);

// ---- a draw is a loss for every bet ----
rooms.setBet('C', 'A', 4);
for (const id of ['A', 'B', 'C', 'D', 'E']) rooms.setReady(id, true);
const started2 = rooms.finishCountdown(code, state().countdownEndsAt!);
const drawn = rooms.finishRound(code, started2!.game!.endsAt)!; // nobody tapped: a draw
check('a draw counts as a loss: C put up 4 on A and loses it (11 -> 7)', drawn.room.result!.winnerId === null && drawn.room.result!.bets[0].delta === -4 && drawn.room.scores.C === 7);
const results2 = rooms.finishFinish(code, drawn.room.finishEndsAt!)!;
rooms.finishResults(code, results2.resultsEndsAt!);

// ---- bets that can no longer stand ----
rooms.setBet('C', 'A', 0);
rooms.setReady('C', true);
rooms.setWatching('A', true); // the player C bet on goes to watch
check('if the player you bet on stops playing, your bet is dropped and you must ready again', state().bets.C === undefined && !state().readyIds.includes('C'));
rooms.setWatching('A', false);
rooms.setBet('C', 'A', 0);
rooms.leave('C');
check('a spectator who leaves takes their bet with them', state().bets.C === undefined);
check('...but keeps their points on record (7) for the session winner', state().scores.C === 7);
// stake is clamped to what you have when the round starts
rooms.setBet('E', 'B', 0);
console.log(failures === 0 ? '\nAll betting checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
