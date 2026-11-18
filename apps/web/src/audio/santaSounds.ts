import { grain, type SoundFn } from './snowSounds';

/** Santa's Sack sounds, MADE LIVE by the browser's audio engine (no sound files). Same signature as every other sound (see snowSounds.ts). */
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function bell(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, length: number, level: number) {
  for (const [mult, gain] of [[1, 1], [2.76, 0.25], [5.4, 0.1]] as const) { // (a bell's overtones are not whole multiples: that is what makes it sound like a bell)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level * gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}

/** An elf picks up a toy: a short, soft "pop". */
export const giftGrab: SoundFn = (ctx, out, t) => {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(760, t + 0.06);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.4, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + 0.13);
};

/** A toy thrown: an airy whoosh. */
export const giftThrow: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'bandpass', freq: rand(1400, 2200), q: 0.9, gain: 0.45, duration: 0.28 });
};

/** A toy lands in the sack: a happy jingle of bells (two quick notes going up) and a soft "whump". */
export const giftIn: SoundFn = (ctx, out, t) => {
  bell(ctx, out, t, 1318.5, 0.5, 0.35); // E6
  bell(ctx, out, t + 0.07, 1760, 0.6, 0.3); // A6
  grain(ctx, out, t, { type: 'lowpass', freq: 500, q: 0.7, gain: 0.35, duration: 0.15 });
};

/** A toy lands on the floor: a dull thud. */
export const giftMiss: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'lowpass', freq: 420, q: 0.8, gain: 0.45, duration: 0.14 });
};
