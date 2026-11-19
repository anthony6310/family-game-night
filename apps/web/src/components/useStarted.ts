import { useEffect, useState } from 'react';

/**
 * True once the server's clock has reached `startsAt` (the moment of GO): no game gives the player any control before it (GAME_RULES.md #10). Every game screen uses it to hide its controls
 * and to ignore taps, steering and throws until then, so nothing reacts during the buffer or the 3, 2, 1. (The server ignores early actions too; this is for what the player sees and hears.)
 */
export function useStarted(startsAt: number, serverNow: () => number): boolean {
  const [started, setStarted] = useState(() => serverNow() >= startsAt);
  useEffect(() => {
    if (started) return;
    const id = setInterval(() => { if (serverNow() >= startsAt) setStarted(true); }, 30);
    return () => clearInterval(id);
  }, [started, startsAt, serverNow]);
  return started;
}
