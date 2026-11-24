import { grain, type SoundFn } from './snowSounds';

/** Broadside Battle's sounds, made live by the browser's audio engine (no files). */

/** BOOM: a low thump that drops in pitch, a rumble of filtered noise and a sharp crack at the start. `strength` is 0..1 (how near the cannon is). */
export const cannonBoom: SoundFn = (ctx, out, t, strength) => {
  const s = 0.35 + 0.65 * strength;
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(130, t);
  thump.frequency.exponentialRampToValueAtTime(38, t + 0.5);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.7 * s, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  thump.connect(env).connect(out);
  thump.start(t); thump.stop(t + 0.65);
  grain(ctx, out, t, { type: 'lowpass', freq: 420, q: 0.7, gain: 0.8 * s, duration: 0.55 });
  grain(ctx, out, t, { type: 'bandpass', freq: 1800, q: 0.8, gain: 0.5 * s, duration: 0.09 });
};

/** A cannonball landing in the sea: a soft broad splash. */
export const seaSplash: SoundFn = (ctx, out, t, strength) => {
  grain(ctx, out, t, { type: 'bandpass', freq: 1400, q: 0.6, gain: 0.35 * (0.4 + strength), duration: 0.5 });
  grain(ctx, out, t, { type: 'lowpass', freq: 500, q: 0.7, gain: 0.45 * (0.4 + strength), duration: 0.35 });
};

/** A ball smashing into a ship: a wooden crack and a thud. */
export const shipHit: SoundFn = (ctx, out, t, strength) => {
  grain(ctx, out, t, { type: 'bandpass', freq: 650, q: 1.1, gain: 0.7 * (0.5 + 0.5 * strength), duration: 0.28 });
  grain(ctx, out, t, { type: 'highpass', freq: 2600, q: 0.8, gain: 0.35, duration: 0.07 });
  const thud = ctx.createOscillator();
  thud.type = 'triangle';
  thud.frequency.setValueAtTime(110, t);
  thud.frequency.exponentialRampToValueAtTime(55, t + 0.25);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.5 * (0.5 + 0.5 * strength), t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  thud.connect(env).connect(out);
  thud.start(t); thud.stop(t + 0.35);
};

/** The wick catching: a short hiss. */
export const wickLight: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'highpass', freq: 4200, q: 0.9, gain: 0.22, duration: 0.18 });
  grain(ctx, out, t + 0.06, { type: 'bandpass', freq: 5200, q: 0.7, gain: 0.12, duration: 0.7 });
};
