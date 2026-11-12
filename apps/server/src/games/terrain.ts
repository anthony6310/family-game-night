import type { TerrainFeature } from '@fgn/shared';

/**
 * Picking a random layout for a Snowball round: ONE big hill, ONE small hill and ONE ditch, always,
 * at random spots that then never change during the round.
 */
export interface FeatureSpec {
  id: string;
  radius: number; // footprint
  height: number; // negative = ditch
}

/** The three features, in the order they are placed (the biggest and most constrained first). */
export const DEFAULT_FEATURE_SPECS: readonly FeatureSpec[] = [
  { id: 'big-hill', radius: 22, height: 6 },
  { id: 'small-hill', radius: 12, height: 2.8 },
  { id: 'ditch', radius: 10, height: -2.4 },
];

export interface Point {
  x: number;
  z: number;
}

/** Where players start: evenly around a ring inside the arena. */
export function spawnPoints(count: number, arenaRadius: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return { x: Math.cos(angle) * arenaRadius * 0.7, z: Math.sin(angle) * arenaRadius * 0.7 };
  });
}

/** A small deterministic random number generator (0 <= n < 1), so layouts can be reproduced in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutOptions {
  arenaRadius: number;
  spawns: Point[]; // every player's starting spot
  specs?: readonly FeatureSpec[];
  /** Keep this much flat ground around every spawn point (beyond the feature's own footprint). */
  spawnClearance?: number;
  /** Two features' centres should be at least this fraction of (r1 + r2) apart: 1 = no overlap at all. */
  separation?: number;
  attempts?: number;
}

/**
 * Random placement by trying lots of spots:
 *  - a feature always lies completely inside the arena;
 *  - HARD rule: nobody starts on a slope, so no spawn point may touch a feature's footprint (with a little
 *    margin when possible);
 *  - SOFT rule: features shouldn't pile on top of each other. If the arena is too crowded (8 players leave
 *    little free ground), the least-overlapping spot that still keeps every spawn flat is used.
 * Given the same random numbers it always returns the same layout.
 */
export function generateTerrainFeatures(random: () => number, options: LayoutOptions): TerrainFeature[] {
  const { arenaRadius, spawns, specs = DEFAULT_FEATURE_SPECS, spawnClearance = 1.5, separation = 0.5, attempts = 400 } = options;
  const placed: TerrainFeature[] = [];

  for (const spec of specs) {
    // Try with the clearance margin first, then with none (just outside the footprint).
    for (const margin of [spawnClearance, 0]) {
      let best: { x: number; z: number; ratio: number } | null = null;
      let chosen: { x: number; z: number } | null = null;
      for (let i = 0; i < attempts && !chosen; i++) {
        const angle = random() * 2 * Math.PI;
        const distance = Math.sqrt(random()) * (arenaRadius - spec.radius); // uniform over the allowed disc
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        if (spawns.some((s) => Math.hypot(s.x - x, s.z - z) < spec.radius + margin)) continue; // would sit on a start spot
        // How far from the other features, as a fraction of their combined radii (bigger = more apart).
        const ratio = Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - x, p.z - z) / (p.radius + spec.radius)));
        if (ratio >= separation) chosen = { x, z };
        else if (!best || ratio > best.ratio) best = { x, z, ratio };
      }
      const spot = chosen ?? best;
      if (spot) {
        placed.push({ id: spec.id, x: round(spot.x), z: round(spot.z), radius: spec.radius, height: spec.height });
        break;
      }
      if (margin === 0) {
        // Practically impossible, but never fail: put it as far from every spawn as the arena allows.
        placed.push({ id: spec.id, x: 0, z: 0, radius: spec.radius, height: spec.height });
      }
    }
  }
  return placed;
}

const round = (n: number) => Math.round(n * 100) / 100;
