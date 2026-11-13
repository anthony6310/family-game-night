import { useCallback, useEffect, useRef, useState } from 'react';
import type { Steer } from '../components/Joystick';

/**
 * Game-agnostic spectating. A spectator either FOLLOWS one player (seeing what that player sees) or uses a FREE
 * camera that they move around themselves. Nothing here knows about any particular game: a game screen gives this
 * hook the list of people who can be followed and reads back `mode`, `targetId` and `pan`, then does whatever
 * "follow" and "free camera" mean for that game (a 3D game feeds them to a `SpectatorRig`; a 2D game can just
 * spotlight the followed player). Spectating is purely local: the server is never told which camera you use.
 */
export type CameraMode = 'follow' | 'free';

export interface Subject {
  id: string;
  name: string;
  color?: string;
}

const KEY_PAN: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
};

export function useSpectatorCamera(subjects: Subject[], enabled: boolean, allowFree = true) {
  const [mode, setModeState] = useState<CameraMode>('follow');
  const [chosen, setChosen] = useState<string | null>(null);
  const mode_ = allowFree ? mode : 'follow';

  // If the followed player is gone (or nobody was chosen yet), fall back to the first one rather than showing nothing.
  const targetId = subjects.some((s) => s.id === chosen) ? chosen : (subjects[0]?.id ?? null);

  const cycle = useCallback((step: number) => {
    if (subjects.length === 0) return;
    const at = Math.max(0, subjects.findIndex((s) => s.id === targetId));
    setChosen(subjects[(at + step + subjects.length) % subjects.length].id);
    setModeState('follow'); // picking a player means "show me them"
  }, [subjects, targetId]);

  /**
   * The free camera's movement input (x east, z south, each -1..1). A ref, not state: it changes every frame
   * the stick moves, and the 3D scene just reads it each frame, so no re-render is needed.
   */
  const pan = useRef<Steer>({ x: 0, z: 0 });
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const stick = useRef<Steer | null>(null);
  const updatePan = useCallback(() => {
    if (stick.current) { pan.current = stick.current; return; } // the on-screen stick wins while touched
    const k = keys.current;
    const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const z = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    const length = Math.hypot(x, z);
    pan.current = length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
  }, []);
  const setStick = useCallback((value: Steer | null) => { stick.current = value; updatePan(); }, [updatePan]);

  // Keyboard: in free mode WASD / arrows move the camera; in follow mode left / right switch player.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const dir = KEY_PAN[e.key.toLowerCase()];
      if (!dir) return;
      if (mode_ === 'free') {
        e.preventDefault();
        keys.current[dir] = down;
        updatePan();
      } else if (down && !e.repeat && (dir === 'left' || dir === 'right')) {
        cycle(dir === 'right' ? 1 : -1);
      }
    };
    const onDown = onKey(true);
    const onUp = onKey(false);
    const reset = () => { keys.current = { up: false, down: false, left: false, right: false }; updatePan(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [enabled, mode_, cycle, updatePan]);

  return {
    mode: mode_,
    targetId,
    subjects,
    pan,
    setStick,
    setMode: setModeState,
    select: (id: string) => { setChosen(id); setModeState('follow'); },
    next: () => cycle(1),
    prev: () => cycle(-1),
  };
}

export type SpectatorCamera = ReturnType<typeof useSpectatorCamera>;
