import { BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Points, ShaderMaterial } from 'three';

/**
 * The puff of dust that billows out when the sandal smacks down in Roach Rumble: soft dusty-grey blobs thrown out from the spot it landed on, slowing as they go, swelling, drifting up a little and thinning away, with a few
 * slower wisps of smoke rising from the middle. (The flat ring that spreads along the floor is separate and stays.)
 */
const PUFF = 40;
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
const DUST = new Color('#d9cfbd');

export class DustPuff {
  readonly group = new Group();
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private pos = new Float32Array(PUFF * 3);
  private vel = new Float32Array(PUFF * 3);
  private alpha = new Float32Array(PUFF);
  private size = new Float32Array(PUFF);
  private age = new Float32Array(PUFF);
  private life = new Float32Array(PUFF);
  private grow = new Float32Array(PUFF);

  constructor(map: CanvasTexture) {
    this.material = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: DUST.clone() }, uMap: { value: map }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG });
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false; points.renderOrder = 7;
    this.group.add(points);
    this.age.fill(99); this.life.fill(1);
  }

  /** The sandal lands at (x, z): a ring of dust is thrown out from there, with wisps of smoke rising from the middle. */
  fire(x: number, z: number) {
    for (let i = 0; i < PUFF; i++) {
      const smoke = i >= PUFF - 10, a = Math.random() * Math.PI * 2, o = i * 3;
      const sp = smoke ? 0.3 + Math.random() * 0.9 : 3 + Math.random() * 3.6;
      this.pos[o] = x + Math.cos(a) * 0.4; this.pos[o + 1] = 0.25 + Math.random() * 0.3; this.pos[o + 2] = z + Math.sin(a) * 0.4;
      this.vel[o] = Math.cos(a) * sp; this.vel[o + 1] = smoke ? 1.0 + Math.random() * 1.2 : 0.5 + Math.random() * 1.0; this.vel[o + 2] = Math.sin(a) * sp;
      this.age[i] = 0; this.life[i] = smoke ? 1.1 + Math.random() * 0.6 : 0.7 + Math.random() * 0.5;
      this.size[i] = smoke ? 1.0 : 0.8; this.grow[i] = smoke ? 2.4 : 2.8 + Math.random();
    }
  }

  update(dt: number, px: number, dim: number) {
    (this.material.uniforms.uColor.value as Color).copy(DUST).multiplyScalar(dim);
    this.material.uniforms.uScale.value = px;
    for (let i = 0; i < PUFF; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      const o = i * 3, u = this.age[i] / this.life[i];
      this.age[i] += dt;
      const drag = Math.exp(-2.6 * dt); // it slows as it spreads
      this.vel[o] *= drag; this.vel[o + 2] *= drag; this.vel[o + 1] *= Math.exp(-1.2 * dt);
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = (0.8 + u * this.grow[i]) * (i >= PUFF - 10 ? 1.2 : 1); // it swells as it thins
      this.alpha[i] = 0.55 * Math.min(1, (1 - u) * 1.6) * Math.min(1, this.age[i] * 14);
    }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.aAlpha.needsUpdate = true; this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
