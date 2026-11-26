import { useEffect, useMemo, useRef, useState } from 'react';
import { TEAM_COLORS, TEAM_NAMES, type GameAction, type Player, type RoundResult, type TugOfWarView } from '@fgn/shared';
import { useLatest } from './useLatest';
import { StartCountdown, introProgress } from './StartCountdown';
import { useStarted } from './useStarted';
import { useRemainingMs } from './Countdown';
import { TugOfWarScene, type PullerStyle } from './tugofwar/TugOfWarScene';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';

interface Props {
  game: TugOfWarView;
  players: Player[];
  /** Each player's own color (shown on their hat); the team colors come from the game's teams. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its closing sequence is playing: tapping does nothing. */
  frozen?: boolean;
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Tug of War round (GAME_RULES.md #18): a full-screen three.js field with a rope, the two teams pulling it, a clock and the team totals. Tapping anywhere is a pull for your team.
 * The SERVER counts; the scene shows its numbers (yours is shown the instant you tap). Spectators just watch the same view. After the 15 seconds the scene plays its own closing sequence
 * (the strain, the massive pull, the fall and the cheering), and for the last WINNER_SECONDS the camera pans right out and a banner names the winning team (see WinnerMoment).
 */
export default function TugOfWarScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const latestGame = useLatest(game); // (the scene lives on, so what it reads must be the newest `game`: GO moves while phones get the game on screen)
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<TugOfWarScene | null>(null);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const over = remainingMs <= 0;
  const started = useStarted(game.startsAt, serverNow); // (no control before GO)
  const isPlayer = selfId !== null && selfId in game.taps;
  const [myTaps, setMyTaps] = useState(0);
  const myTeam = selfId ? game.teams[selfId] : undefined;

  // Names and colors are fixed when the round starts (a player leaving must not change everyone).
  const styles = useMemo<PullerStyle[]>(
    () => players.filter((p) => p.id in game.taps).map((p) => ({ id: p.id, name: p.name, color: colors[p.id] ?? FALLBACK_COLOR })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = new TugOfWarScene(container.current!, serverNow, styles, game.teams, isPlayer ? selfId : null);
    scene.current = s;
    s.introFactor = () => introProgress(latestGame.current.startsAt, serverNow());
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The latest numbers (the rope slides and the pullers heave).
  useEffect(() => { scene.current?.pushView(game); }, [game]);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [remainingMs]);

  // The closing sequence: once the result is known, the scene plays it from the end of the round (its own timing, from the server's clock).
  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  useEffect(() => { if (frozen && result?.team) scene.current?.setFinish(result.team.winner, game.endsAt); }, [frozen, result, game.endsAt]);
  useEffect(() => { scene.current?.setWinnerView(winnerMoment); }, [winnerMoment]);

  // pointerdown fires the instant a finger lands; anywhere on the screen is a pull.
  function onTap() {
    if (!isPlayer || !started || over || frozen) return;
    setMyTaps((n) => n + 1);
    scene.current?.tapped();
    sendAction({ type: 'tap' });
  }

  const { yellow, purple } = game.totals;
  const share = yellow + purple > 0 ? yellow / (yellow + purple) : 0.5;
  return (
    <div className="snow-screen tug-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()} />

      <div className="snow-hud">
        <div className="snow-timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        {/* The tug at a glance: each team's total (taps plus its head start) and a bar of who is ahead. */}
        <div className="tug-bar" aria-label="Team totals">
          <span className="tug-total" style={{ color: TEAM_COLORS.yellow }}>{yellow}</span>
          <div className="tug-track"><div className="tug-fill" style={{ width: `${share * 100}%`, background: TEAM_COLORS.yellow }} /><div className="tug-rest" style={{ background: TEAM_COLORS.purple }} /></div>
          <span className="tug-total" style={{ color: TEAM_COLORS.purple }}>{purple}</span>
        </div>
        {isPlayer && myTeam && started && !frozen && !over && <p className="snow-hint" style={{ color: TEAM_COLORS[myTeam] }}>{myTaps === 0 ? `Tap as fast as you can for ${TEAM_NAMES[myTeam]}!` : `${TEAM_NAMES[myTeam]}: pull!`}</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}
    </div>
  );
}
