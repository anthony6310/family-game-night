import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh, MeshStandardMaterial,
  LatheGeometry, Color, Quaternion, SphereGeometry, Vector2, Vector3, Euler, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPECIES, VARIANTS, type SpeciesId } from '@fgn/shared';
import { HeadKit } from '../penguin/headKit';
import { FishKit } from '../snowball/fish';

/**
 * Every animal in Zoo Adoption as ONE merged, flat-shaded, vertex-colored model, so a crowd of a hundred animals costs only one draw per kind
 * (they are drawn as instances). All face +z with their feet on y = 0.
 *
 *  - The penguin, seal and bear are the very same models as Penguin Lasso (same shapes, the same HeadKit heads; the first color option is its colors),
 *    and the fish is the Fishing / Snowball FishKit fish (lying on its side, since it flops on the ground).
 *  - The rest (cat, dog, lion, tiger, parrot, seagull, pelican, cockroach) are new, built the same way, to the same scale: the units are
 *    about 2.2 per metre (a penguin is 2.4 tall, as it is in Penguin Lasso).
 */

const SPHERE = new SphereGeometry(1, 12, 10);
const BOX = new BoxGeometry(1, 1, 1);
const CYL = new CylinderGeometry(1, 1, 1, 8);
const ICO = new IcosahedronGeometry(1, 1);

type Vec3 = [number, number, number];

/** The penguin's body: the very same outline Penguin Lasso turns round into a pear (widest low down, narrowing up to the neck). */
function makePenguinTorsoGeometry(): LatheGeometry {
  const outline: [number, number][] = [[0.001, 0.08], [0.4, 0.12], [0.66, 0.4], [0.74, 0.8], [0.68, 1.2], [0.52, 1.55], [0.32, 1.78], [0.001, 1.86]];
  return new LatheGeometry(outline.map(([r, y]) => new Vector2(r, y)), 12);
}

/** Collects parts (each with a color baked into its vertices) and merges them into one geometry. */
export class Model {
  private parts: BufferGeometry[] = [];

  /** Bake `geometry` (already scaled/rotated/moved by `matrix`) in `color`. */
  private bake(geometry: BufferGeometry, matrix: Matrix4, color: { r: number; g: number; b: number }) {
    let g = geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.applyMatrix4(matrix);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.parts.push(g);
  }

  private static matrix(s: Vec3, p: Vec3, r: Vec3): Matrix4 {
    return new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2], 'YXZ')), new Vector3(...s));
  }

  private static rgb(hex: string) {
    const m = new MeshStandardMaterial({ color: hex });
    const c = { r: m.color.r, g: m.color.g, b: m.color.b };
    m.dispose();
    return c;
  }

  /** An oval (a squashed ball) with radii sx, sy, sz, at (x, y, z), turned by (rx, ry, rz). */
  oval(color: string, s: Vec3, p: Vec3, r: Vec3 = [0, 0, 0]) { this.bake(SPHERE, Model.matrix(s, p, r), Model.rgb(color)); return this; }
  /** A rounded low-poly lump. */
  lump(color: string, s: Vec3, p: Vec3, r: Vec3 = [0, 0, 0]) { this.bake(ICO, Model.matrix(s, p, r), Model.rgb(color)); return this; }
  box(color: string, s: Vec3, p: Vec3, r: Vec3 = [0, 0, 0]) { this.bake(BOX, Model.matrix(s, p, r), Model.rgb(color)); return this; }
  /** An upright cylinder of the given radius and height, standing with its middle at (x, y, z). `taper` is the bottom radius over the top radius. */
  cyl(color: string, radius: number, height: number, p: Vec3, r: Vec3 = [0, 0, 0], taper = 1) {
    const g = new CylinderGeometry(radius, radius * taper, height, 8);
    this.bake(g, Model.matrix([1, 1, 1], p, r), Model.rgb(color));
    g.dispose();
    return this;
  }
  /** A thin rounded rod from point `a` to point `b` with the given radius (for jointed legs, feelers, necks). */
  limb(color: string, a: Vec3, b: Vec3, radius: number) {
    const A = new Vector3(...a), B = new Vector3(...b);
    const d = B.clone().sub(A);
    const length = d.length();
    if (length < 1e-6) return this;
    const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), d.normalize());
    this.bake(SPHERE, new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(length / 2, radius, radius)), Model.rgb(color));
    return this;
  }
  /** A cone pointing along +y (turn it to aim it). */
  cone(color: string, radius: number, height: number, p: Vec3, r: Vec3 = [0, 0, 0]) {
    const g = new ConeGeometry(radius, height, 6);
    this.bake(g, Model.matrix([1, 1, 1], p, r), Model.rgb(color));
    g.dispose();
    return this;
  }
  /** Bake every mesh of an existing model (a head from HeadKit, the FishKit fish, ...) in with its own materials' colors, moved by `at`. */
  group(group: Group, at: Matrix4 = new Matrix4(), recolor?: Record<string, string>) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const material = (Array.isArray(o.material) ? o.material[0] : o.material) as Material & { color?: { r: number; g: number; b: number } };
      let color = material.color ?? { r: 1, g: 1, b: 1 };
      const swap = recolor?.[new Color(color.r, color.g, color.b).getHexString()]; // (a part whose color is in the table is baked in the new color)
      if (swap) color = Model.rgb(swap);
      this.bake(o.geometry, new Matrix4().multiplyMatrices(at, o.matrixWorld), color);
    });
    return this;
  }
  /** Just the baked geometry, scaled about the origin. */
  build(scale = 1): BufferGeometry {
    const merged = mergeGeometries(this.parts)!;
    this.parts.forEach((p) => p.dispose());
    if (scale !== 1) merged.scale(scale, scale, scale);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

const EYE = '#14161c';
const EYE_WHITE = '#f7f7f2';
const NOSE = '#1b1b1f';

// ---------------------------------------------------------------- four-legged animals (the shared body plan)

interface Quad {
  body: string; belly: string; paw: string; nose: string; ear: string; snoutColor: string;
  L: number; W: number; H: number; leg: number; legR: number; head: number; snoutLen: number; snoutR: number;
  ears: 'cat' | 'floppy' | 'round';
  tail: 'cat' | 'dog' | 'lion';
  tailColor?: string; tuft?: string; mane?: string; stripes?: string;
  eye?: string; pupil?: string; // the white of the eye and the pupil (an albino animal has pink pupils)
}

/**
 * A four-legged animal facing +z: a body, four legs, a head with a snout, ears, eyes and a tail. Cats, dogs, the lion and the tiger are all
 * this body plan with different proportions, colors and details.
 */
function quad(m: Model, o: Quad) {
  const bodyY = o.leg + o.H * 0.85;
  m.oval(o.body, [o.W, o.H, o.L], [0, bodyY, 0]);
  m.oval(o.belly, [o.W * 0.8, o.H * 0.6, o.L * 0.85], [0, bodyY - o.H * 0.4, o.L * 0.05]);
  for (const z of [-1, 1]) for (const s of [-1, 1]) {
    const legTop = bodyY - o.H * 0.45;
    m.cyl(o.body, o.legR, legTop, [s * o.W * 0.62, legTop / 2, z * o.L * 0.58], [0, 0, 0], 0.85);
    m.oval(o.paw, [o.legR * 1.2, o.legR * 0.65, o.legR * 1.6], [s * o.W * 0.62, o.legR * 0.55, z * o.L * 0.58 + o.legR * 0.45]);
  }
  const hy = bodyY + o.H * 0.95;
  const hz = o.L * 0.92 + o.head * 0.35;
  if (o.mane) m.oval(o.mane, [o.head * 1.55, o.head * 1.55, o.head * 1.1], [0, hy - o.head * 0.05, hz - o.head * 0.5]);
  m.oval(o.body, [o.head, o.head * 0.92, o.head], [0, hy, hz]);
  m.oval(o.snoutColor, [o.snoutR, o.snoutR * 0.8, o.snoutLen], [0, hy - o.head * 0.28, hz + o.head * 0.75]);
  m.oval(o.nose, [o.snoutR * 0.45, o.snoutR * 0.35, o.snoutR * 0.3], [0, hy - o.head * 0.14, hz + o.head * 0.75 + o.snoutLen * 0.92]);
  for (const s of [-1, 1]) {
    m.oval(o.eye ?? EYE_WHITE, [o.head * 0.17, o.head * 0.17, o.head * 0.1], [s * o.head * 0.42, hy + o.head * 0.22, hz + o.head * 0.78]);
    m.oval(o.pupil ?? EYE, [o.head * 0.09, o.head * 0.13, o.head * 0.06], [s * o.head * 0.43, hy + o.head * 0.22, hz + o.head * 0.86]);
    if (o.ears === 'cat') m.cone(o.ear, o.head * 0.36, o.head * 0.7, [s * o.head * 0.58, hy + o.head * 0.88, hz - o.head * 0.15], [0, 0, -s * 0.25]);
    else if (o.ears === 'round') m.oval(o.ear, [o.head * 0.28, o.head * 0.28, o.head * 0.14], [s * o.head * 0.66, hy + o.head * 0.78, hz - o.head * 0.2]);
    else m.oval(o.ear, [o.head * 0.18, o.head * 0.55, o.head * 0.3], [s * o.head * 0.92, hy + o.head * 0.15, hz - o.head * 0.15], [0, 0, s * 0.35]); // floppy
  }
  const tailColor = o.tailColor ?? o.body;
  if (o.tail === 'cat') {
    // a long thin tail curling up behind
    const pts: Vec3[] = [[0, bodyY + o.H * 0.2, -o.L - 0.05], [0, bodyY + o.H * 0.55, -o.L - 0.3 * o.L], [0, bodyY + o.H * 1.15, -o.L - 0.42 * o.L], [0, bodyY + o.H * 1.9, -o.L - 0.38 * o.L]];
    pts.forEach((p, i) => m.oval(i === pts.length - 1 && o.tuft ? o.tuft : tailColor, [o.W * 0.28, o.W * 0.28, o.W * 0.28], p));
  } else if (o.tail === 'dog') {
    m.oval(tailColor, [o.W * 0.28, o.W * 0.28, o.L * 0.42], [0, bodyY + o.H * 0.75, -o.L - o.L * 0.22], [0.75, 0, 0]);
  } else {
    m.oval(tailColor, [o.W * 0.14, o.W * 0.14, o.L * 0.6], [0, bodyY - o.H * 0.2, -o.L - o.L * 0.45], [-0.35, 0, 0]);
    if (o.tuft) m.oval(o.tuft, [o.W * 0.3, o.W * 0.3, o.W * 0.5], [0, bodyY - o.H * 0.55, -o.L - o.L * 0.95], [-0.35, 0, 0]);
  }
  if (o.stripes) {
    // rings round the body and a few marks on the head and tail (each ring is as wide as the body is where it sits)
    for (let t = -0.8; t <= 0.8; t += 0.2) {
      const k = Math.sqrt(1 - t * t);
      m.oval(o.stripes, [o.W * k * 1.04 + 0.01, o.H * k * 0.92 + 0.01, o.L * 0.055], [0, bodyY + o.H * 0.1, t * o.L]);
    }
    for (const s of [-1, 1]) m.oval(o.stripes, [o.head * 0.04, o.head * 0.2, o.head * 0.06], [s * o.head * 0.3, hy + o.head * 0.6, hz + o.head * 0.55]);
    m.oval(o.stripes, [o.head * 0.03, o.head * 0.22, o.head * 0.05], [0, hy + o.head * 0.7, hz + o.head * 0.5]);
  }
}

// ---------------------------------------------------------------- the individual animals (each takes its color option: 0 = original, 1 = the second look)

function penguin(v: number, head: HeadKit, torso: BufferGeometry): Model {
  // Penguin Lasso's penguin: a pear-shaped body, a pale front, the HeadKit head, flat orange feet. Option 1 is a brown penguin with a cream front.
  const m = new Model();
  const dark = ['#1e2a47', '#5e4332'][v], white = ['#f6fbff', '#f1e6d2'][v], orange = '#ff9a1f';
  const t = torso.clone().toNonIndexed();
  t.deleteAttribute('uv');
  const c = new MeshStandardMaterial({ color: dark });
  const part = new Group();
  const torsoMesh = new Mesh(t, c);
  torsoMesh.scale.set(1, 1, 0.85); // flatter front to back than it is wide, as in Penguin Lasso
  part.add(torsoMesh);
  m.group(part);
  c.dispose();
  m.lump(white, [0.62 * 0.8, 0.62 * 1.2, 0.62 * 0.5], [0, 0.88, 0.42]);
  m.group(head.build('penguin'), new Matrix4().makeTranslation(0, 2.0, 0.04), v === 1 ? { '1e2a47': dark } : undefined);
  for (const side of [-1, 1]) {
    const foot = new CylinderGeometry(0.3, 0.3, 0.06, 3);
    const mat = new MeshStandardMaterial({ color: orange });
    const g = new Group();
    const mesh = new Mesh(foot, mat);
    mesh.position.set(side * 0.36, 0.05, 0.32);
    mesh.rotation.y = side * 0.4;
    mesh.scale.set(1, 1, 1.25);
    g.add(mesh);
    m.group(g);
    foot.dispose(); mat.dispose();
  }
  return m;
}

function seal(v: number, head: HeadKit): Model {
  // Option 1 is a brown seal.
  const m = new Model();
  const body = ['#7f93a8', '#6a4a36'][v], belly = ['#cbd8e4', '#d8c2a2'][v];
  m.oval(body, [0.85, 0.78, 1.55], [0, 0.78, 0]);
  m.oval(belly, [0.7, 0.5, 1.35], [0, 0.55, 0.1]);
  m.group(head.build('seal'), new Matrix4().compose(new Vector3(0, 1.15, 1.35), new Quaternion().setFromEuler(new Euler(-0.3, 0, 0)), new Vector3(1, 1, 1)), v === 1 ? { '7f93a8': body, 'cbd8e4': belly } : undefined);
  for (const side of [-1, 1]) {
    m.oval(body, [0.48, 0.08, 0.26], [side * 0.95, 0.3, 0.55], [0, side * 0.7, 0]);
    m.oval(body, [0.36, 0.08, 0.3], [side * 0.3, 0.28, -1.6], [0, side * 0.5, 0]);
  }
  return m;
}

function bear(v: number, head: HeadKit): Model {
  // Option 0 is the polar bear, option 1 a brown bear.
  const m = new Model();
  const fur = ['#eef3f8', '#6b4423'][v], muzzle = ['#f7eedb', '#b48a5a'][v];
  m.oval(fur, [1.2, 1.1, 1.75], [0, 2.0, -0.1]);
  m.oval(fur, [1.0, 0.8, 0.9], [0, 2.45, 0.85]);
  for (const z of [-1, 1]) for (const side of [-1, 1]) {
    m.oval(fur, [0.42, 1.05, 0.46], [side * 0.68, 1.0, z * 0.95]);
    m.oval(muzzle, [0.46, 0.18, 0.55], [side * 0.68, 0.14, z * 0.95 + 0.12]);
  }
  m.oval(fur, [0.28, 0.28, 0.28], [0, 2.35, -1.8]);
  m.group(head.build('bear'), new Matrix4().makeTranslation(0, 2.75, 1.75), v === 1 ? { eef3f8: fur, f7eedb: muzzle } : undefined);
  return m;
}

function fish(v: number): Model {
  // The Fishing fish, lying on its side the way it flops about on the ground, nose towards +z. Option 0 is orange, option 1 blue with yellow fins.
  const look = [{ body: '#ff8a3d', fin: '#e8591a' }, { body: '#2f86f0', fin: '#f2c230' }][v];
  const kit = new FishKit({ ...look, eyes: 'round' });
  const g = kit.create();
  const lay = new Matrix4().multiplyMatrices(new Matrix4().makeRotationZ(-Math.PI / 2), new Matrix4().makeRotationY(-Math.PI / 2)); // nose to +z, flat side up
  lay.premultiply(new Matrix4().makeTranslation(0, 0.3, 0));
  return new Model().group(g, lay);
}

function cat(v: number): Model {
  // Option 0 an orange tabby, option 1 a black cat with white paws and yellow-green eyes.
  const m = new Model();
  const base = { L: 0.55, W: 0.25, H: 0.27, leg: 0.25, legR: 0.075, head: 0.27, snoutLen: 0.1, snoutR: 0.13, ears: 'cat' as const, tail: 'cat' as const, nose: '#e58a8a' };
  if (v === 0) quad(m, { ...base, body: '#e8923a', belly: '#f7dfb8', paw: '#f7dfb8', ear: '#e8923a', snoutColor: '#f7dfb8', tailColor: '#d97f2a', stripes: '#b9611c' });
  else quad(m, { ...base, body: '#2b2b31', belly: '#3c3c44', paw: '#f1f1f1', ear: '#2b2b31', snoutColor: '#3c3c44', tailColor: '#2b2b31', eye: '#d8e04a' });
  return m;
}
function dog(v: number): Model {
  // Option 0 a golden dog with floppy brown ears, option 1 a white dog with brown ears and tail.
  const m = new Model();
  const base = { L: 1.0, W: 0.45, H: 0.5, leg: 0.75, legR: 0.15, head: 0.45, snoutLen: 0.5, snoutR: 0.22, ears: 'floppy' as const, tail: 'dog' as const, nose: NOSE };
  if (v === 0) quad(m, { ...base, body: '#d8a24e', belly: '#ecd3a0', paw: '#ecd3a0', ear: '#a8742a', snoutColor: '#ecd3a0' });
  else quad(m, { ...base, body: '#f3ead8', belly: '#fff8ec', paw: '#fff8ec', ear: '#8a5a2b', snoutColor: '#fff8ec', tailColor: '#8a5a2b' });
  return m;
}
function lion(v: number): Model {
  // Option 1 is an albino lion: a cream-white coat and mane, a pink nose and pink pupils.
  const m = new Model();
  const base = { L: 1.4, W: 0.75, H: 0.8, leg: 1.0, legR: 0.24, head: 0.6, snoutLen: 0.35, snoutR: 0.3, ears: 'round' as const, tail: 'lion' as const };
  if (v === 0) quad(m, { ...base, body: '#d9a85a', belly: '#ecd2a0', paw: '#c7924a', nose: '#3b2a24', ear: '#b5803c', snoutColor: '#ecd2a0', tuft: '#6b3f1a', mane: '#8a5a22' });
  else quad(m, { ...base, body: '#f6f0e6', belly: '#fffaf2', paw: '#ece2d4', nose: '#e58a8a', ear: '#efe5d8', snoutColor: '#fffaf2', tuft: '#ece2d4', mane: '#e9dfcf', pupil: '#c2305a' });
  return m;
}
function tiger(v: number): Model {
  // Option 1 is an albino (white) tiger: a white coat with dark stripes, a pink nose and blue eyes.
  const m = new Model();
  const base = { L: 1.45, W: 0.7, H: 0.75, leg: 0.95, legR: 0.22, head: 0.55, snoutLen: 0.32, snoutR: 0.28, ears: 'round' as const, tail: 'lion' as const, nose: '#e58a8a' };
  if (v === 0) quad(m, { ...base, body: '#ee8a2c', belly: '#fbeedd', paw: '#fbeedd', ear: '#ee8a2c', snoutColor: '#fbeedd', tuft: '#1a1612', stripes: '#1a1612' });
  else quad(m, { ...base, body: '#f6f3ec', belly: '#ffffff', paw: '#ffffff', ear: '#f6f3ec', snoutColor: '#ffffff', tuft: '#2a2420', stripes: '#3d342f', pupil: '#3a8fe0' });
  return m;
}

function parrot(v: number): Model {
  // A round, cute cockatiel-style parrot: a big round body and head, a small beak, a swept crest, big eyes, short wings and a short tail.
  // Option 0 is green with a red crest and blue wing tips; option 1 is a scarlet macaw's colors: red with yellow wings and blue tips.
  const c = [
    { body: '#2fbf4a', chest: '#f4d03f', wing: '#2fbf4a', tip: '#2f6fe0', crown: '#e23b3b', tail: '#e23b3b', cheek: '#f08a3a' },
    { body: '#e0302e', chest: '#ec5a52', wing: '#f4c230', tip: '#2f6fe0', crown: '#e0302e', tail: '#e0302e', cheek: '#f4efe6' },
  ][v];
  const foot = '#8c7f73';
  const m = new Model();
  m.oval(c.body, [0.46, 0.5, 0.42], [0, 0.72, 0]); // a round body
  m.oval(c.chest, [0.34, 0.34, 0.16], [0, 0.66, 0.28]);
  m.oval(c.body, [0.37, 0.36, 0.36], [0, 1.28, 0.1]); // a big round head
  for (let i = 0; i < 3; i++) m.cone(c.crown, 0.07, 0.4 - i * 0.07, [0, 1.62 - i * 0.02, 0.02 - i * 0.11], [-0.9 - i * 0.25, 0, 0]); // the crest, swept back
  m.cone('#f0a030', 0.1, 0.22, [0, 1.22, 0.46], [Math.PI / 2 + 0.55, 0, 0]); // a small beak
  for (const s of [-1, 1]) {
    m.oval('#fbfbf6', [0.11, 0.12, 0.05], [s * 0.2, 1.33, 0.35], [0, s * 0.5, 0]); // big eyes
    m.oval(EYE, [0.07, 0.085, 0.04], [s * 0.22, 1.33, 0.38], [0, s * 0.5, 0]);
    m.oval(c.cheek, [0.1, 0.09, 0.04], [s * 0.3, 1.2, 0.3], [0, s * 0.8, 0]); // a round cheek patch
    m.oval(c.wing, [0.12, 0.38, 0.28], [s * 0.42, 0.72, -0.05], [-0.1, 0, s * 0.12]); // short wings
    m.oval(c.tip, [0.09, 0.2, 0.18], [s * 0.44, 0.45, -0.12], [-0.2, 0, s * 0.12]);
    m.cyl(foot, 0.045, 0.28, [s * 0.16, 0.16, 0.04]); // legs
    for (const t of [-0.07, 0, 0.07]) m.oval(foot, [0.04, 0.03, 0.13], [s * 0.16 + t, 0.03, 0.14], [0, t * 3, 0]); // toes
  }
  for (const yaw of [-0.12, 0.12]) m.cone(c.tail, 0.11, 0.7, [yaw * -2.2, 0.35, -0.55], [-2.1, yaw, 0]); // a short tail
  return m;
}

function seagull(v: number): Model {
  // Option 0 is the white adult; option 1 a brown young gull with a dark beak.
  const c = [
    { body: '#f4f6f8', wing: '#9aa6b3', tip: '#22262c', beak: '#f2c230', spot: '#e0382c', leg: '#f08a30' },
    { body: '#b8a692', wing: '#7d6c5c', tip: '#3a322c', beak: '#5a524c', spot: '#5a524c', leg: '#c9a58a' },
  ][v];
  const m = new Model();
  m.oval(c.body, [0.3, 0.27, 0.55], [0, 0.85, 0]);
  m.oval(c.body, [0.2, 0.2, 0.2], [0, 1.1, 0.42]); // the neck
  m.oval(c.body, [0.2, 0.2, 0.21], [0, 1.25, 0.5]); // the head
  m.oval(c.beak, [0.07, 0.07, 0.24], [0, 1.2, 0.74], [0.15, 0, 0]); // the beak
  m.oval(c.spot, [0.05, 0.05, 0.05], [0, 1.16, 0.88]); // its spot
  m.oval(c.body, [0.2, 0.06, 0.3], [0, 0.85, -0.6], [-0.15, 0, 0]); // the tail
  for (const s of [-1, 1]) {
    m.oval(EYE, [0.04, 0.05, 0.04], [s * 0.15, 1.3, 0.62]);
    m.oval(c.wing, [0.2, 0.09, 0.5], [s * 0.2, 0.98, -0.08], [0, 0, s * 0.2]); // wings folded on the back
    m.oval(c.tip, [0.16, 0.06, 0.2], [s * 0.2, 0.96, -0.55], [0, 0, s * 0.2]); // wing tips
    m.cyl(c.leg, 0.035, 0.6, [s * 0.12, 0.3, 0.05]); // thin legs
    m.oval(c.leg, [0.1, 0.025, 0.16], [s * 0.12, 0.025, 0.12]);
  }
  return m;
}

function pelican(v: number): Model {
  // Option 0 is the white pelican; option 1 a brown pelican with a white head and neck.
  const c = [
    { body: '#f6f4ee', neck: '#f6f4ee', wing: '#c9ccd2', bill: '#f4b63c', pouch: '#f2cf72' },
    { body: '#7a6553', neck: '#f1ead6', wing: '#5a4a3c', bill: '#9b9585', pouch: '#b9ad90' },
  ][v];
  const orange = '#f08a30';
  const m = new Model();
  m.oval(c.body, [0.55, 0.5, 0.85], [0, 1.1, 0]); // a big body
  m.oval(c.neck, [0.2, 0.2, 0.2], [0, 1.5, 0.5]); // the S of the neck, rising and curving
  m.oval(c.neck, [0.17, 0.2, 0.17], [0, 1.85, 0.62]);
  m.oval(c.neck, [0.15, 0.2, 0.15], [0, 2.2, 0.52]);
  m.oval(c.neck, [0.24, 0.24, 0.26], [0, 2.5, 0.62]); // the head
  m.oval(c.bill, [0.1, 0.09, 0.75], [0, 2.46, 1.3], [0.05, 0, 0]); // the huge bill
  m.oval(c.pouch, [0.14, 0.17, 0.62], [0, 2.3, 1.22], [0.12, 0, 0]); // and the pouch under it
  m.oval(c.body, [0.3, 0.1, 0.55], [0, 0.95, -0.95], [-0.2, 0, 0]); // the tail
  for (const s of [-1, 1]) {
    m.oval(EYE, [0.04, 0.05, 0.04], [s * 0.2, 2.56, 0.78]);
    m.oval(c.wing, [0.2, 0.45, 0.75], [s * 0.52, 1.15, -0.05], [0, 0, s * 0.12]); // wings folded at the sides
    m.cyl(orange, 0.06, 0.5, [s * 0.22, 0.25, 0.1]); // short legs
    const foot = new Mesh(new CylinderGeometry(0.3, 0.3, 0.05, 3), new MeshStandardMaterial({ color: orange }));
    foot.position.set(s * 0.22, 0.03, 0.28); foot.rotation.y = s * 0.3; foot.scale.set(0.9, 1, 1.4);
    m.group(new Group().add(foot));
    foot.geometry.dispose(); (foot.material as Material).dispose();
  }
  return m;
}

/** Six jointed legs for the cockroach: each goes out and up to a knee, then out and down to the floor; the front legs sweep forward and the back legs back. */
function roachLegs(m: Model, color: string, hips: number[], reach: number, thick: number, knee: number, fore: number) {
  hips.forEach((z, i) => {
    const sweep = i === 0 ? fore : i === 1 ? 0.04 : -fore;
    for (const s of [-1, 1]) {
      const hip: Vec3 = [s * 0.17, 0.2, z];
      const kneeAt: Vec3 = [s * (0.17 + reach * 0.55), 0.2 + knee, z + sweep * 0.5];
      const foot: Vec3 = [s * (0.17 + reach), 0.02, z + sweep * 1.3];
      m.limb(color, hip, kneeAt, thick).limb(color, kneeAt, foot, thick * 0.8);
    }
  });
}

function roach(v: number): Model {
  // A sleek, flat, glossy cockroach: a long teardrop body, two glossy wing cases, a shield behind a tucked head, jointed legs and long curved feelers.
  // Option 0 is brown, option 1 is black.
  const c = [
    { shell: '#5a2e12', wing: '#7a3d18', gloss: '#9a5528', shield: '#6b3516', dark: '#2c150a', leg: '#3a1c0a' },
    { shell: '#1b1a1c', wing: '#26252a', gloss: '#4a4950', shield: '#2b292b', dark: '#0c0b0d', leg: '#0f0e10' },
  ][v];
  const m = new Model();
  m.oval(c.shell, [0.25, 0.09, 0.5], [0, 0.2, -0.12]); // the abdomen: a long flat teardrop
  for (const s of [-1, 1]) {
    m.oval(c.wing, [0.14, 0.05, 0.46], [s * 0.1, 0.27, -0.1], [0, s * 0.05, 0]); // two wing cases, side by side
    m.oval(c.gloss, [0.05, 0.02, 0.3], [s * 0.1, 0.3, -0.05], [0, s * 0.05, 0]); // with a shine on each
  }
  m.oval(c.shield, [0.24, 0.085, 0.17], [0, 0.23, 0.3]); // the shield behind the head
  m.oval(c.dark, [0.12, 0.07, 0.12], [0, 0.18, 0.5]); // the head, tucked low
  for (const s of [-1, 1]) {
    m.oval(EYE, [0.03, 0.035, 0.03], [s * 0.08, 0.22, 0.56]);
    m.limb(c.dark, [s * 0.05, 0.22, 0.58], [s * 0.2, 0.32, 0.92], 0.014).limb(c.dark, [s * 0.2, 0.32, 0.92], [s * 0.44, 0.3, 1.3], 0.012).limb(c.dark, [s * 0.44, 0.3, 1.3], [s * 0.7, 0.2, 1.4], 0.01); // long curved feelers
  }
  roachLegs(m, c.leg, [0.28, 0.02, -0.26], 0.42, 0.025, 0.14, 0.2);
  return m;
}

// ---------------------------------------------------------------- the kit

/** What the scene needs to know about a kind's model (the size it ended up). */
export interface AnimalModel {
  geometry: BufferGeometry;
  /** The tallest point, the length (z) and the widest (x), for the icons, the thought bubbles and the shadows. */
  height: number;
  length: number;
  width: number;
  /** How far the model is from its centre to its farthest edge, on the ground. */
  groundRadius: number;
}

/** How much each type is scaled when it is built (the bear is still a bit bigger than the lion, as a bear is, after being scaled down 15%; the dog is a medium dog). */
const SCALE: Record<SpeciesId, number> = { penguin: 1, seal: 1, bear: 1.105, fish: 0.8, cat: 1, dog: 0.9, lion: 1, tiger: 1, parrot: 1, seagull: 1, pelican: 1, roach: 1 };

/** Builds the model of every KIND once: `models[type * VARIANTS + color option]`. Call `dispose()` when done. */
export class AnimalKit {
  readonly material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  readonly models: AnimalModel[] = [];

  constructor() {
    const head = new HeadKit();
    const torso = makePenguinTorsoGeometry();
    const build: Record<SpeciesId, (v: number) => Model> = {
      penguin: (v) => penguin(v, head, torso),
      seal: (v) => seal(v, head),
      bear: (v) => bear(v, head),
      fish, cat, dog, lion, tiger, parrot, seagull, pelican, roach,
    };
    for (const s of SPECIES) {
      for (let v = 0; v < VARIANTS; v++) {
        const geometry = build[s.id](v).build(SCALE[s.id]);
        const box = geometry.boundingBox!;
        this.models.push({
          geometry,
          height: box.max.y,
          length: box.max.z - box.min.z,
          width: box.max.x - box.min.x,
          groundRadius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
        });
      }
    }
    head.dispose();
    torso.dispose();
  }

  dispose() {
    this.models.forEach((m) => m.geometry.dispose());
    this.material.dispose();
  }
}
