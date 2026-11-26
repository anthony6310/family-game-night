import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { noise, thud, tone, whoosh, windLoop } from './synth';

/** Snowball's sounds (made live, no files), picked by ear from three variations of each. There is deliberately no sound for the stamina refilling. */

/** ROLLING: "Powder swish": a soft swish of snow (played over and over, so quiet). */
export const powderSwish: SoundFn = (ctx, out, t) => whoosh(ctx, out, t, 1200, 2500, 0.35, 0.12);

/** BUMP: "Padded thump": a soft thump with a hint of snow. */
export const paddedThump: SoundFn = (ctx, out, t, strength) => {
  const k = 0.7 + 0.3 * strength;
  thud(ctx, out, t, 0.8 * k);
  noise(ctx, out, t, { type: 'bandpass', f: 1500, q: 1, g: 0.25 * k, dur: 0.12 });
};

/** SPRINT: "Rising zip": a quick rising zip with a rush of air. */
export const risingZip: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'sawtooth', f: 200, f2: 800, dur: 0.35, g: 0.05, att: 0.02 });
  whoosh(ctx, out, t, 500, 2200, 0.4, 0.2);
};

/** SNOWY WIND (loop): "Blizzard whistle": a narrow whistling band that slowly drifts in pitch and swells. */
export const blizzardWind: BedFn = (ctx, out) => windLoop(ctx, out, { f: 900, q: 5, g: 0.1, rate: 0.25, depth: 0.06, drift: 250 });
