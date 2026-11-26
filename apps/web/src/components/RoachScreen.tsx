import { useLatest } from './useLatest';
import { StartCountdown, introProgress } from './StartCountdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POISON_DRAIN, ROACH_LIFE_MAX, ROACH_LOW_LIFE, SMACK_HIT_ARREST_MS, SMACK_MISS_ARREST_MS, TEAM_COLORS, type GameAction, type Player, type RoachHuntView, type RoundResult } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { useStarted } from './useStarted';
import { RoachScene, type RoachStyle } from './roach/RoachScene';
import { audio } from '../audio/spatialAudio';
import { kitchenHum } from '../audio/roachRumbleSounds';
import { useRoachSteering } from './roach/useRoachSteering';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: RoachHuntView;
  players: Player[];
  /** The players' colors. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its finish sequence is playing: no input. */
  frozen?: boolean;
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Roach Rumble round (GAME_RULES.md #26). A roach steers with the stick and has to keep eating to stay alive (its lifetime, shown as a bar, runs down every second) while the sandal hunts it. The sandal steers with the stick on the
 * LEFT half of the screen and smacks with a tap on the RIGHT half (or Space); after a smack it is out of your hands for a moment. A dead roach watches the others, like a spectator (a starved one first watches its own body curl
 * up). The ending is the shared winner moment.
 */
export default function RoachScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const latestGame = useLatest(game); // (the scene lives on, so what it reads must be the newest `game`: GO moves while phones get the game on screen)
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<RoachScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.players;
  const me = isPlayer && selfId ? game.players[selfId] : null;
  const isSandal = me?.role === 'sandal';
  const squashed = !!me && !me.alive; // (dead: squashed or starved)
  const starved = !!me && me.cause === 'starved';
  const [, redraw] = useState(0);

  const styles = useMemo<Record<string, RoachStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The dark kitchen hums from the moment this screen is up until it goes away (the theme is played by the room screen: audio/gameThemes.ts).
  useEffect(() => audio.startBed(kitchenHum, 0.3), []);

  useEffect(() => {
    const s = new RoachScene(container.current!, styles, isPlayer ? selfId : null);
    scene.current = s;
    s.serverNow = serverNow;
    s.introFactor = () => introProgress(latestGame.current.startsAt, serverNow());
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.pushView(game); }, [game]);

  const started = useStarted(game.startsAt, serverNow); // (no control before GO)
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [remainingMs]);
  const live = isPlayer && !squashed && started && !frozen && remainingMs > 0;
  useEffect(() => { if (scene.current) scene.current.canMove = live; }, [live]);
  // The stick is read relative to the camera; a roach can turn its camera by dragging the right side of the screen (the sandal's camera stays put: north is up).
  const getYaw = useCallback(() => (isSandal ? 0 : scene.current?.getYaw() ?? 0), [isSandal]);
  const turnCamera = useCallback((d: number) => { if (!isSandal) scene.current?.turnBy(d); }, [isSandal]);
  const onWorld = useCallback((x: number, z: number) => scene.current?.setSteer(x, z), []);
  const setStick = useRoachSteering(sendAction, getYaw, turnCamera, onWorld, live);
  const look = useRef<{ id: number; x: number } | null>(null);

  // Spectators, and a squashed roach, follow someone.
  const subjects = useMemo(
    () => Object.keys(game.players).filter((id) => game.players[id].alive).map((id) => ({ id, name: styles[id]?.name ?? '?', color: game.players[id].role === 'sandal' ? TEAM_COLORS.purple : TEAM_COLORS.yellow })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.players).filter((id) => game.players[id].alive).join(',')],
  );
  const watching = !isPlayer || squashed;
  const camera = useSpectatorCamera(subjects, watching);

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  // A roach that starved watches its own body curl up (a couple of seconds) before it follows someone else.
  const holdBody = starved && me?.diedAt != null && serverNow() - me.diedAt < 2800;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ targetId: null, winner: true });
    else scene.current?.setCameraView({ targetId: holdBody ? selfId : watching ? camera.targetId : selfId });
  }, [winnerMoment, watching, selfId, camera.targetId, holdBody]);

  // The sandal's recovery, redrawn about 20 times a second while it matters.
  useEffect(() => { const id = setInterval(() => redraw((n) => n + 1), 50); return () => clearInterval(id); }, []);
  const vision = scene.current?.vision();
  const poisoned = !squashed && !isSandal && !!scene.current?.standingInPoison();
  const life = me && !isSandal && me.alive ? me.life : 0;
  const lifeMax = me && !isSandal && me.alive ? me.lifeMax : 0;
  const left = me && isSandal ? Math.max(0, me.readyAt - serverNow()) : 0;
  const ready = !!me && isSandal && left <= 0;
  const stuck = !!me && isSandal && !ready && me.smackHit;
  const blocked = ready && !!scene.current && !scene.current.smackClear();
  function smack() {
    if (!live || !isSandal || !ready) return;
    if (scene.current && !scene.current.smackClear()) return; // nowhere a roach could stand: the server would refuse it too
    scene.current?.smackNow();
    sendAction({ type: 'smack' });
  }
  useEffect(() => {
    if (!live || !isSandal) return;
    const onKey = (e: KeyboardEvent) => { if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return; e.preventDefault(); smack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, isSandal, ready]);

  return (
    <div className="snow-screen roach-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} />
      {/* The roaches' night vision: still dark (dark edges, grain, scanlines, a cold green tint), and a flash of white when the lights come on. */}
      {vision && vision.nv > 0.02 && <div className="roach-nv" style={{ opacity: vision.nv }} />}
      {vision && vision.dazzle > 0.02 && <div className="roach-dazzle" style={{ opacity: vision.dazzle * 0.85 }} />}
      <div className="snow-hud">
        <div className="snow-timer">{remainingMs <= 0 ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <p className="roach-left" aria-label="Roaches left">Roaches left <strong>{game.alive}</strong> / {game.total}</p>
        {isPlayer && !isSandal && !squashed && started && (
          <div className={life <= ROACH_LOW_LIFE ? 'roach-life low' : 'roach-life'} aria-label="Your lifetime">
            <div className="roach-life-bar"><div style={{ width: `${Math.round(Math.min(1, life / ROACH_LIFE_MAX) * 100)}%`, background: life >= 15 ? '#7be07b' : life > ROACH_LOW_LIFE ? '#f2d24b' : '#ff5a4d' }} />{lifeMax > 0 && lifeMax < ROACH_LIFE_MAX && <span className="roach-life-block" style={{ width: `${((ROACH_LIFE_MAX - lifeMax) / ROACH_LIFE_MAX) * 100}%` }} title="The poison took this away for good" />}</div>
            <span>{Math.ceil(life)}s of life</span>
          </div>
        )}
        {poisoned && !frozen && <p className="roach-poison">POISON! You lose life {1 + POISON_DRAIN} times as fast, and your limit drops to 20 for good. Get out!</p>}
        {isPlayer && started && !frozen && !squashed && (
          <p className="snow-hint" style={{ color: isSandal ? TEAM_COLORS.purple : TEAM_COLORS.yellow }}>
            {isSandal
              ? (ready ? 'You are the sandal! Squash every roach, or wait for them to starve. Smash the poison bottle to douse a landmark' : stuck ? 'Stuck in the guts! Wait for it to come free' : 'The sandal is coming back up…')
              : 'You are a roach! Your life runs out: face food while you are next to it to eat and live longer. Keep away from the sandal'}
          </p>
        )}
        {squashed && !frozen && <p className="snow-hint">{starved ? 'You starved! Watching the rest of the round' : 'You were squashed! Watching the rest of the round'}</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {live && (isSandal ? (
        <>
          <Joystick onChange={setStick} className="half-left" />
          <div className="roach-tap" onPointerDown={(e) => { e.preventDefault(); smack(); }} aria-label="Tap to smack">
            <span className={ready && !blocked ? 'roach-tap-hint' : 'roach-tap-hint wait'}>{ready ? (blocked ? 'NO FLOOR THERE' : 'TAP TO SMACK') : stuck ? 'STUCK' : 'RECOVERING'}</span>
            {!ready && <div className="roach-recover"><div style={{ width: `${Math.round(Math.min(1, left / (stuck ? SMACK_HIT_ARREST_MS : SMACK_MISS_ARREST_MS)) * 100)}%` }} /></div>}
          </div>
        </>
      ) : (
        <>
          <Joystick onChange={setStick} className="half-left" />
          <div className="roach-look" aria-label="Drag to look around"
            onPointerDown={(e) => { if (look.current) return; look.current = { id: e.pointerId, x: e.clientX }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { const l = look.current; if (!l || e.pointerId !== l.id) return; turnCamera(-(e.clientX - l.x) * 0.009); l.x = e.clientX; }}
            onPointerUp={(e) => { if (look.current?.id === e.pointerId) look.current = null; }} onPointerCancel={(e) => { if (look.current?.id === e.pointerId) look.current = null; }}>
            {started && remainingMs > 0 && <span className="roach-look-hint">DRAG TO LOOK</span>}
          </div>
        </>
      ))}
      {watching && !frozen && subjects.length > 0 && <SpectatorControls camera={camera} />}
    </div>
  );
}
