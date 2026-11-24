import { useCallback, useEffect, useRef } from 'react';
import { facing, rightOf, type GameAction } from '@fgn/shared';
import type { AdoptionScene } from './AdoptionScene';
import type { Steer } from '../Joystick';

const SEND_EVERY_MS = 50;
const MAX_PITCH = 1.15;
const TURN_SPEED = 2.2; // radians a second with the keyboard
const LOOK_TOUCH = 0.0075; // radians per pixel dragged

const KEYS: Record<string, 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight'> = {
  w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back', a: 'left', d: 'right', arrowleft: 'turnLeft', arrowright: 'turnRight', q: 'turnLeft', e: 'turnRight',
};

/**
 * First-person controls for Zoo Adoption. The left thumb (or WASD) walks relative to where you are facing; the right thumb (or the mouse, or the arrow
 * keys) turns and tilts the view. The scene gets your steering and look at once (so the camera never lags); the server gets the steering as a direction
 * on the floor and the way you face (so others can see it). Nothing is sent before GO (`enabled`).
 */
export function useFirstPerson(scene: React.MutableRefObject<AdoptionScene | null>, sendAction: (action: GameAction) => void, enabled: boolean) {
  const stick = useRef<Steer | null>(null);
  const keys = useRef({ forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false });
  const sent = useRef({ x: 0, z: 0, yaw: 0 });
  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const yaw = useRef(0);
  const pitch = useRef(-0.12); // (a little downward, so the crowd is in the middle of the screen)

  /** The steering in world axes: the stick's forward and sideways parts, turned by the way you face. */
  const desired = useCallback((): Steer => {
    let fwd = 0, side = 0;
    if (stick.current) { fwd = -stick.current.z; side = stick.current.x; }
    else {
      const k = keys.current;
      fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
      side = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const len = Math.hypot(fwd, side);
      if (len > 1) { fwd /= len; side /= len; }
    }
    const f = facing(yaw.current), r = rightOf(yaw.current);
    return { x: f.x * fwd + r.x * side, z: f.z * fwd + r.z * side }; // forward is the way you face, sideways is your right hand
  }, []);

  useEffect(() => {
    let last = performance.now();
    let lastSend = 0;
    const loop = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = scene.current;
      if (!s) return;
      if (!enabledRef.current) { s.steer.x = 0; s.steer.z = 0; return; }
      const k = keys.current;
      if (k.turnLeft || k.turnRight) yaw.current += ((k.turnLeft ? 1 : 0) - (k.turnRight ? 1 : 0)) * TURN_SPEED * dt;
      s.look.yaw = yaw.current; s.look.pitch = pitch.current;
      const want = desired();
      s.steer.x = want.x; s.steer.z = want.z;
      const dyaw = Math.abs(Math.atan2(Math.sin(yaw.current - sent.current.yaw), Math.cos(yaw.current - sent.current.yaw)));
      const moved = Math.abs(want.x - sent.current.x) > 0.02 || Math.abs(want.z - sent.current.z) > 0.02;
      const stopped = want.x === 0 && want.z === 0 && (sent.current.x !== 0 || sent.current.z !== 0);
      if (now - lastSend < SEND_EVERY_MS && !stopped) return; // (at most 20 messages a second, except that stopping is sent at once)
      if (dyaw > 0.02) { sendRef.current({ type: 'look', yaw: yaw.current }); sent.current.yaw = yaw.current; lastSend = now; }
      if (moved || stopped) { sendRef.current({ type: 'steer', x: want.x, z: want.z }); sent.current.x = want.x; sent.current.z = want.z; lastSend = now; }
    }, 1000 / 60);
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const dir = KEYS[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      keys.current[dir] = down;
    };
    const onDown = onKey(true), onUp = onKey(false);
    const onBlur = () => { keys.current = { forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false }; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      clearInterval(loop);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      sendRef.current({ type: 'steer', x: 0, z: 0 }); // leaving the screen: stop walking
    };
  }, [scene, desired]);

  /** The right thumb (or mouse) dragged by this many pixels. */
  const turn = useCallback((dx: number, dy: number) => {
    if (!enabledRef.current) return;
    yaw.current -= dx * LOOK_TOUCH; // dragging right turns right
    pitch.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch.current - dy * LOOK_TOUCH)); // dragging up looks up
  }, []);

  const setStick = useCallback((value: Steer | null) => { stick.current = value; }, []);

  return { setStick, turn };
}
