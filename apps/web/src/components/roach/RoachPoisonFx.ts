import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Points, RingGeometry, ShaderMaterial } from 'three';

/**
 * What the poison looks like in Roach Rumble. There is no separate pool: when the sandal smashes the bottle, `PoisonBlast` throws purple droplets up and out over the landmark (and a ring of purple spreads across the floor), and the
 * landmark's EXISTING dirty puddle turns purple (the scene fades its colours to `POISON_TINT` / `POISON_DEEP`). From then on `PoisonSteam` sends wavy, steamy purple lines curling up off the puddle.
 */
export const POISON_TINT = '#b479ec';
export const POISON_DEEP = '#59298a';
const PURPLE = new Color('#c88aff');

const VERT = `
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uColor;
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const DROPS = 64;

export class PoisonBlast {
  readonly group = new Group();
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private ringMat = new MeshBasicMaterial({ color: '#b86bff', transparent: true, opacity: 0, depthWrite: false });
  private ring = new Mesh(new RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
  private pos = new Float32Array(DROPS * 3);
  private vel = new Float32Array(DROPS * 3);
  private alpha = new Float32Array(DROPS);
  private size = new Float32Array(DROPS);
  private age = new Float32Array(DROPS);
  private life = new Float32Array(DROPS);
  private ringAge = 99;
  private cx = 0; private cz = 0;

  constructor(map: CanvasTexture) {
    this.material = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: PURPLE.clone() }, uMap: { value: map }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG });
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false; points.renderOrder = 7;
    this.ring.position.y = 0.09; this.ring.visible = false; this.ring.renderOrder = 6;
    this.group.add(points, this.ring);
    this.age.fill(99);
  }

  /** The bottle bursts at (x, z): droplets fly up and out in every direction, a ring spreads along the floor. */
  fire(x: number, z: number) {
    this.cx = x; this.cz = z;
    for (let i = 0; i < DROPS; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 6.5, o = i * 3;
      this.pos[o] = x; this.pos[o + 1] = 1.3; this.pos[o + 2] = z;
      this.vel[o] = Math.cos(a) * sp; this.vel[o + 1] = 4 + Math.random() * 7; this.vel[o + 2] = Math.sin(a) * sp;
      this.age[i] = 0; this.life[i] = 0.9 + Math.random() * 0.8; this.size[i] = 0.35 + Math.random() * 0.45;
    }
    this.ringAge = 0;
  }

  update(dt: number, px: number, dim: number, visible: boolean) {
    this.group.visible = visible;
    (this.material.uniforms.uColor.value as Color).copy(PURPLE).multiplyScalar(dim);
    this.material.uniforms.uScale.value = px;
    for (let i = 0; i < DROPS; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      this.age[i] += dt;
      this.vel[o + 1] -= 13 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] = Math.max(0.08, this.pos[o + 1] + this.vel[o + 1] * dt); this.pos[o + 2] += this.vel[o + 2] * dt;
      const u = this.age[i] / this.life[i];
      this.alpha[i] = u > 1 ? 0 : 1 - Math.max(0, (u - 0.6) / 0.4);
    }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.aAlpha.needsUpdate = true; this.geometry.attributes.aSize.needsUpdate = true;
    this.ringAge += dt;
    const k = this.ringAge / 0.8;
    this.ring.visible = k < 1;
    if (k < 1) { this.ring.position.set(this.cx, 0.09, this.cz); this.ring.scale.setScalar(0.5 + k * 7); this.ringMat.opacity = 0.7 * (1 - k) * dim; }
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); this.ring.geometry.dispose(); this.ringMat.dispose(); }
}

/**
 * Steam rising off the poisoned puddle: a dozen thin, wavy lines, each a streamer that rises, sways from side to side and fades in and out. They are drawn as lines (not blobs) so they read as curling wisps.
 */
const LINES = 30, SEG = 18;
export class PoisonSteam {
  readonly group = new Group();
  private lines: { line: Line; geo: BufferGeometry; mat: LineBasicMaterial; bx: number; bz: number; phase: number; speed: number; sway: number }[] = [];

  constructor(private cx: number, private cz: number, radius: number) {
    for (let i = 0; i < LINES; i++) {
      const a = i * 2.399, d = Math.sqrt((i + 0.5) / LINES) * radius * 0.85;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(SEG * 3), 3));
      const mat = new LineBasicMaterial({ color: '#c88aff', transparent: true, opacity: 0, depthWrite: false });
      const line = new Line(geo, mat);
      line.frustumCulled = false; line.renderOrder = 7;
      this.group.add(line);
      this.lines.push({ line, geo, mat, bx: cx + Math.cos(a) * d, bz: cz + Math.sin(a) * d, phase: (i * 0.137) % 1, speed: 0.22 + (i % 5) * 0.04, sway: 0.5 + (i % 3) * 0.25 });
    }
  }

  /** `t` seconds; `strength` 0..1 (it builds up after the bottle breaks); `dim` darkens it in the dark kitchen. */
  update(t: number, strength: number, dim: number, visible: boolean) {
    this.group.visible = visible && strength > 0.01;
    if (!this.group.visible) return;
    for (const L of this.lines) {
      const rise = (t * L.speed + L.phase) % 1; // 0..1: how far the streamer has risen
      const pos = L.geo.getAttribute('position') as BufferAttribute;
      for (let j = 0; j < SEG; j++) {
        const u = j / (SEG - 1), h = Math.max(0, rise - (1 - u) * 0.38); // the streamer is the stretch between where it started and its head
        const y = 0.25 + h * 4.6, w = h * L.sway;
        pos.setXYZ(j, L.bx + Math.sin(h * 7 + t * 1.6 + L.phase * 9) * w, y, L.bz + Math.cos(h * 5.5 + t * 1.3 + L.phase * 7) * w);
      }
      pos.needsUpdate = true;
      L.mat.opacity = Math.sin(Math.PI * rise) * 1.0 * strength * dim;
    }
  }

  dispose() { for (const L of this.lines) { L.geo.dispose(); L.mat.dispose(); } }
}
