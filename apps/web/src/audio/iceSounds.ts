import { grain, type SoundFn } from './snowSounds';

/**
 * Penguin Lasso sounds, MADE LIVE by the browser's audio engine (no sound files). Same signature as every other
 * sound (see snowSounds.ts), so the same spatial mixer plays them.
 */
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A skate blade cutting ice: a short, airy, high "shhk". Quiet, because it repeats while you skate. */
export const skateSwish: SoundFn = (ctx, out, t, strength) => {
  grain(ctx, out, t, { type: 'bandpass', freq: rand(5200, 7400), q: rand(0.9, 1.6), gain: 0.35 + 0.5 * strength, duration: rand(0.07, 0.12) });
  grain(ctx, out, t + 0.01, { type: 'highpass', freq: 8000, q: 0.7, gain: 0.2, duration: 0.05 });
};

/** One soft bell-like note (a sine plus a quieter octave above) that rings out for `length` seconds. */
function note(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, length: number, level: number) {
  for (const [mult, gain] of [[1, 1], [2, 0.3]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level * gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}

/** Caught a penguin! A quick rising three-note sparkle (a major arpeggio) with a squeaky "peep" at the start. */
export const captureChime: SoundFn = (ctx, out, t) => {
  [523.25, 659.25, 783.99].forEach((f, i) => note(ctx, out, t + 0.07 + i * 0.08, f, 0.5, 0.32)); // C, E, G
  const peep = ctx.createOscillator(); // the penguin's startled squeak: a fast upward chirp
  peep.type = 'square';
  peep.frequency.setValueAtTime(900, t);
  peep.frequency.exponentialRampToValueAtTime(1700, t + 0.07);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.12, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  peep.connect(filter).connect(env).connect(out);
  peep.start(t);
  peep.stop(t + 0.12);
};

/** A loop snapping shut with nothing inside: a short, dull "zip" so you know it closed (and missed). */
export const loopMiss: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'bandpass', freq: 2600, q: 1.2, gain: 0.5, duration: 0.14 });
};

/** Cashing in at the igloo: a bright, quick run of coin-like pings (a high C major arpeggio ending on a held note). */
export const cashIn: SoundFn = (ctx, out, t) => {
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => note(ctx, out, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.3));
  grain(ctx, out, t, { type: 'highpass', freq: 6000, q: 0.8, gain: 0.25, duration: 0.05 }); // a little clink at the start
};
