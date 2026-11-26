import { StartCountdown, introProgress } from './StartCountdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RELOAD_MS, TEAM_COLORS, TEAM_NAMES, WICK_MS, type GameAction, type PirateBroadsideView, type Player, type RoundResult } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { useStarted } from './useStarted';
import { PirateScene, type CrewStyle } from './pirate/PirateScene';
import { useAim } from './pirate/useAim';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: PirateBroadsideView;
  players: Player[];
  /** The players' colors (in a team game these are the team colors). */
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
 * The Broadside Battle round (GAME_RULES.md #25): a first-person view from behind your own cannon on a rocking ship. The stick aims the barrel (it keeps working during the wick and the reload), the button
 * lights the wick (1 second of burning, then BOOM, then 2 seconds before the next shot). A spectator follows a pirate's cannon. The ending is the shared winner moment (the camera glides to the winning ship).
 */
export default function PirateScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<PirateScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.players;
  const me = isPlayer && selfId ? game.players[selfId] : null;
  const [, redraw] = useState(0);

  const styles = useMemo<Record<string, CrewStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = new PirateScene(container.current!, styles, isPlayer ? selfId : null);
    scene.current = s;
    s.serverNow = serverNow;
    s.introFactor = () => introProgress(game.startsAt, serverNow());
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.pushView(game); }, [game]);

  const started = useStarted(game.startsAt, serverNow); // (no control before GO)
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [remainingMs]);
  const live = isPlayer && started && !frozen && remainingMs > 0;
  const { setStick } = useAim(scene, sendAction, live, me?.team ?? null, me ? { yaw: me.yaw, pitch: me.pitch } : undefined);

  // Spectators follow a pirate's cannon.
  const subjects = useMemo(
    () => Object.keys(game.players).map((id) => ({ id, name: styles[id]?.name ?? '?', color: TEAM_COLORS[game.players[id].team] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.players).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer);

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ targetId: null, winner: true, winnerTeam: result?.team?.winner ?? null });
    else scene.current?.setCameraView({ targetId: isPlayer ? selfId : camera.targetId });
  }, [winnerMoment, result, isPlayer, selfId, camera.targetId]);

  // The cannon's state, redrawn about 20 times a second while it matters.
  useEffect(() => { const id = setInterval(() => redraw((n) => n + 1), 50); return () => clearInterval(id); }, []);
  const subjectId = isPlayer ? selfId : camera.targetId;
  const sub = subjectId ? game.players[subjectId] : null;
  const now = serverNow();
  const burning = !!sub && sub.wickAt !== null;
  const reloadLeft = sub && !burning ? Math.max(0, sub.readyAt - now) : 0;
  const ready = !!sub && !burning && reloadLeft <= 0;
  const progress = burning && sub ? Math.min(1, (now - sub.wickAt!) / WICK_MS) : reloadLeft > 0 ? 1 - reloadLeft / RELOAD_MS : 1;

  function fire() { if (live && ready) sendAction({ type: 'fire' }); }
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => { if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return; e.preventDefault(); fire(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ready]);

  const { yellow, purple } = game.totals;
  const share = yellow + purple > 0 ? yellow / (yellow + purple) : 0.5;
  const myTeam = me?.team;
  return (
    <div className="snow-screen pirate-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} />
      <div className="snow-hud">
        <div className="snow-timer">{remainingMs <= 0 ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <div className="tug-bar" aria-label="Team hits">
          <span className="tug-total" style={{ color: TEAM_COLORS.yellow }}>{yellow}</span>
          <div className="tug-track"><div className="tug-fill" style={{ width: `${share * 100}%`, background: TEAM_COLORS.yellow }} /><div className="tug-rest" style={{ background: TEAM_COLORS.purple }} /></div>
          <span className="tug-total" style={{ color: TEAM_COLORS.purple }}>{purple}</span>
        </div>
        {isPlayer && myTeam && started && !frozen && me && me.hits === 0 && <p className="snow-hint" style={{ color: TEAM_COLORS[myTeam] }}>Aim with the stick, then FIRE: the wick burns for a second, so lead the roll of the sea · {TEAM_NAMES[myTeam]}</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {live && (
        <>
          <Joystick onChange={setStick} className="half-left" />
          <button className={`pirate-fire${burning ? ' burning' : ready ? ' ready' : ''}`} onPointerDown={(e) => { e.stopPropagation(); fire(); }} disabled={!ready}
            style={{ ['--p' as string]: `${Math.round(progress * 100)}%` }}>
            <span>{burning ? 'BURNING' : ready ? 'FIRE' : 'RELOAD'}</span>
          </button>
        </>
      )}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
