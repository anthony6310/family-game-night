import { useState } from 'react';
import type { GameAction, Player, TapRaceView } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Avatar } from './Avatar';
import { SpectatorControls } from '../spectate/SpectatorControls';
import { useSpectatorCamera } from '../spectate/useSpectatorCamera';

interface Props {
  game: TapRaceView;
  players: Player[];
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
  /** The round has ended and its you-won / you-lost sequence is playing: the button is dead. */
  frozen?: boolean;
}

/** Tap Race UI: one giant button, a clock, and a live leaderboard. The SERVER does the real counting. */
export function TapRaceScreen({ game, players, selfId, serverNow, sendAction, frozen = false }: Props) {
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  // Optimistic local counter so the button feels instant; the leaderboard shows the server's count.
  const [myTaps, setMyTaps] = useState(0);
  const over = remainingMs <= 0;
  // In a tie-breaker, players outside the tie are spectators: they aren't in the game's tap table.
  const isPlayer = selfId !== null && selfId in game.taps;

  // Watchers can "follow" a player too: there is no 3D camera here, so following spotlights that player's count.
  const subjects = players.filter((p) => p.id in game.taps).map((p) => ({ id: p.id, name: p.name }));
  const camera = useSpectatorCamera(subjects, !isPlayer, false);
  const followed = players.find((p) => p.id === camera.targetId);

  function onTap() {
    if (over || frozen || !isPlayer) return;
    setMyTaps((n) => n + 1);
    sendAction({ type: 'tap' });
  }

  const best = Math.max(1, ...Object.values(game.taps));
  const standings = players
    .filter((p) => p.id in game.taps)
    .map((p) => ({ player: p, taps: game.taps[p.id] ?? 0 }))
    .sort((a, b) => b.taps - a.taps);

  return (
    <main className="page tap-page">
      <div className="timer">{over ? 'Time!' : Math.ceil(remainingMs / 1000)}</div>
      {/* pointerdown fires the instant a finger lands (onClick waits for release) */}
      {isPlayer ? (
        <button className="tap-button" disabled={over || frozen} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()}>
          TAP!
          <span className="tap-count">{myTaps}</span>
        </button>
      ) : (
        <div className="tap-spotlight">
          {followed && <Avatar url={followed.avatarUrl} name={followed.name} size={72} />}
          <strong>{followed?.name ?? ''}</strong>
          <span className="tap-spotlight-count">{followed ? (game.taps[followed.id] ?? 0) : 0}</span>
        </div>
      )}
      <ul className="standings">
        {standings.map(({ player, taps }) => (
          <li key={player.id}>
            <Avatar url={player.avatarUrl} name={player.name} size={28} />
            <span className="standing-name">{player.name}{player.id === selfId && ' (you)'}</span>
            <span className="bar"><span style={{ width: `${(taps / best) * 100}%` }} /></span>
            <span className="standing-taps">{taps}</span>
          </li>
        ))}
      </ul>
      {!isPlayer && <SpectatorControls camera={camera} allowFree={false} />}
    </main>
  );
}
