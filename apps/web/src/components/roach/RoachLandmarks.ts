import { Box3, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, type BufferGeometry } from 'three';
import type { Disc } from '@fgn/shared';
import { Model } from '../shelter/AnimalKit';
import type { Piece } from './RoachKitchen';

/**
 * The three landmarks' look in Roach Rumble: a HEAP OF BLACK BAGS (the trash landmark), a yellow WRINGER BUCKET full of dirty water (the mop landmark), and the DIRTY PUDDLES that spread out from each landmark (and the one in front of
 * the cooker) so they really stand out. The puddle is one flat square drawn by a shader with an organic outline (a wobbly blob with lobes and flicked-off drops, different for every puddle), murky inside with a dark thin rim,
 * a wet shine along the edge, bright glints and slow ripples. The puddles and the bucket's water are unlit, so `setDim` darkens them in the dark kitchen.
 */
const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uSeed, uTime, uBase, uDim;
uniform vec3 uTint, uDeep;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float blob(vec2 p, float r, float s) {
  float th = atan(p.y, p.x);
  float w = r * (1.0 + 0.20 * sin(2.0 * th + s) + 0.14 * sin(3.0 * th + s * 1.7) + 0.09 * sin(5.0 * th + s * 2.3) + 0.05 * sin(7.0 * th + s * 3.1));
  return length(p) - w;
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float ang = uSeed * 2.1;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  q.x *= 0.78; // longer one way than the other
  float d = blob(q, uBase, uSeed);
  for (int i = 0; i < 3; i++) { // three lobes bulging out
    float a = uSeed * 1.3 + float(i) * 2.2;
    d = smin(d, blob(p - uBase * 0.95 * vec2(cos(a), sin(a)), uBase * (0.3 + 0.08 * hash(vec2(float(i), uSeed))), uSeed + float(i)), 0.12);
  }
  for (int i = 0; i < 6; i++) { // and a few drops flicked out, some joined on, some not
    float a = uSeed * 3.7 + float(i) * 1.05;
    float rr = uBase * (1.18 + 0.4 * hash(vec2(float(i) * 3.1, uSeed)));
    d = smin(d, blob(p - rr * vec2(cos(a), sin(a)), uBase * (0.05 + 0.07 * hash(vec2(float(i), uSeed + 2.0))), a), 0.05);
  }
  float inside = smoothstep(0.012, -0.012, d);
  if (inside < 0.01) discard;
  float depth = clamp(-d / (uBase * 0.55), 0.0, 1.0);
  vec2 w = p * 6.0 + vec2(uTime * 0.04, 0.0);
  float n = fbm(w + fbm(w * 1.3 + uTime * 0.03) * 1.6);
  vec3 col = mix(uDeep, uTint, 0.3 + depth * 0.4 + n * 0.4);
  float ring = smoothstep(0.0, 0.03, -d) * (1.0 - smoothstep(0.03, 0.1, -d));
  col = mix(col, uDeep * 0.8, ring * 0.55); // a dark rim where the water is thin
  float rim = smoothstep(0.0, 0.01, -d) * (1.0 - smoothstep(0.01, 0.03, -d));
  col += vec3(0.78, 0.74, 0.62) * rim * 0.6; // the wet shine along the very edge
  float g = smoothstep(0.7, 0.9, noise(p * 5.0 + vec2(0.0, uTime * 0.08))) * smoothstep(0.05, 0.22, -d);
  col = mix(col, vec3(1.0, 0.98, 0.92), g * 0.6); // bright streaks of light on the surface
  float swirl = smoothstep(0.5, 0.62, fbm(p * 3.0 + 7.0 + uTime * 0.02)) * smoothstep(0.05, 0.3, -d);
  col = mix(col, uDeep, swirl * 0.12);
  col += (sin(length(p) * 34.0 - uTime * 2.6) * 0.5 + 0.5) * 0.035 * depth; // slow ripples
  gl_FragColor = vec4(col * uDim, inside * (0.66 + 0.2 * (1.0 - depth * 0.5)));
  #include <colorspace_fragment>
}`;

const WATER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uSeed, uDim;
uniform vec3 uTint, uDeep;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float n = fbm(p * 3.0 + vec2(uTime * 0.12, uSeed) + fbm(p * 2.0 - uTime * 0.08) * 1.5);
  vec3 col = mix(uDeep, uTint, 0.35 + n * 0.6);
  col *= 0.55 + 0.45 * smoothstep(1.0, 0.55, r); // darker against the wall
  float ripple = sin(r * 22.0 - uTime * 3.0 + n * 2.0) * 0.5 + 0.5;
  col += ripple * 0.06 * (1.0 - r); // ripples from the middle
  float g = smoothstep(0.66, 0.88, noise(p * 4.5 + vec2(uTime * 0.15, -uTime * 0.1))) * smoothstep(1.0, 0.75, r);
  col = mix(col, vec3(1.0, 0.98, 0.9), g * 0.7); // glints on the surface
  float edge = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  col += vec3(0.8, 0.76, 0.65) * edge * 0.35; // a wet line where it climbs the wall
  gl_FragColor = vec4(col * uDim, 1.0);
  #include <colorspace_fragment>
}`;

/** A puddle of dirty water (a flat square `size` across on the floor, with the puddle `radius` big in the middle of it). `seed` makes its shape. */
export function makePuddle(seed: number, tint: string, deep: string, radius = 4.3, size = 18): Mesh {
  const mat = new ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    uniforms: { uSeed: { value: seed }, uTime: { value: 0 }, uBase: { value: radius / (size / 2) }, uTint: { value: new Color(tint) }, uDeep: { value: new Color(deep) }, uDim: { value: 1 } },
    vertexShader: VERT, fragmentShader: FRAG,
  });
  const m = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.05; m.renderOrder = 4;
  return m;
}

// ---------------------------------------------------------------- water in a bucket
/** The dirty water standing in a bucket: a disc a little below the rim, murky like the puddles, darker where it meets the wall, with ripples spreading from the middle, slow swirls and bright glints. */
/** The heap and the bucket are modelled at one size and drawn this much bigger (their solid discs in the shared layout are scaled the same). */
export const LANDMARK_SCALE = 2.6;
export const PUDDLE_TINT = '#a08c5a';
export const PUDDLE_DEEP = '#665634';
/** Darken (or restore) every unlit watery thing: `dim` 1 is full light, less is darker (the kitchen at night). */
export function setDim(m: Mesh, time: number, dim: number) {
  const u = (m.material as ShaderMaterial).uniforms;
  u.uTime.value = time; u.uDim.value = dim;
}

/** A bucket's wall standing up round the water: a ring of little slabs (the bucket body is solid, so the water sits in this). */
function wall(m: Model, color: string, cx: number, y: number, cz: number, r: number, h: number) {
  const n = 28;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; m.box(color, [0.1, h, (2 * Math.PI * r) / n + 0.04], [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], [0, -a, 0]); }
}


function finish(object: Group, geometry: BufferGeometry, extraGeometries: BufferGeometry[]): Piece {
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  object.add(new Mesh(geometry, material));
  object.updateMatrixWorld(true);
  const b = new Box3().setFromObject(object);
  return { object, materials: [material], geometries: [geometry, ...extraGeometries], bounds: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } };
}

/** T3: a heap of bulging black bags, one split open and leaking, a pizza box on top. No can at all. */
function heapGeometry(): BufferGeometry {
  const m = new Model();
  const bag = (x: number, z: number, s: number, c = '#1d1f24') => { m.oval(c, [0.8 * s, 0.75 * s, 0.75 * s], [x, 0.7 * s, z]); m.cone(c, 0.2 * s, 0.5 * s, [x, 1.55 * s, z]); m.oval('#3a3d44', [0.2 * s, 0.15 * s, 0.1 * s], [x - 0.25 * s, 1.0 * s, z + 0.5 * s]); }; // a tied bag with a shine
  bag(-0.45, 0, 1.0); bag(0.6, 0.2, 0.9, '#23262c'); bag(0.0, -0.7, 0.95); bag(-0.1, 0.65, 0.7, '#2a2d34');
  m.oval('#1d1f24', [0.7, 0.55, 0.65], [0.15, 1.65, -0.2]); // one on top
  m.box('#c9a574', [1.2, 0.12, 1.2], [0.3, 2.3, -0.1], [0.3, 0.5, 0.2]); m.box('#b58f58', [1.2, 0.05, 1.2], [0.3, 2.37, -0.1], [0.3, 0.5, 0.2]); // a pizza box
  m.oval('#6b7a3a', [0.5, 0.15, 0.4], [1.0, 0.12, 0.9]); m.oval('#8a6a3a', [0.25, 0.15, 0.2], [1.3, 0.12, 0.6]); m.limb('#e8e0cc', [-1.2, 0.08, 0.9], [-0.7, 0.1, 1.2], 0.07); m.oval('#d33f3f', [0.18, 0.18, 0.18], [-0.4, 0.18, 1.2]); // spilled gubbins
  return m.build();
}


/** The trash landmark: a heap of bulging black bags with a pizza box on top and scraps spilled round it. Stands on the layout's trash disc. */
export function buildTrashHeap(d: Disc): Piece {
  const g = new Group();
  g.position.set(d.x, 0, d.z);
  g.rotation.y = (d.x * 7.3 + d.z * 3.1) % 6.28; // (a different way round each game)
  g.scale.setScalar(LANDMARK_SCALE); // (2.6 times the size it was first drawn: twice, then 30% more)
  return finish(g, heapGeometry(), []);
}

/** M1: the yellow wringer bucket on wheels with a grubby mop in it. */
function bucketGeometry(): BufferGeometry {
  const m = new Model();
  m.cyl('#d9b52f', 1.0, 1.35, [0, 0.83, 0], [0, 0, 0], 0.78); // the bucket, wider at the top; its top is the water level
  wall(m, '#d9b52f', 0, 1.585, 0, 0.96, 0.17); wall(m, '#b8982a', 0, 1.7, 0, 1.02, 0.07); // the wall standing up above the water, with a rim
  for (const [x, z] of [[0.7, 0.55], [-0.7, 0.55], [0.7, -0.55], [-0.7, -0.55]]) m.cyl('#2a2d31', 0.2, 0.22, [x, 0.14, z], [0, 0, Math.PI / 2]);
  m.box('#c9a32a', [1.2, 0.5, 0.9], [0, 2.1, -0.3]); m.box('#8d9096', [0.18, 0.5, 0.9], [0.62, 2.15, -0.3]); m.box('#8d9096', [0.18, 0.5, 0.9], [-0.62, 2.15, -0.3]);
  m.cyl('#a9784a', 0.07, 3.6, [0.1, 3.0, 0.2], [0.28, 0.3, 0.1]);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28; m.box(i % 2 ? '#a9a699' : '#8e8a7c', [0.1, 0.9, 0.14], [0.1 + Math.cos(a) * 0.22, 1.3, 0.2 + Math.sin(a) * 0.22]); } // the mop head, down in the water
  m.limb('#a9d0e0', [0.9, 1.75, 0.35], [0.95, 1.2, 0.4], 0.05); m.oval('#a9d0e0', [0.07, 0.1, 0.07], [0.95, 1.1, 0.4]); // a drip running down the outside
  return m.build();
}

/** The mop landmark: the yellow wringer bucket on wheels, full of dirty water (`water` is the surface, to be animated with `setDim`), with a grubby mop in it. Stands on the layout's mop bucket disc. */
export function buildMopBucket(d: Disc): { piece: Piece; water: Mesh } {
  const g = new Group();
  g.position.set(d.x, 0, d.z);
  g.rotation.y = (d.x * 5.1 + d.z * 2.3) % 6.28;
  g.scale.setScalar(LANDMARK_SCALE);
  const mat = new ShaderMaterial({ uniforms: { uTime: { value: 0 }, uSeed: { value: (d.x + d.z) % 7 }, uTint: { value: new Color(PUDDLE_TINT) }, uDeep: { value: new Color(PUDDLE_DEEP) }, uDim: { value: 1 } }, vertexShader: VERT, fragmentShader: WATER_FRAG });
  const geo = new PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2);
  const water = new Mesh(geo, mat);
  water.position.set(0, 1.63, 0);
  g.add(water);
  const piece = finish(g, bucketGeometry(), [geo]);
  piece.materials.push(); // (the water is not faded with the rest)
  return { piece, water };
}
