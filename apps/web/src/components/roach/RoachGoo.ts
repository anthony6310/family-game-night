import { BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Points, ShaderMaterial } from 'three';

/**
 * A squashed roach flicks out a couple of drops of goo: a handful of olive-green blobs (the colour of the splat it leaves on the floor) flung out and up from where it was, arcing down under gravity and landing, so the splat
 * looks like it burst rather than just appeared. Drawn as unlit points with their own size and fade.
 */
const DROPS = 12;
const GOO = new Color('#5B6A1E'); // (the splat's dark green, exactly)
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
  float a = smoothstep(0.15, 0.5, texture2D(uMap, gl_PointCoord).a) * vAlpha; // (a crisper edge than the soft puffs: wet drops, not mist)
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class GooSplash {
  readonly group = new Group();
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private pos = new Float32Array(DROPS * 3);
  private vel = new Float32Array(DROPS * 3);
  private alpha = new Float32Array(DROPS);
  private size = new Float32Array(DROPS);
  private age = new Float32Array(DROPS);
  private life = new Float32Array(DROPS);

  constructor(map: CanvasTexture) {
    this.material = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: GOO.clone() }, uMap: { value: map }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG });
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false; points.renderOrder = 8;
    this.group.add(points);
    this.age.fill(99); this.life.fill(1);
  }

  /** A roach is squashed at (x, z): drops fly out. Several bursts can be in the air at once (the drops are reused, oldest first). */
  fire(x: number, z: number) {
    let n = 0;
    for (let i = 0; i < DROPS && n < 9; i++) {
      if (this.age[i] < this.life[i]) continue; // (still in flight)
      const a = Math.random() * Math.PI * 2, sp = 1.6 + Math.random() * 3.2, o = i * 3;
      this.pos[o] = x; this.pos[o + 1] = 0.5; this.pos[o + 2] = z;
      this.vel[o] = Math.cos(a) * sp; this.vel[o + 1] = 3.2 + Math.random() * 3.4; this.vel[o + 2] = Math.sin(a) * sp;
      this.age[i] = 0; this.life[i] = 0.85 + Math.random() * 0.35; this.size[i] = 0.3 + Math.random() * 0.32;
      n++;
    }
  }

  update(dt: number, px: number, dim: number) {
    (this.material.uniforms.uColor.value as Color).copy(GOO).multiplyScalar(dim);
    this.material.uniforms.uScale.value = px;
    for (let i = 0; i < DROPS; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      this.age[i] += dt;
      this.vel[o + 1] -= 13 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      if (this.pos[o + 1] <= 0.06) { this.pos[o + 1] = 0.06; this.vel[o] = 0; this.vel[o + 1] = 0; this.vel[o + 2] = 0; this.size[i] *= 1 + dt * 2.5; } // landed: it stays and spreads a little
      const u = this.age[i] / this.life[i];
      this.alpha[i] = u > 1 ? 0 : 1 - Math.max(0, (u - 0.75) / 0.25);
    }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.aAlpha.needsUpdate = true; this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
