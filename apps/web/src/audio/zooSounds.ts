import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { R, noise, tone } from './synth';

/**
 * Zoo Adoption's sounds, made live by the browser's audio engine (no files). Every one was picked by ear from the sound picker
 * (three variations of each); the pick's name is in each comment. There is deliberately no ambience for the shelter.
 * The theme is a "bed" (it loops until stopped): see `audio.startBed`.
 */

// ---------- little building blocks ----------
/** A clean bell-like ping: the note and a quiet octave above it, fading. */
function ping(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 0.15, dur = 0.35) {
  tone(ctx, out, t, { f, dur, g, att: 0.002 });
  tone(ctx, out, t, { f: f * 2, dur: dur * 0.5, g: g * 0.25, att: 0.002 });
}
/** A tiny animal squeak: a quick rising triangle note. */
function squeak(ctx: BaseAudioContext, out: AudioNode, t: number, f = 900, g = 0.12) {
  tone(ctx, out, t, { type: 'triangle', f, f2: f * 1.7, dur: 0.1, g, att: 0.004 });
}
/** Twinkling high notes scattered over `dur` seconds. */
function sparkle(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, g = 0.07) {
  for (let i = 0; i < n; i++) tone(ctx, out, t + R(0, dur), { f: R(1500, 3600), dur: R(0.08, 0.2), g: g * R(0.4, 1), att: 0.002 });
}
/** A bell strike: the note plus two inharmonic overtones that die faster. */
function bell(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 0.2, dur = 0.9) {
  [1, 2, 2.76].forEach((m, i) => tone(ctx, out, t, { f: f * m, dur: dur / (i + 1), g: g / (i + 1), att: 0.002 }));
}
/** One soft footfall: a muffled thud and a faint tick. */
function step(ctx: BaseAudioContext, out: AudioNode, t: number, g: number, f: number) {
  noise(ctx, out, t, { type: 'lowpass', f, g, dur: 0.07, att: 0.003 });
  noise(ctx, out, t, { type: 'bandpass', f: 2200, q: 1.5, g: g * 0.35, dur: 0.03, att: 0.001 });
}

// ---------- the effects ----------

/** ANIMAL LIGHTS UP: "Gentle glow hum": a short, soft rising hum when an animal comes within reach. */
export const glowHum: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 600, f2: 900, dur: 0.25, g: 0.07, att: 0.04, vib: [9, 8] });
};

/** PICKING AN ANIMAL UP: "Scoop and squeak". */
export const scoopUp: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'bandpass', f: 600, f2: 1200, q: 0.8, g: 0.18, dur: 0.14, att: 0.03 });
  squeak(ctx, out, t + 0.05, 900, 0.14);
};

/** PUTTING AN ANIMAL DOWN: "Gentle plop". */
export const plop: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 520, f2: 250, dur: 0.12, g: 0.25, att: 0.004 });
};

/** STANDING ON THE CARPET holding an animal: "Rising two-note". */
export const padChime: SoundFn = (ctx, out, t) => {
  ping(ctx, out, t, 659, 0.12, 0.25);
  ping(ctx, out, t + 0.1, 880, 0.12, 0.35);
};

/** ADOPTION (the right animal handed over): "Cheerful arpeggio". */
export const adoptedArpeggio: SoundFn = (ctx, out, t) => {
  [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, t + i * 0.07, { type: 'triangle', f, dur: 0.3, g: 0.2, att: 0.004 }));
};

/** ADOPTER JUMPS FOR JOY (hearts; also the opening pan reaching each adopter): "Whoop and sparkle". */
export const joyWhoop: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'triangle', f: 400, f2: 1000, dur: 0.25, g: 0.18, att: 0.01 });
  sparkle(ctx, out, t + 0.15, 0.5, 9, 0.07);
};

/** WRONG ANIMAL: "Gentle uh-oh": two soft falling notes. */
export const uhOh: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'triangle', f: 400, f2: 330, dur: 0.14, g: 0.2, att: 0.005 });
  tone(ctx, out, t + 0.15, { type: 'triangle', f: 330, f2: 250, dur: 0.22, g: 0.2, att: 0.005 });
};

/** ANIMAL RUNS OFF: "Scurry": a rush of tiny fading footfalls and a squeak (about a second). */
export const scurry: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 12; i++) noise(ctx, out, t + i * 0.08 + R(0, 0.02), { type: 'bandpass', f: R(1500, 3000), q: 2, g: 0.16 * (1 - i / 16), dur: 0.04, att: 0.002 });
  squeak(ctx, out, t + 0.1, 1300, 0.08);
};

/** NEW ADOPTER STEPS UP: "Desk bell". */
export const deskBell: SoundFn = (ctx, out, t) => bell(ctx, out, t, 1568, 0.2, 0.8);

/** FOOTSTEPS: "Light padding": one very soft step (the scene plays one about every third of a second while you walk). */
export const footstep: SoundFn = (ctx, out, t) => step(ctx, out, t, 0.09, R(340, 420));

// ---------- the theme (a bed that loops until stopped) ----------

/** One whistled note: a pure tone with a slight vibrato. */
function whistle(ctx: BaseAudioContext, out: AudioNode, t: number, note: number, dur: number, g = 0.12) {
  const f = 440 * 2 ** ((note - 69) / 12);
  tone(ctx, out, t, { f, dur, g, att: 0.04, vib: [5.5, f * 0.012] });
}

// "Sunny stroll": C major, relaxed, 100 bpm: ukulele-style strums, a walking bass, a shaker and a whistled tune. Eight bars (19.2 s) that loop.
const STROLL_BEAT = 60 / 100;
const STROLL_BARS: [number, boolean][] = [[48, false], [43, false], [45, true], [41, false], [48, false], [43, false], [41, false], [48, false]]; // [root note, minor?] for each bar
/** The tune: [beat from the start of the 8 bars, note, length in beats]. */
const STROLL_TUNE: [number, number, number][] = [[0, 76, 1], [1, 79, 0.5], [1.5, 81, 0.5], [2, 79, 1], [3, 76, 1], [4, 74, 1], [5, 79, 1], [6, 83, 1], [7, 79, 1], [8, 76, 1], [9, 81, 1], [10, 84, 1], [11, 81, 1], [12, 77, 1], [13, 81, 0.5], [13.5, 79, 0.5], [14, 77, 2], [16, 79, 1], [17, 84, 1], [18, 83, 0.5], [18.5, 81, 0.5], [19, 79, 1], [20, 79, 1], [21, 83, 1], [22, 86, 2], [24, 84, 1], [25, 81, 1], [26, 77, 1], [27, 81, 1], [28, 79, 1], [29, 76, 1], [30, 72, 2]];

/** Schedules one bar of the theme (at `s`, in audio-clock seconds): about 30 notes, so a phone never builds the whole loop at once. */
function strollBar(ctx: BaseAudioContext, out: AudioNode, bar: number, s: number) {
  const B = STROLL_BEAT;
  const [root, minor] = STROLL_BARS[bar];
  const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
  [0, 2].forEach((b) => tone(ctx, out, s + b * B, { type: 'triangle', f: hz(root - (b ? 5 : 12)), dur: B * 0.8, g: 0.2, att: 0.004 })); // the walking bass: the root, then the fifth
  [1, 3].forEach((b) => [root + 12, root + 12 + (minor ? 3 : 4), root + 19].forEach((n, k) => tone(ctx, out, s + b * B + k * 0.012, { type: 'triangle', f: hz(n + 12), dur: B * 0.35, g: 0.07, att: 0.003 }))); // a strummed chord
  for (let k = 0; k < 8; k++) noise(ctx, out, s + (k * B) / 2, { type: 'highpass', f: 6000, g: k % 2 ? 0.05 : 0.08, dur: 0.05, att: 0.003 }); // the shaker
  for (const [beat, note, len] of STROLL_TUNE) {
    if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
    whistle(ctx, out, s + (beat - bar * 4) * B, note, len * B * 0.92, 0.12);
  }
}

/** GAME THEME: "Sunny stroll", looping bar by bar a little ahead of the audio clock (the same way the app's background music does). */
export const strollTheme: BedFn = (ctx, out) => {
  const barLength = STROLL_BEAT * 4;
  let next = ctx.currentTime + 0.15;
  let n = 0;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 1.2) { // (a long look-ahead, so a throttled timer in a background tab never leaves a gap)
      strollBar(ctx, out, n % STROLL_BARS.length, next);
      next += barLength;
      n++;
    }
  }, 100);
  return () => clearInterval(timer);
};
