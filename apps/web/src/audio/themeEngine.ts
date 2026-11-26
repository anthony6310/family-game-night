import type { BedFn } from './spatialAudio';
import { bass as bassVoice, brass, noise, strings, timpani, tone, voice } from './synth';

/**
 * The small music engine behind the nine guessed game themes: a `ThemeSpec` (key, tempo, chords, a tune and which instruments play) becomes a
 * looping theme bed. The registry that says which game plays which theme, and the hook that plays it, are in gameThemes.ts (this file has no
 * dependency on the app's audio output, so the sound picker can bundle it on its own).
 */

// ---------- the engine ----------
export type Lead = 'whistle' | 'brass' | 'marimba' | 'bell' | 'pluck' | 'synth';
export type Comp = 'strum' | 'pad' | 'arp' | 'none';
export type BassStyle = 'walk' | 'pulse' | 'sustain' | 'none';
export type Drums = 'none' | 'light' | 'march' | 'bounce' | 'driving';

export interface ThemeSpec {
  tonic: number; // the key's note, as a MIDI number (60 = middle C)
  minor: boolean;
  bpm: number;
  chords: number[]; // one chord per bar, as a step of the scale (0 = the tonic chord, 3 = the fourth, 4 = the fifth, 5 = the relative minor/major...): 8 bars
  tune: PatternName[]; // the tune's pattern for each bar (it follows the chord of that bar)
  lead: Lead;
  comp: Comp;
  bass: BassStyle;
  drums: Drums;
  shaker?: boolean;
  swells?: number[]; // bars that begin a rising cymbal swell
  roll?: boolean; // a drum roll across the last bar (it leads back into the first)
  leadSteps?: number; // how many scale steps above the chord the tune sits (7 = an octave: the default)
}

/** One bar of tune: [beat in the bar, scale steps above the bar's chord root, length in beats]. */
const PATTERNS = {
  arp8: [[0, 0, 0.5], [0.5, 2, 0.5], [1, 4, 0.5], [1.5, 2, 0.5], [2, 0, 0.5], [2.5, 2, 0.5], [3, 4, 1]],
  lilt: [[0, 2, 1], [1, 4, 0.5], [1.5, 5, 0.5], [2, 4, 1], [3, 2, 1]],
  rise: [[0, 0, 1], [1, 2, 1], [2, 4, 1], [3, 7, 1]],
  fall: [[0, 7, 1], [1, 4, 1], [2, 2, 1], [3, 0, 1]],
  long: [[0, 4, 2], [2, 2, 1], [3, 0, 1]],
  hold: [[0, 7, 4]],
  hop: [[0, 0, 0.5], [0.5, 4, 0.5], [1, 7, 1], [2, 4, 0.5], [2.5, 0, 0.5], [3, 2, 1]],
  bounce: [[0, 4, 0.5], [0.5, 4, 0.5], [1, 2, 0.5], [1.5, 4, 0.5], [2, 7, 1], [3, 4, 1]],
  sneak: [[0, 0, 0.5], [1, 1, 0.5], [1.5, 0, 0.5], [2.5, 2, 0.5], [3, 1, 0.5]],
  call: [[0, 4, 1.5], [1.5, 2, 0.5], [2, 4, 1], [3, 5, 1]],
  rest2: [[0, 2, 1], [2, 4, 2]],
  stab: [[0, 7, 0.5], [1, 7, 0.5], [2, 4, 0.5], [3, 5, 0.5]],
} satisfies Record<string, [number, number, number][]>;
export type PatternName = keyof typeof PATTERNS;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** The MIDI note `step` scale steps above the tonic (steps past 6 go up an octave each seven). */
const scaleNote = (tonic: number, minor: boolean, step: number) => tonic + 12 * Math.floor(step / 7) + (minor ? MINOR : MAJOR)[((step % 7) + 7) % 7];
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

function leadNote(ctx: BaseAudioContext, out: AudioNode, t: number, kind: Lead, note: number, dur: number) {
  const f = hz(note);
  switch (kind) {
    case 'whistle': tone(ctx, out, t, { f, dur, g: 0.12, att: 0.04, vib: [5.5, f * 0.012] }); break;
    case 'brass': brass(ctx, out, t, note, dur, 0.075); brass(ctx, out, t, note - 12, dur, 0.04); break;
    case 'marimba': { const d = Math.max(0.2, Math.min(dur, 0.6)); tone(ctx, out, t, { f, dur: d, g: 0.16, att: 0.002 }); tone(ctx, out, t, { f: f * 4, dur: d * 0.2, g: 0.03, att: 0.002 }); break; }
    case 'bell': tone(ctx, out, t, { f, dur: Math.max(0.7, dur), g: 0.13, att: 0.003 }); tone(ctx, out, t, { f: f * 2, dur: 0.5, g: 0.03, att: 0.003 }); break;
    case 'pluck': tone(ctx, out, t, { type: 'triangle', f, dur: Math.min(dur, 0.22), g: 0.2, att: 0.003 }); break;
    case 'synth': voice(ctx, out, t, { f, dur: Math.max(0.12, dur * 0.8), g: 0.05, type: 'square', det: 6, lp0: 900, lp1: 2800, att: 0.01, rel: 0.05 }); break;
  }
}

function kick(ctx: BaseAudioContext, out: AudioNode, t: number, g = 0.45) {
  tone(ctx, out, t, { f: 130, f2: 55, dur: 0.2, g, att: 0.003 });
  noise(ctx, out, t, { type: 'lowpass', f: 250, g: g * 0.6, dur: 0.12, att: 0.002 });
}
const snare = (ctx: BaseAudioContext, out: AudioNode, t: number, g = 0.16) => noise(ctx, out, t, { type: 'bandpass', f: 1800, q: 1.2, g, dur: 0.09, att: 0.002 });
const hat = (ctx: BaseAudioContext, out: AudioNode, t: number, g = 0.06) => noise(ctx, out, t, { type: 'highpass', f: 7000, g, dur: 0.03, att: 0.001 });

/** Schedules one bar of a theme (at `s`, in audio-clock seconds): a few dozen notes, so a phone never builds a whole loop at once. */
function themeBar(ctx: BaseAudioContext, out: AudioNode, spec: ThemeSpec, bar: number, s: number) {
  const B = 60 / spec.bpm;
  const c = spec.chords[bar];
  const n = (step: number, octave = 0) => scaleNote(spec.tonic + 12 * octave, spec.minor, step);
  const triad = [c, c + 2, c + 4];
  // the bass
  if (spec.bass === 'walk') [0, 2].forEach((b) => tone(ctx, out, s + b * B, { type: 'triangle', f: hz(n(b ? c + 4 : c, -1)), dur: B * 0.8, g: 0.2, att: 0.004 }));
  else if (spec.bass === 'pulse') for (let k = 0; k < 8; k++) bassVoice(ctx, out, s + (k * B) / 2, n(k % 4 === 3 ? c + 4 : c, -1), B * 0.4, 0.11);
  else if (spec.bass === 'sustain') bassVoice(ctx, out, s, n(c, -1), 4 * B * 0.95, 0.09);
  // the chords
  if (spec.comp === 'strum') [1, 3].forEach((b) => triad.forEach((d, k) => tone(ctx, out, s + b * B + k * 0.012, { type: 'triangle', f: hz(n(d, 1)), dur: B * 0.35, g: 0.07, att: 0.003 })));
  else if (spec.comp === 'pad') triad.forEach((d) => strings(ctx, out, s, n(d, 1), 4 * B * 0.98, 0.03));
  else if (spec.comp === 'arp') for (let k = 0; k < 8; k++) tone(ctx, out, s + (k * B) / 2, { type: 'triangle', f: hz(n(triad[[0, 1, 2, 1][k % 4]], 1)), dur: B * 0.4, g: 0.07, att: 0.003 });
  // the drums
  if (spec.drums === 'light') { [0, 2].forEach((b) => kick(ctx, out, s + b * B, 0.25)); [1, 3].forEach((b) => snare(ctx, out, s + b * B, 0.1)); }
  else if (spec.drums === 'march') { timpani(ctx, out, s, 0.8); timpani(ctx, out, s + 2 * B, 0.6); [1, 3].forEach((b) => snare(ctx, out, s + b * B, 0.16)); }
  else if (spec.drums === 'bounce') { [0, 2].forEach((b) => kick(ctx, out, s + b * B)); [1, 3].forEach((b) => snare(ctx, out, s + b * B, 0.13)); }
  else if (spec.drums === 'driving') { for (let b = 0; b < 4; b++) kick(ctx, out, s + b * B, b === 0 ? 0.55 : 0.4); [1, 3].forEach((b) => snare(ctx, out, s + b * B, 0.18)); for (let k = 0; k < 8; k++) hat(ctx, out, s + (k * B) / 2, k % 2 ? 0.07 : 0.04); }
  if (spec.shaker) for (let k = 0; k < 8; k++) noise(ctx, out, s + (k * B) / 2, { type: 'highpass', f: 6000, g: k % 2 ? 0.05 : 0.08, dur: 0.05, att: 0.003 });
  if (spec.swells?.includes(bar)) noise(ctx, out, s, { type: 'highpass', f: 5000, q: 0.5, g: 0.1, dur: 4.2, att: 3 });
  if (spec.roll && bar === spec.chords.length - 1) for (let k = 0; k < 16; k++) timpani(ctx, out, s + (k * B) / 4, 0.2 + (0.7 * k) / 16, 1.1);
  // the tune
  for (const [beat, rel, len] of PATTERNS[spec.tune[bar]]) leadNote(ctx, out, s + beat * B, spec.lead, scaleNote(spec.tonic, spec.minor, c + rel + (spec.leadSteps ?? 7)), len * B * 0.92);
}

/** Turns a spec into a theme bed: it schedules bar by bar a little ahead of the audio clock (the way the app's background music does) and loops. */
export function makeTheme(spec: ThemeSpec): BedFn {
  return (ctx, out) => {
    const barLength = (60 / spec.bpm) * 4;
    let next = ctx.currentTime + 0.15;
    let n = 0;
    const timer = setInterval(() => {
      while (next < ctx.currentTime + 1.2) { // (a long look-ahead, so a throttled timer in a background tab never leaves a gap)
        themeBar(ctx, out, spec, n % spec.chords.length, next);
        next += barLength;
        n++;
      }
    }, 100);
    return () => clearInterval(timer);
  };
}

// ---------- the nine guessed themes (what each should feel like, in a line) ----------
/** Tap Race: an industrial lab, pure speed: a driving electronic beat, a pulsing bass, an arpeggiating synth and a stabbing lead. */
export const TAP_RACE_THEME: ThemeSpec = { tonic: 57, minor: true, bpm: 140, chords: [0, 0, 5, 6, 0, 0, 3, 4], tune: ['arp8', 'arp8', 'hop', 'stab', 'arp8', 'hop', 'call', 'stab'], lead: 'synth', comp: 'arp', bass: 'pulse', drums: 'driving' };
/** Tug of War: two teams straining: no brass and no stomping, just pressure: a slow pad, a sustained low bass, a hard beat and cymbal swells that keep building to a drum roll. */
export const TUG_OF_WAR_THEME: ThemeSpec = { tonic: 43, minor: true, bpm: 96, chords: [0, 0, 6, 6, 5, 5, 4, 4], tune: ['long', 'long', 'long', 'long', 'call', 'call', 'stab', 'hold'], lead: 'synth', comp: 'pad', bass: 'sustain', drums: 'driving', swells: [1, 3, 5, 7], roll: true };
/** Snowball: combative with a snowy feel: a minor-key bell tune over a driving beat, a pulsing bass and shakers. */
export const SNOWBALL_THEME: ThemeSpec = { tonic: 55, minor: true, bpm: 124, chords: [0, 0, 5, 4, 0, 0, 5, 4], tune: ['hop', 'stab', 'hop', 'call', 'hop', 'stab', 'bounce', 'hold'], lead: 'bell', comp: 'arp', bass: 'pulse', drums: 'driving', shaker: true };
/** Penguin Lasso: gliding on ice: a smooth marimba tune over a warm pad, a light shuffle and a walking bass. */
export const PENGUIN_LASSO_THEME: ThemeSpec = { tonic: 53, minor: false, bpm: 100, chords: [0, 3, 5, 4, 0, 3, 4, 0], tune: ['rise', 'lilt', 'bounce', 'fall', 'rise', 'lilt', 'call', 'hold'], lead: 'marimba', comp: 'pad', bass: 'walk', drums: 'light', shaker: true };
/** Fishing: an up-beat day by the sea: bells and marimba arpeggios over a walking bass, a light shuffle and shakers. */
export const FISHING_THEME: ThemeSpec = { tonic: 48, minor: false, bpm: 112, chords: [0, 5, 3, 4, 0, 5, 3, 0], tune: ['lilt', 'hop', 'call', 'rise', 'lilt', 'bounce', 'call', 'fall'], lead: 'bell', comp: 'arp', bass: 'walk', drums: 'light', shaker: true };
/** Santa's Sack: festive and bouncy: bells and sleigh-bell shakers over a strum and a happy beat. */
export const SANTA_SACK_THEME: ThemeSpec = { tonic: 50, minor: false, bpm: 126, chords: [0, 3, 0, 4, 0, 3, 4, 0], tune: ['bounce', 'hop', 'bounce', 'call', 'bounce', 'hop', 'rise', 'hold'], lead: 'bell', comp: 'strum', bass: 'walk', drums: 'bounce', shaker: true };
/** Snowflake Match: snow drifting down: slow, twinkling bells over a soft sustained bass. */
export const SNOWFLAKE_MATCH_THEME: ThemeSpec = { tonic: 60, minor: false, bpm: 76, chords: [0, 2, 5, 3, 0, 2, 3, 4], tune: ['rest2', 'long', 'rest2', 'rise', 'rest2', 'long', 'fall', 'hold'], lead: 'bell', comp: 'arp', bass: 'sustain', drums: 'none' };
/** Roach Rumble: sneaking through a dark kitchen: a creeping plucked tune, a pulsing bass, a dark pad and soft taps. */
export const ROACH_RUMBLE_THEME: ThemeSpec = { tonic: 48, minor: true, bpm: 104, chords: [0, 0, 5, 4, 0, 0, 6, 4], tune: ['sneak', 'sneak', 'stab', 'sneak', 'sneak', 'sneak', 'stab', 'sneak'], lead: 'pluck', comp: 'pad', bass: 'pulse', drums: 'light' };
/** Frog Climb: hopping up a pole: a bouncy marimba tune over a pulsing bass and a happy beat. */
export const FROG_CLIMB_THEME: ThemeSpec = { tonic: 55, minor: false, bpm: 132, chords: [0, 0, 3, 4, 0, 3, 4, 0], tune: ['hop', 'bounce', 'hop', 'stab', 'bounce', 'hop', 'rise', 'call'], lead: 'marimba', comp: 'none', bass: 'pulse', drums: 'bounce' };

