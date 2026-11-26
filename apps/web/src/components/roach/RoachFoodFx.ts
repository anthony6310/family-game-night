import { BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, type Texture } from 'three';

/**
 * The stink and goo coming off a piece of food in Roach Rumble: soft green blobs that rise in lazy, swirling curls and fade out (the stink), and a few thick drops that cling to the food's edge and ooze slowly down towards the
 * floor (the stickiness). Food that the spilled poison has reached stinks PURPLE instead, and more. One small `Points` cloud per piece, drawn by a tiny shader so each blob can have its own size and fade; the numbers are
 * kept here, not in the scene.
 */
const WISPS = 12;
const DRIPS = 5;
const N = WISPS + DRIPS;
const GREEN = new Color('#7fe03a');
const PURPLE = new Color('#b455ff');

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

const CRUMBS = 14;
const rnd = (seed: number) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class FoodFx {
  readonly points: Points;
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private pos = new Float32Array(N * 3);
  private alpha = new Float32Array(N);
  private size = new Float32Array(N);
  private age = new Float32Array(N);
  private life = new Float32Array(N);
  private angle = new Float32Array(N);
  private radius = new Float32Array(N);
  private phase = new Float32Array(N);

  // the crumbs: while a roach eats, little bits of food pop up off the piece and fall back (separate cloud, brown, small, hard-edged)
  private crumbPoints: Points;
  private crumbGeometry = new BufferGeometry();
  private crumbMaterial: ShaderMaterial;
  private cpos = new Float32Array(CRUMBS * 3);
  private calpha = new Float32Array(CRUMBS);
  private csize = new Float32Array(CRUMBS);
  private cage = new Float32Array(CRUMBS);
  private clife = new Float32Array(CRUMBS);
  private cvel = new Float32Array(CRUMBS * 3);
  private cactive = new Uint8Array(CRUMBS);

  constructor(map: Texture, seed: number, crumbColor = '#d8b878') {
    this.material = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: GREEN.clone() }, uMap: { value: map }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG });
    for (let i = 0; i < N; i++) {
      this.life[i] = i < WISPS ? 2.0 + rnd(seed + i) * 1.2 : 1.5 + rnd(seed + i) * 0.8;
      this.age[i] = rnd(seed * 3 + i) * this.life[i]; // (spread out, so they do not all start together)
      this.angle[i] = rnd(seed * 5 + i * 2) * Math.PI * 2;
      this.radius[i] = i < WISPS ? 0.15 + rnd(seed * 7 + i) * 0.7 : 0.85 + rnd(seed * 9 + i) * 0.2;
      this.phase[i] = rnd(seed * 11 + i) * Math.PI * 2;
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.crumbMaterial = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: new Color(crumbColor) }, uMap: { value: map }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG });
    for (let i = 0; i < CRUMBS; i++) { this.cage[i] = rnd(seed * 17 + i) * 0.8; this.clife[i] = 0.5 + rnd(seed * 19 + i) * 0.4; }
    this.crumbGeometry.setAttribute('position', new BufferAttribute(this.cpos, 3));
    this.crumbGeometry.setAttribute('aAlpha', new BufferAttribute(this.calpha, 1));
    this.crumbGeometry.setAttribute('aSize', new BufferAttribute(this.csize, 1));
    this.crumbPoints = new Points(this.crumbGeometry, this.crumbMaterial);
    this.crumbPoints.frustumCulled = false;
    this.crumbPoints.renderOrder = 6;
    this.points.add(this.crumbPoints); // (a child of the stink cloud, so it moves and hides with it)
  }

  /** `scale` is the food's size now (it shrinks as it is eaten), `poisoned` makes the stink purple and heavier, `px` converts a world size to pixels (screen height over twice the tangent of half the field of view). */
  update(dt: number, scale: number, poisoned: boolean, visible: boolean, px: number, eating = false) {
    this.points.visible = visible;
    if (!visible) return;
    this.updateCrumbs(dt, scale, eating, px);
    (this.material.uniforms.uColor.value as Color).copy(poisoned ? PURPLE : GREEN);
    this.material.uniforms.uScale.value = px;
    const speed = poisoned ? 1.5 : 1;
    for (let i = 0; i < N; i++) {
      this.age[i] += dt * speed;
      if (this.age[i] >= this.life[i]) { this.age[i] -= this.life[i]; this.angle[i] = Math.random() * Math.PI * 2; this.phase[i] = Math.random() * Math.PI * 2; }
      const u = this.age[i] / this.life[i], o = i * 3;
      if (i < WISPS) { // a curl of stink: up and out in a lazy swirl, swelling, then thinning away
        const swirl = this.angle[i] + this.age[i] * 1.1, r = (this.radius[i] + u * 0.9) * scale, sway = Math.sin(this.age[i] * 2.2 + this.phase[i]) * 0.35 * u;
        this.pos[o] = Math.cos(swirl) * r + sway; this.pos[o + 1] = 0.5 * scale + u * 2.6; this.pos[o + 2] = Math.sin(swirl) * r - sway;
        this.size[i] = (0.55 + u * 0.9) * (poisoned ? 1.25 : 1);
        this.alpha[i] = Math.sin(Math.PI * u) * (poisoned ? 0.7 : 0.55);
      } else { // a thick drop clinging to the edge that slides slowly down (slow at first, then it runs) and soaks into the floor
        const r = this.radius[i] * scale, drop = u * u;
        this.pos[o] = Math.cos(this.angle[i]) * r; this.pos[o + 1] = (0.95 - 0.85 * drop) * scale + 0.08; this.pos[o + 2] = Math.sin(this.angle[i]) * r;
        this.size[i] = 0.34 * (1 - 0.3 * u);
        this.alpha[i] = Math.min(1, u * 6) * (1 - Math.max(0, (u - 0.8) / 0.2)) * 0.95;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  /** Crumbs: each pops off the top of the piece in a small arc (up and out, then falling) while a roach is eating it; when nobody is eating the ones in the air finish their fall and no new ones start. */
  private updateCrumbs(dt: number, scale: number, eating: boolean, px: number) {
    this.crumbMaterial.uniforms.uScale.value = px;
    for (let i = 0; i < CRUMBS; i++) {
      const o = i * 3;
      if (!this.cactive[i]) {
        if (!eating) { this.calpha[i] = 0; continue; }
        // start a crumb: from the top of the piece, flung up and outwards
        const a = Math.random() * Math.PI * 2, sp = (0.7 + Math.random() * 1.5) * scale;
        this.cactive[i] = 1; this.cage[i] = 0; this.clife[i] = 0.5 + Math.random() * 0.4;
        this.cpos[o] = Math.cos(a) * 0.3 * scale; this.cpos[o + 1] = 0.9 * scale; this.cpos[o + 2] = Math.sin(a) * 0.3 * scale;
        this.cvel[o] = Math.cos(a) * sp; this.cvel[o + 1] = (2.6 + Math.random() * 2.4) * scale; this.cvel[o + 2] = Math.sin(a) * sp;
        this.csize[i] = 0.16 + Math.random() * 0.14;
      }
      this.cage[i] += dt;
      if (this.cage[i] >= this.clife[i]) { this.cactive[i] = 0; this.calpha[i] = 0; continue; }
      this.cvel[o + 1] -= 11 * dt; // gravity
      this.cpos[o] += this.cvel[o] * dt; this.cpos[o + 1] = Math.max(0.05, this.cpos[o + 1] + this.cvel[o + 1] * dt); this.cpos[o + 2] += this.cvel[o + 2] * dt;
      this.calpha[i] = 1 - Math.max(0, (this.cage[i] / this.clife[i] - 0.7) / 0.3);
    }
    this.crumbGeometry.attributes.position.needsUpdate = true;
    this.crumbGeometry.attributes.aAlpha.needsUpdate = true;
    this.crumbGeometry.attributes.aSize.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); this.crumbGeometry.dispose(); this.crumbMaterial.dispose(); }
}
