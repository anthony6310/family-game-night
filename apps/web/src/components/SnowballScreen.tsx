import { StartCountdown, introProgress } from './StartCountdown';
import { useEffect, useMemo, useRef } from 'react';
import type { GameAction, Player, RoundResult, SnowballView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { SnowballScene, type BallStyle } from './snowball/SnowballScene';
import { SprintButton, StaminaBar } from './snowball/SprintControls';
import { useSprint } from './snowball/useSprint';
import { useSteering } from './snowball/useSteering';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: SnowballView;
  players: Player[];
  /** Each player's chosen color (see the lobby's color picker): the same color in every game. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its you-won / you-lost sequence is playing: no steering, no controls. */
  frozen?: boolean;
  /** The decided result and the server time the finish sequence ends: while `frozen`, they drive the shared winner moment (see WinnerMoment). */
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}


/**
 * The Snowball round: a full-screen three.js view, a small HUD, and steering controls.
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function SnowballScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<SnowballScene | null>(null);

  // Colors, names and profile pictures are fixed when the round starts (a player leaving mustn't recolor everyone).
  const styles = useMemo<Record<string, BallStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR, avatarUrl: p.avatarUrl }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Create the 3D scene once; tear it down (freeing GPU memory) when the round screen closes.
  useEffect(() => {
    const s = new SnowballScene(container.current!, game.arenaRadius, game.terrain, styles, selfId);
    s.setBaseSpeed(game.speedRange.base);
    s.setMaxSpeedFactor(game.speedRange.max / game.speedRange.base);
    scene.current = s;
    s.introFactor = () => introProgress(game.startsAt, serverNow()); // the camera's start-countdown move (see StartCountdown)
    return () => {
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feed every new server snapshot to the scene.
  useEffect(() => {
    scene.current?.pushSnapshot(game.balls);
    scene.current?.setItems(game.items); // the pick-ups lying in the arena
  }, [game]);

  const setStick = useSteering(sendAction, !frozen);
  const setSprintHeld = useSprint(sendAction, !frozen); // hold the button (or Shift / Space) to sprint
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => {
    scene.current?.setSecondsLeft(remainingMs / 1000); // the last 5 seconds tick, then the whistle: the same countdown as every game
  }, [remainingMs]);
  const isPlayer = selfId !== null && selfId in game.balls;

  // Spectators (watchers, or players sitting out a tie-breaker) choose whose camera to follow, or fly a free camera.
  const subjects = useMemo(
    () => Object.keys(game.balls).map((id) => ({ id, name: styles[id]?.name ?? '?', color: styles[id]?.color })),
    // The list only changes when someone joins/leaves the round, not on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.balls).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer);
  useEffect(() => { scene.current?.setPanSource(camera.pan); }, [camera.pan]);
  // The winner moment (shared with the other games): the camera goes to the winner for EVERYONE, with a banner and the drumroll + fanfare.
  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  const winnerId = result?.winnerId ?? null;
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ mode: 'follow', targetId: winnerId });
    else if (!isPlayer) scene.current?.setCameraView({ mode: camera.mode, targetId: camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, camera.mode, camera.targetId]);

  // The stamina bar shows the ball you are playing (or, for a spectator, the one they follow).
  const subjectBall = (isPlayer ? selfId : camera.targetId) ? game.balls[(isPlayer ? selfId : camera.targetId)!] : undefined;

  const standings = Object.entries(game.balls)
    .map(([id, ball]) => ({ id, size: Math.round(ball.radius * 100), style: styles[id], leader: ball.leader, fish: ball.fish }))
    .sort((a, b) => b.size - a.size);

  return (
    <div className="snow-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, size, style, leader, fish }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{leader && '👑 '}{style?.name ?? '?'}</span>
              {fish > 0 && <span className="snow-fish" title="Fish: each adds +5 damage to the next hit">🐟{fish}</span>}
              <span className="snow-size">{size}</span>
            </li>
          ))}
        </ul>
        {!frozen && subjectBall && <StaminaBar stamina={subjectBall.stamina} startAt={game.staminaStart} sprinting={subjectBall.sprinting} recovering={subjectBall.escape} />}
        {isPlayer && !frozen && <p className="snow-hint">Drag to steer · WASD / arrows · hold Shift, Space or ⚡ to sprint</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {isPlayer && !frozen && <Joystick onChange={setStick} />}
      {isPlayer && !frozen && <SprintButton onHold={setSprintHeld} active={Boolean(subjectBall?.sprinting)} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
