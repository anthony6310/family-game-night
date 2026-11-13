import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GAMES, MAX_PLAYERS, getGame, type GameId } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { Countdown } from '../components/Countdown';
import { FinishOverlay } from '../components/FinishOverlay';
import { ResultsScreen } from '../components/ResultsScreen';
import { SessionOverScreen } from '../components/SessionOverScreen';
import { useRoom } from '../room/RoomContext';

// three.js is big, so the 3D game screens are their own downloads, fetched only when needed.
const loadSnowballScreen = () => import('../components/SnowballScreen');
const SnowballScreen = lazy(loadSnowballScreen);
const loadTapRaceScreen = () => import('../components/TapRaceScreen'); // Tap Race is 3D now too
const TapRaceScreen = lazy(loadTapRaceScreen);
const loadPenguinScreen = () => import('../components/PenguinScreen');
const PenguinScreen = lazy(loadPenguinScreen);

/** A picture of each game for the game picker, taken from the real game (files in public/games). A game with no picture yet shows a plain tile. */
const GAME_IMAGES: Partial<Record<GameId, string>> = { 'tap-race': '/games/tap-race.png', snowball: '/games/snowball.png' };

/** The room screen. It renders whatever phase the server says the room is in; it holds no game logic. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { room, selfId, leaveRoom, endSession, updateSettings, setReady, setWatching, returnToLobby, resetRoom, closeRoom, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);

  // As soon as the host picks a game, start downloading its code so the round can begin instantly.
  const pickedGame = room?.settings.gameId;
  useEffect(() => {
    if (pickedGame === 'snowball') void loadSnowballScreen();
    if (pickedGame === 'tap-race') void loadTapRaceScreen();
    if (pickedGame === 'penguin-lasso') void loadPenguinScreen();
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

  // While a round runs, and during its short finish sequence (the game stays on screen, frozen, under the message).
  if ((room.phase === 'playing' || room.phase === 'finish') && room.game) {
    const frozen = room.phase === 'finish';
    // `key` = a fresh screen for every round (and the same screen carries on into the finish sequence).
    const screen =
      room.game.gameId === 'snowball' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SnowballScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
            serverNow={serverNow} sendAction={sendAction} frozen={frozen} />
        </Suspense>
      ) : room.game.gameId === 'penguin-lasso' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <PenguinScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
            serverNow={serverNow} sendAction={sendAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <TapRaceScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
            serverNow={serverNow} sendAction={sendAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      );
    return (
      <>
        {screen}
        {/* Snowball's ending is the you-won / you-lost message; Tap Race and Penguin Lasso stage the shared winner moment (own view, then the winner) inside their screens. */}
        {frozen && room.result && room.game.gameId === 'snowball' && <FinishOverlay result={room.result} selfId={selfId} />}
      </>
    );
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
  const watchingIds = room.watchingIds; // members who chose to watch (or joined mid-round / into a full room)
  const isWatcher = selfId !== null && watchingIds.includes(selfId);
  const playingCount = room.players.length - watchingIds.length; // these use the MAX_PLAYERS slots
  const participantIds = room.players.map((p) => p.id).filter((id) => !watchingIds.includes(id));
  const slotsFull = playingCount >= MAX_PLAYERS;
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = participantIds.filter((id) => !room.readyIds.includes(id)).length;

  // The status line explains exactly why the round hasn't started yet.
  let status = '';
  if (!game) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (participantIds.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  return (
    <main className="page">
      <p className="muted">Room code</p>
      <h1 className="room-code">{room.code}</h1>
      <p className="muted">
        Share this code so others can join ({playingCount}/{MAX_PLAYERS} playing{watchingIds.length > 0 && ` · ${watchingIds.length} watching`})
      </p>


      {/* The session has no fixed length: it runs until the host ends it. */}
      <p className="session-line">Round {room.roundsPlayed + 1}</p>

      <ul className="players">
        {room.players.map((p) => {
          const watching = watchingIds.includes(p.id);
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

      <>
      {isHost ? (
        <section className="settings">
          <p className="muted">Pick a game</p>
          {/* Every tile is the same size: a 16:10 picture area (empty until a game has a picture) with the name under it. */}
          <div className="game-grid" role="radiogroup" aria-label="Game">
            {GAMES.map((g) => (
              <button key={g.id} role="radio" aria-checked={g.id === room.settings.gameId}
                className={g.id === room.settings.gameId ? 'game-tile selected' : 'game-tile'}
                onClick={() => run(updateSettings({ gameId: g.id }))}>
                <span className="game-art">{GAME_IMAGES[g.id] && <img src={GAME_IMAGES[g.id]} alt="" draggable={false} />}</span>
                <span className="game-name">{g.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="settings">
          <p><strong>{game ? game.name : 'No game picked yet'}</strong></p>
        </section>
      )}
      {game && <p className="muted">{game.description}</p>}

      {room.phase === 'countdown' && room.countdownEndsAt !== null && (
        <Countdown endsAt={room.countdownEndsAt} serverNow={serverNow} />
      )}
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}

      {isWatcher ? (
        <p className="muted">You're watching this one out.</p>
      ) : (
        <button className={amReady ? '' : 'primary'} disabled={!game} onClick={() => run(setReady(!amReady))}>
          {amReady ? 'Not ready' : "I'm ready!"}
        </button>
      )}
      </>
      {/* Play / Watch: switch whenever you like between rounds. Your points stay, and a watcher can still win the session. */}
      <div className="mode-toggle" role="radiogroup" aria-label="Play or watch">
        <button role="radio" aria-checked={!isWatcher} className={!isWatcher ? 'on' : ''}
          disabled={isWatcher && slotsFull} title={isWatcher && slotsFull ? 'All playing slots are taken' : undefined}
          onClick={() => isWatcher && run(setWatching(false))}>🎮 Play</button>
        <button role="radio" aria-checked={isWatcher} className={isWatcher ? 'on' : ''}
          onClick={() => !isWatcher && run(setWatching(true))}>👀 Watch</button>
      </div>
      {isWatcher && <p className="muted">Watching: you keep your points, and you can still win the session.</p>}

      {isHost && room.phase === 'lobby' && (
        <>
          {/* The host decides when the session is over: the player with the most wins is crowned. */}
          {room.roundsPlayed > 0 && <button onClick={() => run(endSession())}>End session</button>}
          <button className="link" onClick={() => run(closeRoom())}>Close room</button>
        </>
      )}
      <button className="link" onClick={leave}>Leave room</button>
    </main>
  );
}
