import { useState } from 'react';
import type { GameAction, GameView, Player } from '@fgn/shared';
import { useRemainingMs } from './Countdown';
import { Avatar } from './Avatar';

interface Props {
  game: GameView;
  players: Player[];
  selfId: string | null;
  serverNow: () => number;
  sendAction: (action: GameAction) => void;
}

/** Tap Race UI: one giant button, a clock, and a live leaderboard. The SERVER does the real counting. */
export function TapRaceScreen({ game, players, selfId, serverNow, sendAction }: Props) {
  const remainingMs = useRemainingMs(game.endsAt, serverNow);
  // Optimistic local counter so the button feels instant; the leaderboard shows the server's count.
  const [myTaps, setMyTaps] = useState(0);
  const over = remainingMs <= 0;
  // In a tie-breaker, players outside the tie are spectators: they aren't in the game's tap table.
  const isPlayer = selfId !== null && selfId in game.taps;

  function onTap() {
    if (over || !isPlayer) return;
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
      <button className="tap-button" disabled={over || !isPlayer} onPointerDown={onTap} onContextMenu={(e) => e.preventDefault()}>
        {isPlayer ? 'TAP!' : 'Watching'}
        {isPlayer && <span className="tap-count">{myTaps}</span>}
      </button>
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
    </main>
  );
}
