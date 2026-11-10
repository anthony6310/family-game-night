import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GAMES, MAX_PLAYERS, ROUND_OPTIONS, getGame } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { Countdown } from '../components/Countdown';
import { ResultsScreen } from '../components/ResultsScreen';
import { TapRaceScreen } from '../components/TapRaceScreen';
import { useRoom } from '../room/RoomContext';

/** The room lobby. Renders whatever the server last said; it holds no game logic itself. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { room, selfId, leaveRoom, updateSettings, setReady, returnToLobby, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);

  // No room (e.g. page refresh or lost connection): back to the hub.
  if (!room) return <Navigate to="/play" replace />;

  const isHost = room.hostId === selfId;
  const game = getGame(room.settings.gameId);
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = room.players.length - room.readyIds.length;

  // Fire a command and show its error (if any). Success needs no handling: the server's
  // next `room:state` broadcast updates the screen.
  const run = async (action: Promise<string | null>) => setError(await action);

  function leave() {
    leaveRoom();
    navigate('/play');
  }

  // The status line explains exactly why the game hasn't started yet.
  let status = '';
  if (!game) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (room.players.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  if (room.phase === 'playing' && room.game) {
    // `key` = a fresh screen (and tap counter) for every round.
    return <TapRaceScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
      serverNow={serverNow} sendAction={sendAction} />;
  }
  if (room.phase === 'results' && room.result) {
    return <ResultsScreen room={room} selfId={selfId} error={error} onBack={() => run(returnToLobby())} />;
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
            {(room.scores[p.id] ?? 0) > 0 && <span className="badge wins" title="Rounds won this session">🏆 {room.scores[p.id]}</span>}
            {room.readyIds.includes(p.id) && <span className="ready-mark" title="Ready">✓</span>}
          </li>
        ))}
      </ul>

      {isHost ? (
        <section className="settings">
          <div className="choice-row">
            {GAMES.map((g) => (
              <button key={g.id} className={g.id === room.settings.gameId ? 'choice selected' : 'choice'}
                onClick={() => run(updateSettings({ gameId: g.id }))}>
                {g.name}
              </button>
            ))}
          </div>
          <div className="choice-row">
            {ROUND_OPTIONS.map((n) => (
              <button key={n} className={n === room.settings.totalRounds ? 'choice selected' : 'choice'}
                onClick={() => run(updateSettings({ totalRounds: n }))}>
                {n} rounds
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="settings">
          <p><strong>{game ? game.name : 'No game picked yet'}</strong> · {room.settings.totalRounds} rounds</p>
        </section>
      )}
      {game && <p className="muted">{game.description}</p>}

      {room.phase === 'countdown' && room.countdownEndsAt !== null && (
        <Countdown endsAt={room.countdownEndsAt} serverNow={serverNow} />
      )}
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}

      <button className={amReady ? '' : 'primary'} disabled={!game}
        onClick={() => run(setReady(!amReady))}>
        {amReady ? 'Not ready' : "I'm ready!"}
      </button>
      <button className="link" onClick={leave}>Leave room</button>
    </main>
  );
}
