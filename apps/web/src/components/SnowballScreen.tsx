import { useEffect, useMemo, useRef } from 'react';
import type { GameAction, Player, SnowballView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './snowball/Joystick';
import { SnowballScene, type BallStyle } from './snowball/SnowballScene';
import { useSteering } from './snowball/useSteering';

interface Props {
  game: SnowballView;
  players: Player[];
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
}

/** Ring / name-tag colours. Everyone gets one by their seat at the start of the round. */
const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

/**
 * The Snowball round: a full-screen three.js view, a small HUD, and steering controls.
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function SnowballScreen({ game, players, selfId, serverNow, sendAction }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<SnowballScene | null>(null);

  // Colours and names are fixed when the round starts (a player leaving mustn't recolour everyone).
  const styles = useMemo<Record<string, BallStyle>>(
    () => Object.fromEntries(players.map((p, i) => [p.id, { name: p.name, color: PALETTE[i % PALETTE.length] }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Create the 3D scene once; tear it down (freeing GPU memory) when the round screen closes.
  useEffect(() => {
    const s = new SnowballScene(container.current!, game.arenaRadius, styles, selfId);
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

  const setStick = useSteering(sendAction);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const isPlayer = selfId !== null && selfId in game.balls;

  const standings = Object.entries(game.balls)
    .map(([id, ball]) => ({ id, size: Math.round(ball.radius * 100), style: styles[id] }))
    .sort((a, b) => b.size - a.size);

  return (
    <div className="snow-screen">
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, size, style }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{style?.name ?? '?'}</span>
              <span className="snow-size">{size}</span>
            </li>
          ))}
        </ul>
        {!isPlayer && <p className="snow-note">You're watching this tie-breaker.</p>}
        {isPlayer && <p className="snow-hint">Drag to steer · or use WASD / arrow keys</p>}
      </div>

      {isPlayer && <Joystick onChange={setStick} />}
    </div>
  );
}
