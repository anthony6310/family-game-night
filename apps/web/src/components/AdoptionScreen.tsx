import { StartCountdown } from './StartCountdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { kindName, type AdoptionDayView, type GameAction, type Player, type RoundResult } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { useStarted } from './useStarted';
import { AdoptionScene, type ShelterUi, type VolunteerStyle } from './shelter/AdoptionScene';
import { LookPad } from './shelter/FirstPersonControls';
import { useFirstPerson } from './shelter/useFirstPerson';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: AdoptionDayView;
  players: Player[];
  /** Each player's chosen color (see the lobby's color picker): the same color in every game. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its finish sequence is playing: no input. */
  frozen?: boolean;
  /** The decided result and the server time the finish sequence ends: while `frozen`, they drive the winner moment (see WinnerMoment). */
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Zoo Adoption round: a first-person view of a huge shelter, the clock, the adopters' requests as a strip of pictures, the standings, and
 * the controls (left thumb walks, right thumb looks, one button picks up / hands over / puts down; WASD, arrows and Space on a keyboard).
 * Players see through their own eyes; spectators follow a player and see what they see. The ending is the shared winner moment (GAME_RULES.md #2).
 */
export default function AdoptionScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<AdoptionScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.players;
  const [icons, setIcons] = useState<string[]>([]);
  const [ui, setUi] = useState<ShelterUi>({ highlight: null, nearAdoptee: false, carrying: false });

  // Colors and names are fixed when the round starts (a player leaving mustn't recolor everyone).
  const styles = useMemo<Record<string, VolunteerStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = new AdoptionScene(container.current!, { width: game.width, depth: game.depth }, styles, isPlayer ? selfId : null);
    scene.current = s;
    s.serverNow = serverNow;
    s.onUi = setUi;
    setIcons(s.icons);
    return () => {
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scene.current?.pushView(game);
  }, [game]);

  const started = useStarted(game.startsAt, serverNow); // (no control before GO)
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => {
    scene.current?.setSecondsLeft(remainingMs / 1000); // the shared countdown: ticks for the last 5 seconds, then the whistle
  }, [remainingMs]);

  const live = isPlayer && started && !frozen;
  const { setStick, turn } = useFirstPerson(scene, sendAction, live);

  // Spectators follow a player and see through their eyes.
  const subjects = useMemo(
    () => Object.keys(game.players).map((id) => ({ id, name: styles[id]?.name ?? '?', color: styles[id]?.color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.players).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer);

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow); // drumroll, then the fanfare as the camera reaches the winner
  const winnerId = result?.winnerId ?? null;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ targetId: winnerId, winner: true });
    else scene.current?.setCameraView({ targetId: isPlayer ? selfId : camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  /** The one button: pick up what is lit up, hand over to the adopter in front of you, or put down what you hold. */
  function act() {
    if (!live) return;
    if (ui.carrying) sendAction({ type: 'give' });
    else {
      const target = scene.current?.highlightId ?? null;
      if (target !== null) sendAction({ type: 'grab', target });
    }
  }
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ui.carrying]);

  const subjectId = isPlayer ? selfId : camera.targetId;
  const standings = Object.entries(game.players)
    .map(([id, p]) => ({ id, adoptions: p.adoptions, style: styles[id] }))
    .sort((a, b) => b.adoptions - a.adoptions);
  const carried = subjectId ? game.players[subjectId]?.carry : null;
  const buttonLabel = ui.carrying ? (ui.nearAdoptee ? 'Hand over' : 'Put down') : 'Pick up';
  const buttonReady = ui.carrying || ui.highlight !== null;

  return (
    <div className="snow-screen shelter-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{remainingMs <= 0 ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        {/* What each adopter wants, as pictures (the same models as in their thought bubbles), left to right along the desk. */}
        <ul className="shelter-wants">
          {game.adoptees.map((ad) => {
            const state = ad.doneAt !== null ? 'done' : ad.nopeAt !== null && serverNow() - ad.nopeAt < 900 ? 'nope' : '';
            return (
              <li key={ad.id} className={state} title={kindName(ad.kind)}>
                {icons[ad.kind] && <img src={icons[ad.kind]} alt={kindName(ad.kind)} draggable={false} />}
              </li>
            );
          })}
        </ul>
        <ul className="snow-standings">
          {standings.map(({ id, adoptions, style }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{style?.name ?? '?'}</span>
              <span className="snow-size">{adoptions} {adoptions === 1 ? 'adoption' : 'adoptions'}</span>
            </li>
          ))}
        </ul>
        {isPlayer && !frozen && started && <div className="fp-dot" />}
        {isPlayer && !frozen && !carried && <p className="snow-hint">Find an animal an adopter wants (it lights up when you are close), pick it up, and hand it over from the yellow pad in front of them · left thumb walks, right thumb looks</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {live && (
        <>
          <Joystick onChange={setStick} className="half-left" />
          <LookPad onTurn={turn} />
          <button className={`fp-action${buttonReady ? ' ready' : ''}${ui.carrying && ui.nearAdoptee ? ' give' : ''}`} onPointerDown={(e) => { e.stopPropagation(); act(); }} disabled={!buttonReady}>
            {buttonLabel}
          </button>
        </>
      )}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
