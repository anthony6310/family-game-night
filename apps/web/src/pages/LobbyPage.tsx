import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DEFAULT_ROOM_NAME, GAMES, MAX_PLAYERS, ROOM_NAME_MAX, ROOM_PASSWORD_MAX, TEAM_COLORS, TEAM_IDS, TEAM_NAMES, getGame, type GameId, type Player } from '@fgn/shared';
import { Avatar } from '../components/Avatar';
import { BetPanel } from '../components/BetPanel';
import { ColorPicker } from '../components/ColorPicker';
import { Countdown } from '../components/Countdown';
import { GameCarousel, RandomArt, RouletteScreen } from '../components/GameCarousel';
import { ResultsScreen } from '../components/ResultsScreen';
import { SessionOverScreen } from '../components/SessionOverScreen';
import { StartingScreen } from '../components/StartingScreen';
import { TeamPanel } from '../components/TeamPanel';
import { UnderdogReveal } from '../components/UnderdogReveal';
import { useRoom } from '../room/RoomContext';
import { useScreenFlash } from '../components/screenFlash';

// three.js is big, so the 3D game screens are their own downloads, fetched only when needed.
const loadSnowballScreen = () => import('../components/SnowballScreen');
const SnowballScreen = lazy(loadSnowballScreen);
const loadTapRaceScreen = () => import('../components/TapRaceScreen'); // Tap Race is 3D now too
const TapRaceScreen = lazy(loadTapRaceScreen);
const loadTugScreen = () => import('../components/TugOfWarScreen');
const TugOfWarScreen = lazy(loadTugScreen);
const loadPenguinScreen = () => import('../components/PenguinScreen');
const PenguinScreen = lazy(loadPenguinScreen);
const loadSantaScreen = () => import('../components/SantaSackScreen');
const SantaSackScreen = lazy(loadSantaScreen);
const loadFishingScreen = () => import('../components/FishingScreen');
const FishingScreen = lazy(loadFishingScreen);

/** A picture of each game for the game picker, taken from the real game (files in public/games). A game with no picture yet shows a plain tile. */
const GAME_IMAGES: Partial<Record<GameId, string>> = { 'tap-race': '/games/tap-race.png', snowball: '/games/snowball.png', 'penguin-lasso': '/games/penguin-lasso.png', fishing: '/games/fishing.png', 'santa-sack': '/games/santa-sack.png' };

/** The room screen. It renders whatever phase the server says the room is in; it holds no game logic. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { setTeam, setHandicap, restoring, room: liveRoom, selfId, leaveRoom, endSession, updateSettings, setReady, setWatching, setColor, placeBet, returnToLobby, resetRoom, closeRoom, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null); // the host's room name while they are editing it (null = not editing)
  const [passwordDraft, setPasswordDraft] = useState('');
  // Before every round the screen flashes over the countdown and fades to a plain "starting" page, and the round begins almost at the end of the flash.
  // The server runs that as its own step (phase 'starting') so the game never starts under the flash; the flash itself is the same for every game (see screenFlash.ts).
  const room = useScreenFlash(liveRoom, (from, to) => from !== null && to !== null && from.phase !== 'starting' && to.phase === 'starting');

  // The loading page does not just disappear when the round begins: it is kept on top of the game and fades away (see StartingScreen). `curtain` is the game it was for.
  const [curtain, setCurtain] = useState<GameId | null>(null);
  const previousPhase = useRef<string | null>(null);
  useLayoutEffect(() => { // (before the browser paints, so the game is never seen for a frame without the page over it)
    if (previousPhase.current === 'starting' && room?.phase === 'playing') setCurtain(room.settings.gameId);
    previousPhase.current = room?.phase ?? null;
  }, [room?.phase, room?.settings.gameId]);

  // As soon as the host picks a game, start downloading its code so the round can begin instantly.
  const pickedGame = room?.settings.gameId;
  useEffect(() => {
    if (pickedGame === 'snowball') void loadSnowballScreen();
    if (pickedGame === 'tap-race') void loadTapRaceScreen();
    if (pickedGame === 'tug-of-war') void loadTugScreen();
    if (pickedGame === 'penguin-lasso') void loadPenguinScreen();
    if (pickedGame === 'fishing') void loadFishingScreen();
    if (pickedGame === 'santa-sack') void loadSantaScreen();
  }, [pickedGame]);

  // No room (refresh, lost connection, or the host closed it): back to the hub.
  if (!room) return restoring ? <main className="page"><p className="muted">Getting you back into the room…</p></main> : <Navigate to="/play" replace />; // (right after a refresh the seat is being taken back: do not send them away yet)

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
    // No game lets a player act before GO (rule 10): whatever a screen sends before the round's clock has started is dropped here, as well as on the server.
    const startsAt = (room.game as { startsAt: number }).startsAt;
    const sendGameAction: typeof sendAction = (action) => { if (serverNow() >= startsAt) sendAction(action); };
    // A team game draws everyone in their TEAM's color (yellow or purple) instead of their own.
    const gameColors = getGame(room.settings.gameId)?.teams ? Object.fromEntries(Object.entries(room.teams).map(([id, t]) => [id, TEAM_COLORS[t]])) : room.colors;
    // `key` = a fresh screen for every round (and the same screen carries on into the finish sequence).
    const screen =
      room.game.gameId === 'snowball' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SnowballScreen key={room.game.startsAt} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'penguin-lasso' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <PenguinScreen key={room.game.startsAt} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'santa-sack' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SantaSackScreen key={room.game.startsAt} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'tug-of-war' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <TugOfWarScreen key={room.game.startsAt} game={room.game} players={room.players} colors={room.colors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'fishing' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <FishingScreen key={room.game.startsAt} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <TapRaceScreen key={room.game.startsAt} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      );
    // The page over the game is the SAME element (same key, same place) as the one shown during the starting step, so it only gains the fade-out: it is never rebuilt
    // (a rebuilt page would reload its picture and could blink for a frame). On the very first render of the round `curtain` is not set yet, so the previous phase tells.
    const over = curtain ?? (previousPhase.current === 'starting' ? room.settings.gameId : null);
    return <>{screen}{over && <StartingScreen key="curtain" leaving title={getGame(over)?.name ?? ''} image={GAME_IMAGES[over]} onGone={() => setCurtain(null)} />}</>; // every game stages the shared winner moment inside its own screen (see GAME_RULES.md #2)
  }
  // The Random tile's roulette (after the countdown): the host's options are gone; everyone, host included, watches the carousel spin and slow onto the game that was chosen.
  if (room.phase === 'roulette' && room.roulette) {
    return <RouletteScreen gameId={room.roulette.gameId} startsAt={room.roulette.startsAt} endsAt={room.roulette.endsAt} serverNow={serverNow} images={GAME_IMAGES} />;
  }
  // Between the countdown and the start of the round: everyone is shown the underdog (only happens when there is one).
  if (room.phase === 'underdog' && room.underdog && room.underdogEndsAt !== null) {
    return <UnderdogReveal underdog={room.underdog} players={room.players} endsAt={room.underdogEndsAt} serverNow={serverNow} />;
  }
  // The flash step: a plain page under the flash (like a loading screen) until the round begins.
  if (room.phase === 'starting') {
    return <>{null}<StartingScreen key="curtain" title={getGame(room.settings.gameId)?.name ?? ''} image={room.settings.gameId ? GAME_IMAGES[room.settings.gameId] : undefined} /></>;
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
  const watchingIds = room.watchingIds; // members who chose to watch (or joined mid-round / beyond the seats)
  const isWatcher = selfId !== null && watchingIds.includes(selfId);
  const spectatorOnly = selfId !== null && room.spectatorOnlyIds.includes(selfId); // beyond the first MAX_PLAYERS to join: no Play option
  const playingCount = room.players.length - watchingIds.length;
  const playing = room.players.filter((p) => !watchingIds.includes(p.id)); // the people this round is played by (and bet on)
  // In a team game the bet is on a TEAM: the two teams stand in for players in the bet panel (their ids are the team ids).
  const teamOptions: Player[] = TEAM_IDS.filter((t) => playing.some((p) => room.teams[p.id] === t)).map((t) => ({ id: t, name: TEAM_NAMES[t], avatarUrl: null, isGuest: true }));
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = room.players.filter((p) => !room.readyIds.includes(p.id)).length; // EVERYONE readies up, spectators too (they choose bets)
  const myPoints = selfId ? (room.scores[selfId] ?? 0) : 0;

  // The status line explains exactly why the round hasn't started yet.
  let status = '';
  if (!game) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (playing.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  return (
    <main className="page">
      <h1 className="room-title">{room.hasPassword && <span title="This room has a password">🔒 </span>}{room.name}</h1>
      <p className="muted">
        Others can find this room in the room list ({playingCount} playing{watchingIds.length > 0 && ` · ${watchingIds.length} watching`})
      </p>

      {/* The host can rename the room and add, change or remove its password (new joiners need it; people already here stay). */}
      {isHost && room.phase === 'lobby' && (
        <details className="room-settings">
          <summary>Room name and password</summary>
          <form onSubmit={(e) => { e.preventDefault(); void run(updateSettings({ name: (nameDraft ?? room.name).trim() || DEFAULT_ROOM_NAME })).then(() => setNameDraft(null)); }}>
            <label>
              Room name
              <input value={nameDraft ?? room.name} maxLength={ROOM_NAME_MAX} onChange={(e) => setNameDraft(e.target.value)} />
            </label>
            <button disabled={nameDraft === null}>Save name</button>
          </form>
          <form onSubmit={(e) => { e.preventDefault(); void run(updateSettings({ password: passwordDraft })).then(() => setPasswordDraft('')); }}>
            <label>
              {room.hasPassword ? 'New password' : 'Password'}
              <input type="password" value={passwordDraft} maxLength={ROOM_PASSWORD_MAX} autoComplete="new-password" placeholder="Type a password" onChange={(e) => setPasswordDraft(e.target.value)} />
            </label>
            <button disabled={passwordDraft.length === 0}>{room.hasPassword ? 'Change password' : 'Add password'}</button>
            {room.hasPassword && <button type="button" className="link" onClick={() => void run(updateSettings({ password: null }))}>Remove password</button>}
          </form>
        </details>
      )}

      {/* The session has no fixed length: it runs until the host ends it. */}
      <p className="session-line">Round {room.roundsPlayed + 1}</p>

      <ul className="players">
        {room.players.map((p) => {
          const watching = watchingIds.includes(p.id);
          return (
            <li key={p.id} className={watching ? 'spectator' : ''}>
              <Avatar url={p.avatarUrl} name={p.name} size={44} />
              <span className="color-dot" style={{ background: room.colors[p.id] }} title="Their color in every game" />
              <span className="player-name">{p.name}{p.id === selfId && ' (you)'}</span>
              {p.id === room.hostId && <span className="badge">Host</span>}
              {watching && <span className="muted">watching</span>}
              {room.offlineIds.includes(p.id) && <span className="muted" title="Their connection dropped: their seat is held for a short while">reconnecting…</span>}
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
            {/* The Random tile is always the first option, whatever order the games are in. Picking it chooses nothing yet: once everyone is ready and the countdown ends, the server picks a game and everyone watches the roulette. */}
            <button role="radio" aria-checked={room.settings.random}
              className={room.settings.random ? 'game-tile selected' : 'game-tile'}
              onClick={() => run(updateSettings({ gameId: 'random' }))}>
              <RandomArt />
              <span className="game-name">Random</span>
            </button>
            {GAMES.map((g) => (
              <button key={g.id} role="radio" aria-checked={g.id === room.settings.gameId && !room.settings.random}
                className={g.id === room.settings.gameId && !room.settings.random ? 'game-tile selected' : 'game-tile'}
                onClick={() => run(updateSettings({ gameId: g.id }))}>
                <span className="game-art">{GAME_IMAGES[g.id] && <img src={GAME_IMAGES[g.id]} alt="" draggable={false} />}</span>
                <span className="game-name">{g.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="settings">
          {/* Everyone else sees a carousel of the tiles, resting on Random until the host picks: it slides to the host's game. */}
          <GameCarousel selectedId={room.settings.gameId} random={room.settings.random} images={GAME_IMAGES} />
          <p><strong>{room.settings.random ? 'A random game' : game ? game.name : 'Waiting for the host to pick a game'}</strong></p>
        </section>
      )}
      {room.settings.random && !game && <p className="muted">The game is chosen at random once everyone is ready: you will all watch the roulette pick it.</p>}
      {game && <p className="muted">{game.description}</p>}
      {/* A team game: the team step comes before the ready step. */}
      {game?.teams && (room.phase === 'lobby' || room.phase === 'countdown') && (
        <TeamPanel room={room} selfId={selfId} isHost={isHost} watchingIds={watchingIds}
          onPick={(team) => run(setTeam(team))} onSwap={(allowed) => run(updateSettings({ teamSwap: allowed }))} onHandicap={(team, value) => run(setHandicap(team, value))} />
      )}

      {/* Players pick their own color, from the ones nobody else has (it is their color in every game). Spectators don't need it. */}
      {!isWatcher && <ColorPicker colors={room.colors} selfId={selfId} onPick={(color) => run(setColor(color))} />}

      {room.phase === 'countdown' && room.countdownEndsAt !== null && (
        <Countdown endsAt={room.countdownEndsAt} serverNow={serverNow} />
      )}
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}

      {/* Spectators choose a bet (or none) in the ready step; then everyone, spectators included, readies up. */}
      {isWatcher && (
        <BetPanel players={game?.teams ? teamOptions : playing} teams={Boolean(game?.teams)} bet={selfId ? room.bets[selfId] : undefined} points={myPoints}
          onBet={(target, stake) => run(placeBet(target, stake))} />
      )}
      <button className={amReady ? '' : 'primary'} disabled={!game && !room.settings.random} onClick={() => run(setReady(!amReady))}>
        {amReady ? 'Not ready' : "I'm ready!"}
      </button>
      </>
      {/* Play / Watch: switch whenever you like between rounds. Your points stay, and a watcher can still win the session. */}
      {spectatorOnly ? (
        // Only the first MAX_PLAYERS people in a room may play. Everyone after that is a spectator (and gets a seat if one of the first leaves).
        <p className="muted">The room has {MAX_PLAYERS} players already, so you're a spectator. If a player leaves, you can take their seat.</p>
      ) : (
        <div className="mode-toggle" role="radiogroup" aria-label="Play or watch">
          <button role="radio" aria-checked={!isWatcher} className={!isWatcher ? 'on' : ''}
            onClick={() => isWatcher && run(setWatching(false))}>🎮 Play</button>
          <button role="radio" aria-checked={isWatcher} className={isWatcher ? 'on' : ''}
            onClick={() => !isWatcher && run(setWatching(true))}>👀 Watch</button>
        </div>
      )}
      {isWatcher && <p className="muted">Watching: you keep your points, you can bet on the winner, and you can still win the session.</p>}

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
