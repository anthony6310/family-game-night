/**
 * One-against-all team games (Roach Rumble) at the room level (room manager only, no sockets): npx tsx scripts/test-lone.ts
 * One random player is the lone team each round, everyone takes a turn before anyone repeats, the sides cannot be swapped, bets are on a side, and the teams are shuffled again afterwards.
 */
import { type Player, type RoachHuntView } from '@fgn/shared';
import { RoomManager } from '../src/rooms';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const player = (id: string): Player => ({ id, name: id, avatarUrl: null, isGuest: true });

function setup(ids: string[], spectators: string[] = []) {
  const rooms = new RoomManager({ countdownMs: 0, roundMs: 10_000, finishMs: 0, resultsMs: 0, startingMs: 0, introMs: 0, forceRandom: null } as never);
  const made = rooms.create(player(ids[0]));
  if (!made.ok) throw new Error('create failed');
  const code = made.room.code;
  for (const id of [...ids.slice(1), ...spectators]) rooms.join(code, player(id));
  for (const id of spectators) rooms.setWatching(id, true);
  rooms.setSettings(ids[0], { gameId: 'roach-hunt' });
  return { rooms, code, state: () => rooms.stateOf(code)!, ids };
}
/** Ends the round and walks the finish and results phases back to the lobby. */
function toLobby(r: ReturnType<typeof setup>, endsAt: number) {
  r.rooms.finishRound(r.code, endsAt);
  r.rooms.finishFinish(r.code, r.state().finishEndsAt!);
  r.rooms.finishResults(r.code, r.state().resultsEndsAt!);
  if (r.state().phase !== 'lobby') r.rooms.returnToLobby('A');
}
const wins = (r: ReturnType<typeof setup>) => (r.rooms as unknown as { rooms: Map<string, { wins: Record<string, number> }> }).rooms.get(r.code)!.wins;

{
  const r = setup(['A', 'B', 'C', 'D']);
  const two = setup(['A', 'B']);
  for (const id of ['A', 'B']) two.rooms.setReady(id, true);
  check('two players are enough to start (one sandal, one roach)', two.state().phase === 'countdown');
  const one = setup(['A']);
  one.rooms.setReady('A', true);
  check('one player alone cannot start', one.state().phase === 'lobby');

  // rounds: everyone gets a turn as the sandal before anyone repeats
  const seen: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (const id of r.ids) r.rooms.setReady(id, true);
    const playing = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
    const view = playing.game as RoachHuntView;
    const teams = r.state().teams;
    const purple = r.ids.filter((id) => teams[id] === 'purple');
    check(`round ${round + 1}: exactly one player is on the lone team, and it is the sandal, and everyone else is a roach`, purple.length === 1 && purple[0] === view.sandalId && r.ids.filter((id) => teams[id] === 'yellow').length === 3 && view.total === 3);
    seen.push(view.sandalId);
    toLobby(r, playing.game!.endsAt);
  }
  check('everyone was the sandal once in four rounds of four (a fair turn each)', new Set(seen).size === 4);
  const teamsAfter = r.state().teams;
  check('after the round the teams are shuffled again to an even split (the sides were for that round only)', r.ids.filter((id) => teamsAfter[id] === 'yellow').length === 2 && r.ids.filter((id) => teamsAfter[id] === 'purple').length === 2);
  check('the sides cannot be swapped by players in a one-against-all game', r.rooms.setTeam('B', 'purple').ok === false);
}
{
  // bets are on a side, placed in the lobby before the sides are drawn
  const r = setup(['A', 'B', 'C'], ['S']);
  wins(r).S = 10;
  check('a spectator can bet on a side before the sides are drawn', r.rooms.setBet('S', 'purple', 2).ok && r.state().bets.S.targetId === 'purple');
  check('...but not on a player', r.rooms.setBet('S', 'A', 0).ok === false);
  for (const id of ['A', 'B', 'C', 'S']) r.rooms.setReady(id, true);
  const playing = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
  check('there is no underdog in a one-against-all game', playing.underdog === null && playing.phase === 'playing');
  // the sandal squashes nobody and nobody starves in time: a surviving roach means the roaches win, so a bet on the sandal loses its stake
  const ended = r.rooms.finishRound(r.code, playing.game!.endsAt)!;
  const res = ended.room.result!;
  check('the clock runs out with roaches alive: THE ROACHES win (no draws), the sides named for this game', res.team?.winner === 'yellow' && res.team.totals.yellow === 2 && res.team.totals.purple === 0 && res.team.names.yellow === 'The Roaches' && res.team.names.purple === 'The Sandal');
  check('the bet on the sandal loses its stake', res.bets.length === 1 && res.bets[0].delta === -2 && ended.room.scores.S === 8);
}
{
  // a player leaving mid-round
  const r = setup(['A', 'B', 'C']);
  for (const id of r.ids) r.rooms.setReady(id, true);
  const playing = r.rooms.finishCountdown(r.code, r.state().countdownEndsAt!)!;
  const sandal = (playing.game as RoachHuntView).sandalId;
  r.rooms.leave(sandal);
  check('if the sandal leaves, the round is called off', r.state().phase === 'lobby');
}
console.log(failures === 0 ? '\nAll lone-team checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
