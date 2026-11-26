import type { SoundFn } from './snowSounds';
import { R, noise, pebbles, thud, tone, whoosh, windLoop } from './synth';
import type { BedFn } from './spatialAudio';

/** Roach Rumble's sounds (made live, no files), picked by ear from three variations of each. */

/** SANDAL SWING: "Whoosh". */
export const sandalWhoosh: SoundFn = (ctx, out, t) => whoosh(ctx, out, t, 400, 1800, 0.25, 0.3, 0.1);

/** ROACH SQUISHED: "Crunchy squelch": little cracks and a wet low squelch. */
export const crunchySquelch: SoundFn = (ctx, out, t) => {
  pebbles(ctx, out, t, 0.08, 6, 0.4);
  noise(ctx, out, t, { type: 'lowpass', f: 500, g: 0.4, dur: 0.2 });
};

/** ROACH CURLS UP: "Tiny twitches": six quick little ticks. */
export const tinyTwitches: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 6; i++) noise(ctx, out, t + i * 0.07, { type: 'bandpass', f: R(2500, 4000), q: 3, g: 0.12, dur: 0.03, att: 0.001 });
};

/** POISON BOTTLE SMASHES: "Glass crash". */
export const glassCrash: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'highpass', f: 3000, g: 0.6, dur: 0.5, att: 0.001 });
  pebbles(ctx, out, t, 0.4, 14, 0.3);
  thud(ctx, out, t, 0.4);
};

/** ROACH EATING: "Nibble crunch": eight tiny crunches (about a second: repeat while it eats). */
export const nibbleCrunch: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 8; i++) noise(ctx, out, t + i * 0.1 + R(0, 0.03), { type: 'bandpass', f: R(1200, 2200), q: 2, g: 0.18, dur: 0.04, att: 0.001 });
};

/** STANDING IN POISON: "Bubbling poison": a low wobbling gurgle with bubbles (1.5 s: repeat while it stands there). */
export const bubblingPoison: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'lowpass', f: 400, q: 0.7, g: 0.1, dur: 1.5, att: 0.2 });
  for (let i = 0; i < 6; i++) tone(ctx, out, t + R(0, 1.2), { f: R(200, 400), f2: R(400, 700), dur: 0.08, g: 0.08, att: 0.004 });
};

/** NEARLY STARVED: "Heartbeat": two thumps, a pause, two more (about 1.4 s: repeat while the life is low). */
export const heartbeat: SoundFn = (ctx, out, t) => {
  [0, 0.22, 0.9, 1.12].forEach((d) => tone(ctx, out, t + d, { f: 70, f2: 45, dur: 0.18, g: 0.5, att: 0.01 }));
};

/** ROACH SCUTTLING: "Fast skitter": eight quick little scratches (0.4 s: repeat while it runs). */
export const fastSkitter: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 8; i++) noise(ctx, out, t + i * 0.05, { type: 'bandpass', f: R(1500, 3000), q: 2, g: 0.12, dur: 0.025, att: 0.001 });
};

/** SANDAL SMACK: "Whip-crack smack": a sharp crack on top of a hard slap and a heavy thump. */
export const sandalWhipSmack: SoundFn = (ctx, out, t, strength) => {
  const k = 0.5 + 0.5 * strength;
  noise(ctx, out, t, { type: 'highpass', f: 5500, g: 0.95 * k, dur: 0.02, att: 0.0005 });
  noise(ctx, out, t + 0.005, { type: 'bandpass', f: 1500, q: 0.9, g: 0.75 * k, dur: 0.08, att: 0.001 });
  noise(ctx, out, t + 0.03, { type: 'highpass', f: 2500, g: 0.3 * k, dur: 0.05, att: 0.001 });
  thud(ctx, out, t, k);
};

/** DARK KITCHEN (loop): "Fluorescent flicker": a low mains hum under a quiet murmur, with the odd buzzing flicker of the tube. */
export const kitchenHum: BedFn = (ctx, out) => {
  const stopHum = windLoop(ctx, out, { type: 'lowpass', f: 180, q: 0.7, g: 0.05, rate: 0.2, depth: 0.015, tones: [{ f: 120, g: 0.025, type: 'sine' }] });
  const timer = setInterval(() => { // every second or so the light may flicker
    if (Math.random() < 0.5) noise(ctx, out, ctx.currentTime + R(0, 1), { type: 'bandpass', f: 3000, q: 4, g: 0.1, dur: 0.05, att: 0.002 });
  }, 1000);
  return () => { clearInterval(timer); stopHum(); };
};
