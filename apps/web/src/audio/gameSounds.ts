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
