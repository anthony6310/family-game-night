import { useEffect, useMemo, useRef, useState } from 'react';
import { FALL_MS, JUMP_MS, JUMP_TAP_GAP_MS, judgeJump, type GameAction, type GoatPlayerView, type MountainGoatView, type Player, type RoundResult } from '@fgn/shared';
import { useLatest } from './useLatest';
import { StartCountdown, introProgress } from './StartCountdown';
import { useStarted } from './useStarted';
import { useRemainingMs } from './Countdown';
import { MountainGoatScene, type GoatStyle } from './goat/MountainGoatScene';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { audio } from '../audio/spatialAudio';
import { crevasseWind } from '../audio/goatSounds';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: MountainGoatView;
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
 * The Closing the Gap round. Tap anywhere: the marker's length at that moment decides the leap (the same shared maths as the server). Your own tap is judged on your phone at once, so the goat leaps
 * (or tumbles) the instant you tap; the server judges the same tap with the same numbers and its view takes over without a jump. Spectators follow any player's goat.
 */
export default function MountainGoatScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const latestGame = useLatest(game); // (the scene lives on, so what it reads must be the newest `game`: GO moves while phones get the game on screen)
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<MountainGoatScene | null>(null);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  const over = remainingMs <= 0;
  const started = useStarted(game.startsAt, serverNow);
  const isPlayer = selfId !== null && selfId in game.players;
  // The crevice wind blows from the moment this screen is up until it goes away (the theme is played by the room screen: audio/gameThemes.ts).
  useEffect(() => audio.startBed(crevasseWind, 0.35), []);
  const [, rerender] = useState(0);
  const pred = useRef<GoatPlayerView | null>(null); // your own latest tap, judged locally, until the server's view has caught up with it

  const styles = useMemo<GoatStyle[]>(
    () => players.filter((p) => p.id in game.players).map((p) => ({ id: p.id, name: p.name, color: colors[p.id] ?? FALLBACK_COLOR })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const subjects = useMemo(() => styles.map((s) => ({ id: s.id, name: s.name, color: s.color })), [styles]);
  const camera = useSpectatorCamera(subjects, !isPlayer);

  useEffect(() => {
    const s = new MountainGoatScene(container.current!, serverNow, styles, isPlayer ? selfId : camera.targetId);
    scene.current = s;
    s.introFactor = () => introProgress(latestGame.current.startsAt, serverNow());
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the server's view: it replaces your local prediction once it has seen your last tap (or after a while if it never did: the tap was ignored)
  useEffect(() => {
    scene.current?.pushView(game);
    const mine = selfId ? game.players[selfId] : undefined, p = pred.current;
    if (p && selfId && ((mine?.last && mine.last.at >= p.last!.at) || serverNow() > p.last!.at + 1500)) { pred.current = null; scene.current?.setOverride(selfId, null); rerender((n) => n + 1); }
  }, [game, selfId, serverNow]);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [Math.ceil(remainingMs / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  const winnerId = result?.winnerId ?? null;
  useEffect(() => { scene.current?.setWinnerView(winnerMoment); }, [winnerMoment]);
  useEffect(() => { // whose goat the camera shows: the winner's at the end, yours while you play, the followed player's for a spectator
    scene.current?.setFollow(winnerMoment && winnerId ? winnerId : isPlayer ? selfId : camera.targetId);
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  function onTap() {
    if (!isPlayer || !selfId || !started || over || frozen) return;
    const now = serverNow(), base = pred.current ?? game.players[selfId];
    if (now < base.armedAt || (base.last && now - base.last.at < JUMP_TAP_GAP_MS)) return; // (in the air or climbing back: the server would ignore it too)
    const since = now - base.armedAt, { ok, len, birdU } = judgeJump(game.seed, base.jumps, since, now - game.startsAt);
    const next: GoatPlayerView = { jumps: base.jumps + (ok ? 1 : 0), armedAt: now + (ok ? JUMP_MS : FALL_MS), last: { ok, len, at: now, since, birdU } };
    pred.current = next;
    scene.current?.setOverride(selfId, next);
    sendAction({ type: 'jump', at: now });
    rerender((n) => n + 1);
  }

  const jumpsOf = (id: string) => (id === selfId && pred.current ? Math.max(pred.current.jumps, game.players[id]?.jumps ?? 0) : game.players[id]?.jumps ?? 0);
  const standings = styles.map((s) => ({ ...s, jumps: jumpsOf(s.id) })).sort((a, b) => b.jumps - a.jumps);

  return (
    <div className="snow-screen goat-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()} />
      <div className="snow-hud">
        <div className="snow-timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, name, color, jumps }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: color }} />
              <span className="snow-name">{name}</span>
              <span className="snow-size">{jumps}</span>
            </li>
          ))}
        </ul>
        {isPlayer && started && !frozen && !over && jumpsOf(selfId!) === 0 && <p className="snow-hint">Tap when the ring reaches the next ledge!</p>}
      </div>
      {winnerMoment && result && <WinnerBanner result={result} players={players} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
