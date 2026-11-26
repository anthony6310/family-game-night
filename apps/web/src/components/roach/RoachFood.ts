import type { BufferGeometry } from 'three';
import { Model } from '../shelter/AnimalKit';

/**
 * The food on the floor in Roach Rumble: four kinds, all old and nasty, each a merged vertex-coloured model about 2.4 across, centred on the origin (the scene draws them FOOD_SCALE bigger; the solid disc and the eating reach
 * are scaled the same). 0 a heap of spoiled banana peels with a black banana on top, 1 three sprouting potatoes with long stringy sprouts, 2 a mouldy pizza, 3 a bowl of gravy with a skin on it. (Same order as FOOD_KINDS.)
 */
type P = [number, number, number];

interface BananaOpts { peel?: [string, string]; ridge?: string; spots?: number; squash?: number; thin?: boolean; lift?: number; pale?: string }
/**
 * The banana from the sketch: a plump crescent lying on its side, widest in the middle and tapering at both ends, with a small square stem at one end, a dark nub at the other and a ridge running down the inside curve.
 * It is built from a row of overlapping balls whose size follows the curve (so it is smooth, not a stack of discs). (x, z) is where the stem is; `rot` turns it; `s` scales it.
 */
function banana(m: Model, x: number, z: number, rot: number, s = 1, o: BananaOpts = {}) {
  const N = 30, R = 1.2, a0 = -1.0, a1 = 0.95, peel = o.peel ?? ['#70531a', '#5a4210'], thick = o.thin ? 0.42 : 1;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const loc = (t: number): [number, number] => { const a = a0 + (a1 - a0) * t; return [Math.sin(a) * R - Math.sin(a0) * R, (1 - Math.cos(a)) * R - (1 - Math.cos(a0)) * R]; };
  const rad = (t: number) => s * (0.07 + 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.7));
  const at = (t: number, up = 0, side = 0): P => { const [lx, lz] = loc(t); const [tx, tz] = loc(Math.min(1, t + 0.01)); const [ux, uz] = loc(Math.max(0, t - 0.01)); const dx = tx - ux, dz = tz - uz, d = Math.hypot(dx, dz) || 1; const nx = -dz / d, nz = dx / d; const px = lx + nx * side, pz = lz + nz * side; return [x + px * cs - pz * sn, rad(t) * thick * 0.9 + (o.lift ?? 0) + up, z + px * sn + pz * cs]; };
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = rad(t), sq = o.squash ? 1 - o.squash * Math.exp(-Math.pow((t - 0.5) / 0.22, 2)) : 1;
    const p = at(t); m.oval(peel[i % 3 === 0 ? 1 : 0], [r, r * thick * sq, r], [p[0], p[1] * (sq < 1 ? 0.6 + 0.4 * sq : 1), p[2]]);
  }
  for (let i = 3; i < N - 2; i += 2) { const t = i / N, r = rad(t); const p = at(t, r * thick * 0.55, r * 0.55); m.oval(o.ridge ?? '#3a2a0c', [r * 0.2, r * 0.13, r * 0.2], p); } // the ridge down the inside curve
  for (let k = 0; k < (o.spots ?? 5); k++) { const t = 0.12 + ((k * 0.37 + 0.1) % 0.76), r = rad(t); const p = at(t, r * thick * 0.78, (((k * 7) % 5) - 2) * r * 0.2); m.oval('#150c04', [r * 0.32, r * 0.1, r * 0.26], p); } // black bruises
  const p0 = at(0), p1 = at(1), q0 = at(0.03);
  const stemEnd: P = [p0[0] + (p0[0] - q0[0]) * 6, p0[1] + 0.32 * s, p0[2] + (p0[2] - q0[2]) * 6];
  m.limb('#3a2a0e', p0, stemEnd, 0.13 * s); m.box('#2a1e08', [0.22 * s, 0.14 * s, 0.22 * s], stemEnd, [0, rot, 0]); // the small square stem
  const tipEnd: P = [p1[0] + (p1[0] - at(0.97)[0]) * 5, p1[1] - 0.02, p1[2] + (p1[2] - at(0.97)[2]) * 5];
  m.limb('#1f1608', p1, tipEnd, 0.09 * s); m.oval('#1f1608', [0.1 * s, 0.09 * s, 0.1 * s], tipEnd); // the dark nub at the other end
  return { stem: p0, tip: p1 };
}
/** c: a heap of peels: three empty, flattened skins of the same shape, one black banana lying across them. */
function bananaModel(m: Model) {
  banana(m, -1.2, -0.2, 0.2, 1.0, { thin: true, spots: 3, peel: ['#7a5a1c', '#5e4514'] });
  banana(m, -1.0, 0.4, -0.5, 0.95, { thin: true, spots: 4, lift: 0.12, peel: ['#6d4f1d', '#563f12'] });
  banana(m, -1.1, 0.1, 0.9, 0.9, { thin: true, spots: 2, lift: 0.22, peel: ['#7d5d20', '#614816'] });
  banana(m, -0.9, 0.2, 0.05, 0.85, { spots: 8, lift: 0.4, peel: ['#2a1e0a', '#1c1406'], ridge: '#0d0802' }); // the black one on top
  for (const [x, y, z] of [[0.2, 1.3, 0.3], [-0.5, 1.1, 0.1]] as P[]) m.oval('#1a1a1a', [0.05, 0.04, 0.05], [x, y, z]);
}

/** A sprout: a long thin string that wanders and curls (many short wobbling segments, getting thinner), no blobs. */
const sprout = (m: Model, x: number, y: number, z: number, dir: P, len: number, c = '#cfd68a', seed = 0) => {
  const n = 10, pts: P[] = [[x, y, z]];
  let px = x, py = y, pz = z;
  for (let i = 1; i <= n; i++) {
    const k = i / n, w = 0.2 + k * 0.5;
    px += (dir[0] * len) / n + Math.sin(i * 1.9 + seed * 2.3) * 0.09 * w; pz += (dir[2] * len) / n + Math.cos(i * 1.4 + seed * 1.7) * 0.09 * w;
    py += (dir[1] * len) / n * (1 - k * 0.7) - k * k * 0.05 * len / 2; // rises, then flops over
    pts.push([px, py, pz]);
  }
  for (let i = 0; i < n; i++) m.limb(i > n - 3 ? '#e4e8a8' : c, pts[i], pts[i + 1], 0.034 - (i / n) * 0.02);
};
/** a: three sprouting potatoes in a heap, long pale sprouts, a rotten spot on each. */
function potatoModel(m: Model) {
  let seed = 0;
  for (const [x, z, sc, r] of [[-0.35, 0.2, 1, 0.4], [0.45, -0.2, 0.85, 1.4], [0.1, 0.6, 0.62, 2.2]] as [number, number, number, number][]) {
    m.oval('#8a683a', [0.62 * sc, 0.46 * sc, 0.5 * sc], [x, 0.42 * sc, z], [0, r, 0]); m.lump('#7a5a30', [0.34 * sc, 0.26 * sc, 0.3 * sc], [x + 0.28 * sc, 0.6 * sc, z - 0.12 * sc]);
    m.oval('#3b2a14', [0.2 * sc, 0.1 * sc, 0.16 * sc], [x - 0.18 * sc, 0.72 * sc, z + 0.1 * sc]);
    for (const [dx, dz] of [[0.1, 0.22], [-0.3, -0.05], [0.34, 0.1], [-0.1, -0.3], [0.2, -0.2]]) sprout(m, x + dx * sc, 0.74 * sc, z + dz * sc, [dx * 1.1, 1, dz * 1.1], 1.7 * sc, '#cfd68a', seed++);
  }
}
const mould = (m: Model, x: number, y: number, z: number, r: number) => { m.lump('#7fa04a', [r, r * 0.6, r], [x, y, z]); m.lump('#b9d77a', [r * 0.6, r * 0.4, r * 0.6], [x + r * 0.2, y + r * 0.35, z]); m.oval('#3f6a8a', [r * 0.4, r * 0.3, r * 0.4], [x - r * 0.3, y + r * 0.2, z + r * 0.2]); };
/** a: a whole pizza gone off: hard cheese, shrivelled toppings, patches of green and blue mould, a burnt edge. */
function pizzaModel(m: Model) {
  m.cyl('#b8742c', 1.15, 0.16, [0, 0.1, 0]); m.cyl('#d4a03c', 0.98, 0.14, [0, 0.2, 0]);
  for (const [x, z] of [[0.4, 0.3], [-0.45, 0.2], [0.05, -0.5], [-0.2, 0.62], [0.6, -0.3]] as [number, number][]) m.cyl('#74281d', 0.2, 0.07, [x, 0.3, z]);
  for (const [x, z, r] of [[-0.1, 0.1, 0.22], [0.5, 0.6, 0.15], [-0.6, -0.4, 0.2], [0.25, -0.1, 0.12]] as P[]) mould(m, x, 0.32, z, r);
  m.oval('#3a2610', [0.5, 0.04, 0.12], [0.7, 0.3, -0.1], [0, 0.6, 0]);
}
/** a: a dirty white bowl of cold gravy with a wrinkled skin, a patch of mould and a drip down the side. */
function gravyModel(m: Model) {
  m.cyl('#d6cfbc', 1.0, 0.55, [0, 0.28, 0], [0, 0, 0], 0.72); m.cyl('#5a3a1c', 0.86, 0.06, [0, 0.54, 0]);
  m.oval('#7b5628', [0.45, 0.04, 0.3], [0.2, 0.6, -0.1]); m.oval('#6a4820', [0.25, 0.04, 0.4], [-0.35, 0.6, 0.15]); m.oval('#7f9a55', [0.16, 0.05, 0.14], [-0.1, 0.62, -0.4]);
  m.limb('#5a3a1c', [0.8, 0.5, 0.2], [0.95, 0.15, 0.3], 0.07);
}

export function buildFood(kind: number): BufferGeometry {
  const m = new Model();
  if (kind === 0) bananaModel(m); else if (kind === 1) potatoModel(m); else if (kind === 2) pizzaModel(m); else gravyModel(m);
  return m.build();
}
