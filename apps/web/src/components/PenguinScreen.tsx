import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, PenguinLassoView, Player, RoundResult } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { BagMeter } from './BagMeter';
import { Joystick } from './Joystick';
import { PLAYER_COLORS } from './playerColors';
import { PenguinScene, type SkaterStyle } from './penguin/PenguinScene';
import { useSteering } from './snowball/useSteering';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: PenguinLassoView;
  players: Player[];
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
 * The Penguin Lasso round: a full-screen three.js ice rink, a small HUD (clock and a penguin count per player) and steering
 * controls (the same joystick / WASD as Snowball). Players follow themselves; spectators get the shared spectator camera.
 * The ending is the shared winner moment (GAME_RULES.md #2): your own view for a moment, then the camera glides to the winner.
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function PenguinScreen({ game, players, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<PenguinScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.skaters;

  // Colours, names and pictures are fixed when the round starts (a player leaving mustn't recolour everyone).
  const styles = useMemo<Record<string, SkaterStyle>>(
    () => Object.fromEntries(players.map((p, i) => [p.id, { name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], avatarUrl: p.avatarUrl }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Create the 3D scene once; tear it down (freeing GPU memory) when the round screen closes.
  useEffect(() => {
    const s = new PenguinScene(container.current!, game.arenaRadius, game.trailMax, styles, isPlayer ? selfId : null);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feed every new server view to the scene.
  useEffect(() => {
    scene.current?.pushView(game);
  }, [game]);

  const setStick = useSteering(sendAction, !frozen);
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => {
    scene.current?.setSecondsLeft(remainingMs / 1000); // the shared countdown: ticks for the last 5 seconds, then the whistle
  }, [remainingMs]);

  // Spectators choose whose camera to follow, or fly a free camera over the whole rink.
  const subjects = useMemo(
    () => Object.keys(game.skaters).map((id) => ({ id, name: styles[id]?.name ?? '?', color: styles[id]?.color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.skaters).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer);
  useEffect(() => { scene.current?.setPanSource(camera.pan); }, [camera.pan]);
  // The winner moment: the camera goes to the winner for EVERYONE (on a draw nobody wins, so it pulls back to the middle).
  // The bag display shows the bag of the skater you are watching (yourself, or the one a spectator follows). When that skater closes a loop
  // round animals that do not fit, the circles flash red and shake.
  const subjectId = isPlayer ? selfId : camera.targetId;
  const subjectBag = subjectId ? game.skaters[subjectId]?.bag ?? [] : [];
  const seenLoops = useRef(new Set<number>());
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    for (const loop of game.loops) {
      if (seenLoops.current.has(loop.id)) continue;
      seenLoops.current.add(loop.id);
      if (loop.playerId === subjectId && loop.skipped > 0) setFlash((n) => n + 1);
    }
  }, [game.loops, subjectId]);

  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow); // drumroll, then the fanfare as the camera reaches the winner
  const winnerId = result?.winnerId ?? null;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ mode: 'follow', targetId: winnerId });
    else if (!isPlayer) scene.current?.setCameraView({ mode: camera.mode, targetId: camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, camera.mode, camera.targetId]);

  const standings = Object.entries(game.skaters)
    .map(([id, s]) => ({ id, banked: s.banked, carried: s.carried, bears: s.bag.filter((k) => k === 'bear').length, full: s.bagFull, style: styles[id] }))
    .sort((a, b) => b.banked - a.banked);

  return (
    <div className="snow-screen penguin-screen">
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{remainingMs <= 0 ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, banked, carried, bears, full, style }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{style?.name ?? '?'}</span>
              {/* 🎒 = caught and in the bag (not points yet), 🐧 = cashed in at the igloo (the score) */}
              {carried > 0 && <span className="snow-fish" title="Points in the bag: skate home to the igloo to cash them in">🎒{carried}{full && ' full'}{bears > 0 && ` 🐻×${bears} slow`}</span>}
              <span className="snow-size" title="Cashed in: the score">🐧 {banked}</span>
            </li>
          ))}
        </ul>
        {/* The bag, as a row of circles with the animals' faces in them. */}
        {!frozen && <BagMeter bag={subjectBag} capacity={game.bagCapacity} flash={flash} />}
        {/* A full bag: your trail disappears and nothing more can be caught until you cash in. This stays up (it doesn't fade like the hint). */}
        {isPlayer && !frozen && selfId && game.skaters[selfId]?.bagFull && <p className="snow-note">Bag full! No trail until you skate home to your igloo</p>}
        {isPlayer && !frozen && !(selfId && game.skaters[selfId]?.bagFull) && <p className="snow-hint">Loop animals to bag them, then skate home to your igloo to cash in · drag to steer or WASD</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {isPlayer && !frozen && <Joystick onChange={setStick} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} />}
    </div>
  );
}
