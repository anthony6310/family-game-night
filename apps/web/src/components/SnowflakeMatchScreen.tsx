import { useEffect, useMemo, useRef, useState } from 'react';
import { FLAKE_PICK_GAP_MS, type GameAction, type Player, type RoundResult, type SnowflakeMatchView } from '@fgn/shared';
import { StartCountdown, introProgress } from './StartCountdown';
import { useStarted } from './useStarted';
import { useRemainingMs } from './Countdown';
import { SnowflakeMatchScene, type FlakeStyle } from './flakes/SnowflakeMatchScene';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: SnowflakeMatchView;
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
 * The Snowflake Match round. First person: tap the falling snowflake that matches the one in your hand. Your tap is judged on your phone at once (a burst for a match, a red flash and a screen shake
 * for a wrong one) with the same hand the server knows; the server judges the same tap (which flake, and when you tapped) and its view then gives you the point, the new hand, and the flake's new fall.
 * Spectators follow any player and see that player's hand.
 */
export default function SnowflakeMatchScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<SnowflakeMatchScene | null>(null);
  const lastTap = useRef(0);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const over = remainingMs <= 0;
  const started = useStarted(game.startsAt, serverNow);
  const isPlayer = selfId !== null && selfId in game.players;
  const [pop, setPop] = useState<{ id: number; good: boolean } | null>(null);

  const styles = useMemo<FlakeStyle[]>(
    () => players.filter((p) => p.id in game.players).map((p) => ({ id: p.id, name: p.name, color: colors[p.id] ?? FALLBACK_COLOR })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const subjects = useMemo(() => styles.map((s) => ({ id: s.id, name: s.name, color: s.color })), [styles]);
  const camera = useSpectatorCamera(subjects, !isPlayer);

  useEffect(() => {
    const s = new SnowflakeMatchScene(container.current!, serverNow, styles, isPlayer ? selfId : camera.targetId);
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
  useEffect(() => { // whose hand is shown: the winner's at the end, yours while you play, the followed player's for a spectator
    scene.current?.setFollow(winnerMoment && winnerId ? winnerId : isPlayer ? selfId : camera.targetId);
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  function onTap(e: React.PointerEvent) {
    if (!isPlayer || !selfId || !started || over || frozen || !scene.current?.canTap()) return; // (not while the hand is swapping its snowflake)
    const now = serverNow();
    if (now - lastTap.current < FLAKE_PICK_GAP_MS) return; // (the server ignores faster taps too)
    const hit = scene.current?.pickAt(e.clientX, e.clientY);
    if (!hit) return; // (a tap on empty sky is nothing)
    lastTap.current = now;
    const good = game.players[selfId].hand.includes(hit.design);
    scene.current?.tapped(hit.flake, good);
    setPop({ id: now, good });
    sendAction({ type: 'pick', flake: hit.flake, at: now });
  }

  // the one score on show: yours while you play, the followed player's for a spectator, the winner's at the end
  const shownId = winnerMoment && winnerId ? winnerId : isPlayer ? selfId : camera.targetId;
  const score = shownId ? game.players[shownId]?.points ?? 0 : 0;
  const mine = selfId ? game.players[selfId]?.points ?? 0 : 0;
  // which way the shown score just moved (it flashes blue going up and red going down); a different player being shown is not a change
  const flash = useRef({ id: shownId, score, dir: '', n: 0 });
  if (flash.current.id !== shownId) flash.current = { id: shownId, score, dir: '', n: flash.current.n + 1 };
  else if (flash.current.score !== score) flash.current = { id: shownId, score, dir: score > flash.current.score ? 'up' : 'down', n: flash.current.n + 1 };

  return (
    <div className="snow-screen flake-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()} />
      <div className="snow-hud">
        <div className="snow-timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <div key={flash.current.n} className={`flake-score ${flash.current.dir}`}>{score}</div>
        {pop && <div key={pop.id} className={pop.good ? 'flake-pop good' : 'flake-pop bad'}>{pop.good ? '+1' : '-1'}</div>}
        {isPlayer && started && !frozen && !over && mine === 0 && <p className="snow-hint">Tap the falling snowflake that matches the one in your hand!</p>}
      </div>
      {winnerMoment && result && <WinnerBanner result={result} players={players} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
