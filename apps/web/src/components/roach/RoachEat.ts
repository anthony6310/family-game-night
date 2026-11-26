/**
 * How a roach shows that it is eating in Roach Rumble: it sways its head from side to side in a small range, smoothly. No tilting, no pecking. `eatYaw(variant, t)` is the turn (radians, about the vertical) at `t` seconds.
 *   a  slow sweep: a gentle sine, about 13 degrees either way, a little under once a second
 *   b  wide and gentle: a bigger sweep, about 19 degrees, once every two seconds
 *   c  look and linger: it swings across and lingers at each end (a sine bent so it dwells there), about 15 degrees
 * The game uses EAT_VARIANT.
 */
export type EatVariant = 'a' | 'b' | 'c';
export const EAT_VARIANT: EatVariant = 'a';
export function eatYaw(variant: EatVariant, t: number): number {
  if (variant === 'b') return 0.34 * Math.sin(Math.PI * t); // 0.5 Hz
  if (variant === 'c') return 0.26 * Math.tanh(2.2 * Math.sin(2 * Math.PI * 0.6 * t)) / Math.tanh(2.2);
  return 0.22 * Math.sin(2 * Math.PI * 0.7 * t);
}

// ---- the sway in the game: a small, smooth sweep. These are first guesses (6 degrees, once a second): the rig used to tune them has been deleted.
export const EAT_RANGE_DEG = 6; // how far the head turns either way, in degrees
export const EAT_HZ = 1.0; // sweeps per second
export const EAT_LINGER = 0; // 0 a plain sine; up to 1 it lingers at each end
/** The sway: `range` radians either way, `hz` sweeps a second, `linger` 0..1 (a sine bent so it dwells at the ends). */
export function eatSway(t: number, range: number, hz: number, linger: number): number {
  const s = Math.sin(2 * Math.PI * hz * t);
  if (linger < 0.01) return range * s;
  const k = 0.5 + linger * 3;
  return (range * Math.tanh(k * s)) / Math.tanh(k);
}
export const eatYawNow = (t: number) => eatSway(t, (EAT_RANGE_DEG * Math.PI) / 180, EAT_HZ, EAT_LINGER);
