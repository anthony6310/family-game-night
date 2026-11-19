import { TEAM_COLORS, TEAM_IDS, TEAM_NAMES, getGame, type Player, type RoomState } from '@fgn/shared';
import { Avatar } from './Avatar';
import { useRemainingMs } from './Countdown';

interface Props {
  room: RoomState;
  selfId: string | null;
  error: string | null;
  serverNow: () => number;
  onSkip: () => void;
}

/** Shown after a round: who won, everyone's round score, and a countdown to what comes next. */
export function ResultsScreen({ room, selfId, error, serverNow, onSkip }: Props) {
  const result = room.result!;
  const winner = result.winner;
  const byId = new Map<string, Player>(room.players.map((p) => [p.id, p]));
  // Only players still in the room (someone may have left during the round).
  const rows = Object.entries(result.scores)
    .filter(([id]) => byId.has(id))
    .sort(([, a], [, b]) => b - a);
  const unit = getGame(room.settings.gameId)?.scoreLabel ?? ''; // "taps" for Tap Race; Snowball shows just the size number
  const secondsLeft = Math.ceil(useRemainingMs(room.resultsEndsAt ?? 0, serverNow) / 1000);

  const team = result.team;
  return (
    <main className="page">
      {team ? (
        <>
          {team.winner ? (
            <>
              <h1 style={{ color: TEAM_COLORS[team.winner] }}>🏆 {TEAM_NAMES[team.winner]} wins!</h1>
              <p className="muted">{selfId && team.members[team.winner].includes(selfId) ? "That's your team! +1 point each" : '+1 point for each member'}</p>
            </>
          ) : (
            <>
              <h1>It's a draw!</h1>
              <p className="muted">The teams finished level. Nobody wins this round.</p>
            </>
          )}
          <p className="team-totals">
            {TEAM_IDS.map((t) => (
              <span key={t} style={{ color: TEAM_COLORS[t] }}>{TEAM_NAMES[t]}: <strong>{team.totals[t]}</strong>{team.handicap[t] !== 0 && ` (with a head start of ${team.handicap[t] > 0 ? '+' : ''}${team.handicap[t]})`}</span>
            ))}
          </p>
        </>
      ) : winner ? (
        <>
          <Avatar url={winner.avatarUrl} name={winner.name} size={96} />
          <h1>🏆 {winner.name} wins!</h1>
          <p className="muted">{winner.id === selfId ? "That's you! +1 point" : '+1 point'}</p>
        </>
      ) : (
        <>
          <h1>It's a draw!</h1>
          <p className="muted">Nobody wins this round.</p>
        </>
      )}

      <ul className="players">
        {rows.map(([id, taps]) => (
          <li key={id}>
            <Avatar url={byId.get(id)!.avatarUrl} name={byId.get(id)!.name} size={36} />
            <span className="player-name">{byId.get(id)!.name}{id === selfId && ' (you)'}</span>
            <span>{unit ? `${taps} ${unit}` : taps}</span>
            <span className="badge wins" title="Rounds won this session">🏆 {room.scores[id] ?? 0}</span>
          </li>
        ))}
      </ul>

      {/* Your own bet's result, if you had one (bets are private: nobody sees anybody else's). */}
      {result.bets.filter((b) => b.bettorId === selfId).map((b) => (
        <p key={b.bettorId} className="my-bet-result">
          Your bet on {TEAM_IDS.includes(b.targetId as never) ? TEAM_NAMES[b.targetId as keyof typeof TEAM_NAMES] : (byId.get(b.targetId)?.name ?? 'a player who left')}:{' '}
          <strong>{b.delta > 0 ? `+${b.delta} 🏆 (won)` : b.delta < 0 ? `${b.delta} 🏆 (lost)` : 'no change (void)'}</strong>
        </p>
      ))}

      <p className="muted">Next up in {secondsLeft}…</p>
      {room.hostId === selfId && <button className="link" onClick={onSkip}>Skip</button>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
