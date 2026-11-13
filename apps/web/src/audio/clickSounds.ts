import { grain, type SoundFn } from './snowSounds';

/**
 * A typewriter key-strike, MADE LIVE by the browser's audio engine (no sound file), for every press of a Tap Race
 * button. It is made of the three things you hear in a real typewriter, a few milliseconds apart:
 *   1. a sharp, bright "tk": a very short burst of high noise (the key hitting the paper),
 *   2. a crisp "clack": a band of mid-high noise (the type bar and the frame),
 *   3. a small, softer "tick" a moment later (the bar springing back).
 * Each one varies a little in pitch and loudness, so rapid tapping sounds like a typist and not one repeated sample.
 * Same signature as the snow sounds (`strength` 0..1 = how hard), so the same spatial mixer plays it.
 */
export const typewriterClick: SoundFn = (ctx, out, t, strength) => {
  const lively = 0.75 + 0.25 * strength;
  // 1. the sharp strike
  grain(ctx, out, t, { type: 'highpass', freq: 5500 + Math.random() * 1500, q: 0.7, gain: 1.3 * lively, duration: 0.008 });
  // 2. the crisp clack
  grain(ctx, out, t, { type: 'bandpass', freq: 3000 + Math.random() * 1000, q: 2.4, gain: 1.7 * lively, duration: 0.016 });
  // 3. the spring-back tick
  grain(ctx, out, t + 0.03 + Math.random() * 0.008, { type: 'bandpass', freq: 1700 + Math.random() * 500, q: 2.2, gain: 0.65 * lively, duration: 0.016 });
};
