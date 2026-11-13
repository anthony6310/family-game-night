import { grain, type SoundFn } from './snowSounds';

/**
 * Round-clock sounds for Tap Race, MADE LIVE by the browser's audio engine (no sound files). Same signature as the other
 * sounds, so the same mixer plays them.
 */

/** One clock tick: a short, dry, wooden "tk" (a sharp burst of noise plus a tiny ringing tone that dies in a few ms). */
function clockBeat(ctx: BaseAudioContext, out: AudioNode, t: number, pitch: number) {
  grain(ctx, out, t, { type: 'bandpass', freq: pitch * 1.9, q: 3, gain: 1.5, duration: 0.02 });
  grain(ctx, out, t, { type: 'highpass', freq: 5000, q: 0.7, gain: 0.5, duration: 0.007 });
  const ring = ctx.createOscillator(); // the little woody resonance (short enough to stay a tick, not a thud)
  ring.type = 'sine';
  ring.frequency.value = pitch;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.linearRampToValueAtTime(0.35, t + 0.001);
  level.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  ring.connect(level).connect(out);
  ring.start(t);
  ring.stop(t + 0.04);
}

/** The "tick" of a ticking clock (the higher of the two beats). */
export const clockTick: SoundFn = (ctx, out, t) => clockBeat(ctx, out, t, 1500);

/** The "tock" (a little lower), so the seconds alternate tick, tock, tick, tock like a real clock. */
export const clockTock: SoundFn = (ctx, out, t) => clockBeat(ctx, out, t, 1050);

/**
 * A referee's whistle for the end of the round: one long blast of a bright, slightly breathy tone (about 3 kHz) that
 * warbles quickly in pitch, the way the pea in a whistle makes it, with a quick attack and a short release.
 */
export const whistle: SoundFn = (ctx, out, t) => {
  const length = 0.85;
  const tone = ctx.createOscillator();
  tone.type = 'triangle'; // a few harmonics, so it sounds shrill rather than like a pure beep
  tone.frequency.setValueAtTime(2850, t);
  tone.frequency.linearRampToValueAtTime(3050, t + 0.08); // the pitch jumps up as the blast starts
  // The warble: a fast wobble in the pitch (the pea rattling about).
  const wobble = ctx.createOscillator();
  wobble.type = 'sine';
  wobble.frequency.value = 26;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 140; // +/- 140 Hz
  wobble.connect(wobbleDepth).connect(tone.frequency);
  const shape = ctx.createBiquadFilter();
  shape.type = 'bandpass';
  shape.frequency.value = 3000;
  shape.Q.value = 1.2;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.linearRampToValueAtTime(0.7, t + 0.025); // blown in quickly
  level.gain.setValueAtTime(0.7, t + length - 0.12);
  level.gain.exponentialRampToValueAtTime(0.0001, t + length); // and let go
  tone.connect(shape).connect(level).connect(out);
  tone.start(t);
  wobble.start(t);
  tone.stop(t + length + 0.05);
  wobble.stop(t + length + 0.05);
  grain(ctx, out, t, { type: 'highpass', freq: 4500, q: 0.7, gain: 0.25, duration: length }); // the breath
};

// ---------- the winner sequence (GAME_RULES.md #2): a drumroll that builds, then a victory fanfare ----------

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** One snare-drum stroke: a crisp noise "tk" with a little rattle and a tiny low thump under it. `level` is 0..1. */
function snareHit(ctx: BaseAudioContext, out: AudioNode, t: number, level: number) {
  grain(ctx, out, t, { type: 'bandpass', freq: rand(1700, 2300), q: 0.9, gain: 1.1 * level, duration: 0.07 });
  grain(ctx, out, t, { type: 'highpass', freq: 5500, q: 0.7, gain: 0.35 * level, duration: 0.05 });
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(190, t);
  thump.frequency.exponentialRampToValueAtTime(110, t + 0.05);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.5 * level, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  thump.connect(env).connect(out);
  thump.start(t);
  thump.stop(t + 0.1);
}

/**
 * A drumroll that lasts `seconds`: quiet and slow at first, then quicker and louder until it is a roaring roll at the end
 * (the crescendo). It is built from many snare strokes whose gaps shrink from 120 ms to 45 ms and whose loudness climbs steeply.
 */
export function drumrollFor(seconds: number): SoundFn {
  return (ctx, out, t) => {
    let at = 0;
    while (at < seconds) {
      const u = at / seconds; // 0 at the start of the roll, 1 at its end
      snareHit(ctx, out, t + at, 0.15 + 0.85 * u ** 1.5 * (0.9 + Math.random() * 0.2));
      at += (0.12 - 0.075 * u) * (0.9 + Math.random() * 0.2);
    }
    // A last, biggest stroke right at the end: the roll lands on this.
    snareHit(ctx, out, t + seconds, 1);
  };
}

/** One brass-like note: two slightly detuned sawtooth waves through a low-pass filter that opens up as the note starts ("bwaah"), with a little vibrato on long notes. */
function brass(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, length: number, level: number) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(700, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + 0.08);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(level, t + 0.03);
  env.gain.setValueAtTime(level, t + Math.max(0.04, length - 0.12));
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  filter.connect(env).connect(out);
  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    if (length > 0.5) { // vibrato on the long notes
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.value = 9;
      wobble.connect(depth).connect(osc.detune);
      wobble.start(t + 0.25);
      wobble.stop(t + length + 0.05);
    }
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }
}

/** A bell-like sparkle note (a sine plus an octave above), for the shimmer on top of the fanfare. */
function sparkle(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, length: number, level: number) {
  for (const [mult, gain] of [[1, 1], [2, 0.35]] as const) {
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

/**
 * "You won!": the drumroll lands on a cymbal crash and a deep drum boom, a quick rising brass call (C, E, G) leads into a big,
 * bright, held C major chord, and a shimmer of bells climbs over the top. Major key, rising lines and a long ring-out all
 * say "positive". About 2 seconds long.
 */
export const victoryFanfare: SoundFn = (ctx, out, t) => {
  // The hit: a cymbal crash and a big low boom.
  grain(ctx, out, t, { type: 'highpass', freq: 6500, q: 0.7, gain: 0.4, duration: 1.7 });
  grain(ctx, out, t, { type: 'bandpass', freq: 9000, q: 0.6, gain: 0.3, duration: 1.2 });
  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(110, t);
  boom.frequency.exponentialRampToValueAtTime(48, t + 0.5);
  const boomEnv = ctx.createGain();
  boomEnv.gain.setValueAtTime(0.0001, t);
  boomEnv.gain.linearRampToValueAtTime(0.55, t + 0.01);
  boomEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  boom.connect(boomEnv).connect(out);
  boom.start(t);
  boom.stop(t + 0.75);
  // The brass call: three quick rising notes, C5 E5 G5...
  [523.25, 659.25, 783.99].forEach((f, i) => brass(ctx, out, t + i * 0.13, f, 0.12, 0.2));
  // ...into the big held chord: C4 E4 G4 C5 E5.
  [261.63, 329.63, 392, 523.25, 659.25].forEach((f) => brass(ctx, out, t + 0.42, f, 1.5, 0.15));
  // The shimmer: bells climbing C6 E6 G6 C7.
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => sparkle(ctx, out, t + 0.5 + i * 0.1, f, 0.9, 0.16));
};

/** For a draw there is no fanfare: the drumroll just resolves into a soft, friendly two-note chime and a quiet cymbal tick. */
export const drawChime: SoundFn = (ctx, out, t) => {
  grain(ctx, out, t, { type: 'highpass', freq: 7000, q: 0.7, gain: 0.25, duration: 0.5 });
  sparkle(ctx, out, t, 392, 0.8, 0.22); // G4...
  sparkle(ctx, out, t + 0.16, 587.33, 1, 0.22); // ...up to D5
};
