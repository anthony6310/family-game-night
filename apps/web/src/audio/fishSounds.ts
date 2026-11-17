import { grain, type SoundFn } from './snowSounds';

/**
 * Fishing sounds, MADE LIVE by the browser's audio engine (no sound files). Same signature as every other sound (see snowSounds.ts),
 * so the same spatial mixer plays them.
 */
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A hook and line hitting the water: a low "bloop" of noise plus a short rush of fizz. */
export const splash: SoundFn = (ctx, out, t, strength) => {
  grain(ctx, out, t, { type: 'lowpass', freq: rand(700, 1100), q: 0.8, gain: 0.5 + 0.4 * strength, duration: 0.22 });
  grain(ctx, out, t + 0.02, { type: 'bandpass', freq: rand(2400, 3600), q: 0.8, gain: 0.3, duration: 0.3 });
};

/** The rod whipping through the air as it is cast: a quick airy swish. */
export const rodSwish: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'bandpass', freq: rand(2800, 3600), q: 1.4, gain: 0.3, duration: 0.16 });
};

/** Hooked a fish! A bubbly "bloop" (a quick upward sine chirp) and a bright two-note ping. */
export const fishCatch: SoundFn = (ctx, out, t) => {
  const bloop = ctx.createOscillator();
  bloop.type = 'sine';
  bloop.frequency.setValueAtTime(260, t);
  bloop.frequency.exponentialRampToValueAtTime(700, t + 0.09);
  const bloopEnv = ctx.createGain();
  bloopEnv.gain.setValueAtTime(0.0001, t);
  bloopEnv.gain.linearRampToValueAtTime(0.5, t + 0.01);
  bloopEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  bloop.connect(bloopEnv).connect(out);
  bloop.start(t);
  bloop.stop(t + 0.18);
  [880, 1318.5].forEach((freq, i) => { // A5 then E6
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    const start = t + 0.08 + i * 0.07;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(0.3, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + 0.42);
  });
};
