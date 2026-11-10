import { useEffect, useState } from 'react';

/** Milliseconds left until `endsAt` on the SERVER's clock; re-renders ~10x/sec while mounted. */
export function useRemainingMs(endsAt: number, serverNow: () => number): number {
  const [, redraw] = useState(0);
  useEffect(() => {
    const id = setInterval(() => redraw((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, endsAt - serverNow());
}

/** Big pre-game countdown driven by the server's clock, so every phone hits zero together. */
export function Countdown({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const seconds = Math.ceil(useRemainingMs(endsAt, serverNow) / 1000);
  return <div className="countdown">{seconds > 0 ? seconds : 'Go!'}</div>;
}
