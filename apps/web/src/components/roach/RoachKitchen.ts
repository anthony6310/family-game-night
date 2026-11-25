import { Box3, BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3, type Material } from 'three';
import { COOKER, type Disc, type Rect, type Shoe } from '@fgn/shared';
import { Model } from '../shelter/AnimalKit';

/**
 * The kitchen in Roach Rumble, all low-poly and built in code: the units round the walls (base cabinets with a worktop, a sink, a cooker, a fridge, upper cabinets, a window), and the things on the floor (kitchen
 * islands, brooms, shoes). Every piece has its OWN materials so the scene can make just the pieces that are in the way of the camera see-through, and a flat box (`bounds`, on the floor plan) for that test.
 */
export interface Piece {
  object: Group;
  materials: MeshStandardMaterial[];
  geometries: BufferGeometry[];
  /** Where the piece is on the floor plan (x and z). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

class Builder {
  readonly object = new Group();
  readonly materials: MeshStandardMaterial[] = [];
  readonly geometries: BufferGeometry[] = [];
  private mat(color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) {
    const m = new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
    this.materials.push(m);
    return m;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, parent: Group = this.object) {
    const g = new BoxGeometry(w, h, d);
    this.geometries.push(g);
    const mesh = new Mesh(g, this.mat(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: string, parent: Group = this.object, rz = 0) {
    const g = new CylinderGeometry(r, r, h, 12);
    this.geometries.push(g);
    const mesh = new Mesh(g, this.mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    parent.add(mesh);
    return mesh;
  }
  /** A tapered upright cylinder (wider at the bottom when `rBottom` is the bigger). */
  taper(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, color: string, parent: Group = this.object) {
    const g = new CylinderGeometry(rTop, rBottom, h, 14);
    this.geometries.push(g);
    const mesh = new Mesh(g, this.mat(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  ball(r: number, x: number, y: number, z: number, color: string, parent: Group = this.object) {
    const g = new SphereGeometry(r, 10, 8);
    this.geometries.push(g);
    const mesh = new Mesh(g, this.mat(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  /** An unlit panel (a window at night): not affected by the room's lights. */
  glow(w: number, h: number, x: number, y: number, z: number, color: string, parent: Group = this.object) {
    const g = new PlaneGeometry(w, h);
    this.geometries.push(g);
    const mesh = new Mesh(g, new MeshBasicMaterial({ color }));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  baked(model: Model, parent: Group = this.object) {
    const g = model.build();
    this.geometries.push(g);
    const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    this.materials.push(m);
    const mesh = new Mesh(g, m);
    parent.add(mesh);
    return mesh;
  }
  finish(): Piece {
    this.object.updateMatrixWorld(true);
    const b = new Box3().setFromObject(this.object);
    return { object: this.object, materials: this.materials, geometries: this.geometries, bounds: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } };
  }
}

// ---------------------------------------------------------------- the things on the floor

/** A kitchen island: a cabinet base with drawer fronts, a butcher-block top and a few things on it. Centred on (x, z), long along x unless it is taller than wide. */
export function buildIsland(o: Rect): Piece {
  const b = new Builder();
  const w = o.hw * 2, d = o.hd * 2, lengthX = o.hw >= o.hd;
  const long = Math.max(w, d), short = Math.min(w, d);
  const root = new Group();
  b.object.add(root);
  b.box(long, 2.7, short, 0, 1.35, 0, '#e3dccb', root); // the cabinet body, painted cream
  b.box(long + 0.1, 0.3, short + 0.1, 0, 0.1, 0, '#4a3a2a', root); // the plinth
  for (const side of [-1, 1]) { // drawer and door fronts down both long sides
    const n = Math.max(2, Math.round(long / 3.2));
    for (let i = 0; i < n; i++) {
      const x = -long / 2 + (i + 0.5) * (long / n);
      b.box(long / n - 0.25, 1.9, 0.08, x, 1.45, side * (short / 2 + 0.03), '#c9bfa6', root);
      b.box(0.5, 0.12, 0.1, x, 2.2, side * (short / 2 + 0.1), '#8d9096', root); // handle
    }
  }
  b.box(long + 0.7, 0.35, short + 0.7, 0, 2.88, 0, '#a8794a', root); // the butcher-block top, overhanging
  b.box(2.2, 0.12, 1.4, -long * 0.25, 3.12, 0, '#d9c28f', root); // a chopping board
  b.cyl(0.55, 0.7, long * 0.2, 3.3, 0, '#6e7378', root); // a pot
  b.cyl(0.6, 0.12, long * 0.2, 3.7, 0, '#8d9096', root); // its lid
  for (let i = 0; i < 4; i++) b.ball(0.26, long * 0.05 + (i % 2) * 0.4 + 0.1, 3.3 + (i > 1 ? 0.35 : 0), (i % 2 ? 0.25 : -0.25), ['#c0392b', '#e0a526', '#7a9a3a', '#b4432f'][i], root); // fruit
  root.rotation.y = lengthX ? 0 : Math.PI / 2;
  b.object.position.set(o.x, 0, o.z);
  return b.finish();
}

/** A broom lying on the floor: a long handle and a head of straw at one end. */
export function buildBroom(o: Rect): Piece {
  const b = new Builder();
  const len = Math.max(o.hw, o.hd) * 2, root = new Group();
  b.object.add(root);
  b.cyl(0.14, len, 0, 0.3, 0, '#a9784a', root, Math.PI / 2); // the handle, lying along x
  b.box(1.5, 0.55, 1.5, len / 2 - 0.5, 0.35, 0, '#cfa84f', root); // the straw
  b.box(0.35, 0.58, 1.6, len / 2 - 1.25, 0.36, 0, '#5b3b1c', root); // the binding
  b.box(0.8, 0.12, 1.1, len / 2 + 0.55, 0.12, 0, '#b8923f', root); // the ragged ends
  b.cyl(0.18, 0.4, -len / 2 + 0.1, 0.3, 0, '#c9a374', root, Math.PI / 2); // the knob on the end
  root.rotation.y = o.hw >= o.hd ? 0 : Math.PI / 2;
  b.object.position.set(o.x, 0, o.z);
  return b.finish();
}

/** A shoe kicked off: a sneaker, a boot, or a fluffy slipper. */
export function buildShoe(h: Shoe): Piece {
  const b = new Builder();
  const m = new Model();
  if (h.style === 0) { // a sneaker: white sole, a coloured upper, laces
    m.oval('#eeeeee', [0.45, 0.14, 1.15], [0, 0.14, 0]);
    m.oval(['#d33f3f', '#3f6fd3'][(Math.round(h.x + h.z) & 1)], [0.4, 0.3, 0.85], [0, 0.34, -0.1]);
    m.oval('#f4f4f4', [0.38, 0.22, 0.4], [0, 0.28, 0.72]);
    m.oval('#2a2a2a', [0.24, 0.12, 0.3], [0, 0.55, -0.55]);
    for (let i = 0; i < 4; i++) m.box('#f1f1f1', [0.46, 0.03, 0.06], [0, 0.6 - i * 0.02, 0.1 + i * 0.16]);
  } else if (h.style === 1) { // a boot: a tall brown shaft
    m.oval('#2c2118', [0.46, 0.16, 1.15], [0, 0.16, 0]);
    m.oval('#7a5230', [0.42, 0.3, 0.8], [0, 0.4, 0.3]);
    m.cyl('#6d4828', 0.4, 1.1, [0, 0.8, -0.35]);
    m.oval('#4a3220', [0.3, 0.1, 0.3], [0, 1.38, -0.35]);
  } else { // a fluffy pink slipper
    m.oval('#e89ab8', [0.5, 0.2, 1.1], [0, 0.22, 0]);
    m.oval('#f3b6cc', [0.4, 0.16, 0.6], [0, 0.4, 0.4]);
    m.oval('#fad0e0', [0.3, 0.1, 0.3], [0, 0.5, 0.5]);
  }
  const mesh = b.baked(m);
  mesh.rotation.y = h.angle;
  b.object.position.set(h.x, 0, h.z);
  return b.finish();
}

// ---------------------------------------------------------------- the landmarks

/** The trash can (a landmark): a dented steel can with ridges, its lid knocked askew, stuffed so full that rubbish spills out. Stands on the layout's trash can disc. */
export function buildTrashCan(can: Disc): Piece {
  const b = new Builder();
  const r = can.r, root = new Group();
  b.object.add(root);
  b.taper(r, r * 0.88, 2.9, 0, 1.45, 0, '#7d848b', root); // the can
  for (const y of [0.55, 1.45, 2.35]) b.taper(r + 0.06, r + 0.06, 0.12, 0, y, 0, '#5d636a', root); // the ridges
  b.cyl(0.9 * r, 0.12, 0, 0.06, 0, '#4a4f55', root); // the foot
  const lid = new Group();
  lid.position.set(0.5, 3.0, 0.25); lid.rotation.set(0.25, 0.4, -0.55); // knocked off and leaning
  root.add(lid);
  b.taper(r * 0.95, r, 0.22, 0, 0, 0, '#6c7279', lid);
  b.cyl(0.22, 0.2, 0, 0.2, 0, '#3f4449', lid); // the lid's knob
  b.ball(0.7, -0.15, 2.95, 0.1, '#6b7a3a', root); // a bulging bag of rubbish
  b.ball(0.5, 0.45, 3.1, -0.3, '#3a3d46', root);
  b.ball(0.4, -0.55, 3.2, 0.4, '#8a6a3a', root);
  b.box(0.7, 0.08, 0.5, 0.7, 3.4, 0.5, '#d9d2b8', root); // a crumpled paper
  b.box(0.5, 0.5, 0.5, 1.25, 0.28, 0.9, '#b9b3a0', root); // a carton on the floor
  b.box(0.8, 0.06, 0.3, -1.3, 0.04, 0.8, '#7a8a2a', root); // a banana skin on the floor
  b.ball(0.2, -1.55, 0.2, 0.15, '#7b5628', root);
  b.object.position.set(can.x, 0, can.z);
  return b.finish();
}

/** The dirty mop bucket (a landmark): a yellow bucket of grey water on wheels with a wringer on top and a grubby mop leaning in it. Stands on the layout's mop bucket disc. */
export function buildMopBucket(bucket: Disc): Piece {
  const b = new Builder();
  const r = bucket.r, root = new Group();
  b.object.add(root);
  b.taper(r, r * 0.78, 1.5, 0, 0.95, 0, '#d9b52f', root); // the bucket, wider at the top
  b.taper(r * 0.9, r * 0.9, 0.06, 0, 1.64, 0, '#6a665a', root); // the grey water in it
  b.taper(r + 0.05, r + 0.05, 0.12, 0, 1.72, 0, '#b8982a', root); // its rim
  for (const [x, z] of [[0.7, 0.55], [-0.7, 0.55], [0.7, -0.55], [-0.7, -0.55]]) b.cyl(0.14, 0.22, x, 0.12, z, '#2a2d31', root, Math.PI / 2); // the little wheels
  b.box(1.2, 0.5, 0.9, 0.0, 1.98, -0.25, '#c9a32a', root); // the wringer on top
  b.box(0.18, 0.5, 0.9, 0.62, 2.05, -0.25, '#8d9096', root);
  b.box(0.18, 0.5, 0.9, -0.62, 2.05, -0.25, '#8d9096', root);
  const mop = new Group();
  mop.position.set(0.1, 1.5, 0.2); mop.rotation.set(0.28, 0.3, 0.1); // leaning on the rim
  root.add(mop);
  b.cyl(0.07, 3.6, 0, 1.8, 0, '#a9784a', mop); // the handle
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.box(0.1, 0.9, 0.14, Math.cos(a) * 0.22, -0.1, Math.sin(a) * 0.22, i % 2 ? '#a9a699' : '#8e8a7c', mop); } // the stringy head, grey with dirt
  b.ball(0.26, 0, 0.25, 0, '#9a9686', mop);
  b.cyl(0.9, 0.03, -1.0, 0.02, 1.35, '#4c4a42'); // a dirty puddle on the floor beside it
  b.object.position.set(bucket.x, 0, bucket.z);
  return b.finish();
}

/** The bottle of poison: a dark purple glass bottle with a cork, a pale label with a skull and crossbones, and a drip down the side, standing on the floor next to a landmark. */
export function buildPoisonBottle(at: { x: number; z: number }): Piece {
  const b = new Builder();
  const root = new Group();
  b.object.add(root);
  b.taper(0.46, 0.5, 1.5, 0, 0.75, 0, '#4a2380', root); // the body
  b.taper(0.2, 0.46, 0.5, 0, 1.75, 0, '#4a2380', root); // the shoulder
  b.taper(0.17, 0.2, 0.55, 0, 2.28, 0, '#3d1c6c', root); // the neck
  b.taper(0.2, 0.17, 0.2, 0, 2.62, 0, '#6b4a26', root); // the cork
  b.box(0.76, 0.7, 0.05, 0, 0.8, 0.5, '#e9e2c8', root); // the label, on the front
  b.box(0.3, 0.26, 0.06, 0, 0.9, 0.52, '#1a1a1a', root); // the skull...
  b.box(0.52, 0.07, 0.06, 0, 0.62, 0.52, '#1a1a1a', root); // ...and the bones
  b.box(0.1, 0.4, 0.04, 0.3, 0.3, 0.5, '#c26bff', root); // a bright drip of it down the side
  b.object.position.set(at.x, 0, at.z);
  return b.finish();
}

// ---------------------------------------------------------------- the units round the walls

type UnitKind = 'base' | 'sink' | 'stove' | 'fridge';
const CYCLE: UnitKind[] = ['base', 'base', 'sink', 'base', 'base', 'fridge', 'base', 'base', 'sink', 'base', 'base']; // (no cooker: there is just the one, at COOKER)
const WIDTH: Record<UnitKind, number> = { base: 6, sink: 8, stove: COOKER.width, fridge: 7 };
export const WALL_HEIGHT = 12;

/**
 * One unit of the kitchen, in a frame where x runs along the wall and +z points INTO the room, standing against the wall (so it fills z from 0 outwards to -depth). Returns the finished piece
 * after the caller has put it in its place.
 */
function unit(kind: UnitKind, width: number, shade: number): Builder {
  const b = new Builder();
  const wood = ['#7b5a3a', '#6f5134', '#84623f'][shade % 3], door = ['#8d6a45', '#80603d', '#96734c'][shade % 3];
  const depth = kind === 'fridge' ? 4.4 : 4;
  const front = -0.0; // the front face is at z = 0 (the wall plane, which is the room's edge); the unit stands behind it
  const cz = front - depth / 2;
  if (kind === 'fridge') {
    b.box(width, 9.6, depth, 0, 4.8, cz, '#dfe2e4');
    b.box(width - 0.2, 0.08, 0.1, 0, 6.4, front + 0.04, '#9ea3a8'); // the line between the doors
    for (const x of [-width / 2 + 0.8, width / 2 - 0.8]) b.box(0.18, 2.2, 0.28, x, 4.6, front + 0.12, '#8c9197'); // handles
    for (const [x, y, c] of [[-1.5, 7.8, '#e05a5a'], [-0.4, 8.4, '#e0b84a'], [1.2, 7.4, '#5a8be0'], [1.9, 8.5, '#6ec06e']] as const) b.box(0.45, 0.45, 0.06, x, y, front + 0.05, c); // magnets
    return b;
  }
  b.box(width, 3.2, depth, 0, 1.6, cz, wood); // the base cabinet
  b.box(width + 0.1, 0.3, depth + 0.5, 0, 3.35, cz + 0.2, '#cfc9b9'); // the worktop, overhanging a little into the room
  b.box(width, 0.28, 0.12, 0, 0.14, front + 0.04, '#3f2c1c'); // the plinth
  if (kind === 'base') {
    const n = 2;
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + (i + 0.5) * (width / n);
      b.box(width / n - 0.25, 2.6, 0.1, x, 1.7, front + 0.05, door);
      b.box(0.12, 0.7, 0.14, x + (i ? -0.7 : 0.7), 2.3, front + 0.14, '#8d9096'); // handle
    }
  } else if (kind === 'sink') {
    b.box(width - 1.4, 0.18, 2.2, 0, 3.55, cz + 0.2, '#8a9096'); // the basin
    b.box(width - 2.2, 0.1, 1.5, 0, 3.6, cz + 0.2, '#4c5157');
    b.cyl(0.14, 1.2, 0, 4.1, cz - 0.6, '#b4b9be'); // the tap
    b.box(0.14, 0.14, 0.8, 0, 4.7, cz - 0.25, '#b4b9be');
    for (let i = 0; i < 2; i++) b.box(width / 2 - 0.3, 2.6, 0.1, -width / 4 + i * (width / 2), 1.7, front + 0.05, door);
  } else { // the cooker
    b.box(width - 0.2, 3.1, depth, 0, 1.55, cz, '#d4d6d8');
    b.box(width - 1.6, 1.7, 0.1, 0, 1.55, front + 0.06, '#2a2d31'); // the oven window
    b.box(width - 1.2, 0.14, 0.14, 0, 2.7, front + 0.14, '#9ea3a8'); // the oven handle
    for (const [x, z] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, -2.7], [1.5, -2.7]]) b.cyl(0.8, 0.12, x, 3.55, z, '#1f2124'); // the hobs
    for (let i = 0; i < 4; i++) b.cyl(0.14, 0.2, -1.8 + i * 1.2, 2.95, front + 0.12, '#8c9197', undefined, Math.PI / 2); // the knobs
  }
  // upper cabinets, a hood over the cooker, a window over the sink
  if (kind === 'base') {
    b.box(width, 3, 2.2, 0, 8.0, front - 1.1, wood);
    for (let i = 0; i < 2; i++) b.box(width / 2 - 0.25, 2.5, 0.1, -width / 4 + i * (width / 2), 8.0, front + 0.05, door);
  } else if (kind === 'stove') {
    b.box(width - 1.4, 1.8, 2.6, 0, 8.6, front - 1.3, '#b9bcc1'); // the hood
    b.box(2.2, 3.0, 2.0, 0, 10.6, front - 1.0, '#a8abb0'); // its chimney
  } else if (kind === 'sink') {
    b.box(width - 1.4, 3.6, 0.12, 0, 7.8, front - 0.06, '#0a0f1a'); // the window frame
    b.glow(width - 2.0, 3.0, 0, 7.8, front + 0.02, '#16243f'); // the night outside
    b.box(0.12, 3.0, 0.1, 0, 7.8, front + 0.05, '#cfc9b9'); b.box(width - 2.0, 0.12, 0.1, 0, 7.8, front + 0.05, '#cfc9b9'); // the window bars
    b.box(width - 1.2, 0.2, 0.7, 0, 6.0, front + 0.35, '#cfc9b9'); // the sill
  }
  return b;
}

/** All the units round the four walls of an arena that runs from -half to +half: base cabinets, sinks and fridges, and the ONE cooker on the north wall at COOKER (a landmark). Each unit is its own piece. */
export function buildKitchenUnits(half: number): Piece[] {
  const pieces: Piece[] = [];
  const sides: { pos: [number, number]; turn: number; stove: boolean }[] = [
    { pos: [0, -half], turn: 0, stove: true }, // north wall: the room is at +z
    { pos: [0, half], turn: Math.PI, stove: false }, // south wall
    { pos: [half, 0], turn: -Math.PI / 2, stove: false }, // east wall
    { pos: [-half, 0], turn: Math.PI / 2, stove: false }, // west wall
  ];
  sides.forEach((side, si) => {
    // the stretches of the wall to fill (the north wall has a gap where the cooker is)
    const runs: [number, number][] = side.stove ? [[-half, COOKER.x - COOKER.width / 2], [COOKER.x + COOKER.width / 2, half]] : [[-half, half]];
    let i = si * 3; // (a different start on each wall, so the walls are not all alike)
    const place = (kind: UnitKind, x0: number, width: number) => {
      const b = unit(kind, width, i);
      const holder = new Group();
      holder.add(b.object);
      b.object.position.x = x0 + width / 2;
      holder.rotation.y = side.turn;
      holder.position.set(side.pos[0], 0, side.pos[1]);
      const wrapper = new Group();
      wrapper.add(holder);
      wrapper.updateMatrixWorld(true);
      const bx = new Box3().setFromObject(wrapper);
      pieces.push({ object: wrapper, materials: b.materials, geometries: b.geometries, bounds: { minX: bx.min.x, maxX: bx.max.x, minZ: bx.min.z, maxZ: bx.max.z } });
      i++;
    };
    for (const [from, to] of runs) {
      const n = Math.max(1, Math.round((to - from) / 6)), width = (to - from) / n; // (equal units, no gaps)
      for (let k = 0; k < n; k++) place(CYCLE[i % CYCLE.length], from + k * width, width);
    }
    if (side.stove) place('stove', COOKER.x - COOKER.width / 2, COOKER.width);
  });
  return pieces;
}

export const disposeMaterial = (m: Material) => m.dispose();
export const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
