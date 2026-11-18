import { StartCountdown, introProgress } from './StartCountdown';
import { useEffect, useMemo, useRef } from 'react';
import type { GameAction, Player, RoundResult, SantaSackView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { SantaSackScene, type ElfStyle } from './santa/SantaSackScene';
import { ThrowPad, type Pull } from './ThrowPad';
import { WinnerBanner, isWinnerMoment, useWinnerSounds } from './WinnerMoment';
import { FALLBACK_COLOR } from './playerColors';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: SantaSackView;
  players: Player[];
  /** Each player's chosen color (see the lobby's color picker): the same color in every game. */
  colors: Record<string, string>;
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its finish sequence is playing: no throwing. */
  frozen?: boolean;
  /** The decided result and the server time the finish sequence ends: while `frozen`, they drive the winner moment (see WinnerMoment). */
  result?: RoundResult | null;
  finishEndsAt?: number | null;
}

/**
 * The Santa's Sack round: a full-screen three.js workshop seen from high behind your own elf (spectators pick whose elf to watch from), a small HUD (the clock,
 * how many bags each elf controls) and the drag-and-launch control (see ThrowPad). 
 * The ending is the shared winner moment (GAME_RULES.md #2): your own view for a moment, then the camera glides to the winner's elf.
 * Loaded on demand (see LobbyPage) so the landing page doesn't download three.js.
 */
export default function SantaSackScreen({ game, players, colors, selfId, serverNow, sendAction, frozen = false, result = null, finishEndsAt = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<SantaSackScene | null>(null);
  const isPlayer = selfId !== null && selfId in game.players;

  // Colors and names are fixed when the round starts (a player leaving mustn't recolor everyone).
  const styles = useMemo<Record<string, ElfStyle>>(
    () => Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? FALLBACK_COLOR }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = new SantaSackScene(container.current!, serverNow, styles, isPlayer ? selfId : null);
    scene.current = s;
    s.introFactor = () => introProgress(game.startsAt, serverNow()); // the camera's start-countdown move (see StartCountdown)
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scene.current?.pushView(game); }, [game]);

  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  useEffect(() => { scene.current?.setSecondsLeft(remainingMs / 1000); }, [remainingMs]); // the shared countdown: ticks for the last 5 seconds, then the whistle

  // Spectators choose whose elf to watch from (there is no free camera: every view is behind an elf).
  const subjects = useMemo(
    () => Object.keys(game.players).map((id) => ({ id, name: styles[id]?.name ?? '?', color: styles[id]?.color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(game.players).join(',')],
  );
  const camera = useSpectatorCamera(subjects, !isPlayer, false);

  // The winner moment: the camera glides to the winner's elf for EVERYONE (on a draw nobody wins, so it pulls back high over the whole room).
  const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow);
  useWinnerSounds(frozen, result, finishEndsAt, serverNow);
  const winnerId = result?.winnerId ?? null;
  useEffect(() => {
    if (winnerMoment) scene.current?.setCameraView({ targetId: winnerId });
    else scene.current?.setCameraView({ targetId: isPlayer ? selfId : camera.targetId });
  }, [winnerMoment, winnerId, isPlayer, selfId, camera.targetId]);

  // The pull: letting go throws a gift from your pile (a tiny pull is not a throw). The scene turns the pull into a direction on the floor for your camera.
  const aim = (pull: Pull | null) => scene.current?.setAim(pull);
  const throwIt = (pull: Pull) => {
    if (pull.power < game.throwMinPower || !scene.current) return;
    const dir = scene.current.toWorld(pull);
    sendAction({ type: 'throw', x: dir.x, z: dir.z, power: pull.power });
  };

  const standings = Object.entries(game.players)
    .map(([id, p]) => ({ id, bags: p.controlled, style: styles[id] }))
    .sort((a, b) => b.bags - a.bags);

  return (
    <div className="snow-screen santa-screen">
      <StartCountdown goAt={game.startsAt} serverNow={serverNow} />
      <div className="snow-canvas" ref={container} />

      <div className="snow-hud">
        <div className="snow-timer">{remainingMs <= 0 ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
        <ul className="snow-standings">
          {standings.map(({ id, bags, style }) => (
            <li key={id} className={id === selfId ? 'me' : ''}>
              <span className="dot" style={{ background: style?.color }} />
              <span className="snow-name">{style?.name ?? '?'}</span>
              <span className="snow-size" title="Bags this elf controls (the most gifts in it): whoever controls the most bags at the end wins">{bags} {bags === 1 ? 'bag' : 'bags'}</span>
            </li>
          ))}
        </ul>
        {isPlayer && !frozen && <p className="snow-hint">Pull back to aim, let go to throw · the harder you pull, the farther it flies · the elf with the most gifts in a bag controls it (it takes their color): control the most bags to win · bags that flash are about to be cinched shut and bounce gifts away!</p>}
      </div>

      {winnerMoment && result && <WinnerBanner result={result} players={players} />}

      {isPlayer && !frozen && <ThrowPad onAim={aim} onThrow={throwIt} />}
      {!isPlayer && !frozen && <SpectatorControls camera={camera} allowFree={false} />}
    </div>
  );
}
