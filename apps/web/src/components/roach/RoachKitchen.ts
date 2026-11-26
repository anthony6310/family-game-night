import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Box3, BoxGeometry, Float32BufferAttribute, Matrix4, BufferGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3, type Material } from 'three';
import { COOKER } from '@fgn/shared';
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
  /** A cylinder with a top and bottom radius, turned by `rot` (x, y, z radians). */
  cyl3(rt: number, rb: number, h: number, x: number, y: number, z: number, color: string, rot: [number, number, number] = [0, 0, 0], parent: Group = this.object) {
    const g = new CylinderGeometry(rt, rb, h, 14);
    this.geometries.push(g);
    const mesh = new Mesh(g, this.mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
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
  /**
   * Every box and cylinder of a piece is its own mesh while it is built; to keep the number of draw calls down (a kitchen has hundreds of pieces) they are all merged into ONE mesh with vertex colours and one material.
   * (Unlit glow panels and parts that already have vertex colours are left as they are.)
   */
  mergeNow() { this.merge(); }
  private merge() {
    this.object.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(this.object.matrixWorld).invert();
    const parts: BufferGeometry[] = [], gone: Mesh[] = [], goneMats: Material[] = [];
    this.object.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !(m.material instanceof MeshStandardMaterial) || m.material.vertexColors) return;
      let g = m.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      g.deleteAttribute('uv');
      g.applyMatrix4(new Matrix4().multiplyMatrices(inverse, m.matrixWorld));
      const n = g.getAttribute('position').count, c = m.material.color, colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
      parts.push(g); gone.push(m); goneMats.push(m.material);
    });
    if (!parts.length) return;
    for (const m of gone) m.removeFromParent();
    const merged = mergeGeometries(parts.map((p) => { p.deleteAttribute('normal'); return p; }), false);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    merged.computeVertexNormals();
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.object.add(new Mesh(merged, mat));
    const dead = new Set<Material>(goneMats);
    for (const m of dead) m.dispose();
    this.materials.splice(0, this.materials.length, ...this.materials.filter((m) => !dead.has(m)), mat);
    const deadGeos = new Set(gone.map((m) => m.geometry));
    deadGeos.forEach((g) => g.dispose());
    this.geometries.splice(0, this.geometries.length, ...this.geometries.filter((g) => !deadGeos.has(g)), merged);
  }
  finish(): Piece {
    this.merge();
    this.object.updateMatrixWorld(true);
    const b = new Box3().setFromObject(this.object);
    return { object: this.object, materials: this.materials, geometries: this.geometries, bounds: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } };
  }
}

// ---------------------------------------------------------------- the landmarks

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
export const WALL_HEIGHT = 12;
/** The walls stand this far from the middle: the cabinets stand OUTSIDE the playable floor (which ends at ROACH_ARENA_HALF, where roaches are stopped), in the strip between it and the wall, so roaches can never go through them. */
export const WALL_PLANE = 45;
const F = 0.05; // (a unit's front face is F inside the playable edge, before it is pushed back by SHIFT)
const SHIFT = 0.95; // (every unit is pushed back this far, so even a fridge standing proud stays out of the playable floor)

const CH = '#e4e9ed', MINT = '#6fc3a5', MINT2 = '#a4e8cd', DARK = '#173b31', RED = '#d4453f', CREAM = '#f3ead6', PINK = '#f4a9bd';
function retroUnit(kind: UnitKind, width: number, idx: number, b: Builder): Builder {
  const D = 4, back = F - D;
  const rim = (w: number, h: number, x: number, y: number, z: number) => { const t = 0.07; b.box(w, t, 0.05, x, y + h / 2 - t / 2, z, CH); b.box(w, t, 0.05, x, y - h / 2 + t / 2, z, CH); b.box(t, h - 2 * t, 0.05, x - w / 2 + t / 2, y, z, CH); b.box(t, h - 2 * t, 0.05, x + w / 2 - t / 2, y, z, CH); };
  /** A thick door: a slab, a raised panel on it, and a chrome rim round that. */
  const slab = (w: number, h: number, x: number, y: number, color: string, panel: string, z0 = F, t = 0.26) => { b.box(w, h, t, x, y, z0 + t / 2, color); b.box(w - 0.34, h - 0.34, 0.06, x, y, z0 + t + 0.02, panel); rim(w - 0.08, h - 0.08, x, y, z0 + t + 0.05); };
  const pull = (x: number, y: number, len: number, vertical: boolean, z0 = F + 0.26) => {
    b.cyl3(0.07, 0.07, len, x, y, z0 + 0.3, CH, [0, 0, vertical ? 0 : Math.PI / 2]);
    for (const k of [-1, 1]) b.cyl3(0.06, 0.06, 0.3, vertical ? x : x + k * (len / 2 - 0.1), vertical ? y + k * (len / 2 - 0.1) : y, z0 + 0.15, CH, [Math.PI / 2, 0, 0]);
  };
  const sideShade = '#4aa88a';
  if (kind === 'fridge') {
    const fz = F + 0.9, fd = 4.9; // the fridge stands proud of the cabinets
    b.box(width, 8.6, fd, 0, 4.3, fz - fd / 2, PINK);
    b.cyl3(0.9, 0.9, fd, -width / 2 + 0.9, 8.7, fz - fd / 2, PINK, [Math.PI / 2, 0, 0]); b.cyl3(0.9, 0.9, fd, width / 2 - 0.9, 8.7, fz - fd / 2, PINK, [Math.PI / 2, 0, 0]); b.box(width - 1.8, 1.8, fd, 0, 8.7, fz - fd / 2, PINK);
    b.box(width - 0.2, 0.5, 0.3, 0, 0.25, fz - 0.05, DARK); // the grille at the foot
    b.box(width - 0.1, 5.5, 0.3, 0, 3.4, fz + 0.05, '#f8bccb'); b.box(width - 0.1, 2.7, 0.3, 0, 7.55, fz + 0.05, '#f8bccb'); // the two doors
    b.box(width, 0.14, 0.34, 0, 6.12, fz + 0.06, DARK); // the gap between them
    b.box(width - 0.1, 0.1, 0.34, 0, 0.55, fz + 0.06, CH); // chrome trim along the bottom of the door
    b.box(1.6, 0.35, 0.1, 0, 8.6, fz + 0.24, CH); // a chrome badge
    pull(-width / 2 + 0.9, 7.1, 1.8, true, fz + 0.2); pull(-width / 2 + 0.9, 4.2, 2.6, true, fz + 0.2);
    return b;
  }
  if (kind === 'stove') {
    const sz = F + 0.5, sd = 4.5;
    b.box(width - 0.2, 3.2, sd, 0, 1.6, sz - sd / 2, CREAM);
    b.box(width - 0.4, 0.4, 0.2, 0, 0.2, sz - 0.05, DARK); // the kick grille
    slab(width - 1.0, 2.1, 0, 1.55, CREAM, '#fbf5e8', sz - 0.02, 0.26); // the oven door
    b.box(width - 2.4, 1.0, 0.06, 0, 1.75, sz + 0.34, '#1b1d20'); // its window
    pull(0, 2.55, width - 2.2, false, sz + 0.2);
    b.box(width - 0.1, 0.6, 0.34, 0, 3.0, sz + 0.1, RED); // the control panel
    for (let i = 0; i < 5; i++) { b.cyl3(0.2, 0.2, 0.3, -width / 2 + 1.0 + i * ((width - 2.0) / 4), 3.0, sz + 0.36, CH, [Math.PI / 2, 0, 0]); b.cyl3(0.07, 0.07, 0.34, -width / 2 + 1.0 + i * ((width - 2.0) / 4), 3.0, sz + 0.52, '#1b1d20', [Math.PI / 2, 0, 0]); }
    b.box(width - 0.1, 0.22, sd + 0.1, 0, 3.31, sz - sd / 2, CREAM); // the cooktop
    b.box(width + 0.04, 0.08, sd + 0.14, 0, 3.45, sz - sd / 2, CH);
    for (const [x, z] of [[-1.6, F - 0.9], [1.6, F - 0.9], [-1.6, F - 2.7], [1.6, F - 2.7]]) { b.cyl3(0.88, 0.88, 0.08, x, 3.52, z, CH); b.cyl3(0.74, 0.74, 0.12, x, 3.56, z, '#17181a'); b.cyl3(0.3, 0.3, 0.16, x, 3.6, z, '#3a3d42'); }
    b.box(width - 0.1, 2.0, 0.4, 0, 4.5, back + 0.2, CREAM); b.box(width - 0.1, 0.5, 0.44, 0, 5.2, back + 0.22, RED); b.cyl3(0.08, 0.08, width - 0.2, 0, 4.2, back + 0.55, CH, [0, 0, Math.PI / 2]); // the backguard, with a chrome rail
    b.box(width - 0.4, 0.4, 2.8, 0, 7.5, F - 1.6, RED); b.cyl3(1.1, 1.1, width - 0.8, 0, 8.4, F - 1.7, CH, [0, 0, Math.PI / 2]); b.box(width - 0.8, 1.1, 2.6, 0, 8.0, F - 1.8, CH); b.box(2.2, 3.2, 2.0, 0, 10.4, back + 1.0, CH); b.box(2.5, 0.2, 2.3, 0, 8.9, back + 1.15, RED); // the hood
    return b;
  }
  // base cabinets and the sink: a carcass with a recessed kick, a drawer and doors, a thick worktop with a chrome lip
  b.box(width, 2.75, D, 0, 1.825, F - D / 2, sideShade);
  b.box(width - 0.2, 0.45, D - 0.6, 0, 0.225, F - D / 2 - 0.3, DARK);
  b.box(width + 0.1, 0.45, D + 0.7, 0, 3.425, F - D / 2 + 0.35, CREAM);
  b.box(width + 0.14, 0.18, 0.1, 0, 3.33, F + 0.72, CH);
  b.box(width + 0.14, 0.05, 0.12, 0, 3.66, F + 0.7, CH);
  const n = width > 5.5 ? 2 : 1;
  slab(width - 0.14, 0.8, 0, 2.72, MINT, MINT2); pull(0, 2.72, 1.5, false); // the drawer
  for (let i = 0; i < n; i++) { const x = -width / 2 + (i + 0.5) * (width / n); slab(width / n - 0.14, 1.7, x, 1.36, MINT, MINT2); pull(x + (n === 2 ? (i ? -0.8 : 0.8) : 1.2), 1.9, 1.0, true); }
  if (kind === 'sink') { // a chrome-rimmed steel basin sunk in the top, and a tall tap
    const bw = width - 2.2;
    b.box(bw, 0.06, 2.2, 0, 3.7, F - 1.7, '#7d868e'); b.box(bw + 0.3, 0.14, 0.2, 0, 3.72, F - 0.55, CH); b.box(bw + 0.3, 0.14, 0.2, 0, 3.72, F - 2.85, CH); b.box(0.2, 0.14, 2.5, -bw / 2 - 0.1, 3.72, F - 1.7, CH); b.box(0.2, 0.14, 2.5, bw / 2 + 0.1, 3.72, F - 1.7, CH);
    b.cyl3(0.2, 0.25, 0.3, 0, 3.8, F - 3.1, CH); b.cyl3(0.1, 0.1, 1.6, 0, 4.6, F - 3.1, CH); b.cyl3(0.09, 0.09, 1.1, 0, 5.35, F - 2.6, CH, [Math.PI / 2, 0, 0]); b.cyl3(0.09, 0.09, 0.5, 0, 5.1, F - 2.1, CH); b.cyl3(0.14, 0.14, 0.2, -0.9, 3.85, F - 3.1, RED); b.cyl3(0.14, 0.14, 0.2, 0.9, 3.85, F - 3.1, RED);
    // the window in the back wall, deep set, with a thick chrome sill
    b.box(width - 1.2, 0.5, 0.4, 0, 9.0, back + 0.1, RED); b.box(width - 1.2, 0.5, 0.4, 0, 6.6, back + 0.1, RED); b.box(0.5, 2.4, 0.4, -(width - 1.2) / 2 + 0.25, 7.8, back + 0.1, RED); b.box(0.5, 2.4, 0.4, (width - 1.2) / 2 - 0.25, 7.8, back + 0.1, RED);
    b.glow(width - 2.2, 2.4, 0, 7.8, back + 0.02, '#1c2e55'); b.box(0.16, 2.4, 0.2, 0, 7.8, back + 0.12, RED); b.box(width - 2.2, 0.16, 0.2, 0, 7.8, back + 0.12, RED);
    b.box(width - 0.6, 0.28, 1.4, 0, 6.35, back + 0.7, CH);
    return b;
  }
  // upper cabinets: deep boxes with thick doors, a chrome trim under them and a cap on top (every other one deeper, so the run is not a flat wall)
  const du = idx % 2 ? 3.1 : 2.4;
  b.box(width, 3.0, du, 0, 8.0, F - du / 2, sideShade);
  for (let i = 0; i < n; i++) { const x = -width / 2 + (i + 0.5) * (width / n); slab(width / n - 0.14, 2.8, x, 8.0, MINT, MINT2); pull(x + (n === 2 ? (i ? -0.8 : 0.8) : 1.2), 7.2, 0.9, true); }
  b.box(width + 0.04, 0.12, 0.14, 0, 6.44, F + 0.14, CH);
  b.box(width + 0.12, 0.3, du + 0.14, 0, 9.65, F - du / 2 + 0.07, MINT2);
  return b;
}


/** A corner of the room: a plain base block with a worktop and a small cupboard over it, so the two walls of cabinets meet. */
function cornerBlock(b: Builder): Builder {
  b.box(5, 3.2, 5, 0, 1.6, 0, '#4aa88a'); b.box(5.04, 0.45, 5.04, 0, 3.425, 0, CREAM); b.box(3.6, 3, 3.6, 0.7, 8.0, 0.7, '#4aa88a'); b.box(3.7, 0.3, 3.7, 0.7, 9.65, 0.7, MINT2);
  return b;
}

/**
 * The kitchen's cabinets, Retro Diner style (mint cabinets with chrome, a cream cooker, a pink fridge), standing round the four walls with real depth: base cabinets, sinks under windows, a fridge, and the ONE cooker on the
 * north wall at COOKER (a landmark), plus the four corners. They all stand outside the playable floor. Each unit is its own piece, so the scene can fade just the ones in the camera's way.
 */
export function buildKitchenUnits(half: number): Piece[] {
  const pieces: Piece[] = [];
  const walls: { turn: number; at: (d: number) => [number, number]; stove: boolean }[] = [
    { turn: 0, at: (d) => [0, -d], stove: true }, // north wall: the room is at +z
    { turn: Math.PI, at: (d) => [0, d], stove: false },
    { turn: -Math.PI / 2, at: (d) => [d, 0], stove: false },
    { turn: Math.PI / 2, at: (d) => [-d, 0], stove: false },
  ];
  const finishPiece = (b: Builder, wrapper: Group): Piece => {
    b.mergeNow();
    wrapper.updateMatrixWorld(true);
    const bx = new Box3().setFromObject(wrapper);
    return { object: wrapper, materials: b.materials, geometries: b.geometries, bounds: { minX: bx.min.x, maxX: bx.max.x, minZ: bx.min.z, maxZ: bx.max.z } };
  };
  walls.forEach((w, si) => {
    const runs: [number, number][] = w.stove ? [[-half, COOKER.x - COOKER.width / 2], [COOKER.x + COOKER.width / 2, half]] : [[-half, half]];
    let i = si * 3; // (a different start on each wall)
    const place = (kind: UnitKind, x0: number, width: number) => {
      const b = new Builder();
      retroUnit(kind, width, i, b);
      b.object.position.set(x0 + width / 2, 0, -SHIFT);
      const holder = new Group();
      holder.add(b.object);
      holder.rotation.y = w.turn;
      const [px, pz] = w.at(half);
      holder.position.set(px, 0, pz);
      const wrapper = new Group();
      wrapper.add(holder);
      pieces.push(finishPiece(b, wrapper));
      i++;
    };
    for (const [from, to] of runs) {
      const n = Math.max(1, Math.round((to - from) / 6)), width = (to - from) / n; // (equal units, no gaps)
      for (let k = 0; k < n; k++) place(CYCLE[i % CYCLE.length], from + k * width, width);
    }
    if (w.stove) place('stove', COOKER.x - COOKER.width / 2, COOKER.width);
  });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const b = new Builder();
    cornerBlock(b);
    b.object.position.set(sx * (half + 2.5), 0, sz * (half + 2.5));
    const wrapper = new Group();
    wrapper.add(b.object);
    pieces.push(finishPiece(b, wrapper));
  }
  return pieces;
}

export const disposeMaterial = (m: Material) => m.dispose();
export const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
