/**
 * Moves a game state in time. An engine's state holds its clock readings as absolute server times in milliseconds (`startsAt`, `endsAt`, a respawn's `at`, a `clock`...), all taken from the
 * `now` that `init` was given. A round whose start is MOVED (it waits for every phone to put the game on screen, see RoomManager) needs all of them moved by the same amount, which is what
 * "as if `init` had been given a later `now`" means. Every number that looks like a time (a real clock reading, above TIME_FLOOR_MS) is shifted; everything else is left alone.
 * Arrays, Maps, Sets and plain objects are walked, and a NEW state is returned (the input is not touched). `test-pending.ts` checks that this equals a later `init` for every game: a new game
 * that keeps its times in some other form (seconds, a Date object, a number relative to something) fails that test and has to be taught here.
 */
const TIME_FLOOR_MS = 1e12; // (1e12 ms is September 2001: no game number is this large except a clock reading)

export function shiftTimes<T>(value: T, deltaMs: number): T {
  return walk(value, deltaMs, new Map()) as T;
}

/** (`seen` keeps the sharing: an object that the state holds in two places is still ONE object in the copy, so an engine that changes it in place sees the change in both.) */
function walk(value: unknown, deltaMs: number, seen: Map<object, unknown>): unknown {
  if (typeof value === 'number') return value >= TIME_FLOOR_MS ? value + deltaMs : value;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const v of value) out.push(walk(v, deltaMs, seen));
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [k, v] of value) out.set(k, walk(v, deltaMs, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const v of value) out.add(walk(v, deltaMs, seen));
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [k, v] of Object.entries(value)) out[k] = walk(v, deltaMs, seen);
  return out;
}
