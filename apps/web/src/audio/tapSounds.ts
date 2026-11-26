import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { noise, tone, windLoop } from './synth';

/** Tap Race's sounds (made live, no files), picked by ear from three variations of each. */

/** BUTTON TAP: "Relay click": a dry electrical click and a tiny metallic tick. */
export const relayClick: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'highpass', f: 4000, g: 0.4, dur: 0.015, att: 0.001 });
  tone(ctx, out, t, { type: 'square', f: 900, f2: 300, dur: 0.03, g: 0.1, att: 0.001 });
};

/** LAB AMBIENCE: "Electric buzz": two slightly mistuned buzzing tones (a slow beating) over a low murmur. */
export const labBuzz: BedFn = (ctx, out) => windLoop(ctx, out, { type: 'lowpass', f: 250, q: 0.7, g: 0.06, rate: 0.3, depth: 0.02, tones: [{ f: 100, g: 0.025 }, { f: 101.5, g: 0.025 }] });
