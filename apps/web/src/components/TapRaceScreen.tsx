import { useEffect, useMemo, useRef, useState } from 'react';
import { type GameAction, type Player, type RoundResult, type TapRaceView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { PLAYER_COLORS } from './playerColors';
import { TapRaceScene, type ButtonStyle } from './taprace/TapRaceScene';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: TapRaceView;
  players: Player[];
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its finish sequence is playing: the button is dead. */
  frozen?: boolean;
  /** The decided result and the server time the finish sequence ends: while `frozen`, they drive Tap Race's own ending (below). */
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Tap Race round: a full-screen three.js board with one button per player, a clock and a live scoreboard.
 * A player's camera sits above their own button and never moves; tapping anywhere presses it. A spectator gets the
 * shared spectator controls: follow any player's view, or fly a free camera over the whole board.
 * The SERVER still does the real counting; the scene just shows its numbers. Loaded on demand (see LobbyPage), like Snowball.
 *
 * The ending is this screen's own (not the generic you-won / you-lost message): for the first part of the finish sequence
 * you just keep looking at your own button (no result yet), then the camera glides to the winner's button and a banner
 * names them for the last WINNER_SECONDS (shared by every winner-pan game: see WinnerMoment).
 */
export default function TapRaceScreen({ game, players, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<TapRaceScene | null>(null);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const over = remainingMs <= 0;
  // Optimistic local counter so your own button reacts the instant you tap; everyone else's count is the server's.
  const [myTaps, setMyTaps] = useState(0);
  // In a tie-breaker, players outside the tie are spectators: they aren't in the game's tap table.
  const isPlayer = selfId !== null && selfId in game.taps;

  // Colours and names are fixed when the round starts (a player leaving mustn't recolour everyone).
  const styles = useMemo<ButtonStyle[]>(
    () => players.filter((p) => p.id in game.taps).map((p) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[players.indexOf(p) % PLAYER_COLORS.length], avatarUrl: p.avatarUrl })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Create the 3D scene once; tear it down (freeing GPU memory) when the round screen closes.
  useEffect(() => {
    const s = new TapRaceScene(container.current!, styles, isPlayer ? selfId : null);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How far through the round we are: the sparks get fiercer as it goes on. (Set before the counts, which is when sparks are made.)
  const roundMs = game.endsAt - game.startsAt;
  useEffect(() => {
    scene.current?.setProgress(1 - remainingMs / roundMs, remainingMs / 1000);
  }, [remainingMs, roundMs]);

  // Feed the latest counts to the scene (yours is the instant local one).
  const counts = useMemo(() => (isPlayer && selfId ? { ...game.taps, [selfId]: Math.max(myTaps, game.taps[selfId] ?? 0) } : game.taps), [game.taps, myTaps, isPlayer, selfId]);
  useEffect(() => {
    scene.current?.setCounts(counts);
  }, [counts]);

  // Spectators choose whose view to follow, or fly a free camera over the whole board.
  const subjects = useMemo(() => styles.map((s) => ({ id: s.id, name: s.name, color: s.color })), [styles]);
  const camera = useSpectatorCamera(subjects, !isPlayer);
  useEffect(() => { scene.current?.setPanSource(camera.pan); }, [camera.pan]);
  // The winner's moment (shared with other games: see WinnerMoment). The camera goes to the winner's button for
  // EVERYONE (players and spectators alike); on a draw nobody wins, so it pulls back to show the whole board.
  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow); // drumroll, then the fanfare as the camera reaches the winner
  const winnerId = result?.winnerId ?? null;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ mode: 'follow', targetId: winnerId });
    else if (!isPlayer) scene.current?.setCameraView({ mode: camera.mode, targetId: camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, camera.mode, camera.targetId]);

  // pointerdown fires the instant a finger lands (a click waits for release), and anywhere on the screen counts as a tap.
  function onTap() {
    if (!isPlayer || over || frozen) return;
    setMyTaps((n) => n + 1);
    sendAction({ type: 'tap' });
  }

  const best = Math.max(1, ...Object.values(counts));
  const standings = styles
    .map((s) => ({ ...s, taps: counts[s.id] ?? 0 }))
    .sort((a, b) => b.taps - a.taps);

  return (
    <div className="snow-screen tap-screen">
      {/* The board. For a player, a tap on it presses their button. (touch-action is off in CSS, so a tap is never a scroll or zoom.) */}
      <div className="snow-canvas" ref={container} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()} />

      <div className="snow-hud">
        <div className="snow-timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, name, color, taps }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: color }} />
              <span className="snow-name">{name}</span>
              <span className="snow-size">{taps}</span>
            </li>
          ))}
        </ul>
        {isPlayer && !frozen && !over && best <= 1 && <p className="snow-hint">Tap as fast as you can!</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} />}

      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
