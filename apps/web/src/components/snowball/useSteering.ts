import { useCallback, useEffect, useRef } from 'react';
import type { GameAction } from '@fgn/shared';
import type { Steer } from '../Joystick';

export type { Steer };

const KEYS: Record<string, keyof typeof DIRECTIONS> = {
  w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
};
const DIRECTIONS = { up: false, down: false, left: false, right: false };

const SEND_EVERY_MS = 50; // at most 20 steering messages a second
const MIN_CHANGE = 0.02; // ignore wiggles smaller than this

/**
 * Turns keyboard (WASD / arrows) and the on-screen joystick into steering messages for the server.
 * The server only ever receives a DIRECTION; it does all the moving. We send when the direction
 * changes, at most every 50 ms, and always send "stop" when you let go or the screen closes.
 * Returns `setStick` for the joystick to report its vector (or null when released).
 */
export function useSteering(sendAction: (action: GameAction) => void, enabled = true) {
  const keys = useRef({ ...DIRECTIONS });
  const stick = useRef<Steer | null>(null);
  const sent = useRef<Steer>({ x: 0, z: 0 }); // what the server currently believes
  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;
  const enabledRef = useRef(enabled); // false while the round-end sequence has stopped player input
  enabledRef.current = enabled;

  /** The joystick wins while touched; otherwise the keyboard decides. */
  const desired = useCallback((): Steer => {
    if (stick.current) return stick.current;
    const k = keys.current;
    const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const z = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    const length = Math.hypot(x, z);
    return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
  }, []);

  const flush = useCallback(() => {
    if (!enabledRef.current) return;
    const want = desired();
    if (Math.abs(want.x - sent.current.x) < MIN_CHANGE && Math.abs(want.z - sent.current.z) < MIN_CHANGE) return;
    sent.current = want;
    sendRef.current({ type: 'steer', x: want.x, z: want.z });
  }, [desired]);

  useEffect(() => {
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const dir = KEYS[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault(); // stop arrow keys scrolling the page
      keys.current[dir] = down;
    };
    const onDown = onKey(true);
    const onUp = onKey(false);
    const onBlur = () => { keys.current = { ...DIRECTIONS }; }; // a key released while the tab was hidden never fires keyup
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    const timer = setInterval(flush, SEND_EVERY_MS);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      clearInterval(timer);
      sendRef.current({ type: 'steer', x: 0, z: 0 }); // leaving the screen: stop rolling
    };
  }, [flush]);

  const setStick = useCallback((value: Steer | null) => {
    stick.current = value;
    if (value === null) flush(); // let go: tell the server right away
  }, [flush]);

  return setStick;
}
