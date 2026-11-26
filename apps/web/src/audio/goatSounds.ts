import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { R, bass, brass, noise, noiseBuffer, strings, timpani, tone } from './synth';

/**
 * Closing the Gap's sounds, made live by the browser's audio engine (no files). Every one was picked by ear from the sound picker
 * (three variations of each); the pick's name is in each comment. There is deliberately no sound for the goat climbing back up.
 * The wind and the theme are "beds" (they loop until stopped): see `audio.startBed`.
 */

// ---------- little building blocks ----------
/** A hoof strike: a short woody tap. */
function hoof(ctx: BaseAudioContext, out: AudioNode, t: number, f = 300, g = 0.35) {
  tone(ctx, out, t, { type: 'triangle', f, f2: f * 0.6, dur: 0.08, g, att: 0.002 });
  noise(ctx, out, t, { type: 'bandpass', f: 1100, q: 1.5, g: g * 0.5, dur: 0.05, att: 0.001 });
}
/** Little stones skittering. */
function pebbles(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, g = 0.2) {
  for (let i = 0; i < n; i++) noise(ctx, out, t + R(0, dur), { type: 'bandpass', f: R(1500, 4500), q: 2, g: g * R(0.3, 1), dur: R(0.015, 0.04), att: 0.001 });
}
/** A dull thump on earth. */
function thud(ctx: BaseAudioContext, out: AudioNode, t: number, k = 1) {
  tone(ctx, out, t, { f: 95, f2: 45, dur: 0.22, g: 0.6 * k, att: 0.004 });
  noise(ctx, out, t, { type: 'lowpass', f: 300, g: 0.5 * k, dur: 0.18, att: 0.002 });
}
/** A bird's harsh cry: a buzzy tone, shaken fast, through a band-pass. */
function squawk(ctx: BaseAudioContext, out: AudioNode, t: number, f = 900, dur = 0.3, g = 0.2) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + dur);
  const shake = ctx.createOscillator();
  const depth = ctx.createGain();
  shake.frequency.value = 45;
  depth.gain.value = 60;
  shake.connect(depth).connect(osc.frequency);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1600;
  filter.Q.value = 1.5;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(g, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter).connect(env).connect(out);
  osc.start(t); shake.start(t);
  osc.stop(t + dur + 0.05); shake.stop(t + dur + 0.05);
}
/** One wing beat: a soft airy whump. */
function flap(ctx: BaseAudioContext, out: AudioNode, t: number, g = 0.25) {
  noise(ctx, out, t, { type: 'lowpass', f: 650, g, dur: 0.14, att: 0.012 });
  noise(ctx, out, t + 0.02, { type: 'bandpass', f: 1500, q: 0.8, g: g * 0.35, dur: 0.1, att: 0.01 });
}

// ---------- the effects ----------

/** GOAT LEAPS: "Hoof push and whoosh". */
export const goatJump: SoundFn = (ctx, out, t) => {
  thud(ctx, out, t, 0.7);
  hoof(ctx, out, t, 260, 0.3);
  noise(ctx, out, t + 0.03, { type: 'bandpass', f: 500, f2: 1800, q: 0.8, g: 0.28, dur: 0.4, att: 0.09 });
};

/** AIM MARKER SWEEPING: "Rising and falling hum": one sweep out and back (SWEEP_SECONDS, 2.2 s). */
export const sweepHum: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 300, f2: 700, dur: 1.1, g: 0.1, att: 0.15 });
  tone(ctx, out, t + 1.1, { f: 700, f2: 300, dur: 1.1, g: 0.1, att: 0.02 });
};

/** LANDING ON THE LEDGE: "Soft earthy thud". */
export const goatLand: SoundFn = (ctx, out, t) => {
  thud(ctx, out, t, 0.9);
  pebbles(ctx, out, t + 0.02, 0.2, 6, 0.15);
};

/** POINT SCORED: "Bright ding". */
export const pointDing: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 880, dur: 0.5, g: 0.2, att: 0.003 });
  tone(ctx, out, t, { f: 1320, dur: 0.4, g: 0.1, att: 0.003 });
};

/** GOAT FALLS INTO THE GAP: "Long whistling drop": a falling whistle, then a far-off thump at the bottom. */
export const goatFall: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 950, f2: 140, dur: 1.2, g: 0.18, att: 0.03 });
  noise(ctx, out, t, { type: 'bandpass', f: 1200, f2: 300, q: 4, g: 0.1, dur: 1.2, att: 0.05 });
  thud(ctx, out, t + 1.35, 0.5);
  noise(ctx, out, t + 1.35, { type: 'lowpass', f: 200, g: 0.4, dur: 0.6 });
};

/** GOAT CRASHES INTO THE BIRD: "Screech and smack". */
export const birdHit: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'bandpass', f: 800, q: 1, g: 0.5, dur: 0.1, att: 0.002 });
  squawk(ctx, out, t + 0.04, 1500, 0.5, 0.22);
  noise(ctx, out, t + 0.04, { type: 'bandpass', f: 2500, q: 3, g: 0.12, dur: 0.4 });
};

/** BIRD FLYING ACROSS THE GAP: "Wing flaps": two seconds of beats (repeat it while the bird is in view). */
export const birdFlaps: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 8; i++) flap(ctx, out, t + i * 0.25 + R(0, 0.02), 0.22);
};
export const BIRD_FLAPS_SECONDS = 2;

// ---------- the beds (they loop until stopped) ----------

/** CREVICE WIND: "Whistling wind": band-passed noise with a narrow, whistling band that slowly drifts in pitch and swells. */
export const crevasseWind: BedFn = (ctx, out) => {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 6;
  const level = ctx.createGain();
  level.gain.value = 0.12;
  const swell = ctx.createOscillator();
  const swellAmount = ctx.createGain();
  swell.frequency.value = 0.25;
  swellAmount.gain.value = 0.07;
  swell.connect(swellAmount).connect(level.gain);
  const drift = ctx.createOscillator();
  const driftAmount = ctx.createGain();
  drift.frequency.value = 0.175;
  driftAmount.gain.value = 250;
  drift.connect(driftAmount).connect(filter.frequency);
  source.connect(filter).connect(level).connect(out);
  source.start(); swell.start(); drift.start();
  return () => {
    const end = ctx.currentTime + 1.5; // (the bed's own fade-out has finished by then)
    try { source.stop(end); swell.stop(end); drift.stop(end); } catch { /* already stopped */ }
  };
};

// "Daring ascent": E minor, tense and climbing: pulsing bass, steady drums, a sparse high tune. Eight bars (about 14.5 s) that loop.
const ASCENT_BEAT = 60 / 132;
const ASCENT_BARS: [number, boolean][] = [[52, true], [52, true], [48, false], [50, false], [52, true], [48, false], [47, false], [52, true]]; // [root note, minor?] for each bar
/** The tune: [beat from the start of the 8 bars, note, length in beats]. */
const ASCENT_TUNE: [number, number, number][] = [[0, 76, 2], [2, 79, 2], [4, 83, 3], [7, 81, 1], [8, 79, 2], [10, 76, 2], [12, 74, 3], [15, 76, 1], [16, 79, 2], [18, 83, 2], [20, 84, 3], [23, 83, 1], [24, 81, 2], [26, 79, 2], [28, 83, 4]];

/** Schedules one bar of the theme (at `s`, in audio-clock seconds): about 40 notes, so a phone never builds the whole loop at once. */
function ascentBar(ctx: BaseAudioContext, out: AudioNode, bar: number, s: number, loopedBack: boolean) {
  const B = ASCENT_BEAT;
  const [root, minor] = ASCENT_BARS[bar];
  for (let k = 0; k < 8; k++) bass(ctx, out, s + (k * B) / 2, root - 12 + (k % 4 === 3 ? 7 : 0), B * 0.4, 0.11);
  [root + 12, root + 12 + (minor ? 3 : 4), root + 19].forEach((n) => strings(ctx, out, s, n, 4 * B * 0.98, 0.03 + 0.003 * bar));
  timpani(ctx, out, s, 1);
  timpani(ctx, out, s + B, 0.5);
  timpani(ctx, out, s + 2 * B, 0.8);
  timpani(ctx, out, s + 3 * B, 0.5);
  for (const [beat, note, len] of ASCENT_TUNE) {
    if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
    brass(ctx, out, s + (beat - bar * 4) * B, note, len * B * 0.95, 0.06);
  }
  if (bar === 3 || bar === 6) noise(ctx, out, s, { type: 'highpass', f: 5000, q: 0.5, g: 0.1, dur: 4.2, att: 3 }); // (a cymbal swell rising into the next section)
  if (bar === 7) for (let k = 0; k < 16; k++) timpani(ctx, out, s + (k * B) / 4, 0.2 + (0.7 * k) / 16, 1.1); // the closing drum roll
  if (bar === 0 && loopedBack) timpani(ctx, out, s, 1.3, 0.8); // the big hit that lands the loop
}

/** GAME THEME: "Daring ascent", looping bar by bar a little ahead of the audio clock (the same way the app's background music does). */
export const ascentTheme: BedFn = (ctx, out) => {
  const barLength = ASCENT_BEAT * 4;
  let next = ctx.currentTime + 0.15;
  let n = 0;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 1.2) { // (a long look-ahead, so a throttled timer in a background tab never leaves a gap)
      ascentBar(ctx, out, n % ASCENT_BARS.length, next, n >= ASCENT_BARS.length);
      next += barLength;
      n++;
    }
  }, 100);
  return () => clearInterval(timer);
};
