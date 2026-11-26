import { useRef } from 'react';

/**
 * A ref that always holds the newest value. A game's scene is made once and lives on, so a function handed to it (its camera's `introFactor`...) must read the CURRENT `game`, not the one from the
 * render that made it: the round's `startsAt` is moved while the phones get the game on screen (GAME_RULES.md #8), and a function that kept the first one would use a stale GO.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
