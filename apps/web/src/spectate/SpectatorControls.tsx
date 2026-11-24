import { Icon } from '../components/Icon';
import type { SpectatorCamera } from './useSpectatorCamera';

/**
 * The spectator's on-screen controls, the same for every game: pick whose view to follow (‹ ›). A spectator only ever sees what a player sees (no free camera).
 * It only reads/writes the `useSpectatorCamera` state; it knows nothing about what the game draws.
 */
export function SpectatorControls({ camera }: { camera: SpectatorCamera }) {
  const { subjects, targetId } = camera;
  const target = subjects.find((s) => s.id === targetId);

  return (
    <div className="spectate-bar" onPointerDown={(e) => e.stopPropagation()}>
      <p className="spectate-title"><Icon name="eye" /> You're watching</p>
      <div className="spectate-follow">
        <button aria-label="Previous player" onClick={camera.prev} disabled={subjects.length < 2}>‹</button>
        <span className="spectate-target">
          {target?.color && <span className="dot" style={{ background: target.color }} />}
          {target ? target.name : 'Nobody to follow'}
        </span>
        <button aria-label="Next player" onClick={camera.next} disabled={subjects.length < 2}>›</button>
      </div>
    </div>
  );
}
