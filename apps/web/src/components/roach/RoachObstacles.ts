import { Box3, Group, Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHOE_PAIR_GAP, type Prop, type Rect, type ShoePair } from '@fgn/shared';
import { Model } from '../shelter/AnimalKit';
import type { Piece } from './RoachKitchen';

/**
 * The things lying about on the kitchen floor in Roach Rumble: the checker-top bakery ISLANDS (red cabinets with chrome, a red and white checkered top, a bread box, a fruit bowl and a cake under a dome), the one straw
 * BROOM (a handle and a head that is all bristles) and the PAIRS OF SHOES (chunky sneakers or yellow rain boots, one of the pair kicked over). Each is one merged mesh with vertex colours and its own material, so the scene can fade
 * just the ones in a roach camera's way. A shoe pair's solid footprint is one capsule (see `ShoePair` in the shared code).
 */
type V3 = [number, number, number];
const CH = '#e4e9ed', RED = '#d4453f', DARK = '#173b31';

/** The islands, the table and the small obstacles are all drawn this much bigger than first modelled (and their solid footprints in the shared layout are scaled the same). */
const OBSTACLE_SCALE = 1.2;
/** The diner table with its chairs is drawn 1.44 times its modelled size (20%, then 20% more); its footprint in the shared layout (15 by 11.4) is the model's 10.4 by 7.9 scaled the same. */
const TABLE_SCALE = 1.44;
function piece(object: Group, geometry: BufferGeometry): Piece {
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  object.add(new Mesh(geometry, material));
  object.updateMatrixWorld(true);
  const b = new Box3().setFromObject(object);
  return { object, materials: [material], geometries: [geometry], bounds: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } };
}

function slabRim(m: Model, w: number, h: number, x: number, y: number, z: number, face: number, color: string, panel: string) { // a door on a long side of an island (face +1 or -1)
  m.box(color, [w, h, 0.22], [x, y, z + face * 0.11]); m.box(panel, [w - 0.34, h - 0.34, 0.06], [x, y, z + face * 0.24]);
  m.box(CH, [w - 0.06, 0.07, 0.05], [x, y + h / 2 - 0.04, z + face * 0.27]); m.box(CH, [w - 0.06, 0.07, 0.05], [x, y - h / 2 + 0.04, z + face * 0.27]);
  m.box(CH, [0.07, h - 0.1, 0.05], [x - w / 2 + 0.04, y, z + face * 0.27]); m.box(CH, [0.07, h - 0.1, 0.05], [x + w / 2 - 0.04, y, z + face * 0.27]);
}
/** A checker-top bakery island IL long and ID across: red cabinets with chrome trim, a red and white checkered top, a bread box, a fruit bowl and a cake under a dome. */
function islandGeometry(IL: number, ID: number): BufferGeometry {
  const m = new Model();
  m.box('#c23d38', [IL - 0.4, 2.8, ID - 0.4], [0, 1.65, 0]); m.box(DARK, [IL - 1.2, 0.4, ID - 1.2], [0, 0.2, 0]);
  const n = Math.max(2, Math.round(IL / 5)), w = (IL - 0.8) / n;
  for (const f of [-1, 1]) for (let i = 0; i < n; i++) { const x = -IL / 2 + 0.4 + (i + 0.5) * w; slabRim(m, w - 0.2, 2.0, x, 1.7, f * (ID / 2 - 0.2), f, RED, '#e8625c'); m.cyl(CH, 0.07, 1.4, [x, 2.65, f * (ID / 2 + 0.25)], [0, 0, Math.PI / 2]); }
  m.box(CH, [IL + 0.4, 0.2, ID + 0.4], [0, 3.15, 0]);
  const tx = Math.round(IL), tz = Math.max(3, Math.round(ID)); // the checkered top: about one square to the unit
  for (let i = 0; i < tx; i++) for (let j = 0; j < tz; j++) m.box((i + j) % 2 ? '#fbf6ea' : RED, [IL / tx, 0.18, ID / tz], [-IL / 2 + (i + 0.5) * (IL / tx), 3.33, -ID / 2 + (j + 0.5) * (ID / tz)]);
  m.box(CH, [IL + 0.4, 0.1, 0.12], [0, 3.44, ID / 2 + 0.2]); m.box(CH, [IL + 0.4, 0.1, 0.12], [0, 3.44, -ID / 2 - 0.2]);
  m.box('#c9a574', [2.2, 1.2, 1.4], [-IL * 0.33, 4.1, 0]); m.cyl('#b58f58', 0.7, 2.2, [-IL * 0.33, 4.8, 0], [0, 0, Math.PI / 2]); // a bread box
  m.cyl('#e8ecee', 1.1, 0.5, [0, 3.7, 0.3], [0, 0, 0], 0.6); for (const [x, z, c] of [[-0.3, 0.1, '#d33f3f'], [0.35, 0.3, '#e0a526'], [0, 0.6, '#7a9a3a'], [0.1, 0.0, '#b4432f']] as [number, number, string][]) m.oval(c, [0.3, 0.3, 0.3], [x, 4.15, z]); // a fruit bowl
  m.cyl('#f4a9bd', 1.0, 0.2, [IL * 0.33, 3.6, 0.2]); m.cyl('#fdeaf0', 0.8, 0.6, [IL * 0.33, 4.0, 0.2]); m.oval('#f4f4f4', [0.85, 0.7, 0.85], [IL * 0.33, 4.6, 0.2]); // a cake and its dome
  return m.build();
}

/** B1: the classic straw broom: a long wooden handle and a head that is ALL bristles: a dense bundle of straw strands, filled out in every layer (across, up and down), fanning out from the binding to ragged tips. */
const BROOM_SCALE = 1.56; // the whole broom is drawn 56% bigger than modelled (30%, then 20% more; its handle is 20% shorter)
function broomGeometry(): BufferGeometry {
  const m = new Model();
  m.cyl('#a9784a', 0.14, 11.2, [0.4, 0.3, 0], [0, 0, Math.PI / 2]); m.cyl('#c9a374', 0.2, 0.3, [-5.3, 0.3, 0], [0, 0, Math.PI / 2]); // the handle and the knob on its end
  // the head: a grid of strands (11 across x 5 high), each running from inside the binding out to its own ragged tip; the outer ones lean out so the head fans wider, and the lowest rest on the floor
  const COLS = 11, ROWS = 5;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const u = c / (COLS - 1) * 2 - 1, v = r / (ROWS - 1); // -1..1 across, 0..1 up
    const y0 = 0.16 + v * 0.42, z0 = u * 0.62, j = ((c * 7 + r * 13) % 10) / 10; // (a little jitter, the same every time)
    const tip: V3 = [7.4 + j * 0.9 + (1 - Math.abs(u)) * 0.25, Math.max(0.09, y0 * 0.55 - 0.02), u * 0.98 + (j - 0.5) * 0.12];
    const mid: V3 = [6.0, (y0 + tip[1]) / 2, (z0 + tip[2]) / 2 + (j - 0.5) * 0.05];
    const col = (c + r) % 3 === 0 ? '#e0bd6a' : (c + r) % 3 === 1 ? '#cfa84f' : '#b8923f';
    m.limb(col, [4.55, y0, z0 * 0.8], mid, 0.1); m.limb(col, mid, tip, 0.085);
  }
  m.oval('#cfa84f', [0.9, 0.34, 0.74], [5.1, 0.34, 0]); // the thick base of the bundle, where the strands come out of the binding
  for (const x of [4.35, 4.65]) m.box('#5b3b1c', [0.22, 0.8, 1.55], [x, 0.36, 0]); m.box('#5b3b1c', [0.36, 0.86, 1.6], [4.0, 0.36, 0]); // the binding
  const g = m.build();
  g.translate(-1.55, 0, 0); // (the handle is shorter now, so the middle of the broom has moved: put it back in the middle of its footprint)
  return g;
}
/** S1: chunky red and white sneakers: thick white soles, a red upper, a white toe cap, laces, a stripe. */
function sneaker(): BufferGeometry {
  const m = new Model();
  m.oval('#f4f4f4', [0.5, 0.18, 1.2], [0, 0.18, 0]); m.oval('#d9d9d9', [0.48, 0.05, 1.15], [0, 0.04, 0]); m.oval('#d33f3f', [0.44, 0.34, 0.9], [0, 0.46, -0.1]); m.oval('#f4f4f4', [0.42, 0.26, 0.45], [0, 0.4, 0.78]);
  m.oval('#2a2a2a', [0.28, 0.16, 0.3], [0, 0.72, -0.62]); m.oval('#d33f3f', [0.3, 0.22, 0.3], [0, 0.78, -0.2]);
  for (let i = 0; i < 4; i++) m.box('#f6f6f6', [0.5, 0.04, 0.07], [0, 0.78 - i * 0.015, 0.1 + i * 0.17]);
  m.box('#f4f4f4', [0.06, 0.2, 0.9], [0.43, 0.42, -0.1]); m.box('#f4f4f4', [0.06, 0.2, 0.9], [-0.43, 0.42, -0.1]);
  return m.build();
}
/** S2: yellow rubber rain boots: tall shafts, a black sole, a pull-on loop; one has fallen over. */
function rainBoot(): BufferGeometry {
  const m = new Model();
  m.oval('#1f1f22', [0.52, 0.16, 1.2], [0, 0.16, 0]); m.oval('#f2c230', [0.46, 0.34, 0.95], [0, 0.45, 0.25]); m.cyl('#f2c230', 0.44, 1.8, [0, 1.1, -0.35], [0, 0, 0], 1.0); m.cyl('#d9ac20', 0.47, 0.18, [0, 2.0, -0.35]);
  m.limb('#d9ac20', [0, 1.9, -0.8], [0, 1.6, -0.82], 0.05); m.oval('#fff2a8', [0.08, 0.5, 0.05], [0.2, 1.0, 0.0], [0, 0, 0.1]); // a pull loop and a shine
  return m.build();
}

/** An island on its rectangle (long way along x, or along z if the rectangle is taller than wide). */
export function buildIsland(o: Rect): Piece {
  const lengthX = o.hw >= o.hd;
  const g = new Group();
  g.position.set(o.x, 0, o.z);
  g.rotation.y = lengthX ? 0 : Math.PI / 2;
  g.scale.setScalar(OBSTACLE_SCALE); // (20% bigger than first modelled, all over: the footprint in the shared layout is scaled the same)
  return piece(g, islandGeometry((Math.max(o.hw, o.hd) * 2) / OBSTACLE_SCALE, (Math.min(o.hw, o.hd) * 2) / OBSTACLE_SCALE));
}

/** The broom on its rectangle (the head at one end or the other, picked by where it lies). */
export function buildBroom(o: Rect): Piece {
  const g = new Group();
  g.position.set(o.x, 0, o.z);
  g.rotation.y = (o.hw >= o.hd ? 0 : Math.PI / 2) + (Math.floor(Math.abs(o.x + o.z)) % 2 ? Math.PI : 0);
  g.scale.setScalar(BROOM_SCALE);
  return piece(g, broomGeometry());
}

/** One shoe pair (A at the pair's x, z; B beyond it): the two models are put together once per style and shared; the pair is turned so that shoe B lies where the layout says (`dx, dz`). */
const pairs = new Map<number, BufferGeometry>();
function pairGeometry(style: 0 | 1): BufferGeometry {
  let g = pairs.get(style);
  if (!g) {
    const make = style === 0 ? sneaker : rainBoot;
    const A = make().clone().applyMatrix4(new Matrix4().makeRotationY(0.4));
    const B = make().clone();
    B.applyMatrix4(new Matrix4().makeRotationZ(1.45)); B.computeBoundingBox(); B.translate(0, -B.boundingBox!.min.y, 0); // (kicked over onto its side)
    B.applyMatrix4(new Matrix4().makeRotationY(0.9)); B.translate(2.1, 0, 1.3);
    g = mergeGeometries([A.toNonIndexed(), B.toNonIndexed()])!;
    pairs.set(style, g);
  }
  return g;
}
export function buildShoePair(h: ShoePair): Piece {
  const g = new Group();
  g.position.set(h.x, 0, h.z);
  g.rotation.y = Math.atan2(1.3, 2.1) - Math.atan2(h.dz, h.dx); // (shoe B is at local (2.1, 1.3), which has to end up along (dx, dz))
  g.scale.setScalar(SHOE_PAIR_GAP / Math.hypot(2.1, 1.3)); // (drawn 40% bigger than first modelled: the gap in the shared layout is scaled the same)
  return piece(g, pairGeometry(h.style).clone());
}
const rod = (m: Model, c: string, pts: V3[], r: number) => { for (let i = 0; i < pts.length - 1; i++) m.limb(c, pts[i], pts[i + 1], r); };

/** b: a toppled stash: a standing bleach jug, a yellow detergent bottle knocked over and leaking a blue puddle, a spray bottle on its side, a sponge and a roll of paper towel. */
function cleaningGeometry(): BufferGeometry {
  const m = new Model();
  m.oval('#6fb8ee', [1.0, 0.04, 0.7], [0.5, 0.05, 0.8], [0, 0.4, 0]); m.oval('#9bd3f5', [0.5, 0.05, 0.3], [0.4, 0.09, 0.75]); // the leak
  m.box('#f4f4f4', [0.9, 1.7, 0.7], [-0.7, 0.9, -0.4]); m.cyl('#f4f4f4', 0.2, 0.2, [-0.7, 1.8, -0.4]); m.cyl('#2f7fd6', 0.24, 0.26, [-0.7, 2.0, -0.4]); // the bleach jug, its neck and its blue cap
  rod(m, '#f4f4f4', [[-0.3, 1.62, -0.4], [0.08, 1.72, -0.4], [0.2, 1.45, -0.4], [0.1, 1.15, -0.4], [-0.3, 1.0, -0.4]], 0.09); // the handle: both ends go into the side of the jug m.box('#2f7fd6', [0.6, 0.5, 0.04], [-0.7, 1.0, -0.03]); m.box('#d33f3f', [0.4, 0.2, 0.04], [-0.7, 1.4, -0.03]); // the bleach
  m.cyl('#f2c230', 0.42, 1.6, [0.35, 0.45, 0.35], [0, 0, 1.45], 1.0); m.cyl('#d33f3f', 0.2, 0.3, [1.25, 0.4, 0.38], [0, 0, 1.45]); // the detergent bottle on its side
  { // a spray bottle lying on its side, with its head built on the end of its body (so nothing floats)
    const y = 0.34, x0 = -1.6, z0 = 0.9;
    m.cyl('#7fd1b4', 0.34, 1.4, [x0 + 0.7, y, z0], [0, 0, Math.PI / 2], 1.0); m.cyl('#2a2d31', 0.2, 0.3, [x0 + 1.5, y, z0], [0, 0, Math.PI / 2]);
    m.box('#2a2d31', [0.7, 0.34, 0.3], [x0 + 1.8, y + 0.12, z0]); m.cone('#2a2d31', 0.09, 0.3, [x0 + 2.2, y + 0.12, z0], [0, 0, -Math.PI / 2]); m.box('#d9d9d9', [0.18, 0.4, 0.14], [x0 + 1.7, y - 0.2, z0]); // head, nozzle and trigger
  }
  m.box('#f2e13a', [0.7, 0.28, 0.45], [0.9, 0.17, -0.5], [0, 0.4, 0]); m.box('#3fae5a', [0.7, 0.08, 0.45], [0.9, 0.34, -0.5], [0, 0.4, 0]); // a sponge
  m.cyl('#f4f4f4', 0.4, 0.8, [-1.1, 0.4, 0.9]); m.cyl('#a8864a', 0.15, 0.82, [-1.1, 0.4, 0.9]); m.cyl('#e8e4d0', 0.4, 0.04, [-1.1, 0.82, 0.9]);
  return m.build();
}

/** Prop 1: a chrome diner stool: a round red seat on a chrome pole, a ring footrest and a round foot. */
function stoolGeometry(): BufferGeometry {
  const m = new Model();
  m.cyl('#e4e9ed', 1.0, 0.18, [0, 0.09, 0], [0, 0, 0], 1.0); m.cyl('#e4e9ed', 0.18, 2.0, [0, 1.15, 0]); // the foot and the pole
  m.cyl('#d4453f', 1.15, 0.5, [0, 2.45, 0], [0, 0, 0], 1.0); m.cyl('#a8302b', 1.18, 0.14, [0, 2.12, 0]); m.cyl('#e4e9ed', 1.2, 0.08, [0, 2.2, 0]); // the seat, with a chrome band round it
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, b = ((i + 1) / 14) * Math.PI * 2; m.limb('#e4e9ed', [Math.cos(a) * 0.8, 0.85, Math.sin(a) * 0.8], [Math.cos(b) * 0.8, 0.85, Math.sin(b) * 0.8], 0.07); } // the footrest ring
  for (const a of [0.4, 2.5, 4.6]) m.limb('#e4e9ed', [Math.cos(a) * 0.15, 0.9, Math.sin(a) * 0.15], [Math.cos(a) * 0.8, 0.85, Math.sin(a) * 0.8], 0.06);
  return m.build();
}
/** Prop 2: three cardboard boxes stacked a bit crooked, the top one open with its flaps up, packing tape and a FRAGILE label. */
function boxesGeometry(): BufferGeometry {
  const m = new Model();
  m.box('#c9a574', [2.0, 1.2, 1.7], [-0.1, 0.6, 0.0], [0, 0.1, 0]); m.box('#b58f58', [2.04, 0.05, 0.4], [-0.1, 1.0, 0.0], [0, 0.1, 0]);
  m.box('#bf9a62', [1.5, 1.0, 1.4], [0.25, 1.7, -0.05], [0, -0.3, 0]); m.box('#a8864a', [1.54, 0.05, 0.35], [0.25, 2.0, -0.05], [0, -0.3, 0]);
  m.box('#c9a574', [1.2, 0.8, 1.1], [-0.9, 0.4, 1.2], [0, 0.5, 0]); // a small one beside them
  for (const [x, z, r] of [[-0.45, 0.0, 0.3], [0.95, -0.35, -0.2]] as [number, number, number][]) m.box('#d9b87a', [0.9, 0.05, 0.7], [0.25 + x * 0.3, 2.5, -0.05 + z * 0.4], [0.9 * Math.sign(r), r, 0]); // the open flaps
  m.box('#f4f4f4', [0.8, 0.5, 0.04], [-0.1, 0.6, 0.88], [0, 0.1, 0]); m.box('#d33f3f', [0.6, 0.12, 0.05], [-0.1, 0.72, 0.9], [0, 0.1, 0]); m.box('#2a2a2a', [0.5, 0.06, 0.05], [-0.1, 0.52, 0.9], [0, 0.1, 0]);
  return m.build();
}
/** Prop 3: a steel stockpot tipped over on its side, its lid rolled off, a ladle lying beside it and a stain of soup. */
function potGeometry(): BufferGeometry {
  const m = new Model();
  m.oval('#a9742a', [1.2, 0.04, 0.8], [0.9, 0.05, 0.4], [0, 0.4, 0]); m.oval('#c98f3a', [0.6, 0.05, 0.4], [0.7, 0.08, 0.5]); // the soup
  m.cyl('#b4bac0', 0.95, 1.7, [0, 0.95, 0], [0, 0, Math.PI / 2], 1.0); m.cyl('#8a9096', 0.98, 0.1, [0.85, 0.95, 0], [0, 0, Math.PI / 2]); m.cyl('#8a9096', 0.98, 0.1, [-0.85, 0.95, 0], [0, 0, Math.PI / 2]); // the pot on its side, with rims
  m.cyl('#2a2d31', 0.2, 0.3, [0.0, 0.95, 1.0], [Math.PI / 2, 0, 0]); m.cyl('#2a2d31', 0.2, 0.3, [0.0, 0.95, -1.0], [Math.PI / 2, 0, 0]); // the two handles
  m.cyl('#4a4f55', 0.6, 0.14, [1.2, 0.95, 0], [0, 0, Math.PI / 2]); m.oval('#2a2d31', [0.12, 0.1, 0.12], [1.28, 0.95, 0]); // the dark inside of the open end
  m.cyl('#9aa0a8', 0.95, 0.12, [1.9, 0.12, -1.0], [0.1, 0, 0], 0.9); m.oval('#2a2d31', [0.14, 0.08, 0.14], [1.9, 0.25, -1.0]); // the lid on the floor
  rod(m, '#aeb4ba', [[-0.2, 0.07, 1.6], [0.6, 0.07, 1.6], [1.4, 0.1, 1.55]], 0.06); m.oval('#aeb4ba', [0.3, 0.1, 0.22], [1.6, 0.1, 1.55]); // the ladle
  return m.build();
}

/** A prop from the pool, on its disc, turned the way the layout says. */
export function buildProp(q: Prop): Piece {
  const g = new Group();
  g.position.set(q.x, 0, q.z);
  g.rotation.y = Math.atan2(q.ux, q.uz);
  g.scale.setScalar(OBSTACLE_SCALE);
  const geo = q.kind === 0 ? cleaningGeometry() : q.kind === 1 ? stoolGeometry() : q.kind === 2 ? boxesGeometry() : potGeometry();
  return piece(g, geo);
}

// ---------------------------------------------------------------- the diner table and its chairs
const chairGeo = (style: 'square' | 'round' | 'scoop', seat: string, trim: string): BufferGeometry => {
  const m = new Model();
  for (const [x, z] of [[-0.62, 0.55], [0.62, 0.55], [-0.62, -0.55], [0.62, -0.55]] as [number, number][]) m.limb(CH, [x, 0.04, z], [x * 0.95, 1.55, z * 0.95], 0.065); // the four chrome legs
  m.limb(CH, [-0.62, 0.5, 0.0], [0.62, 0.5, 0.0], 0.05); // a footrest bar
  if (style === 'round') { m.cyl(trim, 0.8, 0.14, [0, 1.55, 0]); m.cyl(seat, 0.76, 0.32, [0, 1.76, 0], [0, 0, 0], 1.0); }
  else { m.box(trim, [1.5, 0.14, 1.4], [0, 1.55, 0]); m.box(seat, [1.46, 0.34, 1.36], [0, 1.78, 0]); m.oval(seat, [0.74, 0.14, 0.68], [0, 1.98, 0]); }
  for (const x of [-0.62, 0.62]) m.limb(CH, [x * 0.95, 1.6, -0.55 * 0.95], [x * 0.95, 3.0, -0.66], 0.065); // the back posts
  if (style === 'square') { m.box(seat, [1.5, 1.05, 0.28], [0, 2.5, -0.66]); m.cyl(CH, 0.07, 1.7, [0, 3.05, -0.66], [0, 0, Math.PI / 2]); }
  else if (style === 'round') { m.oval(seat, [0.78, 0.7, 0.16], [0, 2.55, -0.66]); }
  else { for (let i = 0; i < 5; i++) { const a = -0.8 + i * 0.4; m.box(seat, [0.38, 1.1 - Math.abs(a) * 0.35, 0.24], [a * 0.9, 2.45 + (1.1 - Math.abs(a) * 0.35) / 2 - 0.55, -0.66 + Math.abs(a) * 0.25], [0, a * 0.5, 0]); } m.cyl(CH, 0.06, 1.7, [0, 3.0, -0.6], [0, 0, Math.PI / 2]); }
  return m.build();
};
const placeChair = (g: BufferGeometry, x: number, z: number, rot: number) => g.clone().applyMatrix4(new Matrix4().makeRotationY(rot).setPosition(x, 0, z)).toNonIndexed();
/** Napkin holder, shakers and a sauce bottle in the middle of a table. */
const tableTop = (m: Model, y: number, at = 0) => {
  m.box(CH, [0.5, 0.65, 0.36], [at - 0.4, y + 0.33, 0.1]); m.box('#1b1d20', [0.36, 0.04, 0.05], [at - 0.4, y + 0.62, 0.3]);
  for (const [x, c] of [[0.4, '#f4f4f4'], [0.75, '#f4f4f4']] as [number, string][]) { m.cyl(c, 0.14, 0.45, [at + x, y + 0.22, 0.0], [0, 0, 0], 0.9); m.cyl(CH, 0.1, 0.1, [at + x, y + 0.5, 0.0]); }
  m.cyl('#d4453f', 0.15, 0.7, [at + 1.4, y + 0.35, -0.2], [0, 0, 0], 0.8); m.cone('#d4453f', 0.1, 0.25, [at + 1.4, y + 0.82, -0.2]);
};

const tableGeometry = (): BufferGeometry => { // T2: mint formica on two chrome slab legs, 6 mint chairs with round backs
  const L = 10, W = 4.4, m = new Model();
  m.box(CH, [L + 0.2, 0.2, W + 0.2], [0, 2.86, 0]); m.box('#9be2c6', [L, 0.2, W], [0, 3.02, 0]); m.box('#82ccaf', [L - 0.4, 0.04, W - 0.4], [0, 3.13, 0]);
  for (const sx of [-1, 1]) { m.box(CH, [0.4, 2.7, W - 1.0], [sx * (L / 2 - 1.4), 1.4, 0]); m.box('#9aa2a8', [0.9, 0.16, W - 0.4], [sx * (L / 2 - 1.4), 0.08, 0]); }
  m.box(CH, [L - 2.8, 0.12, 0.2], [0, 0.9, 0]);
  tableTop(m, 3.15, -1.6); tableTop(m, 3.15, 2.2);
  const chair = chairGeo('round', '#7fd1b4', '#5aa88c'), parts = [m.build()];
  for (const x of [-3.2, 0, 3.2]) { parts.push(placeChair(chair, x, -(W / 2 + 0.85), 0)); parts.push(placeChair(chair, x, W / 2 + 0.85, Math.PI)); }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
};

/** The diner table (mint formica on two chrome slab legs, napkin holders, shakers and sauce on it) with its six round-back mint chairs, three along each long side. The solid footprint is the whole set: a rectangle 10.4 by 7.9. */
export function buildTable(o: Rect): Piece {
  const g = new Group();
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.hw >= o.hd ? 0 : Math.PI / 2; // (long way along x, or along z)
  g.scale.setScalar(TABLE_SCALE);
  return piece(g, tableGeometry());
}
