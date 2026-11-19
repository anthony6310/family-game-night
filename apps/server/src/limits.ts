/**
 * A simple "no more than `max` of these in `windowMs`" counter, per key (a connection's address, a room, ...). `blocked` says whether the key
 * has used up its allowance; `record` counts one use. Used to slow down password guessing, room spamming and list refreshing. (In memory, like
 * the rooms themselves: a restart clears it.)
 */
export class AttemptLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  private recent(key: string, now: number): number[] {
    const fresh = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (fresh.length > 0) this.hits.set(key, fresh); else this.hits.delete(key);
    return fresh;
  }
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }
  record(key: string, now = Date.now()) {
    this.hits.set(key, [...this.recent(key, now), now]);
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
