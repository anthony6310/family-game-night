import type { SoundFn } from './snowSounds';
import { crackles, noise, thud, tone, whoosh } from './synth';

/** Tug of War's sounds (made live, no files), picked by ear from three or four variations of each. */

/** YOUR TAP (a pull): "Heave": a short low grunt of effort. */
export const heave: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'triangle', f: 160, f2: 110, dur: 0.12, g: 0.3, att: 0.004 });
  noise(ctx, out, t, { type: 'lowpass', f: 400, g: 0.25, dur: 0.12 });
};

/** ROPE STRAINING (the strain before the final pull): "Stretching rope": a taut, creaking squeal with little crackles (about a second). */
export const ropeStretch: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'bandpass', f: 1200, f2: 700, q: 5, g: 0.1, dur: 1.0, att: 0.3 });
  crackles(ctx, out, t, 1, 10, 2500, 0.08);
};

/** THE MASSIVE PULL: "Massive heave": a rising rush and then a huge deep thump. */
export const massiveHeave: SoundFn = (ctx, out, t) => {
  whoosh(ctx, out, t, 300, 1200, 1.0, 0.4);
  thud(ctx, out, t + 0.9, 1);
  tone(ctx, out, t + 0.9, { f: 70, f2: 30, dur: 0.9, g: 0.6, att: 0.01 });
};

/** THE LOSING TEAM FALLS: "Comic splat": a falling slide and a soft flop. */
export const comicSplat: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 500, f2: 100, dur: 0.4, g: 0.2, att: 0.01 });
  thud(ctx, out, t + 0.38, 0.7);
};
