import type { SoundFn } from './snowSounds';
import { pebbles, thud, tone, whoosh } from './synth';

/** Frog Climb's sounds (made live, no files), picked by ear from three variations of each. There is deliberately no jungle ambience. */

/** FROG HOPS UP: "Boing hop". */
export const boingHop: SoundFn = (ctx, out, t) => tone(ctx, out, t, { type: 'triangle', f: 250, f2: 600, dur: 0.18, g: 0.25, att: 0.004, vib: [16, 14] });

/** FROG SCRAMBLES TO THE OTHER SIDE: "Leaf rustle dash". */
export const leafDash: SoundFn = (ctx, out, t) => {
  whoosh(ctx, out, t, 1500, 3500, 0.3, 0.15, 0.08, 1.5);
  pebbles(ctx, out, t, 0.25, 6, 0.1);
};

/** POLE BENDING: "Rubber stretch": a slow, wobbling rising tone. */
export const rubberStretch: SoundFn = (ctx, out, t) => tone(ctx, out, t, { type: 'sine', f: 180, f2: 320, dur: 0.7, g: 0.12, att: 0.1, vib: [12, 15] });

/** FROG HITS A THORN: "Sproing drop": a springy fall and a soft landing. */
export const sproingDrop: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'triangle', f: 600, f2: 120, dur: 0.5, g: 0.2, att: 0.005, vib: [14, 12] });
  thud(ctx, out, t + 0.5, 0.5);
};

/** POLE OVER-BENDS AND THE FROG DROPS: "Rubbery slip". */
export const rubberySlip: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { type: 'triangle', f: 500, f2: 150, dur: 0.6, g: 0.2, att: 0.01, vib: [12, 16] });
  thud(ctx, out, t + 0.6, 0.4);
};

/** FROG REACHES THE TOP: "Triumph jingle": a rising five-note run. */
export const triumphJingle: SoundFn = (ctx, out, t) => {
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, out, t + i * 0.08, { type: 'triangle', f, dur: 0.3, g: 0.2, att: 0.004 }));
};
