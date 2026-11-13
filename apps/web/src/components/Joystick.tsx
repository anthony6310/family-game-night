import { useRef, useState, type PointerEvent } from 'react';

/** A direction on the ground (x = east, z = south), each -1..1. Used for steering a ball and for panning a camera. */
export interface Steer {
  x: number;
  z: number;
}

const RADIUS = 56; // how far (px) you drag for full speed

interface Stick {
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

/**
 * A "floating" joystick: touch anywhere and the stick appears under your thumb; drag to steer,
 * release to stop. It covers the whole screen, so you can't miss it and can use either thumb.
 * It works with a mouse too (handy on desktop).
 */
export function Joystick({ onChange }: { onChange: (value: Steer | null) => void }) {
  const [stick, setStick] = useState<Stick | null>(null);
  const activePointer = useRef<number | null>(null);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== null) return; // one finger only
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId); // keep getting moves even if the finger leaves the box
    setStick({ originX: e.clientX, originY: e.clientY, knobX: e.clientX, knobY: e.clientY });
    onChange({ x: 0, z: 0 });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== activePointer.current || !stick) return;
    const dx = e.clientX - stick.originX;
    const dy = e.clientY - stick.originY;
    const length = Math.hypot(dx, dy);
    const strength = Math.min(1, length / RADIUS); // 0 at the centre, 1 at the rim and beyond
    const ux = length > 0 ? dx / length : 0;
    const uy = length > 0 ? dy / length : 0;
    setStick({ ...stick, knobX: stick.originX + ux * strength * RADIUS, knobY: stick.originY + uy * strength * RADIUS });
    onChange({ x: ux * strength, z: uy * strength }); // screen up = north = negative z
  }

  function end(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    setStick(null);
    onChange(null);
  }

  return (
    <div className="joystick-zone" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}>
      {stick && (
        <>
          <div className="stick-base" style={{ left: stick.originX, top: stick.originY }} />
          <div className="stick-knob" style={{ left: stick.knobX, top: stick.knobY }} />
        </>
      )}
    </div>
  );
}
