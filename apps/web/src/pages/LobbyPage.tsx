import { Navigate, useNavigate } from 'react-router-dom';
import { MAX_PLAYERS } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { useRoom } from '../room/RoomContext';

/** The room lobby. Renders whatever the server last said; it holds no game logic itself. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { room, selfId, leaveRoom } = useRoom();

  // No room (e.g. page refresh or lost connection): back to the hub.
  if (!room) return <Navigate to="/play" replace />;

  function leave() {
    leaveRoom();
    navigate('/play');
  }

  return (
    <main className="page">
      <p className="muted">Room code</p>
      <h1 className="room-code">{room.code}</h1>
      <p className="muted">Share this code so others can join ({room.players.length}/{MAX_PLAYERS} players)</p>

      <ul className="players">
        {room.players.map((p) => (
          <li key={p.id}>
            <Avatar url={p.avatarUrl} name={p.name} size={44} />
            <span className="player-name">{p.name}{p.id === selfId && ' (you)'}</span>
            {p.id === room.hostId && <span className="badge">Host</span>}
          </li>
        ))}
      </ul>

      <button className="primary" disabled>Choose a game (MVP 3)</button>
      <button className="link" onClick={leave}>Leave room</button>
    </main>
  );
}
