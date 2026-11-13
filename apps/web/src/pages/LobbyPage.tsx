import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GAMES, MAX_PLAYERS, ROUND_OPTIONS, getGame } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { Countdown } from '../components/Countdown';
import { FinishOverlay } from '../components/FinishOverlay';
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
  const { room, selfId, leaveRoom, startSession, updateSettings, setReady, setWatching, returnToLobby, resetRoom, closeRoom, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [pickedRounds, setPickedRounds] = useState<number>(ROUND_OPTIONS[0]); // the host's choice in step 1, before confirming

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

  // While a round runs, and during its short you-won / you-lost sequence (the game stays on screen, frozen, under the message).
  if ((room.phase === 'playing' || room.phase === 'finish') && room.game) {
    const frozen = room.phase === 'finish';
    // `key` = a fresh screen for every round (and the same screen carries on into the finish sequence).
    const screen =
      room.game.gameId === 'snowball' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SnowballScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
            serverNow={serverNow} sendAction={sendAction} frozen={frozen} />
        </Suspense>
      ) : (
        <TapRaceScreen key={room.game.startsAt} game={room.game} players={room.players} selfId={selfId}
          serverNow={serverNow} sendAction={sendAction} frozen={frozen} />
      );
    return (
      <>
        {screen}
        {frozen && room.result && <FinishOverlay result={room.result} selfId={selfId} />}
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
  const total = room.settings.totalRounds;
  // In a tie-breaker only the tied players take part; everyone else watches.
  const watchingIds = room.watchingIds; // members who chose to watch (or joined mid-round / into a full room)
  const isWatcher = selfId !== null && watchingIds.includes(selfId);
  const playingCount = room.players.length - watchingIds.length; // these use the MAX_PLAYERS slots
  const participantIds = (room.contenders ?? room.players.map((p) => p.id)).filter((id) => !watchingIds.includes(id));
  const isSpectator = selfId !== null && !participantIds.includes(selfId); // a watcher, or sitting out a tie-breaker
  const mustPlay = selfId !== null && room.contenders?.includes(selfId) === true; // tied players can't skip their tie-breaker
  const slotsFull = playingCount >= MAX_PLAYERS;
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = participantIds.filter((id) => !room.readyIds.includes(id)).length;
  const contenderNames = room.players.filter((p) => room.contenders?.includes(p.id)).map((p) => p.name).join(', ');

  // The status line explains exactly why the round hasn't started yet.
  let status = '';
  if (!room.sessionConfirmed) status = '';
  else if (!game) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (participantIds.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  return (
    <main className="page">
      <p className="muted">Room code</p>
      <h1 className="room-code">{room.code}</h1>
      <p className="muted">
        Share this code so others can join ({playingCount}/{MAX_PLAYERS} playing{watchingIds.length > 0 && ` · ${watchingIds.length} watching`})
      </p>

      {/* Play / Watch: switch whenever you like between rounds. Your points stay, and a watcher can still win the session. */}
      <div className="mode-toggle" role="radiogroup" aria-label="Play or watch">
        <button role="radio" aria-checked={!isWatcher} className={!isWatcher ? 'on' : ''}
          disabled={isWatcher && slotsFull} title={isWatcher && slotsFull ? 'All playing slots are taken' : undefined}
          onClick={() => isWatcher && run(setWatching(false))}>🎮 Play</button>
        <button role="radio" aria-checked={isWatcher} className={isWatcher ? 'on' : ''}
          disabled={mustPlay} title={mustPlay ? 'You are in the tie-breaker' : undefined}
          onClick={() => !isWatcher && run(setWatching(true))}>👀 Watch</button>
      </div>
      {isWatcher && <p className="muted">Watching: you keep your points, and you can still win the session.</p>}

      {room.sessionConfirmed && (
        <p className="session-line">
          {room.contenders ? `⚔️ Tie-breaker! ${contenderNames} play for the win` : `Round ${Math.min(room.roundsPlayed + 1, total)} of ${total}`}
        </p>
      )}

      <ul className="players">
        {room.players.map((p) => {
          const watching = watchingIds.includes(p.id) || (room.contenders !== null && !room.contenders.includes(p.id));
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

      {!room.sessionConfirmed ? (
        // STEP 1: how many rounds. Asked once per session; after "Let's play!" it isn't shown again until the session ends.
        isHost ? (
          <section className="settings step">
            <h2 className="step-title">How many rounds?</h2>
            <div className="choice-row">
              {ROUND_OPTIONS.map((n) => (
                <button key={n} className={n === pickedRounds ? 'choice selected' : 'choice'} onClick={() => setPickedRounds(n)}>
                  {n} rounds
                </button>
              ))}
            </div>
            <p className="muted">You only choose this once. It stays fixed until the session is over.</p>
            {error && <p className="error">{error}</p>}
            <button className="primary" onClick={() => run(startSession(pickedRounds))}>Let's play!</button>
          </section>
        ) : (
          <section className="settings step">
            <h2 className="step-title">Getting ready…</h2>
            <p className="muted">The host is choosing how many rounds to play.</p>
          </section>
        )
      ) : (
        // STEP 2: the game (and then ready up). The round count is already locked in.
        <>
          {isHost ? (
            <section className="settings">
              <p className="muted">Session: {total} rounds · pick a game</p>
              <div className="choice-row">
                {GAMES.map((g) => (
                  <button key={g.id} className={g.id === room.settings.gameId ? 'choice selected' : 'choice'}
                    onClick={() => run(updateSettings({ gameId: g.id }))}>
                    {g.name}
                  </button>
                ))}
              </div>
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
            <p className="muted">{isWatcher ? "You're watching this one out." : "You're watching this tie-breaker."}</p>
          ) : (
            <button className={amReady ? '' : 'primary'} disabled={!game} onClick={() => run(setReady(!amReady))}>
              {amReady ? 'Not ready' : "I'm ready!"}
            </button>
          )}
        </>
      )}
      {isHost && room.phase === 'lobby' && (
        <>
          <button className="link" onClick={() => run(closeRoom())}>Close room</button>
        </>
      )}
      <button className="link" onClick={leave}>Leave room</button>
    </main>
  );
}
