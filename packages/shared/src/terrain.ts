/**
 * The Snowball arena's hills and ditch. The server picks a random layout for every round (one big hill,
 * one small hill, one ditch) and sends it to the phones. This file is the ONE definition of what a
 * feature is and how it turns into ground height and slope: the server uses it for the physics (uphill
 * slows you, downhill speeds you up) and the phones use it to draw the ground, so what you see is
 * exactly what the physics feels.
 *
 * Every feature is a smooth round bump (a raised-cosine "dome") with a clear footprint: outside its
 * `radius` the ground is perfectly flat, and the slope eases to zero at both the top and the edge.
 * Positive `height` = hill, negative = ditch.
 */
export interface TerrainFeature {
  id: string;
  x: number; // centre, world units (x east, z south)
  z: number;
  radius: number; // footprint
  height: number;
}

/** Ground height and slope at a point. `gradient` points UPHILL: it is d(height)/dx and d(height)/dz. */
export interface Terrain {
  height(x: number, z: number): number;
  gradient(x: number, z: number): { x: number; z: number };
}

export function createTerrain(features: readonly TerrainFeature[]): Terrain {
  return {
    height(x, z) {
      let h = 0;
      for (const f of features) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.radius) h += f.height * 0.5 * (1 + Math.cos((Math.PI * d) / f.radius));
      }
      return h;
    },
    gradient(x, z) {
      let gx = 0;
      let gz = 0;
      for (const f of features) {
        const dx = x - f.x;
        const dz = z - f.z;
        const d = Math.hypot(dx, dz);
        if (d >= f.radius || d < 1e-9) continue; // flat outside the footprint and exactly at the centre
        // d(height)/d(distance from centre), then spread along the direction away from the centre.
        const slope = -f.height * 0.5 * (Math.PI / f.radius) * Math.sin((Math.PI * d) / f.radius);
        gx += (slope * dx) / d;
        gz += (slope * dz) / d;
      }
      return { x: gx, z: gz };
    },
  };
}
