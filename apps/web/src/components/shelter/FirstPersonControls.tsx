import { useRef, type PointerEvent } from 'react';

/**
 * The right half of the screen: drag to look around (a mouse drag works too). It only reports how far the pointer moved since the last event.
 * The walking stick is the shared `Joystick`, put on the left half.
 */
export function LookPad({ onTurn }: { onTurn: (dx: number, dy: number) => void }) {
  const active = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  function down(e: PointerEvent<HTMLDivElement>) {
    if (active.current !== null) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== active.current) return;
    onTurn(e.clientX - last.current.x, e.clientY - last.current.y);
    last.current = { x: e.clientX, y: e.clientY };
  }
  function end(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId === active.current) active.current = null;
  }
  return <div className="fp-look" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()} />;
}
