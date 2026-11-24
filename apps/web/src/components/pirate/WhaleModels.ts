import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Model } from '../shelter/AnimalKit';

/**
 * Battle-torn whales for Broadside Battle (candidates). Every whale faces +z, belly down, centred on the origin; length ~28 units
 * (a ship is 34 long). The body is lofted from a few stations (width / top / bottom), flat-shaded with vertex colors, then fittings
 * (flippers, flukes, jaw, eye, harpoons, gashes) are baked in with the same `Model` baker the other games use.
 */
type Station = [t: number, w: number, top: number, bot: number];
interface Blob { t: number; a: number; r: number; color: string; k?: number } // a patch of scar tissue / barnacles at (t along, a around)
interface Gash { t: number; a: number; len: number; phi: number; wide?: number }
interface Harpoon { t: number; a: number; tilt: [number, number]; len?: number }
interface WhaleSpec {
  mouth?: { gape: number; reach: number }; // the lower jaw hinged open by `gape` at the nose, closing up `reach` (0..1 along the body) back
  name: string; length: number; stations: Station[]; back: string; belly: string; bellyFrom: number; // sin(a) below which it is the belly color
  exponent: number; blobs: Blob[]; gashes: Gash[]; harpoons: Harpoon[]; fittings: (m: Model, s: Surface, spec: WhaleSpec) => void;
}
export interface Surface { P: (t: number, a: number) => Vector3; N: (t: number, a: number) => Vector3; T: (t: number, a: number, phi: number) => Vector3; L: number }

const RING = 20;
const STEPS = 44;
const hex = (h: string) => { const m = new Model(); void m; const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);
const srgb = (c: number) => Math.pow(c, 2.2); // (the baker's colors are linear, so the hand-made body must match)

function profile(st: Station[], t: number): [number, number, number] {
  for (let i = 0; i < st.length - 1; i++) {
    if (t <= st[i + 1][0]) {
      const k = smooth((t - st[i][0]) / (st[i + 1][0] - st[i][0] || 1));
      return [lerp(st[i][1], st[i + 1][1], k), lerp(st[i][2], st[i + 1][2], k), lerp(st[i][3], st[i + 1][3], k)];
    }
  }
  const e = st[st.length - 1];
  return [e[1], e[2], e[3]];
}

function makeSurface(spec: WhaleSpec): Surface {
  const L = spec.length;
  const P = (t: number, a: number) => {
    const [w, top, bot] = profile(spec.stations, t);
    const c = Math.cos(a), s = Math.sin(a), e = 2 / spec.exponent;
    return new Vector3(w * Math.sign(c) * Math.abs(c) ** e, (s >= 0 ? top : bot) * Math.sign(s) * Math.abs(s) ** e, L * (0.5 - t));
  };
  const T = (t: number, a: number, phi: number) => {
    const et = P(t + 0.004, a).sub(P(t - 0.004, a)).normalize();
    const ea = P(t, a + 0.05).sub(P(t, a - 0.05)).normalize();
    return et.multiplyScalar(Math.cos(phi)).add(ea.multiplyScalar(Math.sin(phi))).normalize();
  };
  const N = (t: number, a: number) => {
    const et = P(t + 0.004, a).sub(P(t - 0.004, a)).normalize();
    const ea = P(t, a + 0.05).sub(P(t, a - 0.05)).normalize();
    const n = et.cross(ea).normalize();
    const p = P(t, a);
    if (n.dot(new Vector3(p.x, p.y, 0)) < 0) n.negate();
    return n;
  };
  return { P, N, T, L };
}

function jawDrop(spec: WhaleSpec, t: number) { const m = spec.mouth!; return t >= m.reach ? 0 : m.gape * smooth(1 - t / m.reach); }
function lowerSeamY(spec: WhaleSpec, S: Surface, t: number) { const g = spec.mouth!.gape, o = jawDrop(spec, t) / g; return lerp(0, S.P(t, -0.314).y - jawDrop(spec, t), o); }
function hash(i: number, j: number) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }

function loftBody(spec: WhaleSpec, S: Surface): BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const back = hex(spec.back).map(srgb), belly = hex(spec.belly).map(srgb);
  const blobs = spec.blobs.map((b) => ({ ...b, rgb: hex(b.color).map(srgb) }));
  const vertex = (t: number, a: number, i: number, j: number) => {
    const p = S.P(t, a);
    if (spec.mouth && Math.sin(a) < -0.02) p.y = (j === 4 || j === 16) ? lowerSeamY(spec, S, t) : p.y - jawDrop(spec, t);
    // belly fades in below the flank; every vertex is nudged a little so the skin looks rough and worn
    const k = smooth(Math.min(1, Math.max(0, (Math.sin(a) - spec.bellyFrom) / 0.5)));
    const n = 0.9 + hash(i, j) * 0.2;
    let c = [lerp(belly[0], back[0], k) * n, lerp(belly[1], back[1], k) * n, lerp(belly[2], back[2], k) * n];
    for (const b of blobs) {
      let da = Math.abs(a - b.a); da = Math.min(da, Math.PI * 2 - da);
      const d = Math.hypot((t - b.t) * S.L, da * 2.2) / b.r;
      if (d < 1) { const m = smooth(1 - d) * (b.k ?? 0.85) * (0.75 + hash(i + 3, j + 5) * 0.25); c = [lerp(c[0], b.rgb[0], m), lerp(c[1], b.rgb[1], m), lerp(c[2], b.rgb[2], m)]; }
    }
    return { p, c };
  };
  const push = (v: { p: Vector3; c: number[] }) => { pos.push(v.p.x, v.p.y, v.p.z); col.push(v.c[0], v.c[1], v.c[2]); };
  for (let i = 0; i < STEPS; i++) {
    const t0 = i / STEPS, t1 = (i + 1) / STEPS;
    for (let j = 0; j < RING; j++) {
      if (spec.mouth && t1 <= spec.mouth.reach + 1e-9 && (j === 4 || j === 15)) continue; // the mouth opening: a real hole
      const a0 = (j / RING) * Math.PI * 2 - Math.PI / 2, a1 = ((j + 1) / RING) * Math.PI * 2 - Math.PI / 2;
      const A = vertex(t0, a0, i, j), B = vertex(t0, a1, i, j + 1), C = vertex(t1, a1, i + 1, j + 1), D = vertex(t1, a0, i + 1, j);
      push(A); push(B); push(C); push(A); push(C); push(D);
    }
  }
  for (const [t, flip] of [[0, false], [1, true]] as const) { // end caps
    const mid = S.P(t, 0); mid.x = 0; mid.y = (S.P(t, Math.PI / 2).y + S.P(t, -Math.PI / 2).y) / 2 - (spec.mouth && t === 0 ? spec.mouth.gape * 0.5 : 0);
    for (let j = 0; j < RING; j++) {
      if (spec.mouth && t === 0 && (j === 4 || j === 15)) continue;
      const a0 = (j / RING) * Math.PI * 2 - Math.PI / 2, a1 = ((j + 1) / RING) * Math.PI * 2 - Math.PI / 2;
      const A = vertex(t, a0, 99, j), B = vertex(t, a1, 99, j + 1);
      let at = mid;
      if (spec.mouth && t === 0) { // each jaw gets its own middle point, so the open mouth has no spike across it
        const lower = j <= 3 || j >= 16;
        at = mid.clone(); at.y = lower ? (lowerSeamY(spec, S, 0) + S.P(0, -Math.PI / 2).y - spec.mouth.gape) / 2 : S.P(0, Math.PI / 2).y / 2;
      }
      const M = { p: at, c: A.c };
      if (flip) { push(A); push(B); push(M); } else { push(B); push(A); push(M); }
    }
  }
  if (spec.mouth) { // the roof and the floor of the open mouth: flat strips, with nothing between them (you can see straight through the gap)
    const inside = hex('#d46f7c').map(srgb);
    const strip = (f: (t: number) => Vector3[]) => {
      for (let i = 0; i < STEPS; i++) {
        const t0 = i / STEPS, t1 = (i + 1) / STEPS;
        if (t1 > spec.mouth!.reach + 1e-9) break;
        const [a, b] = f(t0), [c, d] = f(t1);
        for (const v of [a, b, c, a, c, d]) { pos.push(v.x, v.y, v.z); col.push(inside[0], inside[1], inside[2]); }
      }
    };
    strip((t) => { const q = S.P(t, -0.314); return [new Vector3(-q.x, lowerSeamY(spec, S, t), q.z), new Vector3(q.x, lowerSeamY(spec, S, t), q.z)]; });
    strip((t) => { const x = S.P(t, 0).x, z = S.P(t, 0).z; return [new Vector3(-x, 0, z), new Vector3(x, 0, z)]; });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---- fitting helpers: a flat or thin part with x along `along`, thickness along `up` (made square to it)
function plate(m: Model, kind: 'oval' | 'box', color: string, c: Vector3, along: Vector3, up: Vector3, size: [number, number, number]) {
  const x = along.clone().normalize();
  const y = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  const z = x.clone().cross(y);
  const e = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z), 'YXZ');
  m[kind](color, size, [c.x, c.y, c.z], [e.x, e.y, e.z]);
}
function gash(m: Model, S: Surface, g0: Gash) {
  const g = { ...g0, len: g0.len * 1.5, wide: (g0.wide ?? 0.34) * 1.8 };
  const p = S.P(g.t, g.a), n = S.N(g.t, g.a), d = S.T(g.t, g.a, g.phi);
  plate(m, 'box', '#cdb9ad', p.clone().addScaledVector(n, 0.03), d, n, [g.len, 0.12, g.wide ?? 0.34]);
  plate(m, 'box', '#5a2222', p.clone().addScaledVector(n, 0.07), d, n, [g.len * 0.92, 0.1, (g.wide ?? 0.34) * 0.45]);
  for (const k of [] as number[]) { // stitches of torn skin crossing the cut
    const q = p.clone().addScaledVector(d, k * g.len).addScaledVector(n, 0.06);
    const side = d.clone().cross(n).normalize();
    plate(m, 'box', '#cdb9ad', q, side, n, [(g.wide ?? 0.34) * 1.9, 0.08, 0.07]);
  }
}
function harpoon(m: Model, S: Surface, h: Harpoon) {
  const p = S.P(h.t, h.a), n = S.N(h.t, h.a);
  const dir = n.clone().add(new Vector3(h.tilt[0], h.tilt[1], 0)).normalize();
  const len = h.len ?? 3.4;
  const base = p.clone().addScaledVector(dir, -0.5), tip = p.clone().addScaledVector(dir, len);
  limbV(m, '#6b4a2a', base, tip, 0.17); // wooden shaft
  limbV(m, '#3c3f45', base, p.clone().addScaledVector(dir, 0.55), 0.26); // iron head, buried
  plate(m, 'oval', '#3c3f45', p.clone().addScaledVector(dir, 0.1), dir.clone().cross(new Vector3(0, 1, 0)).normalize(), dir, [0.5, 0.06, 0.2]); // barb
  m.oval('#6b4a2a', [0.26, 0.26, 0.26], [tip.x, tip.y, tip.z]); // knob at the butt
}
const limbV = (m: Model, c: string, a: Vector3, b: Vector3, r: number) => m.limb(c, [a.x, a.y, a.z], [b.x, b.y, b.z], r);
const mirror = (v: Vector3) => new Vector3(-v.x, v.y, v.z);
const both = (f: (side: 1 | -1) => void) => { f(1); f(-1); };
function eye(m: Model, S: Surface, t: number, a: number) {
  both((s) => {
    const aa = s === 1 ? a : Math.PI - a;
    const p = S.P(t, aa), n = S.N(t, aa);
    m.oval('#e8e2d0', [0.34, 0.34, 0.34], [p.x, p.y, p.z]);
    const q = p.clone().addScaledVector(n, 0.14);
    m.oval('#0c0c10', [0.2, 0.2, 0.2], [q.x, q.y, q.z]);
  });
}
function flipper(m: Model, S: Surface, color: string, under: string, t: number, a: number, dir: Vector3, length: number, width: number) {
  both((s) => {
    const aa = s === 1 ? a : Math.PI - a;
    const root = S.P(t, aa).add(new Vector3(0, 0, 0)), d = new Vector3(dir.x * s, dir.y, dir.z).normalize();
    const mid = root.clone().addScaledVector(d, length * 0.5);
    plate(m, 'oval', color, mid, d, new Vector3(0, 1, 0), [length * 0.5, 0.2, width]);
    plate(m, 'oval', under, mid.clone().add(new Vector3(0, -0.12, 0)), d, new Vector3(0, 1, 0), [length * 0.46, 0.14, width * 0.85]);
  });
}
function flukes(m: Model, S: Surface, color: string, under: string, span: number, chord: number, scallops = false) {
  const root = S.P(1, 0); root.x = 0; root.y = (S.P(1, Math.PI / 2).y + S.P(1, -Math.PI / 2).y) / 2;
  m.oval(color, [0.7, 0.55, 1.4], [root.x, root.y, root.z - 0.5]);
  both((s) => {
    const d = new Vector3(s * 1, 0.04, -0.5).normalize();
    const mid = root.clone().add(new Vector3(0, 0, -0.9)).addScaledVector(d, span * 0.5);
    plate(m, 'oval', color, mid, d, new Vector3(0, 1, 0), [span * 0.5, 0.22, chord]);
    plate(m, 'oval', under, mid.clone().add(new Vector3(0, -0.14, 0)), d, new Vector3(0, 1, 0), [span * 0.46, 0.16, chord * 0.8]);
    if (scallops) for (let i = 1; i <= 4; i++) { const q = root.clone().add(new Vector3(s * span * (i / 4.6) * 0.92, 0, -0.9 - span * (i / 4.6) * 0.5 - chord * 0.9)); m.lump(color, [0.4, 0.2, 0.34], [q.x, q.y, q.z]); }
  });
}
export function mouthLine(m: Model, S: Surface, color: string, pts: [number, number][], r = 0.1) {
  both((s) => {
    let prev: Vector3 | null = null;
    for (const [t, a] of pts) {
      const p = S.P(t, s === 1 ? a : Math.PI - a); p.addScaledVector(S.N(t, s === 1 ? a : Math.PI - a), 0.04);
      if (prev) limbV(m, color, prev, p, r);
      prev = p;
    }
  });
}

// ================================================================ the three whales
const SPERM: WhaleSpec = {
  name: 'A  Old Ironjaw (sperm whale)', length: 30, back: '#35323a', belly: '#6a666d', bellyFrom: -0.15, exponent: 2.5,
  stations: [[0, 2.3, 3.5, 2.3], [0.04, 2.9, 3.9, 2.7], [0.22, 3.3, 4.2, 3.0], [0.45, 3.1, 3.6, 2.8], [0.68, 2.0, 2.3, 1.9], [0.86, 1.0, 1.1, 1.0], [1, 0.45, 0.55, 0.5]],
  blobs: [
    { t: 0.3, a: 0.2, r: 3, color: '#8d8681', k: 0.7 }, { t: 0.55, a: 2.7, r: 2.6, color: '#8d8681', k: 0.7 }, { t: 0.15, a: 1.6, r: 2.4, color: '#7d7570', k: 0.6 },
    { t: 0.62, a: 0.4, r: 2, color: '#8d8681', k: 0.6 }, { t: 0.4, a: 3.4, r: 3.2, color: '#7a736e', k: 0.6 },
  ],
  gashes: [
    { t: 0.3, a: 0.5, len: 3.4, phi: 0.5 }, { t: 0.33, a: 0.28, len: 2.8, phi: 0.45 }, { t: 0.36, a: 0.05, len: 3.0, phi: 0.5 }, // three claw rakes
    { t: 0.12, a: 1.0, len: 2.2, phi: 1.1 }, { t: 0.55, a: 2.6, len: 3.2, phi: 0.3 }, { t: 0.58, a: 2.45, len: 2.4, phi: 0.4 }, { t: 0.7, a: 0.7, len: 2.0, phi: -0.4 }, { t: 0.46, a: 1.2, len: 3.5, phi: 0.2 },
  ],
  harpoons: [{ t: 0.28, a: 1.15, tilt: [0.5, 0.5] }, { t: 0.4, a: 0.75, tilt: [0.7, 0.3] }, { t: 0.5, a: 1.35, tilt: [-0.3, 0.6] }, { t: 0.62, a: 1.0, tilt: [0.4, 0.4], len: 3 }, { t: 0.2, a: 2.2, tilt: [-0.6, 0.5], len: 3.2 }, { t: 0.45, a: 2.1, tilt: [-0.7, 0.4] }],
  fittings(m, S) {
    // the long narrow lower jaw hung under the blunt head, with a row of teeth
    limbV(m, '#8d878a', new Vector3(0, -2.2, S.L * 0.5 - 1.0), new Vector3(0, -2.9, S.L * 0.5 - 8.8), 0.9);
    m.oval('#8d878a', [0.8, 0.55, 3.8], [0, -2.55, S.L * 0.5 - 4.8]);
    both((s) => { for (let i = 0; i < 9; i++) { const z = S.L * 0.5 - 1.3 - i * 0.75; m.cone('#efe9d8', 0.13, 0.55, [s * 0.5, -2.05 - i * 0.06, z], [0, 0, Math.PI]); } });
    mouthLine(m, S, '#17161a', [[0.0, -0.42], [0.06, -0.45], [0.16, -0.38], [0.26, -0.3]], 0.12);
    eye(m, S, 0.1, -0.12);
    m.cone('#2c2a31', 1.0, 3.1, [0, S.P(0.58, Math.PI / 2).y + 0.9, S.P(0.58, 0).z], [-0.4, 0, 0]); // the knuckle of the back
    for (let i = 0; i < 6; i++) { const t = 0.64 + i * 0.045; const p = S.P(t, Math.PI / 2); m.lump('#2c2a31', [0.5, 0.45, 0.7], [0, p.y + 0.15, p.z]); }
    // the blow hole, off to the left of the nose
    m.lump('#1a191e', [0.5, 0.25, 0.7], [-0.9, S.P(0.03, Math.PI / 2).y + 0.1, S.P(0.03, 0).z - 0.4]);
    flipper(m, S, '#35323a', '#5e5a62', 0.2, -0.55, new Vector3(1, -0.55, -0.35), 3.0, 0.95);
    flukes(m, S, '#35323a', '#6a666d', 7, 1.8);
  },
};

const HUMPBACK: WhaleSpec = {
  name: 'B  Scarback (humpback)', length: 30, back: '#1c2433', belly: '#dcd8cc', bellyFrom: -0.6, exponent: 2.4,
  stations: [[0, 0.5, 0.5, 0.45], [0.03, 1.5, 1.2, 1.1], [0.14, 2.3, 1.8, 1.7], [0.34, 3.1, 2.8, 2.8], [0.5, 3.2, 3.1, 3.0], [0.7, 2.0, 2.0, 1.9], [0.88, 0.9, 1.0, 0.9], [1, 0.4, 0.5, 0.45]],
  blobs: [
    { t: 0.12, a: 1.1, r: 2.2, color: '#4f4f58', k: 0.7 }, { t: 0.32, a: 0.35, r: 3.6, color: '#3a404f', k: 0.8 }, { t: 0.6, a: 2.5, r: 3, color: '#3a404f', k: 0.8 },
    { t: 0.45, a: 3.3, r: 3.2, color: '#6e717a', k: 0.55 }, { t: 0.8, a: 0.8, r: 2, color: '#4f4f58', k: 0.7 }, { t: 0.5, a: -0.6, r: 3.5, color: '#9a98a0', k: 0.6 },
  ],
  gashes: [
    { t: 0.4, a: 0.7, len: 4.2, phi: 0.2 }, { t: 0.43, a: 0.55, len: 3.6, phi: 0.25 }, { t: 0.46, a: 0.4, len: 3.8, phi: 0.2 }, { t: 0.49, a: 0.25, len: 3.0, phi: 0.3 },
    { t: 0.62, a: 2.4, len: 3.8, phi: -0.5 }, { t: 0.2, a: 2.5, len: 2.4, phi: 0.9 }, { t: 0.7, a: 1.0, len: 2.4, phi: 0.7 }, { t: 0.3, a: 3.0, len: 3.0, phi: 0.1 },
  ],
  harpoons: [{ t: 0.36, a: 1.2, tilt: [0.5, 0.45] }, { t: 0.5, a: 0.9, tilt: [0.6, 0.4] }, { t: 0.56, a: 1.4, tilt: [-0.2, 0.6] }, { t: 0.42, a: 2.0, tilt: [-0.6, 0.5] }, { t: 0.66, a: 2.3, tilt: [-0.5, 0.5], len: 3 }],
  fittings(m, S) {
    mouthLine(m, S, '#0e1118', [[0.0, -0.3], [0.05, -0.34], [0.14, -0.32], [0.24, -0.15], [0.3, 0.0]], 0.13);
    eye(m, S, 0.2, -0.05);
    // the knobs along the snout and jaw
    for (let i = 0; i < 9; i++) { const t = 0.02 + i * 0.015; const p = S.P(t, Math.PI / 2 - 0.02); m.lump('#7a7783', [0.22, 0.2, 0.22], [0, p.y + 0.08, p.z]); }
    both((s) => { for (let i = 0; i < 6; i++) { const aa = s === 1 ? 0.12 : Math.PI - 0.12; const p = S.P(0.03 + i * 0.022, aa - 0.2); m.lump('#7a7783', [0.18, 0.18, 0.18], [p.x, p.y, p.z]); } });
    // the pale throat grooves
    for (const a of [-1.1, -1.3, -1.5, -1.7, -1.9]) { const pts: Vector3[] = []; for (let i = 0; i <= 8; i++) pts.push(S.P(0.06 + i * 0.035, a)); for (let i = 0; i < 8; i++) limbV(m, '#b3b0a8', pts[i], pts[i + 1], 0.06); }
    // the humped dorsal fin
    const dp = S.P(0.66, Math.PI / 2);
    m.lump('#1c2433', [0.7, 1.1, 1.2], [0, dp.y + 0.4, dp.z]);
    m.cone('#1c2433', 0.45, 1.2, [0, dp.y + 1.3, dp.z - 0.2], [-0.6, 0, 0]);
    flipper(m, S, '#1c2433', '#e5e2d8', 0.27, -0.6, new Vector3(1, -0.45, -0.6), 8.4, 1.15);
    both((s) => { for (let i = 0; i < 5; i++) { const p = new Vector3(s * (1.8 + i * 1.3), -1.5 - i * 0.55, S.L * 0.5 - 8.0 - i * 1.5); m.lump('#8a8791', [0.22, 0.2, 0.22], [p.x, p.y, p.z]); } }); // leading-edge knobs
    flukes(m, S, '#1c2433', '#e9e6dc', 8.2, 2.3, true);
  },
};

const RIGHT: WhaleSpec = {
  name: 'C  Barnacle King (right whale)', length: 28, mouth: { gape: 1.6, reach: 0.3 }, back: '#17402f', belly: '#2d5a45', bellyFrom: -0.5, exponent: 2.2,
  stations: [[0, 1.7, 2.1, 1.6], [0.04, 2.5, 3.0, 2.3], [0.18, 3.2, 3.9, 2.9], [0.4, 4.3, 4.4, 3.9], [0.55, 4.2, 4.2, 3.7], [0.75, 2.6, 2.7, 2.4], [0.9, 1.1, 1.2, 1.1], [1, 0.5, 0.6, 0.6]],
  blobs: [
    { t: 0.07, a: 1.5, r: 1.8, color: '#d8cfb4', k: 0.95 }, { t: 0.14, a: 0.9, r: 1.3, color: '#d8cfb4', k: 0.95 }, { t: 0.14, a: 2.25, r: 1.3, color: '#d8cfb4', k: 0.95 },
    { t: 0.05, a: -0.5, r: 1.8, color: '#e6e2d4', k: 0.9 }, { t: 0.3, a: 0.4, r: 3.4, color: '#2b5e46', k: 0.8 }, { t: 0.5, a: 2.4, r: 3.4, color: '#2b5e46', k: 0.8 },
    { t: 0.62, a: 0.6, r: 2.4, color: '#4f8068', k: 0.55 }, { t: 0.35, a: 3.6, r: 3.2, color: '#4f8068', k: 0.55 },
  ],
  gashes: [],
  harpoons: [{ t: 0.4, a: 1.0, tilt: [0.5, 0.4] }],
  fittings(m, S, spec) {
    // the great jaw, with a pale chin patch and the baleen showing as a dark fringe
    // rounded teeth along both lips, the upper ones hanging down and the lower ones standing up
    both((sd) => {
      for (let i = 0; i < 17; i++) {
        const t = 0.01 + i * 0.0145;
        const up = S.P(t, sd === 1 ? 0.0 : Math.PI); // the upper lip edge (the side of the head, at its middle)
        const lo = S.P(t, sd === 1 ? -0.314 : Math.PI + 0.314); lo.y = lowerSeamY(spec, S, t);
        up.x *= 0.9; lo.x *= 0.9;
        m.oval('#ece5cf', [0.17, 0.3, 0.17], [up.x, up.y - 0.1, up.z]);
        m.oval('#ece5cf', [0.17, 0.28, 0.17], [lo.x, lo.y + 0.1, lo.z]);
      }
    });
    { // the blow hole: a low rim with a dark hole in it, on top of the head
      const b = S.P(0.2, Math.PI / 2);
      m.lump('#1d4a37', [0.6, 0.12, 0.45], [0, b.y + 0.01, b.z]);
      m.oval('#050a08', [0.4, 0.1, 0.28], [0, b.y + 0.09, b.z]);
    }
    eye(m, S, 0.28, 0.02);
    // callosities: cream crusted bumps on the head
    for (const [t, a, r] of [[0.05, 1.45, 0.5], [0.09, 1.6, 0.42], [0.12, 1.3, 0.38], ] as const) { const p = S.P(t, a); m.lump('#d8cfb4', [r, r * 0.55, r], [p.x, p.y + 0.1, p.z]); }
    both((s) => { for (let i = 0; i < 6; i++) { const aa = s === 1 ? 0.55 + i * 0.07 : Math.PI - (0.55 + i * 0.07); const p = S.P(0.07 + i * 0.015, aa); m.lump('#d8cfb4', [0.24, 0.16, 0.24], [p.x, p.y, p.z]); } });
    both((s) => { for (let i = 0; i < 8; i++) { const aa = s === 1 ? 0.2 + (i % 3) * 0.12 : Math.PI - (0.2 + (i % 3) * 0.12); const p = S.P(0.28 + i * 0.05, aa); m.lump('#c9c1a6', [0.2, 0.15, 0.2], [p.x, p.y, p.z]); } }); // barnacles on the flanks
    flipper(m, S, '#17402f', '#2d5a45', 0.3, -0.6, new Vector3(1, -0.6, -0.3), 4.2, 2.1);
    flukes(m, S, '#17402f', '#2d5a45', 7.5, 2.7);
  },
};

export const WHALES: WhaleSpec[] = [SPERM, HUMPBACK, RIGHT];

/** A whale built from its spec: body + fittings + gashes + harpoons, as ONE vertex-colored geometry. */
export function buildWhaleGeometry(spec: WhaleSpec): BufferGeometry {
  const S = makeSurface(spec);
  const body = loftBody(spec, S);
  const m = new Model();
  spec.fittings(m, S, spec);
  spec.gashes.forEach((g) => gash(m, S, g));
  spec.harpoons.forEach((h) => harpoon(m, S, h));
  void mirror;
  const parts = m.build();
  for (const g of [body, parts]) { g.deleteAttribute('uv'); }
  const merged = mergeGeometries([body.toNonIndexed(), parts.toNonIndexed()])!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Where things are on whale C's body (local coordinates) for the animations. */
export const whaleSurface = () => makeSurface(WHALES[2]);
