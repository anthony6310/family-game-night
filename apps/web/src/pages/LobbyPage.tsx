import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { TEAM_COLORS, getGame, type GameId } from '@fgn/shared';
import { RouletteScreen } from '../components/GameCarousel';
import { ResultsScreen } from '../components/ResultsScreen';
import { SessionOverScreen } from '../components/SessionOverScreen';
import { StartingScreen } from '../components/StartingScreen';
import { LobbyHub } from '../components/lobby/LobbyHub';
import { TeamStep } from '../components/lobby/TeamStep';
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
  const { restoring, room: liveRoom, selfId, leaveRoom, returnToLobby, resetRoom, closeRoom, sendAction, serverNow } = useRoom();
  const [error, setError] = useState<string | null>(null);
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
  // The Random tile landed on a TEAM game: the round pauses so the players can manage the teams; the host starts it.
  if (room.phase === 'teams') {
    return <TeamStep room={room} selfId={selfId} serverNow={serverNow} error={error} run={run} />;
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

  return <LobbyHub room={room} selfId={selfId} serverNow={serverNow} error={error} images={GAME_IMAGES} run={run} onLeave={leave} />;
}
