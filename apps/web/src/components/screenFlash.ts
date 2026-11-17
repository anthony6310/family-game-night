import { useEffect, useRef, useState } from 'react';
import { START_FLASH_IN_MS, START_FLASH_OUT_MS } from '@fgn/shared';

/**
 * A screen FLASH over a change of screen, in one reusable hook (no component to add, no per-game code). The screen fades to a pale flash, the
 * change happens while the picture is covered, and the flash fades away to show the new screen. It is the same look as the flash in the fishing
 * game (the cut from the pier to the water, and from the water to the dock), but a separate thing: the fishing scene has its own flash with its own
 * timings, which this file does not touch.
 *
 * Use it on the value that decides what is on screen, and say which changes deserve a flash:
 *
 *     const shown = useScreenFlash(liveValue, (from, to) => from.phase !== 'playing' && to.phase === 'playing');
 *
 * `shown` is what to draw. It is the same as `liveValue`, except that when a change deserves a flash it keeps showing the OLD value while the
 * flash fades in, then switches to the newest value at the peak. (The flash is a single plain element on the page, made on first use.)
 */
export const FLASH_COLOR = '#eafcff';
// The timings come from the shared config, because the SERVER's 'starting' step is timed from them too (the round begins almost at the end of the flash).
export const FLASH_IN_MS = START_FLASH_IN_MS; // fading in over the old screen
export const FLASH_OUT_MS = START_FLASH_OUT_MS; // fading away from the new one

let overlay: HTMLDivElement | null = null;
function flashElement(): HTMLDivElement {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:2000;pointer-events:none;opacity:0;background:${FLASH_COLOR}`;
    document.body.appendChild(overlay);
    void overlay.offsetHeight; // (let the browser draw it at 0% once, so the very first fade-in is animated and does not jump straight to full)
  }
  return overlay;
}
function fadeTo(opacity: number, ms: number) {
  const el = flashElement();
  el.style.transition = `opacity ${ms}ms ${opacity === 1 ? 'ease-in' : 'ease-out'}`;
  el.style.opacity = String(opacity);
}

export function useScreenFlash<T>(value: T, shouldFlash: (from: T, to: T) => boolean, options: { inMs?: number; outMs?: number } = {}): T {
  const inMs = options.inMs ?? FLASH_IN_MS, outMs = options.outMs ?? FLASH_OUT_MS;
  const shownRef = useRef(value); // what is on the screen
  const holding = useRef(false); // true while the flash is fading in over the old screen
  const latest = useRef(value); // the newest value, which the screen switches to at the peak of the flash
  latest.current = value;
  const timer = useRef<number | null>(null);
  const busyUntil = useRef(0); // no new flash until the last one has finished fading away
  const [, rerender] = useState(0);

  let shown = value;
  if (holding.current) shown = shownRef.current;
  else if (value !== shownRef.current && performance.now() >= busyUntil.current && shouldFlash(shownRef.current, value)) { holding.current = true; shown = shownRef.current; }
  else shownRef.current = value;

  useEffect(() => {
    if (!holding.current || timer.current !== null) return;
    fadeTo(1, inMs);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      holding.current = false;
      shownRef.current = latest.current; // (the change happens now, under the flash)
      busyUntil.current = performance.now() + outMs;
      fadeTo(0, outMs);
      rerender((n) => n + 1);
    }, inMs);
  });
  useEffect(() => () => { // (leaving the page mid-flash: clear it)
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (overlay) { overlay.style.transition = 'none'; overlay.style.opacity = '0'; }
  }, []);

  return shown;
}
