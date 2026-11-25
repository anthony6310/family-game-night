import { useCallback, useEffect, useRef } from 'react';
import type { GameAction } from '@fgn/shared';
import type { Steer } from '../Joystick';

const KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
const SEND_EVERY_MS = 50;
const MIN_CHANGE = 0.02;

/**
 * Steering for Roach Rumble. The stick (or WASD) is read RELATIVE TO THE CAMERA: up is the way the camera looks. The roach's camera can be turned (see `turn`), so the same stick push means a different direction on the
 * floor as the camera turns; this works out the direction on the floor every 50 ms and sends it when it changes (the server only ever gets a direction on the floor). `yaw` is how far the camera is turned (0 for the
 * sandal, whose camera never turns). `onWorld` is told each new direction so the scene can move your roach at once. Q and E turn the camera from the keyboard.
 */
export function useRoachSteering(sendAction: (a: GameAction) => void, getYaw: () => number, turn: (d: number) => void, onWorld: (x: number, z: number) => void, enabled: boolean) {
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const stick = useRef<Steer | null>(null);
  const turning = useRef(0); // -1, 0, 1 from Q / E
  const sent = useRef<Steer>({ x: 0, z: 0 });
  const refs = useRef({ sendAction, getYaw, turn, onWorld, enabled });
  refs.current = { sendAction, getYaw, turn, onWorld, enabled };

  const flush = useCallback(() => {
    const r = refs.current;
    if (!r.enabled) return;
    let sx = 0, sz = 0;
    if (stick.current) { sx = stick.current.x; sz = stick.current.z; }
    else {
      const k = keys.current;
      sx = (k.right ? 1 : 0) - (k.left ? 1 : 0); sz = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      const len = Math.hypot(sx, sz); if (len > 0) { sx /= len; sz /= len; }
    }
    const th = r.getYaw(), sn = Math.sin(th), cs = Math.cos(th); // up on the stick = the way the camera looks
    const x = sx * cs + sz * sn, z = sz * cs - sx * sn;
    r.onWorld(x, z);
    if (Math.abs(x - sent.current.x) < MIN_CHANGE && Math.abs(z - sent.current.z) < MIN_CHANGE) return;
    sent.current = { x, z };
    r.sendAction({ type: 'steer', x, z });
  }, []);

  useEffect(() => {
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'e') { e.preventDefault(); turning.current = down ? (k === 'q' ? 1 : -1) : 0; return; }
      const dir = KEYS[k];
      if (!dir) return;
      e.preventDefault();
      keys.current[dir] = down;
    };
    const dn = onKey(true), up = onKey(false);
    const blur = () => { keys.current = { up: false, down: false, left: false, right: false }; turning.current = 0; };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    const timer = setInterval(flush, SEND_EVERY_MS);
    let raf = 0, last = performance.now();
    const spin = () => { // turning the camera from the keyboard
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (turning.current !== 0 && refs.current.enabled) refs.current.turn(turning.current * 2.2 * dt);
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => {
      window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur);
      clearInterval(timer); cancelAnimationFrame(raf);
      refs.current.sendAction({ type: 'steer', x: 0, z: 0 });
    };
  }, [flush]);

  return useCallback((value: Steer | null) => {
    stick.current = value;
    if (value === null) flush();
  }, [flush]);
}
