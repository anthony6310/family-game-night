import { TEAM_IDS, TEAM_NAMES, getGame, type Player, type RoomState } from '@fgn/shared';
import { BetPanel } from '../BetPanel';
import { Countdown } from '../Countdown';
import { TeamPanel } from '../TeamPanel';
import { useRoom } from '../../room/RoomContext';
import { oneLine } from './GameHero';

/**
 * THE TEAM STEP (GAME_RULES.md #21): when the Random tile lands on a TEAM game, the round pauses here (no game is running and there is NO Ready step) so the players can manage the teams
 * (pick a side while swapping is allowed; the host also has the swap switch). Spectators bet on a team. The HOST starts the round when the teams are right.
 */
export function TeamStep({ room, selfId, serverNow, error, run }: { room: RoomState; selfId: string | null; serverNow: () => number; error: string | null; run: (action: Promise<string | null>) => Promise<void> }) {
  const { setTeam, updateSettings, placeBet, startFromTeams, cancelTeamStart, returnToLobby } = useRoom();
  const counting = room.teamCountdownEndsAt !== null;
  const game = getGame(room.settings.gameId);
  const isHost = room.hostId === selfId;
  const watchingIds = room.watchingIds;
  const isWatcher = selfId !== null && watchingIds.includes(selfId);
  const isSpectator = selfId !== null && room.spectatorOnlyIds.includes(selfId); // (only people with no seat bet)
  const playing = room.players.filter((p) => !watchingIds.includes(p.id));
  const filled = TEAM_IDS.every((t) => playing.some((p) => room.teams[p.id] === t));
  const teamOptions: Player[] = TEAM_IDS.filter((t) => playing.some((p) => room.teams[p.id] === t)).map((t) => ({ id: t, name: TEAM_NAMES[t], avatarUrl: null, isGuest: true }));
  return (
    <main className="page team-step">
      <h1 className="step-title">Set the teams</h1>
      {game && <p className="muted team-step-game"><strong>{game.name}</strong>: {oneLine(game.description)}</p>}
      <TeamPanel hideTitle room={room} selfId={selfId} isHost={isHost} watchingIds={watchingIds}
        onPick={(team) => run(setTeam(team))} onSwap={(allowed) => run(updateSettings({ teamSwap: allowed }))} />
      {/* A spectator's bet is on a team, right above the start. */}
      {isSpectator && (
        <BetPanel players={teamOptions} teams bet={selfId ? room.bets[selfId] : undefined} points={selfId ? (room.scores[selfId] ?? 0) : 0} onBet={(target, stake) => run(placeBet(target, stake))} />
      )}
      {error && <p className="error">{error}</p>}
      {/* Start begins a short countdown (as before a normal game); the host can cancel it, and any change cancels it. */}
      {counting && <Countdown endsAt={room.teamCountdownEndsAt!} serverNow={serverNow} />}
      {isHost ? (
        <>
          {counting
            ? <button className="hub-ready" onClick={() => run(cancelTeamStart())}>Cancel</button>
            : <button className="primary hub-ready" disabled={!filled} onClick={() => run(startFromTeams())}>Start the game</button>}
          {!counting && <button className="link" onClick={() => run(returnToLobby())}>Back to the lobby</button>}
        </>
      ) : (
        <p className="muted">{counting ? 'Starting...' : 'Waiting for the host to start the game...'}</p>
      )}
    </main>
  );
}
