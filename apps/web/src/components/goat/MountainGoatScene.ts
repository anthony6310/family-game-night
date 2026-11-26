import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, IcosahedronGeometry, PerspectiveCamera, Scene, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3, WebGLRenderer,
} from 'three';
import { GOAT_BODY_Y, JUMP_MS, arcHeight, birdAt, birdZ, gapAt, indicatorLen, periodAt, platformX, radiusOf, tolAt, type GoatPlayerView, type MountainGoatView } from '@fgn/shared';
import { createRoundClock } from '../../audio/roundClock';
import { audio } from '../../audio/spatialAudio';
import { birdFlaps, birdHit, goatFall, goatJump, goatLand, pointDing, sweepHum } from '../../audio/goatSounds';

/** A bird that has just been hit: where it was (p0), the velocity the collision gave it (v0), its heading and tumble, and how long ago (f seconds). Its motion from there is a pure function of f. */
interface BirdBump { p0: Vector3; v0: Vector3; yaw: number; spin: Vector3; f: number }
export interface GoatStyle { id: string; name: string; color: string }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (x: number) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
// The camera: this high and this far back from what it looks at. A tall (portrait) screen gets a flatter-on, more overhead view so the jump is easier to judge.
const CAM_WIDE = { h: 15, d: 12 };
const CAM_TALL = { h: 21, d: 7 };
const LAND_SHAKE = 0.07; // a subtle shake when the goat lands...
const FAIL_SHAKE = 0.39; // ...and a more noticeable one when it falls (a missed ledge, or the bird)
const PUFF_COUNT = 34;
const BIRD_GRAVITY = 26; // how hard a bird that has been hit is pulled down
const FALL_SHOW_MS = 700; // a goat that missed tumbles for this long after its leap (or after meeting the bird), then climbs back
const CLIFF_DEPTH = 28; // how far down the cliff takes to fade to black
const CLIFF_HEIGHT = 60;

/** The top of a ledge: packed brown earth with splotches of grass. */
function makeEarthTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a6a46'; g.fillRect(0, 0, 256, 256);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blot = (color: string, count: number, rMin: number, rMax: number) => {
    for (let i = 0; i < count; i++) { g.fillStyle = color; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, rMin + rnd() * (rMax - rMin), (rMin + rnd() * (rMax - rMin)) * 0.75, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  };
  blot('#76593a', 14, 8, 22); // darker earth
  blot('#5e8f3b', 16, 10, 30); // grass
  blot('#719f45', 12, 6, 16); // lighter grass
  blot('#4b7a2e', 8, 4, 10);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}
/** The void round the ledges: a dusky haze at the top of the screen sinking to black. */
function makeVoidTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#46587a'); grad.addColorStop(0.35, '#1d2638'); grad.addColorStop(1, '#000000');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}


// THE CREVICE. The ledges stand in a narrow gap between two cliff sides, seen from above: a grassy, rocky rim, then a stepped, cracked rock face dropping into black. It runs the way the goat travels
// (so up the screen on a phone held upright). It is scenery only: nothing in the game reads it. It is built in tiles that follow the camera.
const WALL_TILE = 24; // length of one tile of wall, along the gap
const WALL_SEGS = 8;
const RIM_Y = -1.2; // the rim of the gap is just below the ledges' tops
// the cross-section of one side (distance from the middle of the gap, height): a wide flat rim, then a face that steps inwards and downwards, narrowing the gap to a slit
const WALL_PROFILE: readonly [number, number][] = [[14, RIM_Y], [3.6, RIM_Y], [3.45, -5], [3.0, -5.6], [2.95, -10], [2.5, -10.6], [2.4, -16], [2.0, -16.5], [1.9, -23], [1.6, -24], [1.5, -60]];
const hash = (a: number, b: number, c: number, v: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + v * 19.19) * 43758.5453; return x - Math.floor(x); };

/** One tile of wall for one side of the gap (the other side is the same mirrored). The tile's two ends are not roughened, so neighbouring tiles join without a seam. `variant` makes different tiles look different. */
function buildWallTile(variant: number): BufferGeometry {
  const M = WALL_PROFILE.length, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const rock = new Color('#aaa59b'), warm = new Color('#b98a63'), grass = new Color('#6f9a45'), c = new Color();
  for (let i = 0; i <= WALL_SEGS; i++) {
    const taper = Math.sin((Math.PI * i) / WALL_SEGS);
    for (let j = 0; j < M; j++) {
      const [pz, py] = WALL_PROFILE[j], edge = j > 0 && j < M - 1;
      const h1 = hash(i, j, 1, variant), h2 = hash(i, j, 2, variant), h3 = hash(i, j, 3, variant), h4 = hash(i, j, 4, variant);
      const x = (i * WALL_TILE) / WALL_SEGS + (j >= 1 ? (h1 - 0.5) * 1.2 * taper : 0);
      const z = pz + (edge ? (h2 - 0.5) * (j === 1 ? 0.7 : 0.45) * taper : 0);
      const y = py + (j >= 2 && edge ? (h3 - 0.5) * 0.6 * taper : 0);
      positions.push(x, y, z);
      if (j <= 1) c.copy(rock).lerp(grass, h4 > 0.4 ? 0.55 + 0.4 * h1 : 0.1).multiplyScalar(0.85 + 0.3 * h2); // the rim top: rock with patches of grass
      else {
        c.copy(rock).multiplyScalar(0.7 + 0.55 * h4); // the face: blocky grey rock with warmer streaks
        if (h1 > 0.82) c.lerp(warm, 0.5);
        c.multiplyScalar(Math.pow(clamp(1 - (RIM_Y - y) / 26, 0, 1), 1.2)); // darker and darker with depth, to black
      }
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < WALL_SEGS; i++) for (let j = 0; j < M - 1; j++) { const a = i * M + j, b = a + M; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function buildGoat(color: string): Group {
  const g = new Group();
  const white = new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.9, flatShading: true });
  const tint = new MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
  const dark = new MeshStandardMaterial({ color: '#4a4036', roughness: 0.9, flatShading: true });
  const add = (geo: BoxGeometry | ConeGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number): Mesh => { const m = new Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new BoxGeometry(1.2, 0.7, 0.62), white, 0, 0.85, 0); // body
  add(new BoxGeometry(0.5, 0.12, 0.66), tint, -0.05, 1.22, 0); // a saddle blanket in the player's colour
  add(new BoxGeometry(0.46, 0.42, 0.4), white, 0.78, 1.2, 0); // head
  add(new BoxGeometry(0.2, 0.2, 0.3), dark, 1.08, 1.12, 0); // muzzle
  const horn = new ConeGeometry(0.07, 0.5, 5);
  for (const z of [-0.14, 0.14]) { const h = add(horn, tint, 0.7, 1.58, z); h.rotation.z = 0.5; }
  add(new ConeGeometry(0.08, 0.3, 4), white, 1.0, 0.85, 0).rotation.z = Math.PI; // beard
  add(new BoxGeometry(0.22, 0.2, 0.15), white, -0.65, 1.1, 0).rotation.z = 0.6; // tail
  const leg = new BoxGeometry(0.16, 0.55, 0.16);
  for (const [x, z] of [[0.45, 0.2], [0.45, -0.2], [-0.45, 0.2], [-0.45, -0.2]]) add(leg, dark, x, 0.3, z);
  return g;
}

/** A bird seen from above: a body, a beak, and two wings that flap (`wings` are rotated about their roots each frame). It faces +x. */
function buildBird(): { group: Group; wings: Mesh[] } {
  const group = new Group();
  const body = new MeshStandardMaterial({ color: '#2f3a5e', roughness: 0.8, flatShading: true });
  const belly = new MeshStandardMaterial({ color: '#e9eef7', roughness: 0.8, flatShading: true });
  const beakM = new MeshStandardMaterial({ color: '#f2a33a', roughness: 0.6, flatShading: true });
  const b = new Mesh(new SphereGeometry(0.4, 7, 5), body); b.scale.set(1.4, 0.8, 0.8); group.add(b);
  const w = new Mesh(new SphereGeometry(0.25, 6, 4), belly); w.scale.set(1.2, 0.5, 0.6); w.position.set(0.05, -0.12, 0); group.add(w);
  const beak = new Mesh(new ConeGeometry(0.1, 0.35, 5), beakM); beak.rotation.z = -Math.PI / 2; beak.position.set(0.7, 0, 0); group.add(beak);
  const wings: Mesh[] = [];
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(0.55, 0.06, 1.05), body);
    wing.geometry.translate(0, 0, side * 0.52); // (so it hinges at the body)
    wing.position.set(-0.05, 0.05, 0); group.add(wing); wings.push(wing);
  }
  group.scale.setScalar(1.25);
  return { group, wings };
}

/**
 * Everything three.js for Closing the Gap: an overhead, tilted view of ONE goat (yours, or the player a spectator follows) on its ledge with the next ledge across the gap.
 * The marker is an arc and arrowhead like Santa's Sack's throw aim, in the player's colour. The ledges are brown, grassy-topped cliffs that drop away into black. A bird may patrol the gap.
 * The leap, the fall and the climb back are drawn from the view's `last` tap and `armedAt` and the clock, so the picture is a pure function of the server's numbers.
 * Travel is left to right on a wide screen and bottom to top on a tall one.
 */
export class MountainGoatScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.5, 300);
  private view: MountainGoatView | null = null;
  private overrides = new Map<string, GoatPlayerView>(); // your own instant, locally-judged state until the server's view catches up
  private followId: string | null;
  private colorOf = new Map<string, string>();
  private goats = new Map<string, Group>();
  private platforms = new Map<number, Mesh[]>();
  private xs: number[] = [0];
  private aimGroup = new Group();
  private aimTube: Mesh;
  private aimHead: Mesh;
  private aimMaterial: MeshBasicMaterial;
  private earth: CanvasTexture;
  private wallTiles = new Map<number, Group>(); // the crevice tiles in view, by tile number
  private wallGeos = [buildWallTile(0), buildWallTile(1)];
  private wallMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: 2 });
  private bushGeo = new IcosahedronGeometry(1, 0);
  private bushMats = ['#4f8a3a', '#5f9a44', '#3f7430'].map((col) => new MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }));
  private birds = new Map<number, { bird: { group: Group; wings: Mesh[] }; born: number }>(); // the bird of each jump that is in view (this jump's, and the next one's, already flying)
  private puffs: { mesh: Mesh; vel: Vector3; life: number; max: number }[] = []; // the plume of earth and grass thrown up when the goat lands
  private shake = 0; // the camera's current shake, in world units (it dies away quickly)
  private heardJump = new Map<string, number>(); // per goat: the tap whose leap sound has played
  private sweepKey = ''; // which sweep of the marker has had its hum
  private flapsAt = -1e9; // when the bird's wing beats last played
  private fired = new Map<string, number>(); // per goat: the tap whose landing (or fall) has already had its plume / shake
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private portrait = false;
  private focus = new Vector3(2, 0, 0);
  private winnerView = false;
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  /** The start countdown's camera move, 0 (pulled far back) .. 1 (normal); set by the game screen from the server's clock. */
  introFactor: () => number = () => 1;

  constructor(private container: HTMLElement, private serverNow: () => number, styles: GoatStyle[], follow: string | null) {
    this.followId = follow;
    for (const s of styles) this.colorOf.set(s.id, s.color);
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    const voidTex = makeVoidTexture();
    this.scene.background = voidTex;
    this.disposables.push(this.renderer, voidTex);
    this.scene.add(new AmbientLight('#ffffff', 0.95));
    const sun = new DirectionalLight('#fff4dc', 1.4); sun.position.set(-8, 20, 10); this.scene.add(sun);

    // the marker: a see-through arc in the player's colour with an arrowhead (the shape of Santa's Sack's aim arc)
    this.aimMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    this.aimTube = new Mesh(new BufferGeometry(), this.aimMaterial);
    this.aimHead = new Mesh(new ConeGeometry(1, 1, 12), this.aimMaterial);
    this.aimGroup.add(this.aimTube, this.aimHead);
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.earth = makeEarthTexture();
    this.disposables.push(this.earth, this.aimMaterial, this.aimHead.geometry, ...this.wallGeos, this.wallMat, this.bushGeo, ...this.bushMats);

    const puffGeo = new BoxGeometry(0.17, 0.17, 0.17), puffMats = ['#c9ae86', '#a38660', '#6fa044'].map((c) => new MeshBasicMaterial({ color: c }));
    this.disposables.push(puffGeo, ...puffMats);
    for (let i = 0; i < PUFF_COUNT; i++) { const m = new Mesh(puffGeo, puffMats[i % 3]); m.visible = false; this.scene.add(m); this.puffs.push({ mesh: m, vel: new Vector3(), life: 0, max: 1 }); }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  pushView(view: MountainGoatView) { this.view = view; }
  /** Whose goat is shown: yours, the one a spectator follows, or the winner's. */
  setFollow(id: string | null) { this.followId = id; }
  /** Your own state as judged on your phone the instant you tapped (null once the server's view has caught up). */
  setOverride(id: string, state: GoatPlayerView | null) { if (state) this.overrides.set(id, state); else this.overrides.delete(id); }
  setWinnerView(on: boolean) { this.winnerView = on; }
  setSecondsLeft(s: number) { this.clock.update(s); }

  private xOf(n: number): number { const seed = this.view!.seed; while (this.xs.length <= n) this.xs.push(platformX(seed, this.xs.length)); return this.xs[n]; }
  private cam() { return this.portrait ? CAM_TALL : CAM_WIDE; }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.portrait = h > w;
    this.camera.aspect = w / h;
    const c = this.cam(), dist = Math.hypot(c.h, c.d), S = 8.6; // the span along the jump (goat to the far edge of the next ledge, with margin) must fit
    const vfov = this.portrait ? 2 * Math.atan((S * (c.h / dist)) / dist) : 2 * Math.atan(Math.tan(Math.atan(S / dist)) / (w / h)); // (on a tall screen the jump runs up the screen, squashed by the tilt)
    this.camera.fov = Math.max(vfov, 0.4) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** A ledge: the snowy top of a cliff that falls away, darkening, until it is black. */
  private makeLedge(r: number, x: number): Mesh[] {
    const geo = new CylinderGeometry(r, r * 2.1, CLIFF_HEIGHT, 9, 16);
    const pos = geo.getAttribute('position'), colors: number[] = [], rock = new Color('#7d5f42'), grass = new Color('#5c8a3a'), c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const depth = CLIFF_HEIGHT / 2 - pos.getY(i); // 0 at the top
      const noise = Math.abs(Math.sin(i * 12.9898 + x * 3.1) * 43758.5453) % 1; // (a steady per-vertex scatter: the facets come out blotchy)
      c.copy(rock).multiplyScalar(0.8 + 0.4 * noise);
      if (depth < 3 && noise > 0.45) c.lerp(grass, (1 - depth / 3) * 0.9); // tufts of grass round the rim
      c.multiplyScalar(Math.pow(clamp(1 - depth / CLIFF_DEPTH, 0, 1), 1.4));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const cliff = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    cliff.position.set(x, -CLIFF_HEIGHT / 2, 0);
    const cap = new Mesh(new CylinderGeometry(r * 0.97, r, 0.16, 9), new MeshStandardMaterial({ map: this.earth, roughness: 1, flatShading: true }));
    cap.position.set(x, 0.02, 0); cap.rotation.y = x * 1.7; // (each ledge's splotches sit differently)
    this.scene.add(cliff, cap);
    return [cliff, cap];
  }
  private ensurePlatforms(n: number) {
    for (let k = Math.max(0, n - 1); k <= n + 3; k++) if (!this.platforms.has(k)) this.platforms.set(k, this.makeLedge(radiusOf(k), this.xOf(k)));
    for (const [k, ms] of [...this.platforms]) {
      if (k >= n - 1 && k <= n + 3) continue;
      for (const m of ms) { m.removeFromParent(); m.geometry.dispose(); (m.material as MeshStandardMaterial).dispose(); }
      this.platforms.delete(k);
    }
  }
  private goatOf(id: string): Group {
    let g = this.goats.get(id);
    if (!g) { g = buildGoat(this.colorOf.get(id) ?? '#ffffff'); g.visible = false; this.scene.add(g); this.goats.set(id, g); }
    return g;
  }

  private frame = (t: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000); this.lastFrame = t;
    const v = this.view, id = this.followId;
    const pv = v && id ? (this.overrides.get(id) ?? v.players[id]) : undefined;
    if (v && id && pv) this.draw(v, id, pv, this.serverNow(), dt, t / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  private draw(v: MountainGoatView, id: string, pv: GoatPlayerView, now: number, dt: number, tSec: number) {
    const n = pv.jumps;
    this.ensurePlatforms(n);
    for (const [gid, g] of this.goats) if (gid !== id) g.visible = false;
    const goat = this.goatOf(id), color = this.colorOf.get(id) ?? '#ffffff';
    const last = pv.last, since = last ? now - last.at : Infinity;
    if (last && since >= 0 && since < 300 && this.heardJump.get(id) !== last.at) { // the leap's sound, only for a tap that has just happened (following someone late plays nothing old)
      this.heardJump.set(id, last.at);
      audio.playFlat(goatJump, 0.6);
    }
    const jumpFrom = last && last.ok ? n - 1 : n; // the ledge the last leap started from
    const standX = this.xOf(n);
    let x = standX, y = 0, pitch = 0, spin = 0, scale = 1, visible = true, flying = false;
    let birdFall: BirdBump | null = null;

    const leap = (x0: number, x1: number, u: number) => { // a parabola from x0 to x1: u 0..1
      const h = arcHeight(Math.abs(x1 - x0));
      x = x0 + (x1 - x0) * u; y = 4 * h * u * (1 - u); pitch = Math.atan2(4 * h * (1 - 2 * u), x1 - x0); flying = true;
    };
    const tumble = (x0: number, y0: number, f: number, drift: number) => { x = x0 + f * drift; y = y0 - f * f * 30; spin = -f * 5; scale = 1 - 0.5 * clamp(f / (FALL_SHOW_MS / 1000), 0, 1); flying = true; };

    if (last && last.ok && since < JUMP_MS && n > 0) leap(this.xOf(n - 1), standX, clamp(since / JUMP_MS, 0, 1));
    else if (last && !last.ok && last.birdU !== null) { // met the bird in the air: they fall together from the spot
      const gap = gapAt(v.seed, n), uc = last.birdU, tc = uc * JUMP_MS;
      const reach = Math.abs(last.len - gap) <= tolAt(n) ? gap : last.len, h = arcHeight(reach); // (a goat that was on target was leaping to the middle of the next ledge; otherwise as far as the marker was)
      if (since < tc) leap(standX, standX + reach, since / JUMP_MS);
      else if (since < tc + FALL_SHOW_MS) {
        const f = (since - tc) / 1000, yc = 4 * h * uc * (1 - uc);
        pitch = Math.atan2(4 * h * (1 - 2 * uc), reach);
        tumble(standX + reach * uc, yc, f, 0.6);
        const b = birdAt(v.seed, n);
        if (b) { // the bird as it was the instant of the impact, on the round's clock (the clock it was flying on), and the shove the goat gives it
          const tImpact = last.at - v.startsAt + tc, bx = this.xOf(n) + gap * b.fx, bz = birdZ(b, tImpact);
          const bobAt = Math.sin((tSec - f) * 5 + n) * 0.08; // (the bob it had in the air at that moment: so it leaves exactly where it was)
          const p0 = new Vector3(bx, 4 * arcHeight(gap) * b.fx * (1 - b.fx) + GOAT_BODY_Y + bobAt, bz);
          const secs = JUMP_MS / 1000, goatPos = new Vector3(standX + reach * uc, yc + GOAT_BODY_Y, 0);
          const vGoat = new Vector3(reach / secs, (4 * h * (1 - 2 * uc)) / secs, 0); // the goat's velocity at the impact
          const vBird = new Vector3(0, 0, (birdZ(b, tImpact + 40) - birdZ(b, tImpact - 40)) / 0.08); // the bird's own velocity (it was flying across the gap)
          const away = p0.clone().sub(goatPos); away.y = Math.max(away.y, -0.2); if (away.lengthSq() < 1e-4) away.set(0, 1, 0); away.normalize();
          const v0 = new Vector3().addScaledVector(vBird, 0.6).addScaledVector(vGoat, 0.55).addScaledVector(away, 3.5); // it keeps some of its own motion, takes some of the goat's, and is shoved away from it
          v0.y += 2.2; // (a little pop upward)
          if (Math.abs(v0.z) < 1.5) v0.z += (bz >= 0 ? 1 : -1) * 1.5; // (always knocked clearly to one side, never straight back along the goat's path)
          birdFall = { p0, v0, yaw: -Math.sign(vBird.z || 1) * Math.PI / 2, spin: new Vector3(Math.sign(v0.z) * 9, 0, -Math.sign(v0.x || 1) * 7), f };
        }
      } else if (now < pv.armedAt - 250) visible = false;
      else scale = smooth((now - (pv.armedAt - 250)) / 250);
    } else if (last && !last.ok) { // missed the ledge: leaps to where the marker was, then tumbles into the gap
      if (since < JUMP_MS) leap(standX, standX + last.len, since / JUMP_MS);
      else if (since < JUMP_MS + FALL_SHOW_MS) tumble(standX + last.len, 0, (since - JUMP_MS) / 1000, 1.2);
      else if (now < pv.armedAt - 250) visible = false; // (climbing back up)
      else scale = smooth((now - (pv.armedAt - 250)) / 250); // (and pops back onto its ledge)
    }
    goat.visible = visible;
    goat.position.set(x, y + (flying ? 0 : Math.sin(tSec * 2.4) * 0.025), 0);
    goat.rotation.set(0, 0, pitch + spin); goat.scale.setScalar(1.15 * Math.max(0.01, scale));

    // the marker: only while the goat is standing and the round is on
    const armed = !flying && visible && now >= Math.max(pv.armedAt, v.startsAt) && now < v.endsAt && scale >= 0.99;
    this.updateAim(n, pv, now, armed, standX, color);
    this.updateAimSounds(v, n, pv, now, armed);

    this.updateBird(v, n, pv, now, tSec, birdFall, jumpFrom);

    // the moment of landing (or of falling): a plume of earth and a shake. Only for a tap that has just happened, so following someone else late shows nothing old.
    if (last) {
      const at = last.ok || last.birdU === null ? JUMP_MS : last.birdU * JUMP_MS;
      if (since >= at && since < at + 400 && this.fired.get(id) !== last.at) {
        this.fired.set(id, last.at);
        if (last.ok) {
          this.puff(standX); this.shake = Math.max(this.shake, LAND_SHAKE);
          audio.playFlat(goatLand, 0.7);
          audio.playFlat(pointDing, 0.55, 0.05); // (a landing is a point)
        } else {
          this.shake = Math.max(this.shake, FAIL_SHAKE);
          audio.playFlat(last.birdU !== null ? birdHit : goatFall, last.birdU !== null ? 0.75 : 0.7); // (no sound for the climb back up: that is deliberate)
        }
      }
    }
    this.updatePuffs(dt);

    // the camera: looking between the goat and the next ledge, from the side (wide screen) or from behind (tall screen)
    const target = new Vector3((flying ? x : standX) + 0.5 * gapAt(v.seed, n), 0, 0);
    this.focus.lerp(target, 1 - Math.exp(-5 * dt));
    const far = 1 + 0.9 * (1 - smooth(this.introFactor())) + (this.winnerView ? 0.25 : 0), c = this.cam(), f = this.focus;
    if (this.portrait) this.camera.position.set(f.x - c.d * far, c.h * far, 0); else this.camera.position.set(f.x, c.h * far, c.d * far);
    if (this.shake > 0.003) { // (the view jolts by a different small amount each frame, and settles quickly)
      this.camera.position.add(new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(this.shake));
      this.shake *= Math.exp(-8 * dt);
    } else this.shake = 0;
    this.camera.lookAt(f.x, 0, 0);
    this.updateWalls(f.x);
  }

  /** Throws up a plume of earth and grass from the ledge the goat has just landed on. */
  private puff(x: number) {
    for (const p of this.puffs) {
      const a = Math.random() * Math.PI * 2, spread = 1 + Math.random() * 2.6;
      p.mesh.position.set(x + Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5);
      p.vel.set(Math.cos(a) * spread, 3.5 + Math.random() * 4.5, Math.sin(a) * spread);
      p.max = p.life = 0.6 + Math.random() * 0.5;
      p.mesh.visible = true;
    }
  }
  private updatePuffs(dt: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.z += dt * 4;
      p.mesh.scale.setScalar(Math.max(0.05, p.life / p.max));
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  /** Keeps tiles of the crevice (rock walls on both sides, with bushes along the rim) built round the camera. */
  private updateWalls(focusX: number) {
    const lo = Math.floor((focusX - 60) / WALL_TILE), hi = Math.floor((focusX + 60) / WALL_TILE);
    for (let k = lo; k <= hi; k++) {
      if (this.wallTiles.has(k)) continue;
      const tile = new Group(), geo = this.wallGeos[((k % 2) + 2) % 2];
      for (const side of [1, -1]) {
        const wall = new Mesh(geo, this.wallMat); wall.scale.z = side; tile.add(wall); // (the far side is the near side mirrored)
        for (let i = 0; i < 7; i++) { // bushes along the rim
          const r1 = hash(k, i, side, 11), r2 = hash(k, i, side, 12), r3 = hash(k, i, side, 13), size = 0.45 + 0.75 * r3;
          const bush = new Mesh(this.bushGeo, this.bushMats[Math.floor(r3 * 3) % 3]);
          bush.position.set(r1 * WALL_TILE, RIM_Y + size * 0.35, side * (3.9 + r2 * 3.5)); bush.scale.set(size * 1.2, size * 0.8, size); bush.rotation.y = r2 * 6;
          tile.add(bush);
        }
      }
      tile.position.x = k * WALL_TILE;
      this.scene.add(tile); this.wallTiles.set(k, tile);
    }
    for (const [k, tile] of [...this.wallTiles]) if (k < lo || k > hi) { tile.removeFromParent(); this.wallTiles.delete(k); } // (the geometry and materials are shared, and freed in dispose)
  }

  /** The marker: an arc from the goat to where it would land, as long as the marker is now (the same arc the goat's leap would take), ending in an arrowhead. */
  /** While the goat stands ready: the marker's hum (one per sweep, started as the sweep starts) and the bird's wing beats (while the next gap has a bird). */
  private updateAimSounds(v: MountainGoatView, n: number, pv: GoatPlayerView, now: number, armed: boolean) {
    if (!armed) { this.sweepKey = ''; return; }
    const period = periodAt(n) * 1000, since = now - pv.armedAt, key = `${pv.armedAt}:${Math.floor(since / period)}`;
    if (key !== this.sweepKey) {
      this.sweepKey = key;
      if (since % period < 250) audio.playFlat(sweepHum, 0.35); // (joining halfway through a sweep waits for the next one)
    }
    if (birdAt(v.seed, n) && now - this.flapsAt > 2000) { this.flapsAt = now; audio.playFlat(birdFlaps, 0.3); }
  }

  private updateAim(n: number, pv: GoatPlayerView, now: number, armed: boolean, standX: number, color: string) {
    this.aimGroup.visible = armed;
    if (!armed) return;
    const len = indicatorLen(n, now - pv.armedAt), h = arcHeight(len);
    const pts: Vector3[] = [];
    for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(new Vector3(standX + len * u, 0.9 + 4 * h * u * (1 - u) - 0.9 * u, 0)); }
    const end = pts[pts.length - 1], tangent = end.clone().sub(pts[pts.length - 3]).normalize();
    const radius = 0.14, head = radius * 5;
    const body = pts.slice(0, -2); body.push(end.clone().addScaledVector(tangent, -head * 0.8));
    this.aimTube.geometry.dispose();
    this.aimTube.geometry = new TubeGeometry(new CatmullRomCurve3(body), 24, radius, 10, false);
    this.aimHead.scale.set(radius * 2.4, head, radius * 2.4);
    this.aimHead.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
    this.aimHead.position.copy(end).addScaledVector(tangent, -head * 0.3);
    this.aimMaterial.color.set(color);
  }

  /** The birds: this jump's and the NEXT jump's (so a bird is already flying over the next gap before the goat gets there; they fly on the round's clock). After a collision this jump's bird tumbles with the goat, then flies back in. */
  private updateBird(v: MountainGoatView, n: number, pv: GoatPlayerView, now: number, tSec: number, birdFall: BirdBump | null, jumpFrom: number) {
    const last = pv.last, since = last ? now - last.at : Infinity;
    const base = last && last.ok && since < JUMP_MS && n > 0 ? jumpFrom : n; // (during a leap the bird it is flying past is still shown, and the next one too)
    const want = new Set<number>([base, base + 1]);
    for (const [idx, e] of [...this.birds]) if (!want.has(idx)) { e.bird.group.removeFromParent(); this.disposeBird(e.bird.group); this.birds.delete(idx); }
    const elapsed = now - v.startsAt;
    for (const idx of want) {
      const b = birdAt(v.seed, idx);
      let e = this.birds.get(idx);
      if (!b) { if (e) e.bird.group.visible = false; continue; }
      if (!e) { e = { bird: buildBird(), born: now }; this.scene.add(e.bird.group); this.birds.set(idx, e); }
      const bird = e.bird.group, gap = gapAt(v.seed, idx), h = arcHeight(gap), x = this.xOf(idx) + gap * b.fx;
      bird.visible = true;
      if (idx === n && birdFall && last) { // shoved by the goat: it flies off on the speed it was given and falls under gravity, tumbling
        const f = birdFall.f, k = 1.6, drag = (1 - Math.exp(-k * f)) / k, spinT = (1 - Math.exp(-3 * f)) / 3; // (the air slows it sideways; the tumble eases off)
        bird.position.set(birdFall.p0.x + birdFall.v0.x * drag, birdFall.p0.y + birdFall.v0.y * f - 0.5 * BIRD_GRAVITY * f * f, birdFall.p0.z + birdFall.v0.z * drag);
        bird.rotation.set(birdFall.spin.x * spinT, birdFall.yaw, birdFall.spin.z * spinT);
        bird.scale.setScalar(1.25 * clamp(1 - 0.6 * smooth((f - 0.25) / (FALL_SHOW_MS / 1000 - 0.25)), 0.1, 1)); // (full size at the impact, shrinking away as it drops out of sight)
        e.bird.wings[0].rotation.x = 0.9 * smooth(f / 0.15); e.bird.wings[1].rotation.x = -0.9 * smooth(f / 0.15); // (the wings go limp)
        continue;
      }
      let grow = smooth((now - e.born) / 400); // (a bird newly in view flies in small and grows)
      if (idx === n && last && last.birdU !== null && !last.ok && since >= last.birdU * JUMP_MS + FALL_SHOW_MS) grow = Math.min(grow, smooth((since - last.birdU * JUMP_MS - FALL_SHOW_MS) / 500)); // (after its fall it comes back; until then it flies on as normal)
      const z = birdZ(b, elapsed), dz = birdZ(b, elapsed + 40) - birdZ(b, elapsed - 40);
      bird.position.set(x, 4 * h * b.fx * (1 - b.fx) + GOAT_BODY_Y + Math.sin(tSec * 5 + idx) * 0.08, z);
      bird.rotation.set(0, -Math.sign(dz || 1) * Math.PI / 2, 0);
      bird.scale.setScalar(1.25 * Math.max(0.01, grow));
      const flap = Math.sin(tSec * 22 + idx) * 0.7;
      e.bird.wings[0].rotation.x = flap; e.bird.wings[1].rotation.x = -flap;
    }
  }
  private disposeBird(g: Group) { g.traverse((c) => { if (c instanceof Mesh) { c.geometry.dispose(); (c.material as MeshStandardMaterial).dispose(); } }); }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const ms of this.platforms.values()) for (const m of ms) { m.geometry.dispose(); (m.material as MeshStandardMaterial).dispose(); }
    for (const g of [...this.goats.values(), ...[...this.birds.values()].map((e) => e.bird.group)]) g.traverse((c) => { if (c instanceof Mesh) { c.geometry.dispose(); (c.material as MeshStandardMaterial).dispose(); } });
    this.aimTube.geometry.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.domElement.remove();
  }
}
