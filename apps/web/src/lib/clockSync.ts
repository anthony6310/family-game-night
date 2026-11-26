/**
 * Estimates the SERVER's clock on a phone. Everything timed across phones (the countdowns, the loading page lifting, GO, flights, jumps) is drawn from it, so every phone must agree on it.
 *
 * What a message can tell us. A message the server PUSHES carries its clock (`serverTime`); the phone notes its own clock when it arrives. Its travel time is unknown but never negative, so
 * `serverTime - arrival` is a LOWER bound on the true offset (server minus phone). Taken alone, as this file first did, that bound is wrong by the whole one-way trip: measured on a test
 * network, a phone 40-100 ms away ran its 3, 2, 1 that much behind a laptop next to the server. A phone on Wi-Fi is worse: while the room is quiet (the lobby, the loading page) its radio
 * dozes and messages to it are held back by a tenth of a second or more.
 *
 * So the phone also PINGS (`clock:ping`, answered at once). The server's answer was stamped somewhere between the ping leaving (`sentAt`) and the answer arriving, so a ping gives both
 * bounds: `serverTime - arrival <= offset <= serverTime - sentAt`. The estimate is the MIDDLE of the tightest interval all recent readings allow (the highest lower bound and the lowest
 * upper bound of the last WINDOW_MS): its error is at most half of the quickest round trip, a few milliseconds on a home network, and it does not depend on how often the server talks.
 *
 * The estimate is followed gently: it moves at most a small fraction of elapsed time (SLEW, so the clock never jumps: a jumping clock made anything animated from it stutter or rewind),
 * except when the gap is big (SNAP_MS: the first reading, or the phone's own clock was changed), where it snaps.
 */
const WINDOW_MS = 20_000; // readings older than this are forgotten (the network path may change; a phone's clock drifts, but by well under a millisecond in this time)
const SLEW = 0.05; // the estimate moves at most this fraction of real time (50 ms a second): invisible, unlike a jump
const SNAP_MS = 250; // a gap bigger than this is a real clock change, not jitter

interface Bound { at: number; value: number }

export class ClockSync {
  private lower: Bound[] = []; // readings that say "the offset is at least this"
  private upper: Bound[] = []; // readings that say "the offset is at most this" (pings only)
  private current = 0;
  private lastAt: number | null = null;

  /** The estimated `server time - phone time`, in milliseconds. */
  get offset(): number { return this.current; }

  /** A message the server pushed: `serverTime` is the stamp on it, `receivedAt` the phone's own `Date.now()` when it arrived. */
  update(serverTime: number, receivedAt: number = Date.now()): void {
    this.lower.push({ at: receivedAt, value: serverTime - receivedAt });
    this.settle(receivedAt);
  }

  /** A ping's answer: sent at `sentAt`, answered with `serverTime`, the answer arrived at `receivedAt` (all `Date.now()` on the phone, except `serverTime`). */
  ping(sentAt: number, serverTime: number, receivedAt: number = Date.now()): void {
    if (receivedAt < sentAt) return; // (the phone's clock was set back in between: the reading means nothing)
    const lo = { at: receivedAt, value: serverTime - receivedAt }, hi = { at: receivedAt, value: serverTime - sentAt };
    // A ping that contradicts what we have (its interval misses the current one) means the phone's clock was changed: start again from it.
    if (hi.value < this.best(this.lower, Math.max, receivedAt) || lo.value > this.best(this.upper, Math.min, receivedAt)) { this.lower = []; this.upper = []; }
    this.lower.push(lo);
    this.upper.push(hi);
    this.settle(receivedAt);
  }

  /** The tightest bound of one kind among the recent readings (old ones are dropped). */
  private best(list: Bound[], pick: (...v: number[]) => number, now: number): number {
    while (list.length > 1 && list[0].at < now - WINDOW_MS) list.shift();
    return list.length ? pick(...list.map((b) => b.value)) : pick === Math.max ? -Infinity : Infinity;
  }

  private settle(now: number) {
    const lo = this.best(this.lower, Math.max, now), hi = this.best(this.upper, Math.min, now);
    // With pings, the middle of what is possible; with pushed messages only (an older server), the lower bound (the least-delayed message).
    const target = hi === Infinity ? lo : hi >= lo ? (lo + hi) / 2 : hi;
    const gap = target - this.current;
    if (this.lastAt === null || Math.abs(gap) > SNAP_MS) this.current = target;
    else {
      const room = Math.max(0, now - this.lastAt) * SLEW; // how far it may move since the last reading
      this.current += Math.max(-room, Math.min(room, gap));
    }
    this.lastAt = now;
  }
}
