import { useCallback, useEffect, useState } from 'react';

/**
 * Game-agnostic spectating. A spectator FOLLOWS one player: they see what that player sees, and can switch to any other player whenever they like. There is no free camera
 * (a game does NOT need to build one). A game screen gives this hook the list of people who can be followed and reads back `targetId`, then shows that player's view in
 * whatever way suits the game (a 3D game feeds it to a `SpectatorRig` or its own camera; a 2D game can just spotlight the followed player).
 * Spectating is purely local: the server is never told which player you follow.
 */
export interface Subject {
  id: string;
  name: string;
  color?: string;
}

export function useSpectatorCamera(subjects: Subject[], enabled: boolean) {
  const [chosen, setChosen] = useState<string | null>(null);

  // If the followed player is gone (or nobody was chosen yet), fall back to the first one rather than showing nothing.
  const targetId = subjects.some((s) => s.id === chosen) ? chosen : (subjects[0]?.id ?? null);

  const cycle = useCallback((step: number) => {
    if (subjects.length === 0) return;
    const at = Math.max(0, subjects.findIndex((s) => s.id === targetId));
    setChosen(subjects[(at + step + subjects.length) % subjects.length].id);
  }, [subjects, targetId]);

  // Keyboard: left / right (or A / D) switch player.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowright' || key === 'd') cycle(1);
      else if (key === 'arrowleft' || key === 'a') cycle(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, cycle]);

  return {
    targetId,
    subjects,
    select: (id: string) => setChosen(id),
    next: () => cycle(1),
    prev: () => cycle(-1),
  };
}

export type SpectatorCamera = ReturnType<typeof useSpectatorCamera>;
