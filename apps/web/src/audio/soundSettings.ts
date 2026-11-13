import { useSyncExternalStore } from 'react';

/**
 * The player's sound on/off choice. It is remembered in this browser (localStorage) and shared by everything that
 * makes noise, so one button in the lobby mutes the whole game. localStorage can be blocked (private windows), so
 * every access is wrapped: if it fails, the choice simply isn't remembered.
 */
const KEY = 'fgn-muted';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let muted = read();
const listeners = new Set<() => void>();

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    /* not remembered: fine */
  }
  listeners.forEach((l) => l());
}

/** React hook: `[muted, setMuted]`, re-rendering when the choice changes. */
export function useMuted(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isMuted,
  );
  return [value, setMuted];
}
