import { useEffect, useMemo, useRef } from 'react';
import type { GameAction, Player, SnowballView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { SnowballScene, type BallStyle } from './snowball/SnowballScene';
import { useSteering } from './snowball/useSteering';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: SnowballView;
  players: Player[];
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its you-won / you-lost sequence is playing: no steering, no controls. */
  frozen?: boolean;
}

/** Ring / name-tag colours. Everyone gets one by their seat at the start of the round. */
const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

/**
 * The Snowball round: a full-screen three.js view, a small HUD, and steering controls.
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function SnowballScreen({ game, players, selfId, serverNow, sendAction, frozen = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<SnowballScene | null>(null);

  // Colours, names and profile pictures are fixed when the round starts (a player leaving mustn't recolour everyone).
  const styles = useMemo<Record<string, BallStyle>>(
    () => Object.fromEntries(players.map((p, i) => [p.id, { name: p.name, color: PALETTE[i % PALETTE.length], avatarUrl: p.avatarUrl }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Create the 3D scene once; tear it down (freeing GPU memory) when the round screen closes.
  useEffect(() => {
    const s = new SnowballScene(container.current!, game.arenaRadius, game.terrain, styles, selfId);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feed every new server snapshot to the scene.
  useEffect(() => {
    scene.current?.pushSnapshot(game.balls);
  }, [game]);

  const setStick = useSteering(sendAction, !frozen);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
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
  useEffect(() => {
    if (!isPlayer) scene.current?.setCameraView({ mode: camera.mode, targetId: camera.targetId });
  }, [isPlayer, camera.mode, camera.targetId]);

  const standings = Object.entries(game.balls)
    .map(([id, ball]) => ({ id, size: Math.round(ball.radius * 100), style: styles[id], leader: ball.leader }))
    .sort((a, b) => b.size - a.size);

  return (
    <div className="snow-screen">
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, size, style, leader }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{leader && '👑 '}{style?.name ?? '?'}</span>
              <span className="snow-size">{size}</span>
            </li>
          ))}
        </ul>
        {isPlayer && !frozen && <p className="snow-hint">Drag to steer · or use WASD / arrow keys</p>}
      </div>

      {isPlayer && !frozen && <Joystick onChange={setStick} />}
      {!isPlayer && <SpectatorControls camera={camera} />}
    </div>
  );
}
