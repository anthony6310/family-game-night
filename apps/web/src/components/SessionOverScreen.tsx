import type { RoomState } from '@fgn/shared';
import { Avatar } from './Avatar';

interface Props {
  room: RoomState;
  selfId: string | null;
  error: string | null;
  onReset: () => void;
  onClose: () => void;
  onLeave: () => void;
}

/** The end of a session: the champion, the final standings, and the host's reset / close choice. */
export function SessionOverScreen({ room, selfId, error, onReset, onClose, onLeave }: Props) {
  const champion = room.sessionWinner;
  const standings = [...room.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0));
  const isHost = room.hostId === selfId;

  return (
    <main className="page">
      <p className="muted">Session complete</p>
      {champion && <Avatar url={champion.avatarUrl} name={champion.name} size={110} />}
      <h1>👑 {champion?.name ?? 'Nobody'} wins!</h1>
      {champion?.id === selfId && <p className="muted">That's you!</p>}

      <ul className="players">
        {standings.map((p) => (
          <li key={p.id}>
            <Avatar url={p.avatarUrl} name={p.name} size={36} />
            <span className="player-name">{p.name}{p.id === selfId && ' (you)'}</span>
            <span className="badge wins" title="Rounds won">🏆 {room.scores[p.id] ?? 0}</span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <>
          <button className="primary" onClick={onReset}>Play again</button>
          <button onClick={onClose}>Close room</button>
        </>
      ) : (
        <>
          <p className="muted">Waiting for the host…</p>
          <button className="link" onClick={onLeave}>Leave room</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
