import { useCallback, useEffect, useRef } from 'react';
import { AIM_START, sideOf, stepAim, type GameAction, type TeamId } from '@fgn/shared';
import type { PirateScene } from './PirateScene';
import type { Steer } from '../Joystick';

const SEND_EVERY_MS = 50;
const KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };

/**
 * Aiming for Broadside Battle: the stick (or WASD / arrows) moves the barrel steadily (right and up on the screen are right and up; which way is "towards the bow" depends on the ship's side, which the
 * hook takes care of). The barrel moves ON THE PHONE AT ONCE (the same `stepAim` maths as the shared code) and the phone tells the server where it points, about 20 times a second while it changes.
 * Aiming never stops: it works during the wick and the reload. Nothing is sent before GO (`enabled`).
 */
export function useAim(scene: React.MutableRefObject<PirateScene | null>, sendAction: (action: GameAction) => void, enabled: boolean, team: TeamId | null, start: { yaw: number; pitch: number } = AIM_START) {
  const stick = useRef<Steer | null>(null);
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const aim = useRef({ ...start });
  const sent = useRef({ yaw: start.yaw, pitch: start.pitch });
  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const sideRef = useRef(team ? sideOf(team) : 1);
  sideRef.current = team ? sideOf(team) : 1;

  const input = useCallback((): { x: number; y: number } => {
    let sx = 0, sy = 0;
    if (stick.current) { sx = stick.current.x; sy = -stick.current.z; }
    else {
      const k = keys.current;
      sx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      sy = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      const len = Math.hypot(sx, sy);
      if (len > 1) { sx /= len; sy /= len; }
    }
    return { x: sx * -sideRef.current, y: sy }; // (turning right on screen is towards the stern for the north ship, towards the bow for the south one)
  }, []);

  useEffect(() => {
    let last = performance.now(), lastSend = 0;
    const loop = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = scene.current;
      if (!s) return;
      if (enabledRef.current) aim.current = stepAim(aim.current, input(), dt);
      s.aim.yaw = aim.current.yaw; s.aim.pitch = aim.current.pitch;
      if (!enabledRef.current) return;
      const changed = Math.abs(aim.current.yaw - sent.current.yaw) > 0.003 || Math.abs(aim.current.pitch - sent.current.pitch) > 0.003;
      if (changed && now - lastSend >= SEND_EVERY_MS) {
        sendRef.current({ type: 'aim', yaw: aim.current.yaw, pitch: aim.current.pitch });
        sent.current = { ...aim.current };
        lastSend = now;
      }
    }, 1000 / 60);
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const dir = KEYS[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      keys.current[dir] = down;
    };
    const onDown = onKey(true), onUp = onKey(false);
    const onBlur = () => { keys.current = { up: false, down: false, left: false, right: false }; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      clearInterval(loop);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [scene, input]);

  const setStick = useCallback((value: Steer | null) => { stick.current = value; }, []);
  return { setStick };
}
