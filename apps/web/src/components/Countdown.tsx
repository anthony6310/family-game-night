import { useEffect, useState } from 'react';

/** Big countdown driven by the server's clock (`serverNow`), so every phone hits zero together. */
export function Countdown({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const id = setInterval(() => redraw((n) => n + 1), 100); // re-render 10x/sec; the math below is what matters
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
  return <div className="countdown">{seconds > 0 ? seconds : 'Go!'}</div>;
}
