import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { POLE_WORLD_HEIGHT, bendStress, SWAP_COOLDOWN_MS, frogDeflection, obstaclesFor, poleCurve, worldY, type FrogClimbView, type FrogPlayerView, type Obstacle } from '@fgn/shared';
import { createRoundClock } from '../../audio/roundClock';
import { audio } from '../../audio/spatialAudio';
import { createNameTag, disposeNameTag } from '../labelTexture';

export interface FrogStyle { id: string; name: string; color: string }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (x: number) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };

const WORLD_PER_M = 0.6; // world units per metre of height (the pole is 140 m)
const POLE_LEN = POLE_WORLD_HEIGHT + 5; // the pole reaches a little above the finish ring
const SEGS = 210, SIDES = 8;
const ROPE_TURNS = 28; // the cream rope spirals this many times up each pole
const ROPE_PTS = 420, ROPE_SIDES = 4, ROPE_R = 0.1;
const FROG_OFF = 0.78; // how far the frog's body sits from the pole's middle
const CAM_DIST = 19; // the fixed camera: this far from the pole, looking straight at it, from beside the frog's height
const CAM_FOV = 48;
const PUFF_MAX = 16; // squiggle particles per pole
const PUFF_RATE = 14; // squiggles a second at a pole's limit (none until it is straining)
const PUFF_LIFE = 0.55; // seconds
/** A wavy "tremble" line: a dark red outline with a pale core, so it reads on the sky and on the pole. */
function makeSquiggleTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i <= 40; i++) { const x = 10 + (108 * i) / 40, y = 32 + Math.sin((i / 40) * Math.PI * 4) * 14; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); } };
  path(); g.strokeStyle = '#a3201a'; g.lineWidth = 16; g.stroke();
  path(); g.strokeStyle = '#ffe9d6'; g.lineWidth = 8; g.stroke();
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}
/** Wood grain: a steady brightness 0.85..1.15 for ring number i (the same on every pole). */
const grainOf = (i: number) => 0.85 + 0.3 * Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
const BLUR_SCALE = 0.5; // the background is drawn at this fraction of the screen's size, then blurred: a frosted-glass look

/** The sky behind everything: a soft gradient with pale blobs of light (it is blurred anyway, so it reads as a hazy, frosted backdrop). */
function makeSkyTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#9fd4f5'); grad.addColorStop(0.55, '#dff3f2'); grad.addColorStop(1, '#cfe9c4');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 512);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 22; i++) { g.fillStyle = `rgba(255,255,255,${0.07 + rnd() * 0.1})`; g.beginPath(); g.arc(rnd() * 256, rnd() * 512, 14 + rnd() * 46, 0, Math.PI * 2); g.fill(); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

const BLUR_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLUR_FRAG = `
  uniform sampler2D tex; uniform vec2 dir; uniform float tint; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tex, vUv) * 0.2270270270;
    c += (texture2D(tex, vUv + dir * 1.3846153846) + texture2D(tex, vUv - dir * 1.3846153846)) * 0.3162162162;
    c += (texture2D(tex, vUv + dir * 3.2307692308) + texture2D(tex, vUv - dir * 3.2307692308)) * 0.0702702703;
    gl_FragColor = vec4(mix(c.rgb, vec3(0.90, 0.96, 1.0), tint), 1.0);
    #ifdef FINAL
    #include <colorspace_fragment>
    #endif
  }`;

/** One cute low-poly frog clinging to a pole on its right (+x); it faces the camera (+z). The pole is at its local x = -FROG_OFF. */
function buildFrog(color: string): Group {
  const g = new Group();
  const skin = new MeshStandardMaterial({ color, roughness: 0.65, flatShading: true });
  const dark = new MeshStandardMaterial({ color: new Color(color).multiplyScalar(0.62), roughness: 0.7, flatShading: true });
  const belly = new MeshStandardMaterial({ color: new Color(color).lerp(new Color('#ffffff'), 0.7), roughness: 0.8, flatShading: true });
  const white = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, flatShading: true });
  const black = new MeshStandardMaterial({ color: '#15181f', roughness: 0.3, flatShading: true });
  const add = (geo: BufferGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  const ball = new SphereGeometry(1, 9, 7);
  add(ball, skin, 0, 0, 0, 0.62, 0.78, 0.55); // body
  add(ball, belly, 0.12, -0.05, 0.28, 0.4, 0.55, 0.3); // belly, showing toward the camera
  add(ball, skin, 0.06, 0.86, 0.12, 0.62, 0.42, 0.55); // head
  add(ball, belly, 0.08, 0.72, 0.42, 0.34, 0.2, 0.2); // throat
  add(new BoxGeometry(1, 1, 1), black, 0.08, 0.8, 0.64, 0.5, 0.035, 0.05); // mouth
  for (const dx of [-0.26, 0.26]) { // bulging eyes on top of the head
    add(ball, skin, 0.06 + dx, 1.13, 0.1, 0.2, 0.2, 0.2);
    add(ball, white, 0.06 + dx, 1.18, 0.2, 0.15, 0.15, 0.15);
    add(ball, black, 0.06 + dx * 1.05, 1.19, 0.32, 0.075, 0.075, 0.075);
  }
  for (const z of [-0.2, 0.2]) { // arms reaching to the pole, with hands gripping it
    add(new BoxGeometry(1, 1, 1), dark, -0.38, 0.4, z, 0.7, 0.14, 0.14);
    add(ball, dark, -0.74, 0.4, z, 0.14, 0.14, 0.14);
  }
  for (const z of [-0.36, 0.36]) { // folded back legs and feet on the pole
    add(ball, skin, 0.08, -0.5, z, 0.3, 0.34, 0.2);
    add(new BoxGeometry(1, 1, 1), dark, -0.32, -0.74, z * 0.85, 0.8, 0.12, 0.2);
    add(ball, dark, -0.72, -0.74, z * 0.7, 0.16, 0.1, 0.18);
  }
  return g;
}

/** The thorns of the obstacle `o` (2 to 5 starbursts: a green bump with seven red-tipped spines, spread over its hitbox), built once around its own middle (so it can be moved and tilted with the pole). */
function buildVine(o: Obstacle): BufferGeometry {
  const len = (o.y1 - o.y0) * WORLD_PER_M, parts: BufferGeometry[] = [], count = o.thorns, side = o.side; // (the hitbox is as tall as the thorns need: more thorns, taller)
  const paint = (geo: BufferGeometry, color: string) => { const c = new Color(color), n = geo.getAttribute('position').count, cols: number[] = []; for (let i = 0; i < n; i++) cols.push(c.r, c.g, c.b); geo.setAttribute('color', new Float32BufferAttribute(cols, 3)); return geo; };
  const burst: [number, number][] = [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.8], [0, -0.8], [0.45, 0.6], [-0.45, -0.6]]; // (spines bursting out in every direction, as angles up/down and toward/away from the camera)
  for (let i = 0; i < count; i++) {
    const y = -len / 2 + (len * (i + 0.5)) / count, root = new Vector3(side * 0.3, y, 0);
    const bump = new SphereGeometry(1, 8, 6); bump.scale(0.3, 0.3, 0.3); bump.translate(root.x, root.y, root.z); parts.push(paint(bump, '#4f9a45'));
    for (const [ay, az] of burst) {
      const dir = new Vector3(side * Math.cos(ay) * Math.cos(az), Math.sin(ay), Math.cos(ay) * Math.sin(az)).normalize(), q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir), L = 0.8;
      const spine = new ConeGeometry(0.05, L, 5); spine.translate(0, L / 2, 0); spine.applyQuaternion(q); spine.translate(root.x, root.y, root.z); parts.push(paint(spine, '#f4ecd0'));
      const tip = new ConeGeometry(0.0275, L * 0.32, 5); tip.translate(0, L * 0.86, 0); tip.applyQuaternion(q); tip.translate(root.x, root.y, root.z); parts.push(paint(tip, '#d94c3a'));
    }
  }
  const merged = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return merged;
}

interface PoleActor {
  id: string; name: string; color: string;
  group: Group; geo: BufferGeometry; positions: Float32Array; frog: Group; ring: Mesh; cap: Mesh; flag: Mesh; tag: Sprite;
  angle: number; // the pole's place on the circle
  dispH: number; dispLean: number; dispSide: -1 | 1; swapStart: number; swapFrom: -1 | 1; pendingSide: -1 | 1 | null; pendingUntil: number;
  hopStart: number; localHopAt: number; seenClimbAt: number; seenSlipAt: number; initialised: boolean;
  vines: { o: Obstacle; mesh: Mesh }[]; red: number; colorAttr: BufferAttribute;
  rope: { geo: BufferGeometry; positions: Float32Array; mat: MeshStandardMaterial }; ropeA: number; ropeD: number;
  puffs: { sprite: Sprite; vx: number; vy: number; life: number }[]; emit: number;
}

/**
 * Everything three.js for Frog Climb. Every player's pole stands on a circle (two across from each other, three in a triangle...), and the camera is FIXED in angle: it hangs outside the circle,
 * looking straight at the pole it follows (yours, the followed player's, or the winner's), and rises with that frog. The followed pole and frog are drawn sharp; everything behind them (the other
 * poles, the ground, the sky) is drawn to a smaller picture and blurred like frosted glass. Poles bend toward their frog's side with the shared pole maths (pole.ts); what is drawn is eased toward the server's numbers.
 */
export class FrogClimbScene {
  private renderer: WebGLRenderer;
  private bgScene = new Scene(); // the blurred backdrop: sky, ground and every pole but the followed one
  private fgScene = new Scene(); // the sharp pole being followed
  private tagScene = new Scene(); // names, on a top layer
  private camera = new PerspectiveCamera(CAM_FOV, 1, 0.5, 400);
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadScene = new Scene();
  private rtA = new WebGLRenderTarget(2, 2, { samples: 4 });
  private rtB = new WebGLRenderTarget(2, 2);
  private blurH: ShaderMaterial;
  private blurV: ShaderMaterial;
  private poles = new Map<string, PoleActor>();
  private view: FrogClimbView | null = null;
  private vineSeed: number | null = null;
  private baseColors = new Float32Array(0);
  private redColors = new Float32Array(0);
  private vineMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
  private followId: string | null;
  private winnerView = false;
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private camPos = new Vector3();
  private camLook = new Vector3();
  private camReady = false;
  private squiggle: CanvasTexture;
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  /** The start countdown's camera move, 0 (pulled far back) .. 1 (normal); set by the game screen from the server's clock. */
  introFactor: () => number = () => 1;
  /** Floating names are on by default; the tile picture turns them off (it shows the 3D models only). */
  showNames = true;

  constructor(private container: HTMLElement, private serverNow: () => number, styles: FrogStyle[], follow: string | null) {
    this.followId = follow;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer, this.rtA, this.rtB);

    this.squiggle = makeSquiggleTexture(); this.disposables.push(this.squiggle);
    const sky = makeSkyTexture();
    this.bgScene.background = sky;
    this.bgScene.fog = new Fog('#dcf0ee', 50, 190);
    const ground = new Mesh(new PlaneGeometry(600, 600), new MeshStandardMaterial({ color: '#a6d98f', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; this.bgScene.add(ground);
    this.disposables.push(sky, ground.geometry, ground.material as MeshStandardMaterial);
    for (const s of [this.bgScene, this.fgScene]) {
      s.add(new HemisphereLight('#ffffff', '#b7d6a0', 1.05));
      s.add(new AmbientLight('#ffffff', 0.35));
      const sun = new DirectionalLight('#fff3da', 1.5); sun.position.set(-14, 40, 30); s.add(sun);
    }

    // the blur: draw the backdrop small, blur it sideways, then blur it up and down straight onto the screen with a faint frosted-white veil
    const mk = (final: boolean) => new ShaderMaterial({
      uniforms: { tex: { value: null }, dir: { value: new Vector2() }, tint: { value: final ? 0.16 : 0 } },
      vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, defines: final ? { FINAL: '' } : {}, depthTest: false, depthWrite: false,
    });
    this.blurH = mk(false); this.blurV = mk(true);
    const quadGeo = new PlaneGeometry(2, 2);
    const quad = new Mesh(quadGeo, this.blurH); quad.frustumCulled = false; this.quadScene.add(quad);
    this.disposables.push(quadGeo, this.blurH, this.blurV);

    // shared pole parts
    const ringGeo = new TorusGeometry(0.5, 0.09, 6, 14), ringMat = new MeshStandardMaterial({ color: '#e5483c', roughness: 0.5, flatShading: true });
    const capGeo = new SphereGeometry(0.3, 8, 6), capMat = new MeshStandardMaterial({ color: '#f2c94c', roughness: 0.4, flatShading: true });
    const moundGeo = new CylinderGeometry(3.4, 4.6, 0.8, 10), moundMat = new MeshStandardMaterial({ color: '#86c46e', roughness: 1, flatShading: true });
    const flagGeo = new ConeGeometry(0.45, 1.6, 3); flagGeo.rotateZ(-Math.PI / 2); flagGeo.translate(0.8, 0, 0);
    const poleMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: false });
    const indices: number[] = [];
    for (let i = 0; i < SEGS; i++) for (let k = 0; k < SIDES; k++) { const a = i * SIDES + k, b = i * SIDES + ((k + 1) % SIDES), c = a + SIDES, d = b + SIDES; indices.push(a, b, c, b, d, c); }
    const colors: number[] = [], redColors: number[] = [], wood = new Color('#8a5a33'), redWood = new Color('#d8352b'), tmp = new Color();
    for (let i = 0; i <= SEGS; i++) {
      const y = (i / SEGS) * POLE_LEN, g = grainOf(Math.floor(i / 3));
      tmp.copy(wood).multiplyScalar(g); if (y > POLE_WORLD_HEIGHT) tmp.lerp(new Color('#c9a06c'), 0.35); // (a paler wood above the finish ring)
      for (let k = 0; k < SIDES; k++) colors.push(tmp.r, tmp.g, tmp.b);
      tmp.copy(redWood).multiplyScalar(0.85 + 0.15 * g); // (the same pole, as it looks when it is bent to the limit: red)
      for (let k = 0; k < SIDES; k++) redColors.push(tmp.r, tmp.g, tmp.b);
    }
    this.disposables.push(this.vineMat, ringGeo, ringMat, capGeo, capMat, moundGeo, moundMat, flagGeo, poleMat);

    const n = styles.length, radius = Math.max(12, 4.2 * n);
    styles.forEach((s, i) => {
      const angle = (i / n) * Math.PI * 2 + Math.PI / 2; // (the first pole is nearest the bottom of an overview)
      const group = new Group();
      group.position.set(radius * Math.cos(angle), 0, radius * Math.sin(angle));
      group.rotation.y = Math.PI / 2 - angle; // (its local +x is screen-right for a camera standing outside the circle, looking in; local +z points at that camera)
      const positions = new Float32Array((SEGS + 1) * SIDES * 3), geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(positions, 3)); // (shares the array, which bendPole rewrites every frame)
      const colorAttr = new BufferAttribute(new Float32Array(colors), 3); // (each pole has its own colors: it reddens as it bends)
      geo.setAttribute('color', colorAttr);
      geo.setIndex(indices);
      const pole = new Mesh(geo, poleMat); pole.frustumCulled = false; group.add(pole);
      const ropePositions = new Float32Array((ROPE_PTS + 1) * ROPE_SIDES * 3), ropeGeo = new BufferGeometry(), ropeIdx: number[] = [];
      ropeGeo.setAttribute('position', new BufferAttribute(ropePositions, 3));
      for (let j = 0; j < ROPE_PTS; j++) for (let k = 0; k < ROPE_SIDES; k++) { const a0 = j * ROPE_SIDES + k, b0 = j * ROPE_SIDES + ((k + 1) % ROPE_SIDES), c0 = a0 + ROPE_SIDES, d0 = b0 + ROPE_SIDES; ropeIdx.push(a0, b0, c0, b0, d0, c0); }
      ropeGeo.setIndex(ropeIdx);
      const rope = { geo: ropeGeo, positions: ropePositions, mat: new MeshStandardMaterial({ color: '#efe1bd', roughness: 0.9, flatShading: true }) };
      const ropeMesh = new Mesh(ropeGeo, rope.mat); ropeMesh.frustumCulled = false; group.add(ropeMesh);
      const mound = new Mesh(moundGeo, moundMat); mound.position.y = -0.1; group.add(mound);
      const ring = new Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; group.add(ring);
      const cap = new Mesh(capGeo, capMat); group.add(cap);
      const flag = new Mesh(flagGeo, new MeshStandardMaterial({ color: s.color, roughness: 0.6, flatShading: true, side: 2 })); group.add(flag);
      const frog = buildFrog(s.color); group.add(frog);
      const puffs = Array.from({ length: PUFF_MAX }, () => {
        const sprite = new Sprite(new SpriteMaterial({ map: this.squiggle, transparent: true, depthWrite: false, opacity: 0 }));
        sprite.visible = false; group.add(sprite);
        return { sprite, vx: 0, vy: 0, life: 0 };
      });
      const tag = createNameTag(s.name, s.color); this.tagScene.add(tag);
      this.poles.set(s.id, { id: s.id, name: s.name, color: s.color, group, geo, positions, frog, ring, cap, flag, tag, angle,
        dispH: 0, dispLean: 0, dispSide: 1, swapStart: -1e9, swapFrom: 1, pendingSide: null, pendingUntil: 0, hopStart: -1e9, localHopAt: -1e9, seenClimbAt: 0, seenSlipAt: 0, initialised: false, vines: [], red: -1, colorAttr, puffs, emit: 0, rope, ropeA: NaN, ropeD: NaN });
    });
    this.baseColors = new Float32Array(colors); this.redColors = new Float32Array(redColors);
    this.assignLayers();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  pushView(view: FrogClimbView) {
    this.view = view;
    this.ensureVines(view.seed);
    const nowPerf = performance.now();
    for (const [id, pv] of Object.entries(view.players)) {
      const p = this.poles.get(id); if (!p) continue;
      if (!p.initialised) { p.initialised = true; p.dispH = pv.h; p.dispLean = pv.lean; p.dispSide = pv.side; p.seenClimbAt = pv.climbAt; p.seenSlipAt = pv.slipAt; continue; }
      if (pv.climbAt !== p.seenClimbAt) { p.seenClimbAt = pv.climbAt; if (nowPerf - p.localHopAt > 300) p.hopStart = nowPerf; } // (your own hop already started when you tapped)
      if (pv.slipAt !== p.seenSlipAt) { p.seenSlipAt = pv.slipAt; }
      if (p.pendingSide !== null) {
        if (pv.side === p.pendingSide) p.pendingSide = null; // the server has caught up with your swap
        else if (nowPerf < p.pendingUntil) continue; // (not yet: keep the side you chose)
        else p.pendingSide = null;
      }
      if (pv.side !== p.dispSide) { p.swapFrom = p.dispSide; p.dispSide = pv.side; p.swapStart = nowPerf; }
    }
  }
  /** Builds every pole's thorny vines once, from the round's seed (they are the same on every pole). */
  private ensureVines(seed: number) {
    if (this.vineSeed === seed) return;
    this.vineSeed = seed;
    const list = obstaclesFor(seed);
    for (const p of this.poles.values()) for (const o of list) {
      const mesh = new Mesh(buildVine(o), this.vineMat); mesh.frustumCulled = false; p.group.add(mesh); p.vines.push({ o, mesh });
    }
  }
  /** Whose pole the camera follows: yours, the followed player's, or the winner's. null (a draw) pulls back to look at the whole circle. */
  setFollow(id: string | null) {
    if (id === this.followId) return;
    this.followId = id;
    this.assignLayers();
  }
  setWinnerView(on: boolean) { this.winnerView = on; }
  setSecondsLeft(s: number) { this.clock.update(s); }
  /** Your own tap, shown at once (the height itself comes from the server). */
  localClimb(id: string) { const p = this.poles.get(id); if (!p) return; p.hopStart = p.localHopAt = performance.now(); }
  localSwap(id: string) {
    const p = this.poles.get(id); if (!p) return;
    const now = performance.now();
    p.swapFrom = p.dispSide; p.dispSide = p.dispSide === 1 ? -1 : 1; p.swapStart = now; p.pendingSide = p.dispSide; p.pendingUntil = now + 700;
  }

  /** The followed pole goes in the sharp scene, all the others in the blurred one (when nobody is followed, everything is sharp: it is the pulled-back look at the whole circle). */
  private assignLayers() {
    for (const p of this.poles.values()) { (this.followId === null || p.id === this.followId ? this.fgScene : this.bgScene).add(p.group); }
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const bw = Math.max(2, Math.round(size.x * BLUR_SCALE)), bh = Math.max(2, Math.round(size.y * BLUR_SCALE));
    this.rtA.setSize(bw, bh); this.rtB.setSize(bw, bh);
    this.blurH.uniforms.dir.value.set(1.6 / bw, 0);
    this.blurV.uniforms.dir.value.set(0, 1.6 / bh);
  }

  /** The more a pole bends, the redder it turns (nothing until it is leaning a little, fully red at the limit). */
  private redden(p: PoleActor) {
    const t = Math.round(smooth((Math.abs(p.dispLean) - 0.25) / 0.7) * 50) / 50;
    if (t === p.red) return;
    p.red = t;
    const arr = p.colorAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = this.baseColors[i] + (this.redColors[i] - this.baseColors[i]) * t;
    p.colorAttr.needsUpdate = true;
    p.rope.mat.color.set('#efe1bd').lerp(new Color('#f6aa9c'), t);
  }

  /** The tremble: while a pole is straining, wavy lines fly off it around the frog (more and more of them as it nears the limit). */
  private puff(p: PoleActor, a: number, d: number, dt: number) {
    const stress = bendStress(p.dispLean);
    p.emit += stress * PUFF_RATE * dt;
    for (const q of p.puffs) {
      if (q.life <= 0) {
        if (p.emit < 1) continue;
        p.emit -= 1;
        const side = Math.random() < 0.5 ? -1 : 1, y = Math.max(1, a + (Math.random() - 0.35) * 8), c = poleCurve(y, a, d);
        q.sprite.position.set(c.x + side * 0.4, y, 0.45); q.vx = side * (2 + Math.random() * 2.5); q.vy = 0.4 + Math.random() * 1.8;
        q.sprite.material.rotation = (Math.random() - 0.5) * 1.2 + (side < 0 ? Math.PI : 0); // (pointing away from the pole, tilted a little)
        q.life = PUFF_LIFE; q.sprite.visible = true;
      } else {
        q.life -= dt;
        const age = 1 - Math.max(0, q.life) / PUFF_LIFE;
        q.sprite.position.x += q.vx * dt; q.sprite.position.y += q.vy * dt; q.vx *= Math.exp(-2 * dt);
        { const w = 1.0 + 0.7 * age; q.sprite.scale.set(w, w / 2, 1); }
        q.sprite.material.opacity = Math.min(1, (1 - age) * 1.6) * (0.5 + 0.5 * stress);
        if (q.life <= 0) { q.sprite.visible = false; q.sprite.material.opacity = 0; }
      }
    }
  }

  /** Reshapes one pole to the bend its frog gives it. */
  private bendPole(p: PoleActor, a: number, d: number) {
    const pos = p.positions;
    for (let i = 0; i <= SEGS; i++) {
      const y = (i / SEGS) * POLE_LEN, { x, slope } = poleCurve(y, a, d), r = 0.27 - 0.11 * (y / POLE_LEN);
      const ang = Math.atan(slope), nx = Math.cos(ang), ny = -Math.sin(ang);
      for (let k = 0; k < SIDES; k++) {
        const phi = (k / SIDES) * Math.PI * 2, c = Math.cos(phi) * r, s = Math.sin(phi) * r, o = (i * SIDES + k) * 3;
        pos[o] = x + c * nx; pos[o + 1] = y + c * ny; pos[o + 2] = s;
      }
    }
    const attr = p.geo.getAttribute('position'); attr.needsUpdate = true;
    p.geo.computeVertexNormals();
    this.bendRope(p, a, d);
  }
  /** The rope that spirals up the pole follows its bend (only rebuilt when the pole's shape has changed). */
  private bendRope(p: PoleActor, a: number, d: number) {
    if (Math.abs(p.ropeA - a) < 1e-4 && Math.abs(p.ropeD - d) < 1e-4) return;
    p.ropeA = a; p.ropeD = d;
    const pos = p.rope.positions;
    for (let j = 0; j <= ROPE_PTS; j++) {
      const t = j / ROPE_PTS, y = t * POLE_LEN, { x } = poleCurve(y, a, d), r = 0.27 - 0.11 * t + 0.045, ph = t * ROPE_TURNS * Math.PI * 2, cs = Math.cos(ph), sn = Math.sin(ph);
      const cx = x + cs * r, cz = sn * r;
      for (let k = 0; k < ROPE_SIDES; k++) {
        const q = (k / ROPE_SIDES) * Math.PI * 2, ca = Math.cos(q) * ROPE_R, sa = Math.sin(q) * ROPE_R, o = (j * ROPE_SIDES + k) * 3;
        pos[o] = cx + cs * ca; pos[o + 1] = y + sa; pos[o + 2] = cz + sn * ca; // (the little cross-section turns in the plane of "outwards" and "up")
      }
    }
    p.rope.geo.getAttribute('position').needsUpdate = true;
    p.rope.geo.computeVertexNormals();
  }

  private frame = (t: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000); this.lastFrame = t;
    if (this.view) this.update(this.view, dt, t);
    this.draw();
  };

  private update(v: FrogClimbView, dt: number, tPerf: number) {
    const follow = this.followId ? this.poles.get(this.followId) : undefined;
    for (const p of this.poles.values()) {
      const pv: FrogPlayerView | undefined = v.players[p.id];
      if (!pv) { p.group.visible = false; p.tag.visible = false; continue; }
      p.group.visible = true;
      p.dispH += (pv.h - p.dispH) * (1 - Math.exp(-(pv.h >= p.dispH ? 16 : 7) * dt)); // (hops up quickly; a slip slides down where you can see it)
      p.dispLean += (pv.lean - p.dispLean) * (1 - Math.exp(-14 * dt));
      const a = worldY(p.dispH), d = frogDeflection(p.dispH, p.dispLean);
      this.bendPole(p, a, d);
      this.redden(p);
      this.puff(p, a, d, dt);

      // the frog: on its side of the pole, hopping up, or scrambling round the front of the pole to the other side
      const swapU = clamp((tPerf - p.swapStart) / SWAP_COOLDOWN_MS, 0, 1), e = smooth(swapU);
      const from = p.swapFrom === 1 ? 0 : Math.PI, to = p.dispSide === 1 ? 0 : Math.PI, ang = swapU < 1 ? from + (to - from) * e : to;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      const { x, slope } = poleCurve(a, a, d), tilt = Math.atan(slope), nx = Math.cos(tilt), ny = -Math.sin(tilt);
      const hopU = clamp((tPerf - p.hopStart) / 260, 0, 1), hop = Math.sin(Math.PI * hopU) * 0.8 + (swapU < 1 ? Math.sin(Math.PI * swapU) * 0.9 : 0);
      const lift = 0.55 * Math.max(0, 1 - a / 2.5); // (at the bottom the frog stands on top of the grassy base, not in it; the lift fades away within the first couple of hops)
      p.frog.position.set(x + FROG_OFF * cosA * nx, a + 0.75 + lift + FROG_OFF * cosA * ny + hop, FROG_OFF * sinA * 0.9);
      p.frog.rotation.set(0, 0, -tilt);
      const squash = 1 + 0.12 * Math.sin(Math.PI * hopU);
      p.frog.scale.set((cosA >= 0 ? 1 : -1) * 1.1 / squash, 1.1 * squash, 1.1);

      // the vines ride on the bending pole
      for (const { o, mesh } of p.vines) {
        const yc = worldY((o.y0 + o.y1) / 2), c = poleCurve(yc, a, d);
        mesh.position.set(c.x, yc, 0); mesh.rotation.z = -Math.atan(c.slope);
      }

      // the finish ring, the pennant and the cap at the top follow the pole's tip
      const ringAt = poleCurve(POLE_WORLD_HEIGHT, a, d), tipAt = poleCurve(POLE_LEN, a, d);
      p.ring.position.set(ringAt.x, POLE_WORLD_HEIGHT, 0); p.ring.rotation.set(Math.PI / 2, 0, -Math.atan(ringAt.slope));
      p.cap.position.set(tipAt.x, POLE_LEN + 0.15, 0);
      p.flag.position.set(tipAt.x, POLE_LEN - 1.1, 0); p.flag.rotation.z = Math.sin(tPerf / 260 + p.angle) * 0.12;
    }
    this.updateCamera(v, follow, dt);
    this.updateTags(follow);
  }

  private updateCamera(v: FrogClimbView, follow: PoleActor | undefined, dt: number) {
    const f = smooth(this.introFactor()), pullBack = 1 + 0.25 * (this.winnerView ? 1 : 0);
    let wantPos: Vector3, wantLook: Vector3;
    if (follow) {
      const a = worldY(follow.dispH), d = frogDeflection(follow.dispH, follow.dispLean), fx = poleCurve(a, a, d).x * 0.92 * f;
      const far = 1 + 2.4 * (1 - f); // (the opening: pulled far back, showing the whole pole, then in to the frog)
      const lookY = (a + 4.2) * f + 36 * (1 - f);
      wantPos = follow.group.localToWorld(new Vector3(fx, lookY + (1 - f) * 8, CAM_DIST * far * pullBack));
      wantLook = follow.group.localToWorld(new Vector3(fx, lookY, 0));
    } else { // a draw: pull back and look at all the poles from above and outside the circle
      const R = Math.max(12, 4.2 * this.poles.size);
      wantPos = new Vector3(0, 34, R + 62); wantLook = new Vector3(0, 22, 0);
    }
    if (!this.camReady) { this.camPos.copy(wantPos); this.camLook.copy(wantLook); this.camReady = true; }
    else { const k = 1 - Math.exp(-(follow && follow.id === this.lastFollow ? 20 : 3.2) * dt); this.camPos.lerp(wantPos, k); this.camLook.lerp(wantLook, k); }
    this.lastFollow = follow?.id ?? null;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    void v;
  }
  private lastFollow: string | null = null;

  /** Names float above each frog, drawn last on their own layer and kept the same size on screen whatever the distance. */
  private updateTags(follow: PoleActor | undefined) {
    const k = 2 * Math.tan((CAM_FOV * Math.PI) / 360) * 0.04, world = new Vector3();
    for (const p of this.poles.values()) {
      p.tag.visible = p.group.visible && this.showNames;
      if (!p.tag.visible) continue;
      world.copy(p.frog.position); world.y += 1.9;
      p.group.localToWorld(world);
      p.tag.position.copy(world);
      const dist = Math.max(1, world.distanceTo(this.camera.position)), h = dist * k * (p === follow ? 1 : 0.85);
      p.tag.scale.set(h * 4, h, 1);
    }
  }

  private draw() {
    const r = this.renderer;
    // 1. the backdrop, small; 2. blurred sideways; 3. blurred up and down onto the screen
    r.setRenderTarget(this.rtA); r.clear(); r.render(this.bgScene, this.camera);
    const quad = this.quadScene.children[0] as Mesh;
    quad.material = this.blurH; this.blurH.uniforms.tex.value = this.rtA.texture;
    r.setRenderTarget(this.rtB); r.clear(); r.render(this.quadScene, this.quadCam);
    quad.material = this.blurV; this.blurV.uniforms.tex.value = this.rtB.texture;
    r.setRenderTarget(null); r.clear(); r.render(this.quadScene, this.quadCam);
    // 4. the sharp pole and frog, then the names
    r.clearDepth(); r.render(this.fgScene, this.camera);
    r.clearDepth(); r.render(this.tagScene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const p of this.poles.values()) {
      p.geo.dispose();
      p.frog.traverse((c) => { if (c instanceof Mesh) { c.geometry.dispose(); (c.material as MeshStandardMaterial).dispose(); } });
      (p.flag.material as MeshStandardMaterial).dispose();
      for (const v of p.vines) v.mesh.geometry.dispose();
      for (const q of p.puffs) q.sprite.material.dispose();
      p.rope.geo.dispose(); p.rope.mat.dispose();
      disposeNameTag(p.tag);
    }
    for (const d of this.disposables) d.dispose();
    this.renderer.domElement.remove();
  }
}
