import { Joystick } from '../components/Joystick';
import type { SpectatorCamera } from './useSpectatorCamera';

/**
 * The spectator's on-screen controls, the same for every game: pick whose view to follow (‹ ›), or switch to the
 * free camera and drag anywhere to fly around it. Games that have no free camera (2D ones) pass allowFree={false}.
 * It only reads/writes the `useSpectatorCamera` state; it knows nothing about what the game draws.
 */
export function SpectatorControls({ camera, allowFree = true }: { camera: SpectatorCamera; allowFree?: boolean }) {
  const { mode, subjects, targetId } = camera;
  const target = subjects.find((s) => s.id === targetId);

  return (
    <>
      {/* The free camera is steered by dragging anywhere on the screen, like the players' joystick. */}
      {allowFree && mode === 'free' && <Joystick onChange={camera.setStick} />}

      <div className="spectate-bar" onPointerDown={(e) => e.stopPropagation()}>
        <p className="spectate-title">👀 You're watching</p>
        {allowFree && (
          <div className="mode-toggle small" role="radiogroup" aria-label="Camera">
            <button role="radio" aria-checked={mode === 'follow'} className={mode === 'follow' ? 'on' : ''} onClick={() => camera.setMode('follow')}>Follow</button>
            <button role="radio" aria-checked={mode === 'free'} className={mode === 'free' ? 'on' : ''} onClick={() => camera.setMode('free')}>Free camera</button>
          </div>
        )}
        {mode === 'follow' ? (
          <div className="spectate-follow">
            <button aria-label="Previous player" onClick={camera.prev} disabled={subjects.length < 2}>‹</button>
            <span className="spectate-target">
              {target?.color && <span className="dot" style={{ background: target.color }} />}
              {target ? target.name : 'Nobody to follow'}
            </span>
            <button aria-label="Next player" onClick={camera.next} disabled={subjects.length < 2}>›</button>
          </div>
        ) : (
          <p className="spectate-hint">Drag to move the camera · or WASD / arrow keys</p>
        )}
      </div>
    </>
  );
}
