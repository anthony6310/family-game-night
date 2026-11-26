import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { ping, sparkle, thud, tone, whoosh, windLoop } from './synth';

/**
 * Penguin Lasso's sounds (made live, no files), picked by ear from three or four variations of each. Catching any animal (penguin, seal or bear) keeps
 * the original capture chime (`captureChime` in iceSounds); a loop that closes on nothing is deliberately silent.
 */

/** SKATING: "Ice carve": a thin sweep of blade on ice (played over and over, so quiet). */
export const iceCarve: SoundFn = (ctx, out, t) => whoosh(ctx, out, t, 2500, 1200, 0.4, 0.15);

/** CASHING IN AT THE IGLOO: "Igloo fanfare": a rising four-note run and a shower of sparkles. */
export const iglooFanfare: SoundFn = (ctx, out, t) => {
  [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, t + i * 0.07, { type: 'triangle', f, dur: 0.3, g: 0.2, att: 0.004 }));
  sparkle(ctx, out, t + 0.2, 0.4, 6, 0.06);
};

/** BAG IS FULL: "Thud and ping": a soft thump and a low ping. */
export const bagFull: SoundFn = (ctx, out, t) => {
  thud(ctx, out, t, 0.5);
  ping(ctx, out, t + 0.1, 440, 0.12, 0.4);
};

/** ICY WIND (loop): "Whistling cold": a thin, whistling wind. */
export const icyWind: BedFn = (ctx, out) => windLoop(ctx, out, { f: 1100, q: 6, g: 0.08, rate: 0.22, depth: 0.05, drift: 300 });
