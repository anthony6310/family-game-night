import {
  AdditiveBlending, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Quaternion, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, type Texture,
} from 'three';

/**
 * THE NIGHT CAMP behind Snowball Match: a small 3D world seen from where the player stands, looking down a little (so the snowy floor fills most of the screen): a campfire (logs, stones, flickering flames and a
 * warm light that really lights the snow and the tent) near the left edge, a dome tent near the right edge, snow mounds, and far off at the horizon (a quarter of the way down the screen) rows of pine trees and the stars above them.
 * It is scenery only. It is drawn on its own, and then looked at THROUGH A PANE OF FROSTED GLASS: the picture is blurred (a few soft passes at half size), lightened a touch and given a little grain, so shapes can be made out
 * but are hard to see, and the game in front (the flakes and the hand, drawn crisp afterwards) stays readable. The fire and the tent are meant to be cut off by the edges of the screen.
 */

const EYE = 1.6; // how high the player's eyes are
const HORIZON = 0.25; // the horizon is this far down the screen (a quarter): from there up are the pines and the stars
const FOV = 60;
const FIRE_DEPTH = 3.0; // how far ahead the fire is (it sits low in the screen, near the left edge)
const TENT_DEPTH = 3.6; // and the tent (high on the right edge)
const HORIZON_COLOR = '#1f3a66';
const FROST = { passes: 2, stride: 2.2, tint: 0.08, grain: 0.035 }; // the glass: how many blurs, how wide, how much it lightens, and its grain

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#050a18'); grad.addColorStop(HORIZON, '#1f3a66'); grad.addColorStop(1, '#1f3a66');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

const BLUR_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLUR_FRAG = `
  uniform sampler2D tex; uniform vec2 dir; uniform float last; uniform float tint; uniform float grain; uniform float time; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec4 c = texture2D(tex, vUv) * 0.2270270270;
    c += (texture2D(tex, vUv + dir * 1.3846153846) + texture2D(tex, vUv - dir * 1.3846153846)) * 0.3162162162;
    c += (texture2D(tex, vUv + dir * 3.2307692308) + texture2D(tex, vUv - dir * 3.2307692308)) * 0.0702702703;
    gl_FragColor = vec4(c.rgb, 1.0);
    if (last > 0.5) { // the last pass is the glass itself: frosted, a little lighter, a little grainy
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.30, 0.38, 0.55), tint) + (hash(vUv * 900.0 + time) - 0.5) * grain;
    }
    #include <colorspace_fragment>
  }`;

export class NightCamp {
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 400);
  private disposables: { dispose(): void }[] = [];
  private fire = new Group();
  private tent = new Group();
  private fireLight = new PointLight('#ff8a3c', 10, 14, 2);
  private flames: { mesh: Mesh; base: Vector3; phase: number }[] = [];
  private stars: Points;
  private starMaterial: PointsMaterial;
  private a: WebGLRenderTarget | null = null;
  private b: WebGLRenderTarget | null = null;
  private quad = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, uniforms: { tex: { value: null as Texture | null }, dir: { value: new Vector2() }, last: { value: 0 }, tint: { value: FROST.tint }, grain: { value: FROST.grain }, time: { value: 0 } }, depthTest: false, depthWrite: false }));
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new Vector2();

  constructor() {
    this.disposables.push(this.quad.geometry, this.quad.material as ShaderMaterial);
    this.quadScene.add(this.quad);
    const sky = skyTexture();
    this.scene.background = sky; this.scene.fog = new Fog(new Color(HORIZON_COLOR), 14, 95);
    this.disposables.push(sky);
    // looking down just enough that the horizon sits HORIZON of the way down the screen
    const pitch = Math.atan((0.5 - HORIZON) * 2 * Math.tan((FOV * Math.PI) / 360));
    this.camera.position.set(0, EYE, 0); this.camera.rotation.x = -pitch;
    this.scene.add(new HemisphereLight('#7f9fe0', '#34415e', 0.75));
    const moon = new DirectionalLight('#9ab6ff', 0.55); moon.position.set(-6, 10, 4); this.scene.add(moon);

    const standard = (color: string, rough = 0.95) => { const m = new MeshStandardMaterial({ color, roughness: rough, flatShading: true }); this.disposables.push(m); return m; };
    const geo = <T extends BufferGeometry>(g: T): T => { this.disposables.push(g); return g; };

    // the floor: snow all the way to the horizon, with mounds and drifts (and a few right by the player, at the edges)
    const floor = new Mesh(geo(new PlaneGeometry(400, 400)), standard('#b4c4e0', 1)); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    const mound = geo(new SphereGeometry(1, 8, 5)), moundMat = standard('#c3d1ea', 1);
    let s = 17; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const mounds: [number, number, number][] = [[-2.6, -1.4, 0.9], [2.4, -1.2, 0.8], [0.4, -5.5, 1.2], [-4.5, -6, 1.5], [3.5, -7.5, 1.6]];
    for (let i = 0; i < 14; i++) mounds.push([(rnd() - 0.5) * 36, -8 - rnd() * 40, 1 + rnd() * 2.2]);
    for (const [x, z, r] of mounds) { const m = new Mesh(mound, moundMat); m.position.set(x, 0, z); m.scale.set(r * 1.6, r * 0.28, r); m.rotation.y = rnd() * 3; this.scene.add(m); }

    // the campfire: a ring of stones, crossed logs, a bed of embers, three flames one inside another, and a warm light that flickers
    const stone = geo(new IcosahedronGeometry(0.1, 0)), stoneMat = standard('#5d6678');
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, m = new Mesh(stone, stoneMat); m.position.set(Math.cos(a) * 0.46, 0.05, Math.sin(a) * 0.46); m.scale.set(1.1, 0.8, 1); m.rotation.y = i; this.fire.add(m); }
    const log = geo(new CylinderGeometry(0.06, 0.07, 0.8, 7)), logMat = standard('#3b2616');
    for (let i = 0; i < 3; i++) { const m = new Mesh(log, logMat); m.rotation.z = Math.PI / 2 - 0.35; m.rotation.y = (i / 3) * Math.PI * 2; m.position.set(0, 0.1, 0); this.fire.add(m); }
    const embers = new Mesh(geo(new CircleGeometry(0.34, 12)), new MeshBasicMaterial({ color: '#ff5a14' })); embers.rotation.x = -Math.PI / 2; embers.position.y = 0.03; this.disposables.push(embers.material as MeshBasicMaterial); this.fire.add(embers);
    for (const [color, r, h, y] of [['#ff6a1a', 0.26, 0.9, 0.45], ['#ffb33d', 0.19, 0.66, 0.34], ['#fff3c4', 0.11, 0.42, 0.24]] as const) {
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: AdditiveBlending, depthWrite: false }); this.disposables.push(mat);
      const m = new Mesh(geo(new ConeGeometry(r, h, 7, 1, true)), mat); m.position.y = y + 0.08; this.fire.add(m);
      this.flames.push({ mesh: m, base: new Vector3(1, 1, 1), phase: this.flames.length * 1.9 });
    }
    this.fireLight.position.set(0, 0.55, 0); this.fire.add(this.fireLight);
    this.scene.add(this.fire);

    // the dome tent (tall, with a dark doorway facing the fire and snow banked at its foot)
    const dome = new Mesh(geo(new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), standard('#8a7766', 0.9)); dome.scale.set(0.6, 1.7, 0.95); this.tent.add(dome);
    const door = new Mesh(geo(new CircleGeometry(0.3, 10)), new MeshBasicMaterial({ color: '#150f1a' })); this.disposables.push(door.material as MeshBasicMaterial);
    door.scale.set(0.8, 1.45, 1); door.position.set(-0.4, 0.5, 0.78); door.rotation.y = -0.55; this.tent.add(door);
    const bank = new Mesh(mound, moundMat); bank.scale.set(0.95, 0.16, 1.25); bank.position.y = 0.03; this.tent.add(bank);
    this.scene.add(this.tent);

    // the pines: rows of them out towards the horizon (fog turns the far ones into a haze), and some at the sides, nearer
    const cone = geo(new ConeGeometry(1, 1, 7)), treeMat = standard('#13303f', 1);
    const trees: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 46; i++) trees.push({ x: (rnd() - 0.5) * 120, z: -60 - rnd() * 14, s: 2.4 + rnd() * 1.3 });
    for (let i = 0; i < 30; i++) trees.push({ x: (rnd() - 0.5) * 80, z: -34 - rnd() * 14, s: 1.8 + rnd() * 1.1 });
    for (let i = 0; i < 12; i++) trees.push({ x: (rnd() < 0.5 ? -1 : 1) * (4.5 + rnd() * 9), z: -13 - rnd() * 8, s: 1.2 + rnd() * 0.8 });
    const pines = new InstancedMesh(cone, treeMat, trees.length * 3); const mtx = new Matrix4(), q = new Quaternion(), sc = new Vector3(), pos = new Vector3();
    trees.forEach((t, k) => { for (let tier = 0; tier < 3; tier++) { const w = t.s * (1.0 - tier * 0.27), h = t.s * 1.5; pos.set(t.x, t.s * (0.5 + tier * 0.9) + h / 2, t.z); sc.set(w, h, w); mtx.compose(pos, q, sc); pines.setMatrixAt(k * 3 + tier, mtx); } });
    this.scene.add(pines); this.disposables.push(pines);

    // the stars, high above the horizon
    const star: number[] = []; // (only the band of sky that can be on the screen: from the horizon up to the top edge)
    for (let i = 0; i < 420; i++) { const az = (rnd() - 0.5) * 1.8, el = 0.03 + rnd() * 0.22; star.push(220 * Math.sin(az) * Math.cos(el), EYE + 220 * Math.sin(el), -220 * Math.cos(az) * Math.cos(el)); }
    const sg = new BufferGeometry(); sg.setAttribute('position', new Float32BufferAttribute(star, 3));
    this.starMaterial = new PointsMaterial({ color: '#d6e4ff', size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false });
    this.stars = new Points(sg, this.starMaterial); this.stars.frustumCulled = false; this.scene.add(this.stars); this.disposables.push(sg, this.starMaterial);
  }

  /** Places the fire and the tent for a screen of this shape (width / height): the fire half off the left edge, the tent just peeking in on the right. */
  layout(aspect: number) {
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    const t = Math.tan((FOV * Math.PI) / 360);
    this.fire.position.set(-t * FIRE_DEPTH * aspect, 0, -FIRE_DEPTH);
    this.tent.position.set(t * TENT_DEPTH * aspect + 0.2, 0, -TENT_DEPTH); this.tent.rotation.y = 0.35;
  }

  /** The fire flickers: each flame's height, width and sway change on their own rhythms, and the light it throws on the snow and the tent goes up and down with them. The stars twinkle faintly. */
  update(tSec: number) {
    for (const f of this.flames) {
      const n = Math.sin(tSec * 7.3 + f.phase) * 0.5 + Math.sin(tSec * 12.9 + f.phase * 2) * 0.3 + Math.sin(tSec * 21.7 + f.phase * 3) * 0.2;
      f.mesh.scale.set(1 - 0.12 * n, 1 + 0.2 * n, 1 - 0.12 * n);
      f.mesh.rotation.z = Math.sin(tSec * 4.3 + f.phase) * 0.09; f.mesh.rotation.x = Math.sin(tSec * 3.7 + f.phase * 1.3) * 0.09;
    }
    this.fireLight.intensity = 10 * (1 + Math.sin(tSec * 5.1) * 0.14 + Math.sin(tSec * 11.3 + 2) * 0.1 + Math.sin(tSec * 19 + 4) * 0.06);
    this.starMaterial.opacity = 0.62 + 0.1 * Math.sin(tSec * 1.3);
  }

  /** Draws the camp, as seen through the frosted glass, over the whole screen. (The caller then draws the game on top.) */
  render(renderer: WebGLRenderer, tSec: number) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, Math.floor(this.size.x / 2)), h = Math.max(2, Math.floor(this.size.y / 2)); // (half size: the blur does not need more, and it is much cheaper)
    if (!this.a || this.a.width !== w || this.a.height !== h) {
      this.a?.dispose(); this.b?.dispose();
      this.a = new WebGLRenderTarget(w, h); this.b = new WebGLRenderTarget(w, h);
    }
    const a = this.a, b = this.b!;
    renderer.setRenderTarget(a); renderer.clear(); renderer.render(this.scene, this.camera);
    const mat = this.quad.material as ShaderMaterial, texel = new Vector2(FROST.stride / w, FROST.stride / h);
    const pass = (from: WebGLRenderTarget, to: WebGLRenderTarget | null, horizontal: boolean, last: boolean) => {
      mat.uniforms.tex.value = from.texture; mat.uniforms.dir.value.set(horizontal ? texel.x : 0, horizontal ? 0 : texel.y); mat.uniforms.last.value = last ? 1 : 0; mat.uniforms.time.value = tSec % 10;
      renderer.setRenderTarget(to); renderer.clear(); renderer.render(this.quadScene, this.quadCamera);
    };
    let src = a, dst = b;
    for (let i = 0; i < FROST.passes; i++) { pass(src, dst, true, false); [src, dst] = [dst, src]; pass(src, dst, false, false); [src, dst] = [dst, src]; }
    pass(src, null, true, true); // (the last pass goes to the screen, and is the glass: tint and grain; one more small blur is fine there)
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.a?.dispose(); this.b?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
