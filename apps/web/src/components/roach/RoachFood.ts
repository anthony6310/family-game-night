import type { BufferGeometry } from 'three';
import { Model } from '../shelter/AnimalKit';

/**
 * The food on the floor in Roach Rumble: four kinds, all old and nasty, each a merged vertex-coloured model about 2.4 across (a roach cannot walk through it: FOOD_RADIUS 1.2), centred on the origin.
 * 0 spoiled bananas, 1 sprouting potatoes, 2 mouldy pizza, 3 a bowl of gravy with a skin on it. (Same order as FOOD_KINDS.)
 */
type Vec3 = [number, number, number];

function banana(m: Model, cx: number, cz: number, turn: number) {
  // an arc of short fat limbs, brown-yellow with black bruises, a dark stalk at one end and a dark tip at the other
  const pts: Vec3[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = turn + (i / 6) * 2.2 - 1.1;
    pts.push([cx + Math.cos(a) * 1.0, 0.24, cz + Math.sin(a) * 1.0]);
  }
  for (let i = 0; i < 6; i++) m.limb(i % 2 ? '#7d5b1a' : '#8a6a22', pts[i], pts[i + 1], 0.24);
  m.oval('#2b1d0a', [0.2, 0.18, 0.2], pts[0]); m.oval('#33270f', [0.16, 0.14, 0.16], pts[6]);
  for (const i of [1, 3, 4]) m.oval('#1b1006', [0.13, 0.05, 0.1], [pts[i][0], 0.46, pts[i][2]]); // bruises
  m.oval('#4a3a14', [0.1, 0.1, 0.1], [pts[5][0], 0.32, pts[5][2]]);
}
function potato(m: Model, x: number, z: number, s: number, rot: number) {
  m.oval('#8a683a', [0.62 * s, 0.46 * s, 0.5 * s], [x, 0.42 * s, z], [0, rot, 0]);
  m.lump('#7a5a30', [0.34 * s, 0.26 * s, 0.3 * s], [x + 0.28 * s, 0.6 * s, z - 0.12 * s]);
  m.oval('#3b2a14', [0.2 * s, 0.1 * s, 0.16 * s], [x - 0.18 * s, 0.72 * s, z + 0.1 * s]); // a rotten spot
  for (const [dx, dz] of [[0.1, 0.22], [-0.3, -0.05], [0.34, 0.1]]) m.limb('#a9b96e', [x + dx * s, 0.74 * s, z + dz * s], [x + dx * s * 1.4, 1.2 * s, z + dz * s * 1.3], 0.045); // long pale sprouts
}
function pizza(m: Model) {
  m.cyl('#b8742c', 1.15, 0.16, [0, 0.1, 0]); // the crust
  m.cyl('#d4a03c', 0.98, 0.14, [0, 0.2, 0]); // the cheese, gone hard
  for (const [x, z] of [[0.4, 0.3], [-0.45, 0.2], [0.05, -0.5], [-0.2, 0.62], [0.6, -0.3]]) m.cyl('#74281d', 0.2, 0.07, [x, 0.3, z]);
  for (const [x, z, r] of [[-0.1, 0.1, 0.22], [0.5, 0.6, 0.15], [-0.6, -0.4, 0.2], [0.25, -0.1, 0.12]]) m.oval('#6d8f3a', [r, 0.05, r * 0.8], [x, 0.3, z]); // mould
  m.oval('#3a2610', [0.5, 0.04, 0.12], [0.7, 0.3, -0.1], [0, 0.6, 0]); // burnt
}
function gravy(m: Model) {
  m.cyl('#d6cfbc', 1.0, 0.55, [0, 0.28, 0], [0, 0, 0], 0.72); // a dirty white bowl
  m.cyl('#5a3a1c', 0.86, 0.06, [0, 0.54, 0]); // the gravy
  m.oval('#7b5628', [0.45, 0.04, 0.3], [0.2, 0.6, -0.1]); // the skin, wrinkled
  m.oval('#6a4820', [0.25, 0.04, 0.4], [-0.35, 0.6, 0.15]);
  m.oval('#7f9a55', [0.16, 0.05, 0.14], [-0.1, 0.62, -0.4]); // a patch of mould
  m.limb('#5a3a1c', [0.8, 0.5, 0.2], [0.95, 0.15, 0.3], 0.07); // a drip down the side
}

export function buildFood(kind: number): BufferGeometry {
  const m = new Model();
  if (kind === 0) { banana(m, 0, 0, 0.3); banana(m, 0.1, 0.35, 0.9); }
  else if (kind === 1) { potato(m, -0.35, 0.2, 1, 0.4); potato(m, 0.45, -0.2, 0.85, 1.4); potato(m, 0.1, 0.6, 0.6, 2.2); }
  else if (kind === 2) pizza(m);
  else gravy(m);
  return m.build();
}
