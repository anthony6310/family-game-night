import type { SoundFn } from './snowSounds';
import { R, noise, ping, tone, whoosh } from './synth';

/** Fishing's sounds (made live, no files), picked by ear from three variations of each. There is deliberately no ocean ambience. */

/** CASTING THE LINE: "Whip swish". */
export const whipSwish: SoundFn = (ctx, out, t) => whoosh(ctx, out, t, 800, 3000, 0.25, 0.25, 0.05);

/** HOOK HITS THE WATER (and the catch splashing at the end): "Bigger splash": a sweep of water over a low plunge. */
export const bigSplash: SoundFn = (ctx, out, t) => {
  whoosh(ctx, out, t, 2800, 600, 0.6, 0.45, 0.02);
  noise(ctx, out, t, { type: 'lowpass', f: 400, g: 0.4, dur: 0.4 });
};

/** FISH HOOKED: "Reel zing and pop". */
export const reelZing: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 900, f2: 1800, dur: 0.1, g: 0.12, att: 0.005 });
  ping(ctx, out, t + 0.08, 1319, 0.2, 0.4);
};

/** HOOK HITS A MINE: "Big explosion": a deep boom, a crack and a rumble. */
export const bigExplosion: SoundFn = (ctx, out, t) => {
  tone(ctx, out, t, { f: 110, f2: 30, dur: 0.9, g: 0.9, att: 0.005 });
  noise(ctx, out, t, { type: 'lowpass', f: 900, g: 1, dur: 0.9, att: 0.002 });
  noise(ctx, out, t + 0.05, { type: 'bandpass', f: 1800, q: 0.7, g: 0.5, dur: 0.3 });
};

/** HOOKS REELING UP: "Ratchet clicks": fourteen quick clicks (one second of reeling: repeat while the hooks come up). */
export const REEL_SECONDS = 1;
export const reelRatchet: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 14; i++) noise(ctx, out, t + i * 0.07, { type: 'bandpass', f: 2600, q: 4, g: 0.15, dur: 0.025, att: 0.001 });
};

/** THE CATCH LANDS ON THE DOCK: "Splash and slither": a wet splash, then a slithering pile of wet fish. */
export const fishPile: SoundFn = (ctx, out, t) => {
  whoosh(ctx, out, t, 2400, 500, 0.5, 0.4, 0.01);
  for (let i = 0; i < 5; i++) noise(ctx, out, t + 0.1 + i * 0.08, { type: 'bandpass', f: R(450, 800), q: 1, g: 0.4, dur: 0.12, att: 0.003 });
  noise(ctx, out, t + 0.3, { type: 'lowpass', f: 700, g: 0.2, dur: 0.5, att: 0.1 });
};
