import { useCallback, useEffect, useRef } from 'react';
import type { GameAction } from '@fgn/shared';

/**
 * Sprint input: hold to sprint. It sends the server "sprint on" when you start holding and "sprint off" when you let go (only when it
 * changes). The hold comes from the on-screen button (see SprintButton) or the keyboard (Shift or Space). Letting go, leaving the
 * screen, or the tab losing focus always turns it off, so a sprint can never get stuck on.
 * Returns `setHeld`, for the button to report that it is being held.
 */
export function useSprint(sendAction: (action: GameAction) => void, enabled = true) {
  const held = useRef({ button: false, key: false });
  const sent = useRef(false); // what the server currently believes
  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const flush = useCallback(() => {
    const want = enabledRef.current && (held.current.button || held.current.key);
    if (want === sent.current) return;
    sent.current = want;
    sendRef.current({ type: 'sprint', on: want });
  }, []);

  useEffect(() => {
    const isSprintKey = (e: KeyboardEvent) => e.key === 'Shift' || e.key === ' ' || e.code === 'Space';
    const onDown = (e: KeyboardEvent) => { if (!isSprintKey(e)) return; e.preventDefault(); held.current.key = true; flush(); };
    const onUp = (e: KeyboardEvent) => { if (!isSprintKey(e)) return; held.current.key = false; flush(); };
    const onBlur = () => { held.current = { button: false, key: false }; flush(); }; // a key released while the tab was hidden never fires keyup
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      if (sent.current) sendRef.current({ type: 'sprint', on: false }); // leaving the screen: stop sprinting
    };
  }, [flush]);

  // The round-end sequence stops input: make sure sprint is switched off then too.
  useEffect(() => { flush(); }, [enabled, flush]);

  return useCallback((on: boolean) => { held.current.button = on; flush(); }, [flush]);
}
