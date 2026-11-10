import type { Player, RoomState } from '@fgn/shared';
import { Avatar } from './Avatar';

interface Props {
  room: RoomState;
  selfId: string | null;
  error: string | null;
  onBack: () => void;
}

/** Shown after a round: who won, everyone's round score, and the running session wins. */
export function ResultsScreen({ room, selfId, error, onBack }: Props) {
  const result = room.result!;
  const winner = room.players.find((p) => p.id === result.winnerId);
  const byId = new Map<string, Player>(room.players.map((p) => [p.id, p]));
  // Only players still in the room (someone may have left during the round).
  const rows = Object.entries(result.scores)
    .filter(([id]) => byId.has(id))
    .sort(([, a], [, b]) => b - a);

  return (
    <main className="page">
      {winner ? (
        <>
          <Avatar url={winner.avatarUrl} name={winner.name} size={96} />
          <h1>🏆 {winner.name} wins!</h1>
          <p className="muted">{winner.id === selfId ? 'That\'s you! +1 point' : '+1 point'}</p>
        </>
      ) : (
        <>
          <h1>It's a draw!</h1>
          <p className="muted">No winner this round, so no point.</p>
        </>
      )}

      <ul className="players">
        {rows.map(([id, taps]) => (
          <li key={id}>
            <Avatar url={byId.get(id)!.avatarUrl} name={byId.get(id)!.name} size={36} />
            <span className="player-name">{byId.get(id)!.name}{id === selfId && ' (you)'}</span>
            <span>{taps} taps</span>
            <span className="badge wins" title="Rounds won this session">🏆 {room.scores[id] ?? 0}</span>
          </li>
        ))}
      </ul>

      {room.hostId === selfId ? (
        <button className="primary" onClick={onBack}>Back to lobby</button>
      ) : (
        <p className="muted">Waiting for the host…</p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
