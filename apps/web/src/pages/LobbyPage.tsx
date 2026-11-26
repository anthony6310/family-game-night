import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { STARTING_MAX_MS, TEAM_COLORS, getGame, type GameId } from '@fgn/shared';
import { RouletteScreen } from '../components/GameCarousel';
import { ResultsScreen } from '../components/ResultsScreen';
import { SessionOverScreen } from '../components/SessionOverScreen';
import { waitUntilSettled } from '../lib/settle';
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
const loadRoachScreen = () => import('../components/RoachScreen');
const RoachScreen = lazy(loadRoachScreen);
const loadPirateScreen = () => import('../components/PirateScreen');
const PirateScreen = lazy(loadPirateScreen);
const loadAdoptionScreen = () => import('../components/AdoptionScreen');
const AdoptionScreen = lazy(loadAdoptionScreen);
const loadFrogScreen = () => import('../components/FrogClimbScreen');
const FrogClimbScreen = lazy(loadFrogScreen);
const loadGoatScreen = () => import('../components/MountainGoatScreen');
const MountainGoatScreen = lazy(loadGoatScreen);
const loadFlakeScreen = () => import('../components/SnowflakeMatchScreen');
const SnowflakeMatchScreen = lazy(loadFlakeScreen);
const loadTugScreen = () => import('../components/TugOfWarScreen');
const TugOfWarScreen = lazy(loadTugScreen);
const loadPenguinScreen = () => import('../components/PenguinScreen');
const PenguinScreen = lazy(loadPenguinScreen);
const loadSantaScreen = () => import('../components/SantaSackScreen');
const SantaSackScreen = lazy(loadSantaScreen);
const loadFishingScreen = () => import('../components/FishingScreen');
const FishingScreen = lazy(loadFishingScreen);

/**
 * Every game's loader, by id. `Record<GameId, ...>` makes it a compile error to add a game to games.ts and forget it here. The game's code starts downloading the moment the host picks it, so it
 * is normally in by the time the loading step mounts the game.
 */
const GAME_LOADERS: Record<GameId, () => Promise<unknown>> = {
  'adoption-day': loadAdoptionScreen,
  fishing: loadFishingScreen,
  'frog-climb': loadFrogScreen,
  'mountain-goat': loadGoatScreen,
  'penguin-lasso': loadPenguinScreen,
  'pirate-broadside': loadPirateScreen,
  'roach-hunt': loadRoachScreen,
  'santa-sack': loadSantaScreen,
  snowball: loadSnowballScreen,
  'snowflake-match': loadFlakeScreen,
  'tap-race': loadTapRaceScreen,
  'tug-of-war': loadTugScreen,
};

/** How long this phone tries to get the game on screen and smooth before it reports anyway (shorter than the server's own STARTING_MAX_MS, so the report still counts). */
const READY_REPORT_MAX_MS = STARTING_MAX_MS - 2500;
/** The loading page's fade (styles.css, `starting-out`), with a little to spare: after `revealAt` plus this, a page that missed its fade's end (a hidden tab) is not shown any more. */
const CURTAIN_FADE_MS = 1000;

/** A picture of each game for the game picker, taken from the real game (files in public/games). A game with no picture yet shows a plain tile. */
const GAME_IMAGES: Partial<Record<GameId, string>> = { 'tap-race': '/games/tap-race.png', snowball: '/games/snowball.png', 'penguin-lasso': '/games/penguin-lasso.png', fishing: '/games/fishing.png', 'santa-sack': '/games/santa-sack.png', 'tug-of-war': '/games/tug-of-war.png', 'mountain-goat': '/games/mountain-goat.png', 'snowflake-match': '/games/snowflake-match.png', 'adoption-day': '/games/adoption-day.png', 'pirate-broadside': '/games/pirate-broadside.png', 'roach-hunt': '/games/roach-hunt.png', 'frog-climb': '/games/frog-climb.png' };

/** The room screen. It renders whatever phase the server says the room is in; it holds no game logic. */
export function LobbyPage() {
  const navigate = useNavigate();
  const { restoring, room: liveRoom, selfId, leaveRoom, returnToLobby, resetRoom, closeRoom, sendAction, serverNow, reportLoaded } = useRoom();
  const [error, setError] = useState<string | null>(null);
  // Before every round the screen flashes over the countdown and fades to a plain "starting" page, and the round begins almost at the end of the flash.
  // The server runs that as its own step (phase 'starting') so the game never starts under the flash; the flash itself is the same for every game (see screenFlash.ts).
  const room = useScreenFlash(liveRoom, (from, to) => from !== null && to !== null && from.phase !== 'starting' && to.phase === 'starting');

  // The loading page does not just disappear when the round begins: it fades away over the game at the round's reveal moment (see StartingScreen). This is the round whose page has finished fading.
  const [curtainGone, setCurtainGone] = useState<number | null>(null);

  // As soon as the host picks a game, start downloading its code so the round can begin instantly.
  const pickedGame = room?.settings.gameId;
  useEffect(() => {
    if (pickedGame) void GAME_LOADERS[pickedGame]();
  }, [pickedGame]);

  // THE LOADING STEP (GAME_RULES.md #8). The round's game is made when the 'starting' step begins, and this phone mounts it straight away, under the loading page: the real scene, built once.
  // When it is on screen and drawing smoothly (`waitUntilSettled`; at once if this page is hidden) the phone tells the server, which waits for every phone (and the minimum time) and then announces
  // one reveal moment and GO for everyone. A ref, not the effect's cleanup, makes it report once per round (React's development double-run); a late report is harmless, the server refuses it.
  const loadingRound = room?.phase === 'starting' && room.game ? room.roundId : null;
  const reported = useRef<number | null>(null);
  useEffect(() => {
    if (loadingRound === null || reported.current === loadingRound) return;
    reported.current = loadingRound;
    void waitUntilSettled(READY_REPORT_MAX_MS).then(() => void reportLoaded());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingRound]);

  // No room (refresh, lost connection, or the host closed it): back to the hub.
  if (!room) return restoring ? <main className="page"><p className="muted">Getting you back into the room…</p></main> : <Navigate to="/play" replace />; // (right after a refresh the seat is being taken back: do not send them away yet)

  // Fire a command and show its error (if any). Success needs no handling: the server's
  // next `room:state` broadcast updates the screen.
  const run = async (action: Promise<string | null>) => setError(await action);

  function leave() {
    leaveRoom();
    navigate('/play');
  }

  // While the round loads (under the loading page), while it runs, and during its short finish sequence (the game stays on screen, frozen, under the message).
  if ((room.phase === 'starting' || room.phase === 'playing' || room.phase === 'finish') && room.game) {
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
          <SnowballScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'penguin-lasso' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <PenguinScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'santa-sack' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SantaSackScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'roach-hunt' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <RoachScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'pirate-broadside' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <PirateScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'adoption-day' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <AdoptionScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'frog-climb' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <FrogClimbScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'mountain-goat' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <MountainGoatScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'snowflake-match' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <SnowflakeMatchScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'tug-of-war' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <TugOfWarScreen key={room.roundId} game={room.game} players={room.players} colors={room.colors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : room.game.gameId === 'fishing' ? (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <FishingScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      ) : (
        <Suspense fallback={<p className="center">Loading…</p>}>
          <TapRaceScreen key={room.roundId} game={room.game} players={room.players} colors={gameColors} selfId={selfId}
            serverNow={serverNow} sendAction={sendGameAction} frozen={frozen} result={room.result} finishEndsAt={room.finishEndsAt} />
        </Suspense>
      );
    // The loading page over the game: up for the whole 'starting' step, then fading at the reveal moment (the same element throughout, same key and place, so it is never rebuilt: a rebuilt
    // page would reload its picture and could blink). A page that opens on a round already revealed (a refresh) shows no curtain.
    const curtainUp = room.phase === 'starting' || (room.phase === 'playing' && room.revealAt !== null && curtainGone !== room.roundId && serverNow() < room.revealAt + CURTAIN_FADE_MS);
    const roundId = room.roundId;
    return <>{screen}{curtainUp && <StartingScreen key="curtain" title={getGame(room.settings.gameId)?.name ?? ''} image={room.settings.gameId ? GAME_IMAGES[room.settings.gameId] : undefined}
      revealAt={room.phase === 'playing' ? room.revealAt : null} serverNow={serverNow} onGone={() => setCurtainGone(roundId)} />}</>; // every game stages the shared winner moment inside its own screen (see GAME_RULES.md #2)
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
  // The flash step without a game (it always has one: this is only a fallback): the plain loading page.
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
