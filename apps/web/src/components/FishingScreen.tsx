import { StartCountdown } from './StartCountdown';
import { useEffect, useMemo, useRef } from 'react';
import type { FishingView, GameAction, Player, RoundResult } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Joystick } from './Joystick';
import { FishingScene, type AnglerStyle } from './fishing/FishingScene';
import { useSteering } from './snowball/useSteering';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: FishingView;
  players: Player[];
  /** Each player's chosen color (see the lobby's color picker): the same color in every game. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its finish sequence is playing: no steering. */
  frozen?: boolean;
  /** The decided result and the server time the finish sequence ends: while `frozen`, they drive the winner moment (see WinnerMoment). */
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Fishing round: a full-screen three.js ocean (see FishingScene), a small HUD (the clock and each player's fish count) and a
 * left / right control (the same joystick / A D keys as the other games; sideways slides the hook, up lifts it a little; the ascent itself is automatic).
 * Players follow their own lane; spectators pick whose lane to watch. The ending is the shared winner moment (GAME_RULES.md #2).
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function FishingScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<FishingScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.hooks;

  // Colors and names are fixed when the round starts (a player leaving mustn't recolor everyone).
  const styles = useMemo<Record<string, AnglerStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = new FishingScene(container.current!, serverNow, styles, isPlayer ? selfId : null);
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scene.current?.pushView(game); }, [game]);

  // Steering only counts once the hooks are rising (the server ignores it before that, so the control is simply hidden until then).
  const setStick = useSteering(sendAction, !frozen);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const ascentMs = game.endsAt - game.ascentStartsAt;
  const casting = serverNow() < game.ascentStartsAt;
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [remainingMs]); // the shared countdown: ticks for the last 5 seconds, then the whistle

  // Spectators choose whose lane to follow (there is no free camera: the ocean is a flat picture).
  const subjects = useMemo(
    () => game.lanes.filter((id) => id in game.hooks).map((id) => ({ id, name: styles[id]?.name ?? '?', color: styles[id]?.color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.hooks).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer, false);

  // The winner moment: the camera goes to the winner's lane for EVERYONE (on a draw nobody wins, so it pulls back to show the whole ocean).
  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  const winnerId = result?.winnerId ?? null;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ targetId: winnerId, winner: true });
    else scene.current?.setCameraView({ targetId: isPlayer ? selfId : camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  const standings = Object.entries(game.hooks)
    .map(([id, h]) => ({ id, fish: h.fish, points: h.points, style: styles[id] }))
    .sort((a, b) => b.points - a.points);

  return (
    <div className="snow-screen fishing-screen">
      <StartCountdown goAt={game.ascentStartsAt} serverNow={serverNow} /> {/* (GO! is the moment the hooks get control: the end of the cast) */}
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{casting ? 'Cast!' : remainingMs <= 0 ? 'Time!' : Math.min(Math.ceil(ascentMs / 1000), Math.ceil(remainingMs / 1000))}</div>
        <ul className="snow-standings">
          {standings.map(({ id, fish, points, style }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{style?.name ?? '?'}</span>
              <span className="snow-size" title={`${fish} fish caught`}>{points} pts</span>
            </li>
          ))}
        </ul>
        {!casting && !frozen && <p className="fish-depth" title="How deep your hook is">Depth {Math.max(0, Math.round(((game.hookDepth - game.endDepth) / (game.depth - game.endDepth)) * 100))} m</p>}
        {isPlayer && !frozen && !casting && <p className="snow-hint fish-hint">Slide your hook left and right to line it up with a fish&apos;s mouth, and up a little to reach higher · drag or WASD</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {isPlayer && !frozen && !casting && <Joystick onChange={setStick} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} allowFree={false} />}
    </div>
  );
}
