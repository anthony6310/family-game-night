import {
  BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, RepeatWrapping, Shape, ShapeGeometry, SRGBColorSpace, ShaderMaterial, Vector2, Vector3,
} from 'three';
import { DECK_Y, RAIL_Y, SHIP_HALF_BEAM, SHIP_HALF_LENGTH, SHIP_KEEL_Y, sideOf, type TeamId } from '@fgn/shared';
import { Model } from '../shelter/AnimalKit';

/** The models of Broadside Battle, all built in code: the ship (lofted hull, deck, masts, sails, flag), the cannon, the sea and the little textures. */


// ------------------------------------------------------------------------------------------------ the hull (the galleon): a lofted hull, a planked deck and the fittings

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const L = SHIP_HALF_LENGTH;

interface HullStyle {
  /** Half the beam at the widest, along the hull from the stern (u = 0) to the bow (u = 1). */
  half: (u: number) => number;
  rail: (u: number) => number; // the height of the top of the side
  keel: (u: number) => number;
  tumble: number; // how much narrower the top of the side is than the belly (the sides curve in at the top)
  colorAt: (y: number, u: number) => string; // the color of the side at this height
}

/** A smooth lofted hull: rings of points round the cross-section at stations along the ship, joined into facets. */
function loft(style: HullStyle): BufferGeometry {
  const N = 24, J = 9;
  const profile: [number, number][] = [[0, 1 - style.tumble], [0.12, 1 - style.tumble * 0.45], [0.3, 1], [0.6, 0.92], [0.85, 0.55], [1, 0]];
  const frac = (s: number) => { for (let i = 1; i < profile.length; i++) if (s <= profile[i][0]) { const [s0, f0] = profile[i - 1], [s1, f1] = profile[i]; return f0 + ((f1 - f0) * (s - s0)) / (s1 - s0); } return 0; };
  const rings: { x: number; y: number; z: number }[][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = -L + 2 * L * u, w = style.half(u), top = style.rail(u), k = style.keel(u);
    const ring: { x: number; y: number; z: number }[] = [];
    for (let j = 0; j <= J; j++) { const s = j / J; ring.push({ x, y: top + (k - top) * s, z: -w * frac(s) }); }
    for (let j = J - 1; j >= 0; j--) { const s = j / J; ring.push({ x, y: top + (k - top) * s, z: w * frac(s) }); }
    rings.push(ring);
  }
  const pos: number[] = [], col: number[] = [];
  const cache = new Map<string, Color>();
  const rgb = (h: string) => { let c = cache.get(h); if (!c) { c = new Color(h); cache.set(h, c); } return c; };
  const tri = (a: { x: number; y: number; z: number }, b: typeof a, c: typeof a, color: Color) => { for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); col.push(color.r, color.g, color.b); } };
  const count = rings[0].length;
  for (let i = 0; i < N; i++) for (let j = 0; j < count - 1; j++) {
    const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
    const color = rgb(style.colorAt((a.y + b.y + c.y + d.y) / 4, (i + 0.5) / N));
    tri(a, b, c, color); tri(a, c, d, color);
  }
  const stern = rings[0], mid = { x: -L, y: (stern[0].y + stern[J].y) / 2, z: 0 };
  for (let j = 0; j < count - 1; j++) tri(mid, stern[j + 1], stern[j], rgb('#4a2c18'));
  tri(mid, stern[0], stern[count - 1], rgb('#4a2c18')); // (the last piece of the stern: across the top, so the transom is whole and has no V cut in it)
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function deckFor(half: (u: number) => number, deckColor: string): { geometry: BufferGeometry; texture: CanvasTexture } {
  const shape = new Shape();
  const N = 24;
  const top: [number, number][] = [];
  for (let i = 0; i <= N; i++) { const u = i / N; top.push([-L + 2 * L * u, half(u) * 0.93]); }
  shape.moveTo(top[0][0], top[0][1]);
  for (const [x, z] of top) shape.lineTo(x, z);
  for (let i = N; i >= 0; i--) shape.lineTo(top[i][0], -top[i][1]);
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, DECK_Y, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = deckColor; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) { g.fillStyle = y % 32 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)'; g.fillRect(0, y, 128, 15); g.fillStyle = 'rgba(40,20,5,0.55)'; g.fillRect(0, y + 15, 128, 1.5); }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / 8, 1 / 8);
  return { geometry, texture };
}


const galleon: HullStyle = {
  half: (u) => SHIP_HALF_BEAM * (u < 0.5 ? 0.7 + 0.3 * Math.sin((u / 0.5) * Math.PI / 2) : u < 0.8 ? 1 : Math.sqrt(Math.max(0.0, 1 - ((u - 0.8) / 0.2) ** 2))) + 0.1 * (u > 0.97 ? 1 : 0),
  rail: (u) => 4.5 + 0.9 * u ** 2.2 + 2.0 * Math.max(0, (0.3 - u) / 0.3) ** 1.4, // a high sterncastle and a rising bow
  keel: (u) => SHIP_KEEL_Y * (0.45 + 0.55 * Math.sin(Math.PI * (0.08 + 0.84 * u))),
  tumble: 0.24,
  colorAt: (y) => (y > 4.0 ? '#3f2514' : y > 3.2 ? 'TEAM' : y > 2.6 ? '#c79a2e' : y > 0 ? (Math.floor(y / 0.55) % 2 ? '#6e4524' : '#5d3820') : '#3b2414'),
};
export function buildFittings(team: TeamId, color: string): BufferGeometry {
  const m = new Model();
  const side = sideOf(team);
  const stern = galleon.half(0);
  // the stern: a tall transom with a gallery of windows, gold trim and lanterns
  m.box('#6a4122', [0.5, 2.6, stern * 1.8], [-L + 0.1, DECK_Y + 2.3, 0]);
  m.box('#c79a2e', [0.7, 0.3, stern * 1.9], [-L, DECK_Y + 3.7, 0]);
  m.box('#c79a2e', [0.7, 0.3, stern * 1.9], [-L, DECK_Y + 0.9, 0]);
  for (const z of [-1.7, -0.57, 0.57, 1.7]) { m.box('#f2d77a', [0.6, 0.9, 0.7], [-L - 0.05, DECK_Y + 2.3, z]); m.box('#5a3419', [0.65, 0.1, 0.9], [-L - 0.05, DECK_Y + 2.85, z]); }
  for (const z of [-stern * 0.85, stern * 0.85]) { m.cyl('#5a3a20', 0.1, 1.6, [-L + 0.2, DECK_Y + 4.9, z]); m.oval('#ffe9a8', [0.34, 0.4, 0.34], [-L + 0.2, DECK_Y + 5.9, z]); }
  m.box('#6e4526', [5.6, 0.25, stern * 1.7], [-L + 3.2, DECK_Y + 2.2, 0]); // the deck of the castle
  // the bow: a long beakhead and a gold figurehead
  m.cyl('#5a3a20', 0.3, 8, [L + 1.4, 5.7, 0], [0, 0, -1.37]);
  m.oval('#c79a2e', [0.6, 0.6, 0.6], [L + 4.9, 7.0, 0]);
  m.cone('#c79a2e', 0.3, 1.1, [L + 5.5, 7.2, 0], [0, 0, -Math.PI / 2]);
  for (const [x, z, r] of [[12.4, -side * 2.6, 0.7], [-8.5, -side * 2.4, 0.7], [4.6, -side * 2.4, 0.62]] as const) { m.cyl('#8a5a35', r, 1.3, [x, DECK_Y + 0.65, z]); m.cyl('#4a4a4f', r * 1.02, 0.12, [x, DECK_Y + 0.4, z]); m.cyl('#4a4a4f', r * 1.02, 0.12, [x, DECK_Y + 0.95, z]); }
  void color;
  return m.build();
}


/** The hull, in the team's color along the side. */
export function buildHull(teamColor: string): BufferGeometry {
  return loft({ ...galleon, colorAt: (y, u) => { const c = galleon.colorAt(y, u); return c === 'TEAM' ? teamColor : c; } });
}
/** The deck: the outline of the ship at deck height, planked. */
export function buildDeck(): { geometry: BufferGeometry; texture: CanvasTexture } {
  return deckFor(galleon.half, '#a8774a');
}

// ------------------------------------------------------------------------------------------------ masts, sails, the rest of the ship

export const MAST_XS = [-9, 0, 9];
export const MAST_HEIGHTS = [15.5, 18, 15.5];

/** The masts, yards and crow's nests, in their own mesh: from the deck of their own ship the players see through them (see PirateScene), so a mast never hides the target. */
export function buildRigging(): BufferGeometry {
  const m = new Model();
  MAST_XS.forEach((x, i) => {
    const h = MAST_HEIGHTS[i];
    m.cyl('#6b4426', 0.42, h - DECK_Y, [x, DECK_Y + (h - DECK_Y) / 2, 0], [0, 0, 0], 1.1); // the mast
    for (const y of [7.0, 12.2]) {
      m.cyl('#5a3a20', 0.2, 9.6, [x + 0.15, y, 0], [Math.PI / 2, 0, 0]); // a yard (a long beam across the ship)
      m.oval('#5a3a20', [0.3, 0.3, 0.3], [x + 0.15, y, 4.9]); m.oval('#5a3a20', [0.3, 0.3, 0.3], [x + 0.15, y, -4.9]);
    }
    m.cyl('#4a3018', 0.55, 0.5, [x, h - 3.5, 0]); // the crow's nest rim
  });
  return m.build();
}

export interface SailRig {
  mesh: Mesh;
  geometry: BufferGeometry;
  base: Float32Array;
  cols: number;
  rows: number;
  phase: number;
}
/** The sail texture: sailcloth with stitching and a stripe and a round emblem in the team's color. */
export function makeSailTexture(teamColor: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1e7cf'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 51) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 192); g.stroke(); }
  g.fillStyle = teamColor; g.fillRect(0, 20, 256, 16); g.fillRect(0, 156, 256, 16);
  g.beginPath(); g.arc(128, 96, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f1e7cf'; g.beginPath(); g.arc(128, 96, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = teamColor; g.beginPath(); g.arc(128, 96, 11, 0, Math.PI * 2); g.fill();
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
/** A sail on a yard: a grid of points across the ship (z) and up (y) that the wind pushes forward (+x) into a belly. */
export function buildSail(texture: CanvasTexture, x: number, y0: number, height: number, phase: number): SailRig {
  const cols = 12, rows = 9;
  const width = 8.8;
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    positions.push(x, y0 + v * height, (u - 0.5) * width);
    uvs.push(u, v);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; index.push(a, c, b, b, c, d); }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: texture, side: DoubleSide, roughness: 0.95, flatShading: false }));
  mesh.frustumCulled = false;
  return { mesh, geometry, base: new Float32Array(positions), cols, rows, phase };
}
/** Fill the sail with wind: a belly that bulges forward, with a gentle ripple moving across it. */
export function billowSail(s: SailRig, t: number) {
  const pos = s.geometry.getAttribute('position') as Float32BufferAttribute;
  for (let j = 0; j <= s.rows; j++) for (let i = 0; i <= s.cols; i++) {
    const u = i / s.cols, v = j / s.rows, k = j * (s.cols + 1) + i;
    const belly = Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * (0.05 + 0.9 * v));
    const gust = 0.88 + 0.12 * Math.sin(t * 1.7 + s.phase) + 0.05 * Math.sin(t * 3.1 + s.phase * 2 + u * 5);
    pos.setX(k, s.base[k * 3] + 1.55 * belly * gust + 0.12 * Math.sin(t * 4 + u * 7 + v * 3 + s.phase) * belly);
  }
  pos.needsUpdate = true;
  s.geometry.computeVertexNormals();
}

/** A pennant on the mast top in the team's color: a thin flag that streams towards the bow and waves. */
export function buildFlag(color: string): { mesh: Mesh; geometry: BufferGeometry; base: Float32Array; cols: number } {
  const cols = 8, rows = 1;
  const positions: number[] = [], index: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const u = i / cols; positions.push(u * 4.2, (j - 0.5) * 1.5 * (1 - u * 0.85), 0); }
  for (let i = 0; i < cols; i++) { const a = i, b = i + 1, c = i + cols + 1, d = c + 1; index.push(a, c, b, b, c, d); }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide }));
  mesh.frustumCulled = false;
  return { mesh, geometry, base: new Float32Array(positions), cols };
}
export function waveFlag(f: { geometry: BufferGeometry; base: Float32Array; cols: number }, t: number) {
  const pos = f.geometry.getAttribute('position') as Float32BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const u = (k % (f.cols + 1)) / f.cols;
    pos.setZ(k, Math.sin(t * 7 - u * 6) * 0.45 * u);
    pos.setY(k, f.base[k * 3 + 1] + Math.sin(t * 5 - u * 5) * 0.12 * u);
  }
  pos.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ the cannon

/** The iron barrel, along +z from the breech (z = -0.7) to the muzzle (z = 2.4): a rounded breech, a thick body that tapers, bands, and a flared muzzle. */
export function buildBarrel(): BufferGeometry {
  const profile: [number, number][] = [
    [0.001, -0.72], [0.16, -0.7], [0.24, -0.6], [0.3, -0.5], [0.44, -0.38], [0.45, 0.2], [0.5, 0.24], [0.45, 0.28], [0.42, 0.9], [0.47, 0.94], [0.42, 0.98], [0.36, 1.9],
    [0.4, 2.05], [0.5, 2.18], [0.52, 2.4], [0.32, 2.4], [0.3, 2.2],
  ];
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 14);
  g.rotateX(Math.PI / 2); // the lathe's axis is y; the barrel points along z
  return g;
}
/** The carriage the barrel sits on, WITHOUT its wheels (they are separate so they can turn): a wooden block and cheeks. Built with its base on the deck at the cannon's station, facing +z. */
export function buildCarriage(): BufferGeometry {
  const m = new Model();
  m.box('#6b4426', [1.5, 0.8, 2.8], [0, 0.9, 0.3]); // the block, up on the axles
  for (const s of [-1, 1]) m.box('#5a3a20', [0.22, 0.9, 2.2], [s * 0.62, 1.55, 0.2]); // the cheeks the barrel rests between (its axis is 1.65 up)
  m.box('#4a3018', [1.1, 0.14, 0.4], [0, 1.0, 1.7]); // a cross-piece at the front
  return m.build();
}

/** The black inside of the barrel's mouth: a flat dark disc a little way in from the tip (z = 2.4), facing out, so the barrel does not look hollow from the front. */
export function buildBore(): BufferGeometry {
  return new CircleGeometry(0.3, 14).translate(0, 0, 2.12);
}
export const WHEEL_RADIUS = 0.34;
/** A carriage wheel (the axle along x), with crossed spokes so you can see it turn. */
export function buildWheel(): BufferGeometry {
  const m = new Model();
  m.cyl('#3b3b40', WHEEL_RADIUS, 0.26, [0, 0, 0], [0, 0, Math.PI / 2]);
  m.box('#9a7a50', [0.3, 0.1, WHEEL_RADIUS * 1.9], [0, 0, 0]);
  m.box('#9a7a50', [0.3, WHEEL_RADIUS * 1.9, 0.1], [0, 0, 0]);
  return m.build();
}

// ------------------------------------------------------------------------------------------------ the sea

/**
 * The sea: a big grid whose heights are made in the shader from a few swells that travel TOWARDS THE STERN (the ships "sail" forward, so the sea runs past them backwards), flat-shaded facets,
 * pale foam on the crests, and thin foam streaks that stream past quickly. All of it only looks like movement: nothing here is read by the game.
 */
export function makeSeaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new Color('#0b4c7d') },
      uShallow: { value: new Color('#1d98b8') },
      uFog: { value: new Color('#bfe1ee') },
      uSun: { value: new Vector3(0.45, 0.8, 0.3).normalize() },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vPos;
      varying float vHeight;
      float wave(vec2 p, vec2 k, float amp, float speed) { return amp * sin(dot(k, p) + speed * uTime); }
      void main() {
        vec3 p = position;
        vec2 xz = p.xz;
        float h = wave(xz, vec2(0.20, 0.05), 0.34, 1.15) + wave(xz, vec2(0.34, -0.12), 0.22, 1.65) + wave(xz, vec2(0.72, 0.31), 0.11, 2.4);
        p.y += h;
        vHeight = h;
        vPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uFog, uSun;
      varying vec3 vPos;
      varying float vHeight;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
        if (n.y < 0.0) n = -n;
        float light = 0.55 + 0.45 * max(dot(n, uSun), 0.0);
        vec3 col = mix(uDeep, uShallow, clamp(0.5 + vHeight * 1.2, 0.0, 1.0)) * light;
        float crest = smoothstep(0.42, 0.62, vHeight);
        float u = vPos.x + uTime * 7.0; // the streaks run past towards the stern at the speed the ships seem to sail
        float streak = vnoise(vec2(u * 0.11, vPos.z * 0.85));
        float streak2 = vnoise(vec2(u * 0.05 + 7.0, vPos.z * 0.5 + 3.0));
        float foam = smoothstep(0.80, 0.9, streak) * (0.45 + 0.55 * smoothstep(0.2, 0.7, streak2)) * 0.8;
        col = mix(col, vec3(0.93, 0.98, 1.0), clamp(crest * 0.75 + foam, 0.0, 0.95));
        float dist = length(vPos.xz - cameraPosition.xz);
        col = mix(col, uFog, smoothstep(110.0, 330.0, dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** A soft white streak texture for the foam that streams along each hull. */
export function makeWakeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = 6 + Math.random() * 52, len = 20 + Math.random() * 70;
    const grad = g.createLinearGradient(x, 0, x + len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.85)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(x, y, len, 2 + Math.random() * 2.5);
    g.fillRect(x - 256, y, len, 2.5); g.fillRect(x + 256, y, len, 2.5);
  }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}

/** The foam's fade along its length (as an alpha map): none at the far stern end, full from about a third of the way along. */
export function makeWakeFadeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#000000'); grad.addColorStop(0.4, '#ffffff'); grad.addColorStop(0.92, '#ffffff'); grad.addColorStop(1, '#808080');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 4);
  return new CanvasTexture(c);
}

/** A soft round glow for sparks, smoke and splashes. */
export function makeSoftTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Put a geometry's vertex colors to use with the standard flat-shaded look. */
export const flatMaterial = (extra: { side?: number } = {}) => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: extra.side as never });

export const IDENTITY = new Matrix4();
export { Group, CylinderGeometry, PlaneGeometry };
