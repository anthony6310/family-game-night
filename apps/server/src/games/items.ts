import type { ItemKind, SnowballItem } from '@fgn/shared';
import type { Point } from './terrain';

/**
 * Where pick-ups lie. Pure functions (no clocks, no sockets), so the layout rules are easy to test: pass a seeded
 * random number generator and you get the same layout every time.
 */

/** A pick-up the engine keeps track of: what phones are told (minus the flight countdown), plus when a thrown one lands. */
export interface Item extends Omit<SnowballItem, 'thrown'> {
  /** Set for a fish thrown off a ball by a hit: where it came from, when (server clock ms) it lands, and how long the flight is. Until then it can't be collected. */
  thrown?: { fromX: number; fromZ: number; landsAt: number; flightMs: number };
}

export interface PlacementRules {
  arenaRadius: number;
  /** Stay this far inside the wall, so a ball can always reach the item without scraping the wall. */
  edgeMargin: number;
  /** Stay at least this far from every point in `avoid` (the start positions and the balls), so nothing is handed to anyone for free. */
  clearance: number;
  /** Stay at least this far from every other item, so a wave is scattered across the arena rather than bunched up. */
  spacing: number;
}

/**
 * Picks `count` random spots for new items of `kind`, scattered across the arena. A spot is rejected if it is too
 * near the wall, `avoid` points or another item; after many failed tries the rules relax a little rather than
 * leaving an item out (a cramped arena still gets its items). Returns the new items with ids counting up from `firstId`.
 */
export function placeItems(
  random: () => number, kind: ItemKind, count: number, firstId: number,
  rules: PlacementRules, avoid: readonly Point[], existing: readonly Item[],
): Item[] {
  const placed: Item[] = [];
  for (let n = 0; n < count; n++) {
    let best: Point | null = null;
    // Each round of tries uses the full rules; if none fits, relax them by a fifth and try again.
    for (let relax = 1; relax > 0.05 && !best; relax -= 0.2) {
      for (let attempt = 0; attempt < 200 && !best; attempt++) {
        // sqrt gives an even spread over the AREA of the disc (without it, items would crowd the middle).
        const reach = Math.sqrt(random()) * (rules.arenaRadius - rules.edgeMargin);
        const angle = random() * Math.PI * 2;
        const spot = { x: Math.cos(angle) * reach, z: Math.sin(angle) * reach };
        const tooClose = (p: Point, distance: number) => Math.hypot(p.x - spot.x, p.z - spot.z) < distance * relax;
        if (avoid.some((p) => tooClose(p, rules.clearance))) continue;
        if ([...existing, ...placed].some((p) => tooClose(p, rules.spacing))) continue;
        best = spot;
      }
    }
    // (Practically unreachable: relaxing all the way to ~nothing always finds a spot. Fall back to the middle regardless.)
    const spot = best ?? { x: 0, z: 0 };
    placed.push({ id: firstId + n, kind, x: spot.x, z: spot.z });
  }
  return placed;
}
