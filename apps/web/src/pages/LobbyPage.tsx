import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GAMES, MAX_PLAYERS, ROUND_OPTIONS, getGame } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { Countdown } from '../components/Countdown';
import { ResultsScreen } from '../components/ResultsScreen';
import { SessionOverScreen } from '../components/SessionOverScreen';
import { TapRaceScreen } from '../components/TapRaceScreen';
import { useRoom } from '../room/RoomContext';

// three.js is big, so the Snowball screen is its own download, fetched only when needed.
const loadSnowballScreen = () => import('../components/SnowballScreen');
const SnowballScreen = lazy(loadSnowballScreen);

/** The room screen. It renders whatever phase the server says the room is in; it holds no game logic. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { room, selfId, leaveRoom, updateSettings, setReady, returnToLobby, resetRoom, closeRoom, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);

  // As soon as the host picks Snowball, start downloading its code so the round can begin instantly.
  const pickedGame = room?.settings.gameId;
  useEffect(() => {
    if (pickedGame === 'snowball') void loadSnowballScreen();
  }, [pickedGame]);

  // No room (refresh, lost connection, or the host closed it): back to the hub.
  if (!room) return <Navigate to="/play" replace />;

  // Fire a command and show its error (if any). Success needs no handling: the server's
  // next `room:state` broadcast updates the screen.
  const run = async (action: Promise<string | null>) => setError(await action);

  function leave() {
    leaveRoom();
    navigate('/play');
  }

  if (room.phase === 'playing' && room.game) {
    // `key` = a fresh screen for every round.
    if (room.game.gameId === 'snowball') {
      return (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SnowballScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
            serverNow={serverNow} sendAction={sendAction} />
        </Suspense>
      );
    }
    return <TapRaceScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
      serverNow={serverNow} sendAction={sendAction} />;
  }
  if (room.phase === 'results' && room.result) {
    return <ResultsScreen room={room} selfId={selfId} error={error} serverNow={serverNow} onSkip={() => run(returnToLobby())} />;
  }
  if (room.phase === 'session-over') {
    return <SessionOverScreen room={room} selfId={selfId} error={error} onLeave={leave}
      onReset={() => run(resetRoom())} onClose={() => run(closeRoom())} />;
  }

  const isHost = room.hostId === selfId;
  const game = getGame(room.settings.gameId);
  const total = room.settings.totalRounds;
  // In a tie-breaker only the tied players take part; everyone else watches.
  const participantIds = room.contenders ?? room.players.map((p) => p.id);
  const isSpectator = selfId !== null && !participantIds.includes(selfId);
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = participantIds.filter((id) => !room.readyIds.includes(id)).length;
  const sessionStarted = room.roundsPlayed > 0 || room.contenders !== null || Object.keys(room.scores).length > 0;
  const contenderNames = room.players.filter((p) => room.contenders?.includes(p.id)).map((p) => p.name).join(', ');

  // The status line explains exactly why the round hasn't started yet.
  let status = '';
  if (!game) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (participantIds.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  return (
    <main className="page">
      <p className="muted">Room code</p>
      <h1 className="room-code">{room.code}</h1>
      <p className="muted">Share this code so others can join ({room.players.length}/{MAX_PLAYERS} players)</p>

      <p className="session-line">
        {room.contenders ? `⚔️ Tie-breaker! ${contenderNames} play for the win` : `Round ${Math.min(room.roundsPlayed + 1, total)} of ${total}`}
      </p>

      <ul className="players">
        {room.players.map((p) => {
          const watching = room.contenders !== null && !room.contenders.includes(p.id);
          return (
            <li key={p.id} className={watching ? 'spectator' : ''}>
              <Avatar url={p.avatarUrl} name={p.name} size={44} />
              <span className="player-name">{p.name}{p.id === selfId && ' (you)'}</span>
              {p.id === room.hostId && <span className="badge">Host</span>}
              {watching && <span className="muted">watching</span>}
              {(room.scores[p.id] ?? 0) > 0 && <span className="badge wins" title="Rounds won this session">🏆 {room.scores[p.id]}</span>}
              {room.readyIds.includes(p.id) && <span className="ready-mark" title="Ready">✓</span>}
            </li>
          );
        })}
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
              // The session length is fixed once the first round has been played.
              <button key={n} className={n === total ? 'choice selected' : 'choice'}
                disabled={sessionStarted && n !== total} onClick={() => run(updateSettings({ totalRounds: n }))}>
                {n} rounds
              </button>
            ))}
          </div>
          {sessionStarted && <p className="muted">Session length is locked until you play again.</p>}
        </section>
      ) : (
        <section className="settings">
          <p><strong>{game ? game.name : 'No game picked yet'}</strong> · {total} rounds</p>
        </section>
      )}
      {game && <p className="muted">{game.description}</p>}

      {room.phase === 'countdown' && room.countdownEndsAt !== null && (
        <Countdown endsAt={room.countdownEndsAt} serverNow={serverNow} />
      )}
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}

      {isSpectator ? (
        <p className="muted">You're watching this tie-breaker.</p>
      ) : (
        <button className={amReady ? '' : 'primary'} disabled={!game} onClick={() => run(setReady(!amReady))}>
          {amReady ? 'Not ready' : "I'm ready!"}
        </button>
      )}
      {isHost && room.phase === 'lobby' && (
        <>
          {sessionStarted && <button className="link" onClick={() => run(resetRoom())}>Start over (reset scores)</button>}
          <button className="link" onClick={() => run(closeRoom())}>Close room</button>
        </>
      )}
      <button className="link" onClick={leave}>Leave room</button>
    </main>
  );
}
