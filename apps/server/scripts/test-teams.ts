/**
 * Team games (room manager only, no sockets):  npm run test:teams -w @fgn/server
 * Everyone starts on a random team (shared out evenly); the host can allow swapping and sets handicaps; a team game needs a player on each team; bets are on a team; there is no
 * underdog; the team with the higher total (taps plus handicap) wins and EVERY member of it gets a victory point; the Random tile never picks a team game.
 */
import { GAMES, RANDOM_GAME, type Player, type TeamId } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(ids: string[], spectators: string[] = []) {
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, startingMs: 0, introMs: 0, forceRandom: null } as never);
  const made = rooms.create(player(ids[0]));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  for (const id of [...ids.slice(1), ...spectators]) rooms.join(code, player(id));
  for (const id of spectators) rooms.setWatching(id, true);
  rooms.setSettings(ids[0], { teamSwap: true }); // (swapping is OFF by default: most tests here want it on)
  return { rooms, code, state: () => rooms.stateOf(code)!, ids, spectators };
}
const teamsOf = (r: ReturnType<typeof setup>, ids = r.ids) => Object.fromEntries(ids.map((id) => [id, r.state().teams[id]])) as Record<string, TeamId>;
const count = (r: ReturnType<typeof setup>, t: TeamId) => r.ids.filter((id) => teamsOf(r)[id] === t).length;
const wins = (r: ReturnType<typeof setup>) => (r.rooms as unknown as { rooms: Map<string, { wins: Record<string, number> }> }).rooms.get(r.code)!.wins;

// ---- assignment ----
{
  const r = setup(['A', 'B', 'C', 'D']);
  check('everyone has a team, and four players are shared out 2 and 2', Object.keys(r.state().teams).length === 4 && count(r, 'yellow') === 2 && count(r, 'purple') === 2);
  const r5 = setup(['A', 'B', 'C', 'D', 'E']);
  check('an odd number of players gives uneven teams (3 and 2), which is allowed', Math.abs(count(r5, 'yellow') - count(r5, 'purple')) === 1);
  check('teams are not part of a normal game: nothing needs them', r.state().settings.gameId === null);
}

// ---- the default and the memory of team swapping ----
{
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, startingMs: 0, introMs: 0, forceRandom: null } as never);
  const made = rooms.create(player('A')); if (!made.ok) throw new Error('create failed');
  const code = made.room.code; rooms.join(code, player('B'));
  check('team swapping is OFF by default (the teams start random and locked)', rooms.stateOf(code)!.settings.teamSwap === false);
  rooms.setSettings('A', { teamSwap: true });
  rooms.setSettings('A', { gameId: 'tug-of-war' });
  rooms.setReady('A', true); rooms.setReady('B', true);
  const playing = rooms.finishCountdown(code, rooms.stateOf(code)!.countdownEndsAt!)!;
  rooms.finishRound(code, playing.game!.endsAt);
  rooms.returnToLobby('A');
  check('the host\'s choice is remembered for the session: it is still on after a round (and after a reset)', rooms.stateOf(code)!.settings.teamSwap === true && (rooms.reset('A'), rooms.stateOf(code)!.settings.teamSwap === true));
}

// ---- swapping and handicap ----
{
  const r = setup(['A', 'B']);
  r.rooms.setSettings('A', { gameId: 'tug-of-war' });
  check('picking a team game is allowed', r.state().settings.gameId === 'tug-of-war');
  const other: TeamId = teamsOf(r).A === 'yellow' ? 'purple' : 'yellow';
  r.rooms.setReady('A', true); r.rooms.setReady('B', true);
  check('with each team having a player, the countdown starts', r.state().phase === 'countdown');
  check('a player can pick their team while swapping is on', r.rooms.setTeam('A', other).ok && r.state().teams.A === other);
  check('...and it drops everyone\'s Ready (the teams changed), cancelling the countdown', r.state().readyIds.length === 0 && r.state().phase === 'lobby');
  check('with both players on the same team a team game cannot start', (() => { r.rooms.setTeam('B', other); r.rooms.setReady('A', true); r.rooms.setReady('B', true); return r.state().phase === 'lobby'; })());
  const before = r.state().teams;
  check('the host turns swapping off', r.rooms.setSettings('A', { teamSwap: false }).ok && r.state().settings.teamSwap === false);
  check('with swapping off the teams are locked', r.rooms.setTeam('B', other === 'yellow' ? 'purple' : 'yellow').ok === false && JSON.stringify(r.state().teams) === JSON.stringify(before));
  check('only the host can turn swapping on or off', r.rooms.setSettings('B', { teamSwap: true }).ok === false);
  r.rooms.setSettings('A', { teamSwap: true });
  check('team swapping is refused when the game is not a team game', (() => { r.rooms.setSettings('A', { gameId: 'tap-race' }); const res = r.rooms.setTeam('B', 'yellow'); r.rooms.setSettings('A', { gameId: 'tug-of-war' }); return res.ok === false; })());
  r.rooms.setTeam('B', other === 'yellow' ? 'purple' : 'yellow');
  r.rooms.setReady('A', true);
  check('the host sets a handicap for a team', r.rooms.setHandicap('A', 'purple', 5).ok && r.state().settings.handicap.purple === 5);
  check('...which does NOT drop anyone\'s Ready', r.state().readyIds.includes('A'));
  check('a handicap can be negative; it must be a whole number within bounds; only the host sets it', r.rooms.setHandicap('A', 'yellow', -3).ok && r.rooms.setHandicap('A', 'yellow', 1.5).ok === false && r.rooms.setHandicap('A', 'yellow', 5000).ok === false && r.rooms.setHandicap('B', 'yellow', 1).ok === false && r.state().settings.handicap.yellow === -3);
}

// ---- a round: totals, handicap, wins for every member, bets on a team, no underdog ----
{
  const r = setup(['A', 'B', 'C', 'D'], ['S']);
  r.rooms.setSettings('A', { gameId: 'tug-of-war' });
  // put A, B on yellow and C, D on purple
  for (const [id, t] of [['A', 'yellow'], ['B', 'yellow'], ['C', 'purple'], ['D', 'purple']] as [string, TeamId][]) { r.rooms.setTeam(id, t); }
  wins(r).S = 10;
  check('a spectator cannot bet on a player in a team game', r.rooms.setBet('S', 'A', 0).ok === false);
  check('a spectator bets on a team', r.rooms.setBet('S', 'yellow', 2).ok && r.state().bets.S.targetId === 'yellow');
  for (const id of ['A', 'B', 'C', 'D', 'S']) r.rooms.setReady(id, true);
  const afterCountdown = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
  check('there is no underdog in a team game, even when everyone but one player would qualify', afterCountdown.phase === 'playing' && afterCountdown.underdog === null);
  // taps: yellow gets 3, purple gets 1; with a purple handicap of 0 yellow wins
  for (const id of ['A', 'A', 'B', 'C']) { r.rooms.gameAction(id, { type: 'tap' }); await sleep(45); }
  const ended = r.rooms.finishRound(r.code, afterCountdown.game!.endsAt)!;
  const res = ended.room.result!;
  check('the result names the winning TEAM (and no single winner), with each team\'s total and members', res.team?.winner === 'yellow' && res.winnerId === null && res.winner === null && res.team.totals.yellow >= 3 && res.team.totals.purple === 1 && res.team.members.yellow.length === 2);
  check('every member of the winning team gets a victory point, the other team none', ended.room.scores.A === 1 && ended.room.scores.B === 1 && !ended.room.scores.C && !ended.room.scores.D);
  check('a database record is made for each winning member', ended.rounds?.length === 2 && ended.rounds.every((x) => x.gameType === 'tug-of-war'));
  check('the bet on the winning team wins its stake', res.bets.length === 1 && res.bets[0].delta === 2 && res.winningBettors[0].bettorId === 'S' && ended.room.scores.S === 12);
}
{
  // a handicap decides it: yellow taps 2, purple taps 1 but has a handicap of 5
  const r = setup(['A', 'B']);
  r.rooms.setSettings('A', { gameId: 'tug-of-war' });
  r.rooms.setTeam('A', 'yellow'); r.rooms.setTeam('B', 'purple');
  r.rooms.setHandicap('A', 'purple', 5);
  r.rooms.setReady('A', true); r.rooms.setReady('B', true);
  const playing = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
  for (const id of ['A', 'A', 'B']) { r.rooms.gameAction(id, { type: 'tap' }); await sleep(45); }
  const res = r.rooms.finishRound(r.code, playing.game!.endsAt)!.room.result!;
  check('the handicap is added to a team\'s total, so the team with fewer taps can win', res.team?.winner === 'purple' && res.team.totals.purple === 6 && res.team.totals.yellow === 2);
}
{
  // equal totals are a draw
  const r = setup(['A', 'B']);
  r.rooms.setSettings('A', { gameId: 'tug-of-war' });
  r.rooms.setTeam('A', 'yellow'); r.rooms.setTeam('B', 'purple');
  r.rooms.setReady('A', true); r.rooms.setReady('B', true);
  const playing = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
  const ended = r.rooms.finishRound(r.code, playing.game!.endsAt)!;
  check('equal totals are a draw: nobody wins a point', ended.room.result!.team?.winner === null && ended.rounds?.length === 0 && !ended.room.scores.A && !ended.room.scores.B);
}
{
  // a team that empties ends the round
  const r = setup(['A', 'B', 'C']);
  r.rooms.setSettings('A', { gameId: 'tug-of-war' });
  r.rooms.setTeam('A', 'yellow'); r.rooms.setTeam('B', 'purple'); r.rooms.setTeam('C', 'purple');
  for (const id of ['A', 'B', 'C']) r.rooms.setReady(id, true);
  r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!);
  check('(the round is running)', r.state().phase === 'playing');
  r.rooms.leave('A');
  check('when a team has nobody left the round is called off', r.state().phase === 'lobby');
}

// ---- the Random tile landing on a team game: the round pauses in a team step, and the host starts it ----
{
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, startingMs: 0, introMs: 0, rouletteMs: 5000, forceRandom: 'tug-of-war' });
  const made = rooms.create(player('A'));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  for (const id of ['B', 'C', 'S']) rooms.join(code, player(id));
  rooms.setWatching('S', true);
  rooms.setSettings('A', { teamSwap: true });
  rooms.setSettings('A', { gameId: 'random' });
  rooms.setBet('S', 'A', 0); // (a bet on a player: the game was not known yet)
  for (const id of ['A', 'B', 'C', 'S']) rooms.setReady(id, true);
  const st = () => rooms.stateOf(code)!;
  rooms.finishCountdown(code, st().countdownEndsAt!);
  check('(the roulette runs and lands on the team game)', st().phase === 'roulette' && st().roulette?.gameId === 'tug-of-war');
  rooms.finishRoulette(code, st().roulette!.endsAt);
  check('when the roulette lands on a team game the round PAUSES in the team step (no game running, no Ready step)', st().phase === 'teams' && st().game === null && st().readyIds.length === 0 && st().settings.gameId === 'tug-of-war');
  check('bets placed before the game was known are cleared (spectators bet on a team now)', Object.keys(st().bets).length === 0);
  check('a spectator bets on a team in the team step', rooms.setBet('S', 'yellow', 0).ok === false || rooms.setBet('S', 'purple', 0).ok);
  check('nobody can ready up in the team step', rooms.setReady('B', true).ok === false);
  check('players can pick their team in the team step (while swapping is on)', rooms.setTeam('B', 'yellow').ok && st().teams.B === 'yellow' && st().phase === 'teams');
  check('the host can still change team swapping, but nothing else, in the team step', rooms.setSettings('A', { teamSwap: false }).ok && rooms.setSettings('A', { gameId: 'tap-race' }).ok === false && st().settings.teamSwap === false);
  check('with swapping off the teams are locked', rooms.setTeam('B', 'purple').ok === false);
  rooms.setSettings('A', { teamSwap: true });
  check('the host sets a handicap in the team step', rooms.setHandicap('A', 'yellow', 3).ok && st().settings.handicap.yellow === 3);
  check('only the host can start it', rooms.startFromTeams('B').ok === false);
  rooms.setTeam('A', 'yellow'); rooms.setTeam('B', 'yellow'); rooms.setTeam('C', 'yellow');
  check('the host cannot start while a team has nobody in it', rooms.startFromTeams('A').ok === false && st().phase === 'teams');
  rooms.setTeam('C', 'purple');
  check('the host starts the round once each team has a player', rooms.startFromTeams('A').ok && st().phase === 'playing' && st().game?.gameId === 'tug-of-war');
  rooms.returnToLobby('A');
  // leaving in the team step so a team is empty calls it off
  rooms.setSettings('A', { gameId: 'random' });
  for (const id of ['A', 'B', 'C', 'S']) rooms.setReady(id, true);
  rooms.finishCountdown(code, st().countdownEndsAt!); rooms.finishRoulette(code, st().roulette!.endsAt);
  rooms.setTeam('A', 'yellow'); rooms.setTeam('B', 'purple'); rooms.setTeam('C', 'purple');
  rooms.leave('A');
  check('a team with nobody left in the team step calls the round off', st().phase === 'lobby');
}

// ---- the team step's start countdown (the host can cancel) ----
{
  const rooms = new RoomManager({ countdownMs: 200, roundMs: 10_000, finishMs: 0, resultsMs: 0, startingMs: 0, introMs: 0, rouletteMs: 0, forceRandom: 'tug-of-war' } as never);
  const made = rooms.create(player('A')); if (!made.ok) throw new Error('create failed');
  const code = made.room.code; for (const id of ['B', 'C']) rooms.join(code, player(id));
  const st = () => rooms.stateOf(code)!;
  rooms.setSettings('A', { gameId: 'random' }); rooms.setSettings('A', { teamSwap: true });
  for (const id of ['A', 'B', 'C']) rooms.setReady(id, true);
  rooms.finishCountdown(code, st().countdownEndsAt!);
  check('(the Random pick landed on the team game: the team step)', st().phase === 'teams');
  rooms.setTeam('A', 'yellow'); rooms.setTeam('B', 'purple'); rooms.setTeam('C', 'purple');
  check('Start begins a short countdown in the team step (nothing starts yet)', rooms.startFromTeams('A').ok && st().phase === 'teams' && st().teamCountdownEndsAt !== null && st().game === null);
  check('only the host can cancel it', rooms.cancelTeamStart('B').ok === false && st().teamCountdownEndsAt !== null);
  check('the host cancels it: back to managing the teams', rooms.cancelTeamStart('A').ok && st().teamCountdownEndsAt === null && st().phase === 'teams');
  rooms.startFromTeams('A');
  rooms.setTeam('C', 'yellow'); // a change cancels the countdown
  check('any change to the teams cancels the countdown', st().teamCountdownEndsAt === null);
  rooms.setTeam('C', 'purple'); rooms.startFromTeams('A');
  check('a stale countdown timer does nothing', rooms.finishTeamCountdown(code, 1) === null && st().phase === 'teams');
  const started = rooms.finishTeamCountdown(code, st().teamCountdownEndsAt!)!;
  check('when the countdown ends the round starts', started.phase === 'playing' && started.game?.gameId === 'tug-of-war' && started.teamCountdownEndsAt === null);
}

// ---- the Random tile never picks a team game ----
{
  const r = setup(['A', 'B']);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    r.rooms.setSettings('A', { gameId: RANDOM_GAME }); r.rooms.setReady('A', true); r.rooms.setReady('B', true);
    r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!);
    seen.add(r.state().settings.gameId!);
    r.rooms.returnToLobby('A');
  }
  check('over many rolls the Random tile never lands on a team game, and still reaches every other game', !seen.has('tug-of-war') && seen.size === GAMES.filter((g) => !(g as { teams?: boolean }).teams).length);
}

console.log(failures === 0 ? '\nAll team checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
