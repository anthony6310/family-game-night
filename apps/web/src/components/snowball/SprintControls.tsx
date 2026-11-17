import type { PointerEvent } from 'react';

/** The big on-screen SPRINT button: hold it to sprint (+50% speed, using stamina). Sits above the steering stick's touch layer, so pressing it never steers. */
export function SprintButton({ onHold, active }: { onHold: (on: boolean) => void; active: boolean }) {
  const down = (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onHold(true); };
  const up = (e: PointerEvent) => { e.stopPropagation(); onHold(false); };
  return (
    <button className={active ? 'sprint-btn on' : 'sprint-btn'} aria-label="Sprint: hold to run faster"
      onPointerDown={down} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
      ⚡<span>SPRINT</span>
    </button>
  );
}

/**
 * The stamina bar: full at the right, with a notch where a sprint can start (you need at least that much to START sprinting). It
 * drains while you sprint, goes orange-red when it is too low to start, and glows blue while the small-ball recovery is on (the
 * stamina refills straight away after a small ball hits a bigger one).
 */
export function StaminaBar({ stamina, startAt, sprinting, recovering }: { stamina: number; startAt: number; sprinting: boolean; recovering: boolean }) {
  const low = !sprinting && stamina < startAt;
  return (
    <div className={`stamina-bar${sprinting ? ' sprinting' : ''}${low ? ' low' : ''}${recovering ? ' recovering' : ''}`} role="meter"
      aria-label="Stamina" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stamina * 100)}>
      <div className="stamina-fill" style={{ width: `${Math.round(stamina * 100)}%` }} />
      <div className="stamina-notch" style={{ left: `${startAt * 100}%` }} />
    </div>
  );
}
