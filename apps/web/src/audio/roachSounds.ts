import { grain, type SoundFn } from './snowSounds';

/** Roach Rumble's sounds, made live by the browser's audio engine (no files). */

/** The sandal landing: a flat slap and a low thud. `strength` is 0..1 (how near it is). */
export const sandalSmack: SoundFn = (ctx, out, t, strength) => {
  const s = 0.35 + 0.65 * strength;
  grain(ctx, out, t, { type: 'bandpass', freq: 1500, q: 0.9, gain: 0.7 * s, duration: 0.07 });
  grain(ctx, out, t, { type: 'lowpass', freq: 380, q: 0.7, gain: 0.8 * s, duration: 0.18 });
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(140, t);
  thud.frequency.exponentialRampToValueAtTime(55, t + 0.16);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.6 * s, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  thud.connect(env).connect(out);
  thud.start(t); thud.stop(t + 0.25);
};

/** A roach going splat: a wet crunch. */
export const roachSquish: SoundFn = (ctx, out, t, strength) => {
  const s = 0.4 + 0.6 * strength;
  grain(ctx, out, t + 0.01, { type: 'bandpass', freq: 900, q: 1.6, gain: 0.5 * s, duration: 0.12 });
  grain(ctx, out, t + 0.03, { type: 'highpass', freq: 3200, q: 0.9, gain: 0.25 * s, duration: 0.05 });
};

/** The swing starting: a quick whoosh. */
export const sandalSwish: SoundFn = (ctx, out, t, strength) => {
  grain(ctx, out, t, { type: 'bandpass', freq: 1100, q: 0.6, gain: 0.25 * (0.4 + 0.6 * strength), duration: 0.14 });
};

/** The bottle of poison smashing: bright glass shards, then a fizzing hiss as it spills. */
export const bottleSmash: SoundFn = (ctx, out, t, strength) => {
  const s = 0.4 + 0.6 * strength;
  grain(ctx, out, t, { type: 'highpass', freq: 3800, q: 0.8, gain: 0.5 * s, duration: 0.09 });
  grain(ctx, out, t + 0.05, { type: 'bandpass', freq: 5200, q: 2.4, gain: 0.3 * s, duration: 0.07 });
  grain(ctx, out, t + 0.11, { type: 'bandpass', freq: 4300, q: 1.8, gain: 0.22 * s, duration: 0.06 });
  grain(ctx, out, t + 0.12, { type: 'highpass', freq: 5000, q: 0.5, gain: 0.16 * s, duration: 0.9 }); // the hiss
};

/** A starved roach tipping over and going still: a small dry tick-tick. */
export const roachCurl: SoundFn = (ctx, out, t, strength) => {
  const s = 0.3 + 0.7 * strength;
  grain(ctx, out, t, { type: 'bandpass', freq: 2400, q: 3, gain: 0.25 * s, duration: 0.025 });
  grain(ctx, out, t + 0.07, { type: 'bandpass', freq: 1900, q: 3, gain: 0.18 * s, duration: 0.03 });
  grain(ctx, out, t + 0.55, { type: 'bandpass', freq: 2100, q: 3, gain: 0.2 * s, duration: 0.03 });
};
