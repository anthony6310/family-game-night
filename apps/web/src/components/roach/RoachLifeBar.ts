import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

/**
 * The lifetime bar over a roach in Roach Rumble: ONE flat quad that always faces the camera, with the backing, the border and the fill all drawn by one tiny shader from `uFill` (0..1). Because it is a single piece, the fill is
 * always lined up with its backing however the camera turns. (The first version was two sprites, one shifted sideways by a world offset: that only lined up from one camera angle.) Sized in world units, drawn on top of everything.
 */
const VERT = `
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform float uFill;
uniform float uCap;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec3 col = vec3(0.07);
  float a = 0.88;
  if (vUv.x > 0.02 && vUv.x < 0.98 && vUv.y > 0.2 && vUv.y < 0.8) {
    float f = (vUv.x - 0.02) / 0.96;
    if (f > uCap) { col = vec3(0.62, 0.3, 1.0); a = 0.97; if (f < uCap + 0.012) col = vec3(0.92, 0.85, 1.0); } // the part of the bar the poison has taken away: a solid purple block
    else if (f <= uFill) { col = uColor; a = uAlpha; }
  }
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class LifeBar {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor(width = 2.3, height = 0.3) {
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uSize: { value: [width, height] }, uFill: { value: 1 }, uCap: { value: 1 }, uColor: { value: new Color('#7be07b') }, uAlpha: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 90;
    this.mesh.frustumCulled = false; // (its corners are placed in the shader, so the usual bounds are wrong)
  }

  /** `fill` 0..1, a colour, and an opacity for the fill (it flashes when the roach is nearly out of life). `cap` 0..1 is how much of the bar the roach can still use: past it the bar is blocked in purple (the life the poison took away). */
  set(fill: number, color: string, alpha: number, cap = 1) {
    this.material.uniforms.uCap.value = Math.max(0, Math.min(1, cap));
    this.material.uniforms.uFill.value = Math.max(0, Math.min(1, fill));
    (this.material.uniforms.uColor.value as Color).set(color);
    this.material.uniforms.uAlpha.value = alpha;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
