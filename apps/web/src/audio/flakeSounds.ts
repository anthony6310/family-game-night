import type { SoundFn } from './snowSounds';
import { ping, squeak, tone } from './synth';

/** Snowflake Match's sounds (made live, no files), picked by ear from three variations of each. */

/** MATCHED A SNOWFLAKE: "Crystal ding": two bright chimes. */
export const crystalDing: SoundFn = (ctx, out, t) => {
  ping(ctx, out, t, 1568, 0.2, 0.6);
  ping(ctx, out, t + 0.06, 2093, 0.14, 0.5);
};

/** TAPPED THE WRONG FLAKE: "Descending blips": two soft falling blips. */
export const descendingBlips: SoundFn = (ctx, out, t) => {
  [500, 400].forEach((f, i) => tone(ctx, out, t + i * 0.1, { f, dur: 0.12, g: 0.15, att: 0.004 }));
};

/** THE HAND SHOWS THE NEXT FLAKE: "Glove squeak": a tiny leathery squeak and a soft chime. */
export const gloveSqueak: SoundFn = (ctx, out, t) => {
  squeak(ctx, out, t, 1100, 0.08);
  ping(ctx, out, t + 0.06, 1319, 0.1, 0.3);
};
