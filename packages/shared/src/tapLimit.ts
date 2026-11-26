/**
 * The tap-rate limit of the two tap games (Tap Race and Tug of War): at most 25 taps a second over any stretch (this blunts auto-clickers), but a BURST of a few taps
 * may arrive together. A phone's taps do not reach the server evenly: a slow moment on the network delivers three or four of them in one clump, and a rule that
 * threw away any tap closer than 40 ms to the last ONE (measured on arrival) threw those away although the player had tapped at a perfectly human pace.
 * It is a token bucket: every tap spends a token, tokens come back at one per TAP_MIN_INTERVAL_MS, and the bucket holds at most TAP_BURST.
 * Shared so the Tap Race phone can count its own taps by the very same rule (it shows only the taps the server will count). The bucket's `at` is a clock
 * reading, so the server's `shiftTimes` moves it with the rest of the state; `tokens` is small and left alone.
 */
export const TAP_MIN_INTERVAL_MS = 40;
export const TAP_BURST = 6;

export interface TapBucket { tokens: number; at: number }

/** Spends a token for a tap at `now`: the new bucket, or null when the player is tapping too fast (the tap is not counted and nothing is spent). */
export function spendTap(bucket: TapBucket | undefined, now: number): TapBucket | null {
  const before = bucket ?? { tokens: TAP_BURST, at: now };
  const tokens = Math.min(TAP_BURST, before.tokens + Math.max(0, now - before.at) / TAP_MIN_INTERVAL_MS);
  if (tokens < 1) return null;
  return { tokens: tokens - 1, at: now };
}
