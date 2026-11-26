import { useEffect, useMemo, useRef, useState } from 'react';
import { CLIMB_COOLDOWN_MS, POLE_TOP, bendStress, SWAP_COOLDOWN_MS, type FrogClimbView, type GameAction, type Player, type RoundResult } from '@fgn/shared';
import { StartCountdown, introProgress } from './StartCountdown';
import { useStarted } from './useStarted';
import { useRemainingMs } from './Countdown';
import { FrogClimbScene, type FrogStyle } from './frog/FrogClimbScene';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: FrogClimbView;
  players: Player[];
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  frozen?: boolean;
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Frog Climb round. No buttons: tap the LEFT half of the screen to swap sides (scramble to the other side of the pole) and the RIGHT half to climb (hop up), like Roach Rumble's tap field. The scene follows your own frog on its own pole (a spectator follows any player's), with the other poles
 * blurred behind. The pole itself turns redder the more it bends. The server does the real judging; the tap fields only show the cooldown the server enforces.
 */
export default function FrogClimbScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<FrogClimbScene | null>(null);
  const readyAt = useRef(0); // when your next action will be accepted (the server's rule, worked out locally from your own taps)
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const over = remainingMs <= 0;
  const started = useStarted(game.startsAt, serverNow);
  const isPlayer = selfId !== null && selfId in game.players;
  const [cooling, setCooling] = useState(false);

  const styles = useMemo<FrogStyle[]>(
    () => players.filter((p) => p.id in game.players).map((p) => ({ id: p.id, name: p.name, color: colors[p.id] ?? FALLBACK_COLOR })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const subjects = useMemo(() => styles.map((s) => ({ id: s.id, name: s.name, color: s.color })), [styles]);
  const camera = useSpectatorCamera(subjects, !isPlayer);

  useEffect(() => {
    const s = new FrogClimbScene(container.current!, serverNow, styles, isPlayer ? selfId : camera.targetId);
    scene.current = s;
    s.introFactor = () => introProgress(game.startsAt, serverNow());
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.pushView(game); }, [game]);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [Math.ceil(remainingMs / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  const winnerId = result?.winnerId ?? null;
  useEffect(() => { scene.current?.setWinnerView(winnerMoment); }, [winnerMoment]);
  useEffect(() => { // whose pole the camera shows: the winner's at the end (nobody's on a draw: the whole circle), yours while you play, the followed player's for a spectator
    scene.current?.setFollow(winnerMoment ? winnerId : isPlayer ? selfId : camera.targetId);
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  function act(type: 'climb' | 'swap') {
    if (!isPlayer || !selfId || !started || over || frozen) return;
    const now = serverNow();
    if (now < readyAt.current) return; // (the server would ignore it too)
    const wait = type === 'climb' ? CLIMB_COOLDOWN_MS : SWAP_COOLDOWN_MS;
    readyAt.current = now + wait;
    setCooling(true); setTimeout(() => setCooling(false), wait);
    if (type === 'climb') scene.current?.localClimb(selfId); else scene.current?.localSwap(selfId);
    sendAction({ type });
  }
  // keyboard: left arrow / A swaps, up arrow / space / W climbs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a' || k === 'arrowright' || k === 'd') act('swap'); else if (k === 'arrowup' || k === 'w' || k === ' ') { e.preventDefault(); act('climb'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shownId = winnerMoment && winnerId ? winnerId : isPlayer ? selfId : camera.targetId;
  const shown = shownId ? game.players[shownId] : undefined;
  const standings = styles.map((s) => ({ ...s, h: Math.floor(game.players[s.id]?.h ?? 0) })).sort((a, b) => b.h - a.h);

  const stress = shown && !winnerMoment ? bendStress(shown.lean) : 0; // how hard the followed pole is straining: the screen edges redden by this much (the scene shakes by it too)

  return (
    <div className="snow-screen frog-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} onContextMenu={(e) => e.preventDefault()} />
      <div className="frog-vignette" style={{ opacity: stress * 0.85 }} />
      <div className="snow-hud">
        <div className="snow-timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, name, color, h }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: color }} />
              <span className="snow-name">{name}</span>
              <span className="snow-size">{h}<small>/{POLE_TOP}</small></span>
            </li>
          ))}
        </ul>
        {isPlayer && started && !frozen && !over && (shown?.h ?? 0) === 0 && <p className="snow-hint frog-hint">Tap the right side to climb. Tap the left side to swap sides before the pole turns red, and to dodge the thorns!</p>}
      </div>
      {isPlayer && !frozen && (
        <>
          <div className={`frog-zone left${cooling ? ' cooling' : ''}`} onPointerDown={(e) => { e.preventDefault(); act('swap'); }} aria-label="Tap to swap sides">
            {started && !over && <span className="frog-zone-hint">TAP TO SWAP SIDES</span>}
          </div>
          <div className={`frog-zone right${cooling ? ' cooling' : ''}`} onPointerDown={(e) => { e.preventDefault(); act('climb'); }} aria-label="Tap to climb">
            {started && !over && <span className="frog-zone-hint">TAP TO CLIMB</span>}
          </div>
        </>
      )}
      {winnerMoment && result && <WinnerBanner result={result} players={players} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
