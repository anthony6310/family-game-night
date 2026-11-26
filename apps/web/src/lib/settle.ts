/**
 * Resolves when THIS device has the round's game on its screen and is drawing it smoothly: a game canvas exists in the page, and then SETTLE_FRAMES frames in a row came in under SETTLE_FRAME_MS.
 * (Building the scene and drawing its first frames is the slowest part of a game on a phone: seconds for a heavy one. A device that reports before this would start while it is still frozen.)
 *
 * It never holds a room up for nothing:
 *  - a page that is HIDDEN (a background tab, a covered window, a phone with its screen off) gets no animation frames at all, so it would never settle. It cannot show anything anyway, so it
 *    resolves at once (and at the moment it becomes hidden). Measured: one hidden device used to keep everyone on the loading page until the safety nets fired, 25 seconds a round;
 *  - after `maxMs` it resolves anyway, on a timer (not inside a frame callback, which a hidden or stuck page may never run).
 */
const SETTLE_FRAMES = 8;
const SETTLE_FRAME_MS = 50; // at least 20 frames a second: the first-frame hitch this waits out is hundreds of ms. (34 ms, 30 fps, failed devices that draw at 30 fps, such as an iPhone in Low Power Mode.)

export function waitUntilSettled(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      resolve();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
    const timer = window.setTimeout(finish, maxMs);
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'hidden') { finish(); return; }
    let last = 0, smooth = 0;
    const tick = (now: number) => {
      if (done) return;
      if (!document.querySelector('canvas')) { last = 0; smooth = 0; requestAnimationFrame(tick); return; } // (the game's screen is not in the page yet: its code may still be downloading)
      if (last) smooth = now - last <= SETTLE_FRAME_MS ? smooth + 1 : 0; // (the first frame with a canvas only starts the clock)
      last = now;
      if (smooth >= SETTLE_FRAMES) finish(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
