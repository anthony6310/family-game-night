import { useRef, useState, type PointerEvent } from 'react';

/** A pull, in screen directions: `dx` is towards the right of the screen and `dz` towards the bottom, both the OPPOSITE way to the drag (the toy flies the other way, like a slingshot), and `power` (0..1) is how long the pull is. The scene turns it into a direction on the floor for the player's camera. */
export interface Pull { dx: number; dz: number; power: number }

/** How much longer a pull is needed for a full-power throw than it first was: 250% more (3.5 times), so the pull has a much bigger range to feel along. */
const PULL_RANGE_SCALE = 3.5;

interface Props {
  /** The pull as it changes (null when it ends), so the scene can draw where the toy would land. */
  onAim: (pull: Pull | null) => void;
  /** Let go: throw. */
  onThrow: (pull: Pull) => void;
}

/**
 * The drag-and-launch control for Santa's Sack: touch anywhere on the screen, pull back (towards you) like a slingshot and let go. It covers the whole screen (you can't miss it and either
 * thumb works), and it works with a mouse too. The pull is the opposite way to where the toy flies; a longer pull throws farther (FULL_PULL px is a full-power throw).
 * It decides nothing about the game: it only reports the pull.
 */
export function ThrowPad({ onAim, onThrow }: Props) {
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const active = useRef<number | null>(null);

  const pull = (e: PointerEvent<HTMLDivElement>, ox: number, oy: number): Pull => {
    const full = Math.max(110, 0.28 * Math.min(window.innerWidth, window.innerHeight)) * PULL_RANGE_SCALE; // (the pull for a full-power throw, in pixels)
    const dx = ox - e.clientX, dz = oy - e.clientY; // (pulling back: the toy goes the opposite way)
    return { dx, dz, power: Math.min(1, Math.hypot(dx, dz) / full) };
  };

  function down(e: PointerEvent<HTMLDivElement>) {
    if (active.current !== null) return; // one finger only
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStick({ ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
    onAim({ dx: 0, dz: 0, power: 0 });
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== active.current || !stick) return;
    setStick({ ...stick, x: e.clientX, y: e.clientY });
    onAim(pull(e, stick.ox, stick.oy));
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== active.current) return;
    active.current = null;
    if (stick) onThrow(pull(e, stick.ox, stick.oy));
    onAim(null);
    setStick(null);
  }

  return (
    <div className="throw-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {stick && (
        <>
          <div className="throw-base" style={{ left: stick.ox, top: stick.oy }} />
          <svg className="throw-line" width="100%" height="100%"><line x1={stick.ox} y1={stick.oy} x2={stick.x} y2={stick.y} /></svg>
          <div className="throw-knob" style={{ left: stick.x, top: stick.y }} />
        </>
      )}
    </div>
  );
}
