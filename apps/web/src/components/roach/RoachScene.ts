import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, PointLight, Matrix4, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Quaternion, RepeatWrapping, RingGeometry, Scene, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector3, WebGLRenderer,
} from 'three';
import {
  BOTTLE_RADIUS, FOOD_RADIUS, FOOD_ROT_MS, POISON_RADIUS, ROACH_LIFE_MAX, ROACH_LOW_LIFE, lightsOn, inPoison, makeLayout, ROACH_ARENA_HALF, ROACH_RADIUS, SANDAL_RADIUS, SANDAL_SPEED, SMACK_HIT_ARREST_MS, SMACK_MISS_ARREST_MS, SMACK_RADIUS, SMACK_WINDUP_MS,
  SPECIES, VARIANTS, moveRoach, stepMover,
  type Disc, type Layout, type RoachHuntView, type RoachPlayerView,
} from '@fgn/shared';
import { buildFood } from './RoachFood';
import { WALL_HEIGHT, buildBroom, buildIsland, buildKitchenUnits, buildMopBucket, buildPoisonBottle, buildShoe, buildTrashCan, type Piece } from './RoachKitchen';
import { buildCorpseGeometry, corpsePose } from './RoachCorpse';
import { FoodFx } from './RoachFoodFx';
import { LifeBar } from './RoachLifeBar';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { bottleSmash, roachCurl, roachSquish, sandalSmack, sandalSwish } from '../../audio/roachSounds';
import { createNameTag, disposeNameTag } from '../labelTexture';
import { AnimalKit, Model } from '../shelter/AnimalKit';

/** How a character is labelled and ringed. */
export interface RoachStyle {
  name: string;
  color: string;
}

const FOV_ROACH = 72; // the horizontal field of view we want on any screen shape (the vertical one follows the aspect ratio, within limits)
const FOV_SANDAL = 53;
const SANDAL_VIEW = 1.5; // the sandal's camera is this much further out than before (zoomed out 50%): the high view is a benefit of the sandal alone
const SANDAL_SIGHT = 9; // in the dark the sandal's own light lets it see this far
const SANDAL_HOVER = 4.8; // the sandal is held up in the air this high, well above the roaches
const ROACH_SCALE = 1.7;
const PREDICT_SNAP = 4;
const PREDICT_PULL = 4;
const SMACK_LIFT = 1.8; // how much higher than its hover the sandal is raised before it comes down
const SHAKE_SMACK = 0.3;
const SHAKE_DEATH = 0.5;
const SPLAT_POOL = 12;
const DUST_POOL = 6;
const ease = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The big flip-flop: a thick tan sole with a lighter footbed, red straps meeting in a V at a toe post, and a darker tread under it. Faces +z. */
function buildSandal() {
  const m = new Model();
  m.oval('#a96f36', [0.95, 0.16, 2.05], [0, 0.12, 0]); // the sole
  m.oval('#6e421f', [0.85, 0.05, 1.9], [0, 0.04, 0]); // the tread, under it
  m.oval('#e2b27a', [0.84, 0.06, 1.9], [0, 0.27, 0]); // the footbed
  m.oval('#cf9a63', [0.5, 0.025, 0.55], [0, 0.34, -1.2]); // the heel hollow
  for (const s of [-1, 1]) {
    m.limb('#d9423f', [0, 0.38, 1.05], [s * 0.82, 0.3, 0.05], 0.11); // the straps, from the toe post out to the sides
    m.oval('#b92f2d', [0.13, 0.12, 0.13], [s * 0.82, 0.3, 0.05]);
  }
  m.oval('#b92f2d', [0.17, 0.15, 0.17], [0, 0.4, 1.05]); // the toe post
  return m.build();
}

function floorTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#d9c9a3' : '#e8dcc0'; g.fillRect(x * 128, y * 128, 128, 128); }
  g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function splatTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  for (let i = 0; i < 14; i++) { // a main splat and some drops flung out
    const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.3, d = i < 5 ? 0 : 28 + (i % 4) * 8, r = i < 5 ? 22 - i * 3 : 5 + (i % 3) * 2;
    g.fillStyle = i % 2 ? '#5b6a1e' : '#7a8a2a';
    g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * 1.2, r, a, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#3b2412'; g.beginPath(); g.ellipse(0, 0, 12, 6, 0.4, 0, Math.PI * 2); g.fill(); // the shell, crushed
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** The spilled poison: a glowing purple pool with darker swirls and bright bubbles, soft at the edges. */
function poisonTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126);
  grad.addColorStop(0, 'rgba(200,110,255,0.8)'); grad.addColorStop(0.7, 'rgba(150,60,230,0.72)'); grad.addColorStop(0.92, 'rgba(100,35,170,0.5)'); grad.addColorStop(1, 'rgba(80,30,140,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) { // swirls and bubbles
    const a = i * 2.399, d = 20 + ((i * 37) % 90), r = 5 + (i % 5) * 4;
    g.fillStyle = i % 3 ? 'rgba(50,15,95,0.4)' : 'rgba(235,190,255,0.5)';
    g.beginPath(); g.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r * 1.4, r, a, 0, Math.PI * 2); g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft round blob (white, fading to nothing at the edge) for the stink and goo particles. */
function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

interface Actor {
  id: string;
  role: 'roach' | 'sandal';
  group: Group; // moved to the character's place
  body: Mesh; // the model (bobbed and tilted)
  ring: Mesh;
  shadow: Mesh; // a soft dark patch on the floor under the character (it shows how high the sandal is)
  tag: Sprite;
  x: number; z: number; facing: number; // what is drawn
  walk: number; // how fast it is moving, smoothed (for the waddle)
  phase: number;
  alive: boolean;
  seenDeath: boolean;
  seenSmack: number | null;
  bar: { holder: Group; bar: LifeBar } | null; // a roach's lifetime bar (the holder stays put in the world; the bar inside always faces the camera)
  hiddenDark: boolean; // in the dark and too far for a sandal to see
  corpse: boolean; // a roach that starved: its body is the curled-up one
  side: number; // which way it rolls over when it starves
}
interface FoodVis { group: Group; mesh: Mesh; phase: number; born: number; fx: FoodFx }
interface Splat { mesh: Mesh; used: boolean }
interface Dust { mesh: Mesh; age: number; active: boolean }

/**
 * The Roach Rumble scene (GAME_RULES.md #26): a plain kitchen floor with low walls, the roaches (the roach from Zoo Adoption) and the big sandal. The camera follows one character with a fixed
 * orientation (north up, so the stick pushes the way it looks): low behind a roach, higher and further out for the sandal. The scene draws the server's view; your own character moves at once from your stick
 * (the same walking function as the server) and is only gently pulled onto the server's position.
 */
export class RoachScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(60, 1, 0.1, 600);
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private kit = new AnimalKit();
  private sandalGeometry = buildSandal();
  private floorMap = floorTexture();
  private splatMap = splatTexture();
  private shadowMap = shadowTexture();
  private actors = new Map<string, Actor>();
  private splats: Splat[] = [];
  private splatAt = new Map<string, Splat>();
  private dust: Dust[] = [];
  private foodGeos = new Map<number, BufferGeometry>(); // (one model per kind of food, shared by every piece)
  private poisonMap = poisonTexture();
  private blobMap = blobTexture();
  private darkEye: { x: number; z: number } | null = null; // a sandal in the dark: what it can see is what is near it
  private layout: Layout | null = null; // this game's kitchen, made from the seed in the view
  private poison: { zone: Mesh; bubbles: { mesh: Mesh; phase: number; x: number; z: number }[]; bottle: Piece | null; seen: number | null } | null = null;
  private corpseGeometry: BufferGeometry | null | undefined; // (undefined: not made yet; null: the roach model does not fit, no curl)
  private foods = new Map<number, FoodVis>();
  private blocks: { piece: Piece; fade: number }[] = [];
  private hemi!: HemisphereLight;
  private sun!: DirectionalLight;
  private sandalLight!: PointLight;
  private fog = new Fog('#000000', 30, 130);
  private vis = { nv: 0, dazzle: 0, dark: false, lit: 1 };
  private lastLights = -1;
  private poisonHidden = false;
  private latest: RoachHuntView | null = null;
  private disposables: { dispose(): void }[] = [];
  private shake = 0;
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  private steer = { x: 0, z: 0 };
  private yaw = 0; // how far a roach has turned its camera (0 = looking north); the stick pushes the way the camera looks
  private eyeId: string | null;
  private winner = false;
  private camSmooth = { pos: new Vector3(), quat: new Quaternion(), ready: false };
  private localSmackAt = -1e9; // when you pressed smack on this phone (so the sandal reacts at once)
  serverNow: () => number = () => Date.now();
  /** 0 = the opening overview .. 1 = the normal view. */
  introFactor: () => number = () => 1;
  /** Whether your own character may walk (the round has started and you are alive and it is not over). */
  canMove = false;

  constructor(private container: HTMLElement, private styles: Record<string, RoachStyle>, private selfId: string | null) {
    this.eyeId = selfId;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer, this.kit, this.sandalGeometry, this.floorMap, this.splatMap, this.shadowMap, this.poisonMap, this.blobMap);
    this.scene.background = new Color('#2a2118');
    this.buildRoom();
    for (let i = 0; i < SPLAT_POOL; i++) {
      const mat = new MeshBasicMaterial({ map: this.splatMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new Mesh(new PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2), mat);
      mesh.position.y = 0.03; mesh.visible = false;
      this.scene.add(mesh); this.splats.push({ mesh, used: false }); this.disposables.push(mat, mesh.geometry);
    }
    for (let i = 0; i < DUST_POOL; i++) {
      const mat = new MeshBasicMaterial({ color: '#f4ead2', transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new Mesh(new RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), mat);
      mesh.position.y = 0.06; mesh.visible = false;
      this.scene.add(mesh); this.dust.push({ mesh, age: 99, active: false }); this.disposables.push(mat, mesh.geometry);
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------
  pushView(view: RoachHuntView) {
    this.ensureLayout(view);
    this.latest = view;
    for (const [id, p] of Object.entries(view.players)) if (!this.actors.has(id)) this.addActor(id, p);
    for (const f of view.foods) if (!this.foods.has(f.id)) this.addFood(f.id, f.kind, f.x, f.z);
  }
  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); }
  setSteer(x: number, z: number) { this.steer = { x, z }; }
  /** Turn a roach's own camera by `d` radians (dragging the right side of the screen); the stick follows the camera. */
  turnBy(d: number) { this.yaw = (this.yaw + d) % (Math.PI * 2); }
  getYaw() { return this.yaw; }
  /** The camera follows this character (a player: themselves; a spectator or a squashed roach: the one they pick); or at the end the whole room. */
  setCameraView(view: { targetId: string | null; winner?: boolean }) {
    this.winner = !!view.winner;
    if (!view.winner) this.eyeId = view.targetId;
  }
  /** You pressed smack on this phone: the sandal starts swinging at once (the server's answer follows). */
  smackNow() { this.localSmackAt = this.serverNow(); audio.playFlat(sandalSwish, 0.5); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const a of this.actors.values()) disposeNameTag(a.tag);
    for (const g of this.foodGeos.values()) g.dispose();
    for (const v of this.foods.values()) v.fx.dispose();
    this.corpseGeometry?.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => { const m = o as Mesh; if (m.geometry && m.geometry !== this.sandalGeometry) m.geometry.dispose?.(); });
    this.renderer.domElement.remove();
  }

  // ---------- building ----------
  private buildRoom() {
    const half = ROACH_ARENA_HALF;
    this.floorMap.repeat.set(half / 2, half / 2);
    const floorMat = new MeshStandardMaterial({ map: this.floorMap, roughness: 0.7 });
    const floor = new Mesh(new PlaneGeometry(half * 2 + 12, half * 2 + 12).rotateX(-Math.PI / 2), floorMat);
    this.floorMap.repeat.set((half * 2 + 12) / 4, (half * 2 + 12) / 4);
    this.scene.add(floor);
    this.disposables.push(floorMat, floor.geometry);
    // The walls are single-sided panels facing into the room, as tall as the kitchen: you see them from inside, but a camera behind one (a roach in a corner) sees straight through to the floor.
    const wallMat = new MeshStandardMaterial({ color: '#cfc29a', roughness: 0.9, flatShading: true });
    const tileMat = new MeshStandardMaterial({ color: '#e6edf0', roughness: 0.6, flatShading: true });
    this.disposables.push(wallMat, tileMat);
    const panel = (x: number, z: number, turn: number) => {
      const w = new Mesh(new PlaneGeometry(half * 2, WALL_HEIGHT), wallMat); w.position.set(x, WALL_HEIGHT / 2, z); w.rotation.y = turn;
      const t = new Mesh(new PlaneGeometry(half * 2, 3), tileMat); t.position.set(x, 5.0, z); t.rotation.y = turn; t.translateZ(0.01); // the tiled splashback over the worktops
      this.scene.add(w, t); this.disposables.push(w.geometry, t.geometry);
    };
    panel(0, -half, 0); panel(0, half, Math.PI); panel(half, 0, -Math.PI / 2); panel(-half, 0, Math.PI / 2);
    // The units round the walls, and the things on the floor (islands, brooms, shoes: solid for roaches; the sandal hovers over them). Each piece can fade out when it is in the camera's way.
    this.addPieces(buildKitchenUnits(half)); // (the cooker is always in the same place; the rest of the floor is made when the first view tells us the game's layout: `ensureLayout`)
    // The lights. The kitchen is dark; the sandal carries a weak light of its own; every 15 seconds the main lights come on (see `updateLights`).
    this.hemi = new HemisphereLight('#fff3e0', '#6a5a48', 0);
    this.sun = new DirectionalLight('#fff0d6', 0);
    this.sun.position.set(-14, 40, 10);
    this.sandalLight = new PointLight('#ffd49a', 0, 13, 1.3);
    this.scene.add(this.hemi, this.sun, this.sandalLight);
    this.scene.fog = this.fog;
  }

  private addPieces(pieces: Piece[]) {
    for (const piece of pieces) {
      this.scene.add(piece.object);
      this.disposables.push(...piece.geometries, ...piece.materials);
      this.blocks.push({ piece, fade: 0 });
    }
  }

  /** This game's kitchen (different every game, the same on every phone: made from the seed): the islands, brooms, shoes, trash can, mop bucket and the bottle of poison, and the pool the poison will make. */
  private ensureLayout(view: RoachHuntView) {
    if (this.layout && this.layout.seed === view.layoutSeed) return;
    const layout = makeLayout(view.layoutSeed);
    this.layout = layout;
    const bottle = buildPoisonBottle(layout.poison);
    this.addPieces([
      ...layout.obstacles.map((o) => (o.kind === 'island' ? buildIsland(o) : buildBroom(o))),
      ...layout.shoes.map((h) => buildShoe(h)),
      buildTrashCan(layout.trash), buildMopBucket(layout.mop), bottle,
    ]);
    const mat = new MeshBasicMaterial({ map: this.poisonMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const zone = new Mesh(new PlaneGeometry(POISON_RADIUS * 2.1, POISON_RADIUS * 2.1).rotateX(-Math.PI / 2), mat);
    zone.position.set(layout.poison.cx, 0.045, layout.poison.cz); zone.visible = false;
    this.scene.add(zone);
    this.disposables.push(mat, zone.geometry);
    const bubbles: { mesh: Mesh; phase: number; x: number; z: number }[] = [];
    const bubbleMat = new MeshBasicMaterial({ color: '#e6b8ff', transparent: true, opacity: 0.8 });
    const bubbleGeo = new SphereGeometry(0.22, 8, 6);
    this.disposables.push(bubbleMat, bubbleGeo);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.399, d = Math.sqrt((i + 0.5) / 12) * (POISON_RADIUS - 0.8);
      const mesh = new Mesh(bubbleGeo, bubbleMat);
      mesh.visible = false;
      this.scene.add(mesh);
      bubbles.push({ mesh, phase: i * 1.7, x: layout.poison.cx + Math.cos(a) * d, z: layout.poison.cz + Math.sin(a) * d });
    }
    this.poison = { zone, bubbles, bottle, seen: null };
  }

  private foodGeo(kind: number) {
    let g = this.foodGeos.get(kind);
    if (!g) { g = buildFood(kind); this.foodGeos.set(kind, g); }
    return g;
  }

  private addFood(id: number, kind: number, x: number, z: number) {
    const mesh = new Mesh(this.foodGeo(kind), this.kit.material);
    mesh.rotation.y = (id * 2.4 + kind) % 6.28;
    const group = new Group();
    group.add(mesh);
    group.position.set(x, 0, z);
    this.scene.add(group);
    const fx = new FoodFx(this.blobMap, id + 1);
    group.add(fx.points);
    this.foods.set(id, { group, mesh, phase: Math.random() * 6, born: performance.now(), fx });
  }

  private addActor(id: string, p: RoachPlayerView) {
    const style = this.styles[id] ?? { name: '?', color: '#94a3b8' };
    const group = new Group();
    let body: Mesh;
    if (p.role === 'sandal') {
      const mat = this.kit.material.clone(); // (a faint glow of its own, so its top is not black in the dark: only its light under it is weak)
      mat.emissive = new Color('#4a3320'); mat.emissiveIntensity = 0.6;
      this.disposables.push(mat);
      body = new Mesh(this.sandalGeometry, mat);
      body.scale.set(1.15, 1.9, 1.15); // (thick, so it reads as a solid object)
      body.position.y = SANDAL_HOVER;
    } else {
      const type = SPECIES.findIndex((s) => s.id === 'roach');
      body = new Mesh(this.kit.models[type * VARIANTS].geometry, this.kit.material);
      body.scale.setScalar(ROACH_SCALE);
    }
    group.add(body);
    const radius = p.role === 'sandal' ? SANDAL_RADIUS : ROACH_RADIUS;
    const ring = new Mesh(new RingGeometry(radius * 1.15, radius * 1.45, 28).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.05;
    group.add(ring);
    const shadowMat = new MeshBasicMaterial({ map: this.shadowMap, transparent: true, depthWrite: false, opacity: p.role === 'sandal' ? 0.8 : 0.3 });
    const shadow = new Mesh(new PlaneGeometry(p.role === 'sandal' ? 3.0 : 2.0, p.role === 'sandal' ? 5.2 : 2.6).rotateX(-Math.PI / 2), shadowMat);
    shadow.position.y = 0.04;
    group.add(shadow);
    this.disposables.push(shadowMat, shadow.geometry);
    const tag = createNameTag(style.name, style.color);
    tag.scale.set(3.2, 0.8, 1);
    tag.position.y = p.role === 'sandal' ? SANDAL_HOVER + 2.2 : 2.7;
    group.add(tag);
    let bar: { holder: Group; bar: LifeBar } | null = null;
    if (p.role === 'roach') { // the lifetime bar, over the roach's head: everyone can see how long each roach has left
      const lb = new LifeBar();
      const holder = new Group();
      holder.add(lb.mesh);
      this.scene.add(holder);
      this.disposables.push(lb);
      bar = { holder, bar: lb };
    }
    group.position.set(p.x, 0, p.z);
    this.scene.add(group);
    this.disposables.push(ring.geometry, ring.material as MeshBasicMaterial);
    let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
    this.actors.set(id, { id, role: p.role, group, body, ring, shadow, tag, x: p.x, z: p.z, facing: p.facing, walk: 0, phase: Math.random() * 6, alive: p.alive, seenDeath: false, seenSmack: null, bar, hiddenDark: false, corpse: false, side: h & 1 ? 1 : -1 });
  }

  // ---------- per frame ----------
  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private fovFor(hfov: number) {
    return MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(hfov) / 2) / this.camera.aspect)), 38, 82);
  }

  private frame = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    const view = this.latest;
    if (!view) return;
    const now = this.serverNow();
    this.updateLights(view, now, dt);
    for (const a of this.actors.values()) {
      const p = view.players[a.id];
      if (!p) { a.group.visible = false; continue; }
      const mine = a.id === this.selfId;
      const px = a.x, pz = a.z;
      const arrested = a.role === 'sandal' && now < p.readyAt; // the sandal is out of your hands while it floats back up (or is stuck)
      if (mine && p.alive && this.canMove && !arrested) { // your own character walks at once from your stick, and is only gently pulled onto the server's position
        if (a.role === 'roach') [a.x, a.z] = moveRoach(a.x, a.z, this.steer.x, this.steer.z, dt, this.solidDiscs(view), this.layout!);
        else [a.x, a.z] = stepMover(a.x, a.z, this.steer.x, this.steer.z, SANDAL_SPEED, dt, SANDAL_RADIUS);
        if (Math.hypot(p.x - a.x, p.z - a.z) > PREDICT_SNAP) { a.x = p.x; a.z = p.z; }
        else { const k = 1 - Math.exp(-PREDICT_PULL * dt); a.x += (p.x - a.x) * k; a.z += (p.z - a.z) * k; }
        const len = Math.hypot(this.steer.x, this.steer.z);
        if (len > 0.05) a.facing = Math.atan2(this.steer.x, this.steer.z);
      } else {
        const k = 1 - Math.exp(-16 * dt);
        a.x += (p.x - a.x) * k; a.z += (p.z - a.z) * k;
        let d = p.facing - a.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
        a.facing += d * (1 - Math.exp(-14 * dt));
      }
      const speed = Math.hypot(a.x - px, a.z - pz) / Math.max(dt, 1e-3);
      a.walk += (Math.min(1, speed / (a.role === 'roach' ? 9 : SANDAL_SPEED)) - a.walk) * (1 - Math.exp(-10 * dt));
      a.phase += dt * (a.role === 'roach' ? 26 : 9) * (0.2 + a.walk);
      this.poseActor(a, p, now);
      this.updateBar(a, p, now);
      // A roach squashed: a splat where it was, a squish, and the roach is gone. A roach that starved stays: it tips over and curls up where it fell.
      if (!p.alive && !a.seenDeath) {
        a.seenDeath = true;
        const fresh = p.diedAt !== null && now - p.diedAt < 1500;
        if (p.cause === 'squashed') { if (fresh) this.onSquash(a, now); else this.placeSplat(a); }
        else if (p.cause === 'starved') this.startCorpse(a, fresh);
      }
    }
    // The swing landing for everyone: dust and a shake.
    const sandal = view.players[view.sandalId];
    const sa = this.actors.get(view.sandalId);
    if (sandal && sa && sandal.smackAt !== null && sa.seenSmack !== sandal.smackAt) {
      sa.seenSmack = sandal.smackAt;
      if (now - sandal.smackAt < 800) this.onImpact(sandal, now);
    }
    for (const d of this.dust) if (d.active) {
      d.age += dt;
      const k = d.age / 0.45;
      d.mesh.scale.setScalar(1 + k * SMACK_RADIUS * 1.2);
      (d.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.7 * (1 - k));
      if (k >= 1) { d.active = false; d.mesh.visible = false; }
    }
    this.updateFoods(view, dt, now);
    this.updatePoison(view, now, dt);
    this.shake *= Math.exp(-6 * dt);
    this.updateCamera(view, dt);
  }

  /** What the viewer sees: `nv` (0..1) night vision for a roach in the dark, `dazzle` (0..1) the flash when the lights come on, `lit` how bright the room is, and `dark`. */
  vision() { return this.vis; }

  /**
   * The light. Until GO, at the end and for 3 seconds every 15 seconds (the lights switch on with a flicker) the kitchen is lit. The rest of the time it is DARK: a sandal sees only what its weak light under it reaches, and a roach
   * has night vision: a cold green, grainy look with a short view, so it can see but still feels dark (the screen adds the grain and the dark edges).
   */
  private updateLights(view: RoachHuntView, now: number, dt: number) {
    const t = (now - view.startsAt) / 1000;
    const subject = this.eyeId ? this.actors.get(this.eyeId) : null;
    const roachEyes = subject?.role === 'roach';
    let want = t < 0 || this.winner ? 1 : lightsOn(t) ? 1 : 0;
    const k = Math.floor(t / 15);
    if (t >= 15 && want === 1 && !this.winner) { // switching on: a flicker for the first half second
      const since = t - k * 15;
      if (since < 0.5) want = Math.sin(since * 61) * Math.sin(since * 23 + 1) > -0.1 ? 1 : 0.1;
      if (k !== this.lastLights) { this.lastLights = k; this.vis.dazzle = roachEyes ? 1 : 0; }
    }
    const rate = want > this.vis.lit ? 40 : 14; // (on in a snap, off a little slower)
    this.vis.lit += (want - this.vis.lit) * (1 - Math.exp(-rate * dt));
    const lit = this.vis.lit;
    this.vis.dazzle = Math.max(0, this.vis.dazzle - dt * 1.6);
    const nv = roachEyes ? 1 - lit : 0;
    this.vis.nv += (nv - this.vis.nv) * (1 - Math.exp(-8 * dt));
    this.vis.dark = lit < 0.5;
    // the room's lights, dimmed to a night-vision green for a roach and almost nothing for a sandal
    const dark = new Color(roachEyes ? '#9affb0' : '#1a2540'), darkGround = new Color(roachEyes ? '#1d3a26' : '#05060a');
    this.hemi.color.copy(dark).lerp(new Color('#fff3e0'), lit);
    this.hemi.groundColor.copy(darkGround).lerp(new Color('#6a5a48'), lit);
    this.hemi.intensity = MathUtils.lerp(roachEyes ? 0.85 : 0.05, 1.5, lit);
    this.sun.intensity = 2.0 * lit;
    const bg = new Color(roachEyes ? '#041008' : '#020305').lerp(new Color('#2a2118'), lit);
    (this.scene.background as Color).copy(bg);
    this.fog.color.copy(bg);
    this.fog.near = MathUtils.lerp(roachEyes ? 28 : 18, 200, lit); this.fog.far = MathUtils.lerp(roachEyes ? 120 : 60, 600, lit);
    // the sandal's own light, under it
    const sandal = view.players[view.sandalId] && this.actors.get(view.sandalId);
    if (sandal) {
      this.sandalLight.position.set(sandal.x, 1.8 + sandal.body.position.y * 0.5, sandal.z);
      this.sandalLight.intensity = MathUtils.lerp(70, 8, lit);
    }
    // In the dark a sandal cannot see what its light does not reach: the rings, names, life bars, splats and the glowing poison (which are not lit) of faraway roaches are hidden.
    const sandalEyes = subject?.role === 'sandal' && this.vis.dark;
    this.darkEye = sandalEyes ? { x: subject!.x, z: subject!.z } : null;
    for (const a of this.actors.values()) {
      if (a.role !== 'roach') continue;
      const hidden = sandalEyes && Math.hypot(a.x - subject!.x, a.z - subject!.z) > SANDAL_SIGHT;
      const pv = view.players[a.id], dead = !pv || !pv.alive;
      a.hiddenDark = !!hidden;
      a.ring.visible = !hidden && !dead;
      a.tag.visible = !hidden && !(dead && pv?.cause !== 'starved');
    }
    for (const [id, sp] of this.splatAt) { const owner = this.actors.get(id); sp.mesh.visible = !(sandalEyes && owner && Math.hypot(owner.x - subject!.x, owner.z - subject!.z) > SANDAL_SIGHT); }
    this.poisonHidden = !!(sandalEyes && this.layout && Math.max(0, Math.hypot(this.layout.poison.cx - subject!.x, this.layout.poison.cz - subject!.z) - POISON_RADIUS) > SANDAL_SIGHT);
  }

  /** What a roach bumps into besides the fixed junk: the food on the floor, and the bottle of poison while it stands. */
  private solidDiscs(view: RoachHuntView): Disc[] {
    const d: Disc[] = view.foods.map((f) => ({ x: f.x, z: f.z, r: FOOD_RADIUS }));
    if (view.poisonAt === null && this.layout) d.push({ x: this.layout.poison.x, z: this.layout.poison.z, r: BOTTLE_RADIUS });
    return d;
  }

  /** Is your own roach standing in the spilled poison (for the warning on the screen)? */
  standingInPoison(): boolean {
    const v = this.latest, me = this.selfId ? this.actors.get(this.selfId) : null;
    return !!(v && v.poisonAt !== null && this.layout && me && me.role === 'roach' && v.players[me.id]?.alive && inPoison(this.layout, me.x, me.z));
  }

  /** The food: it grows in when it turns up, shrinks as its pool of life is eaten, and shakes a little while a roach is at it. It gives off green stink and goo (purple once the poison has reached it, and it shrinks away over its last half second). A piece that is gone is taken away. */
  private updateFoods(view: RoachHuntView, dt: number, now: number) {
    const present = new Set<number>();
    const t = performance.now();
    const px = this.renderer.domElement.height / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
    for (const f of view.foods) {
      present.add(f.id);
      const v = this.foods.get(f.id);
      if (!v) continue;
      v.phase += dt * 22;
      v.group.visible = true;
      const born = ease(MathUtils.clamp((t - v.born) / 450, 0, 1));
      const rotting = f.poisonedAt === null ? 1 : MathUtils.clamp((FOOD_ROT_MS - (now - f.poisonedAt)) / 500, 0, 1); // (shrinks away in its last half second)
      const size = (0.5 + 0.5 * f.left) * Math.max(0.01, born) * Math.max(0.01, rotting);
      v.mesh.scale.setScalar(size);
      v.mesh.position.x = f.eating ? Math.sin(v.phase) * 0.05 : 0;
      // in the dark a sandal sees the stink only near it (the glow is not lit)
      const seen = !this.darkEye || Math.hypot(f.x - this.darkEye.x, f.z - this.darkEye.z) <= SANDAL_SIGHT;
      v.fx.update(dt, Math.max(0.3, size), f.poisonedAt !== null, seen, px);
    }
    for (const [id, v] of this.foods) if (!present.has(id)) { this.scene.remove(v.group); v.fx.dispose(); this.foods.delete(id); }
  }

  /** A roach's lifetime bar: how much it has left of 30 seconds (green, then yellow, then red and flashing under 5). */
  private updateBar(a: Actor, p: RoachPlayerView, now: number) {
    if (!a.bar) return;
    const show = p.alive && !a.hiddenDark;
    a.bar.holder.visible = show;
    if (!show) return;
    a.bar.holder.position.set(a.x, 2.15, a.z);
    const color = p.life >= 15 ? '#7be07b' : p.life > ROACH_LOW_LIFE ? '#f2d24b' : '#ff5a4d';
    a.bar.bar.set(p.life / ROACH_LIFE_MAX, color, p.life <= ROACH_LOW_LIFE ? 0.45 + 0.55 * Math.abs(Math.sin(now / 110)) : 1);
  }

  /** A roach that starved: its body becomes the curled-up one (the curl is blended in by `poseActor`), with a tick of a sound as it tips over. */
  private startCorpse(a: Actor, fresh: boolean) {
    if (this.corpseGeometry === undefined) {
      const type = SPECIES.findIndex((s) => s.id === 'roach');
      this.corpseGeometry = buildCorpseGeometry(this.kit.models[type * VARIANTS].geometry);
      if (this.corpseGeometry) this.disposables.push(this.corpseGeometry);
    }
    if (this.corpseGeometry) { a.body.geometry = this.corpseGeometry; a.body.updateMorphTargets(); a.body.morphTargetInfluences = [0]; }
    a.corpse = true;
    if (fresh) setTimeout(() => { if (!this.disposed) audio.playFlat(roachCurl, this.distanceToEye(a.x, a.z) < 14 ? 0.7 : 0.3); }, 380);
  }

  /** The poison: the bottle is gone the moment it is smashed (a crash), and the landmark is covered in a pool of glowing purple that spreads out and then bubbles. */
  private updatePoison(view: RoachHuntView, now: number, dt: number) {
    const P = this.poison;
    if (!P) return;
    const spilled = view.poisonAt !== null;
    if (P.bottle) P.bottle.object.visible = !spilled;
    if (spilled && P.seen !== view.poisonAt) {
      P.seen = view.poisonAt;
      if (now - view.poisonAt! < 1500) {
        const near = this.distanceToEye(this.layout!.poison.x, this.layout!.poison.z);
        audio.playFlat(bottleSmash, near < 16 ? 1 : 0.5);
      }
    }
    const k = spilled ? ease(MathUtils.clamp((now - view.poisonAt!) / 700, 0, 1)) : 0;
    const show = spilled && !this.poisonHidden;
    P.zone.visible = show;
    if (show) {
      P.zone.scale.setScalar(0.15 + 0.85 * k);
      (P.zone.material as MeshBasicMaterial).opacity = (0.72 + 0.18 * Math.sin(now / 420)) * Math.min(1, k * 1.6);
    }
    for (const b of P.bubbles) {
      b.phase += dt * 2.6;
      const u = (Math.sin(b.phase) + 1) / 2;
      b.mesh.visible = show && k > 0.9;
      b.mesh.position.set(b.x, 0.1 + u * 0.35, b.z);
      b.mesh.scale.setScalar(0.4 + u * 0.9);
    }
  }

  /** Waddle, tilt, and for the sandal the smack: lifted, brought down on the spot in front of it, held, then back. */
  private poseActor(a: Actor, p: RoachPlayerView, now: number) {
    if (!p.alive) { // squashed (a splat is on the floor) or gone: nothing to see. A roach that starved lies where it fell, curled up on its back.
      a.group.visible = p.cause === 'starved';
      if (a.group.visible) {
        a.group.position.set(a.x, 0, a.z);
        a.group.rotation.y = a.facing;
        const pose = corpsePose(p.diedAt === null ? 1e6 : Math.max(0, now - p.diedAt), a.side, ROACH_SCALE);
        a.body.position.set(pose.x, pose.y, 0);
        a.body.rotation.set(0, pose.yaw, pose.roll);
        if (a.body.morphTargetInfluences) a.body.morphTargetInfluences[0] = pose.curl;
        a.tag.position.y = 1.5;
        a.shadow.position.y = 0.04;
      }
      return;
    }
    a.group.visible = true;
    a.group.position.set(a.x, 0, a.z);
    a.group.rotation.y = a.facing;
    if (a.role === 'roach') {
      a.body.rotation.y = Math.sin(a.phase) * 0.12 * a.walk;
      a.body.position.y = Math.abs(Math.sin(a.phase * 1.3)) * 0.05 * a.walk;
      a.body.rotation.z = Math.sin(a.phase * 0.7) * 0.05 * a.walk;
      return;
    }
    // the sandal: held up in the air, rocking a little as it walks. A smack brings it down on the spot in front of it; then it is out of the player's hands: a miss floats back up (1.5 s), a hit leaves it stuck in the guts, tugging back and forth (2.5 s).
    const since = Math.min(now - (p.smackAt ?? -1e9), now - this.localSmackAt);
    const hit = p.smackAt !== null && now - p.smackAt >= SMACK_WINDUP_MS && p.smackHit;
    const total = hit ? SMACK_HIT_ARREST_MS : SMACK_MISS_ARREST_MS;
    let y = SANDAL_HOVER + Math.sin(a.phase * 0.5 + 1) * 0.12 + Math.abs(Math.sin(a.phase)) * 0.15 * a.walk, forward = 0, tilt = 0.12 + 0.12 * a.walk, roll = Math.sin(a.phase) * 0.1 * a.walk, yaw = 0, squash = 1;
    if (since >= 0 && since < total) {
      roll = 0;
      const D = SMACK_WINDUP_MS;
      if (since < D) { const k = since / D; y = lerp(SANDAL_HOVER + SMACK_LIFT, 0.05, k * k); forward = k * 2.3; tilt = lerp(-0.6, 0.02, k); } // down on the spot
      else {
        forward = 2.3; y = 0.05; tilt = 0.02;
        const u = since - D;
        if (hit) {
          if (u < 260) squash = 1 - 0.18 * ease(u / 260); // pressed into it
          else if (u < 660) { const k = (u - 260) / 400; squash = 0.82; y = 0.05 + 0.18 * ease(k); tilt = lerp(0.02, -0.28, ease(k)); } // anticipation: a heave back to pull
          else if (u < 1860) { // three tugs, each a little harder, back and forth, and it drops back each time (the guts hold on)
            const k = (u - 660) / 1200, tug = Math.sin(k * Math.PI * 6), amp = 0.35 + 0.65 * k;
            y = 0.05 + amp * 0.9 * Math.max(0, Math.sin(k * Math.PI * 3));
            roll = tug * 0.2 * amp; yaw = Math.sin(k * Math.PI * 6 + 1) * 0.16 * amp; tilt = -0.28 + 0.2 * Math.abs(tug); squash = 0.82 + 0.1 * Math.max(0, Math.sin(k * Math.PI * 3));
          } else if (u < 2020) { const k = (u - 1860) / 160; y = lerp(0.1, SANDAL_HOVER + 1.0, 1 - (1 - k) * (1 - k)); forward = 2.3 * (1 - k * 0.6); tilt = lerp(-0.3, 0.3, k); squash = lerp(0.9, 1.08, k); } // pulled free: it pops up
          else { const k = ease((u - 2020) / (total - D - 2020)); y = lerp(SANDAL_HOVER + 1.0, SANDAL_HOVER, k); forward = 2.3 * 0.4 * (1 - k); tilt = lerp(0.3, 0.12, k); squash = lerp(1.08, 1, k); } // and settles
        } else if (u < 200) { /* pressed a moment */ }
        else { const k = ease((u - 200) / (total - D - 200)); y = lerp(0.05, SANDAL_HOVER, k); forward = 2.3 * (1 - k); tilt = lerp(0.02, 0.12, k); } // a miss: floats back up to its attack position
      }
    }
    a.body.position.set(0, y, forward);
    a.body.rotation.set(tilt, yaw, roll);
    a.body.scale.set(1.15, 1.9 * squash, 1.15);
    // the shadow on the floor: smaller and fainter the higher the sandal is, and it goes where the sandal is
    const high = MathUtils.clamp((y - 0.05) / (SANDAL_HOVER + SMACK_LIFT), 0, 1);
    a.shadow.position.set(0, 0.04, forward);
    a.shadow.scale.setScalar(1.25 - 0.45 * high);
    (a.shadow.material as MeshBasicMaterial).opacity = 0.95 - 0.35 * high;
  }

  private onSquash(a: Actor, now: number) {
    this.placeSplat(a);
    const d = this.distanceToEye(a.x, a.z);
    audio.playFlat(roachSquish, d < 14 ? 0.8 : 0.4);
    if (a.id === this.selfId) this.shake = Math.max(this.shake, SHAKE_DEATH);
    void now;
  }
  private placeSplat(a: Actor) {
    const s = this.splats.find((x) => !x.used);
    if (!s) return;
    s.used = true; this.splatAt.set(a.id, s);
    s.mesh.position.set(a.x, 0.03, a.z); s.mesh.rotation.y = Math.random() * 6.28; s.mesh.visible = true;
  }
  private onImpact(sandal: RoachPlayerView, now: number) {
    void now;
    const d = this.dust.find((x) => !x.active);
    const delay = Math.max(0, SMACK_WINDUP_MS - (this.serverNow() - (sandal.smackAt ?? 0)));
    setTimeout(() => {
      if (this.disposed) return;
      if (d) { d.active = true; d.age = 0; d.mesh.position.set(sandal.smackX, 0.06, sandal.smackZ); d.mesh.scale.setScalar(1); d.mesh.visible = true; }
      const near = this.distanceToEye(sandal.smackX, sandal.smackZ);
      audio.playFlat(sandalSmack, near < 16 ? 1 : 0.5, 0, near < 16 ? 1 : 0.5);
      if (near < 8) this.shake = Math.max(this.shake, SHAKE_SMACK * (1 - near / 10));
    }, delay);
  }
  private distanceToEye(x: number, z: number) {
    const e = this.eyeId ? this.actors.get(this.eyeId) : null;
    return e ? Math.hypot(e.x - x, e.z - z) : 99;
  }

  private cameraPoseFor(a: Actor): { pos: Vector3; look: Vector3; hfov: number } {
    if (a.role === 'sandal') return { pos: new Vector3(a.x, 15 * SANDAL_VIEW, a.z + 8.5 * SANDAL_VIEW), look: new Vector3(a.x, 0.6, a.z - 0.6 * SANDAL_VIEW), hfov: FOV_SANDAL };
    // A shallow chase view: the roach sees along the floor (the high view belongs to the sandal). A roach turns its own camera; the camera sits behind it and looks the way it points.
    const th = a.id === this.selfId ? this.yaw : 0, sn = Math.sin(th), cs = Math.cos(th);
    return { pos: new Vector3(a.x + sn * 9.2, 3.7, a.z + cs * 9.2), look: new Vector3(a.x - sn * 3.2, 0.9, a.z - cs * 3.2), hfov: FOV_ROACH };
  }

  private updateCamera(view: RoachHuntView, dt: number) {
    const overview = { pos: new Vector3(0, 100, 56), look: new Vector3(0, 0, 0), hfov: 70 };
    const subject = this.eyeId ? this.actors.get(this.eyeId) : null;
    const follow = subject ? this.cameraPoseFor(subject) : overview;
    let pose = follow;
    let smooth = false;
    if (this.winner) { pose = { pos: new Vector3(0, 98, 52), look: new Vector3(0, 0, 0), hfov: 70 }; smooth = true; }
    else if (subject && this.introFactor() < 1) {
      const u = ease(MathUtils.clamp(this.introFactor(), 0, 1));
      pose = { pos: overview.pos.clone().lerp(follow.pos, u), look: overview.look.clone().lerp(follow.look, u), hfov: MathUtils.lerp(overview.hfov, follow.hfov, u) };
    }
    this.camera.fov = this.fovFor(pose.hfov);
    this.camera.updateProjectionMatrix();
    const m = new Matrix4().lookAt(pose.pos, pose.look, new Vector3(0, 1, 0));
    const quat = new Quaternion().setFromRotationMatrix(m);
    if (smooth) {
      const s = this.camSmooth;
      if (!s.ready) { s.pos.copy(this.camera.position); s.quat.copy(this.camera.quaternion); s.ready = true; }
      const k = 1 - Math.exp(-2.4 * dt);
      s.pos.lerp(pose.pos, k); s.quat.slerp(quat, k);
      this.camera.position.copy(s.pos); this.camera.quaternion.copy(s.quat);
    } else {
      this.camera.position.copy(pose.pos); this.camera.quaternion.copy(quat);
      if (this.shake > 0.01) {
        const sh = this.shake * 0.02;
        this.camera.rotateX((Math.random() - 0.5) * sh); this.camera.rotateY((Math.random() - 0.5) * sh);
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.12; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.12;
      }
    }
    this.fadeBlocks(subject, dt);
    void view;
  }

  /** Anything between the camera and the roach you are following (a cabinet on the wall behind the camera, an island, a shoe, a broom) turns see-through, so you can always find yourself, even with something right up against the lens. */
  private fadeBlocks(subject: Actor | null | undefined, dt: number) {
    const cam = this.camera.position;
    for (const b of this.blocks) {
      let want = 0;
      if (subject && subject.role === 'roach') {
        // does the line from the camera to the roach (seen from above) pass through this piece's floor plan (a little bigger), or is the camera inside it?
        const r = b.piece.bounds, x0 = cam.x, z0 = cam.z, x1 = subject.x, z1 = subject.z, pad = 0.7;
        const minX = r.minX - pad, maxX = r.maxX + pad, minZ = r.minZ - pad, maxZ = r.maxZ + pad;
        let t0 = 0, t1 = 1;
        const dx = x1 - x0, dz = z1 - z0;
        for (const [p, d, lo, hi] of [[x0, dx, minX, maxX], [z0, dz, minZ, maxZ]] as const) {
          if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 2; break; } }
          else { let a = (lo - p) / d, c = (hi - p) / d; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
        }
        if (t0 <= t1) want = 1;
      }
      b.fade += (want - b.fade) * (1 - Math.exp(-10 * dt));
      const o = 1 - 0.8 * b.fade, transparent = b.fade > 0.02;
      for (const m of b.piece.materials) { m.opacity = o; if (m.transparent !== transparent) { m.transparent = transparent; m.depthWrite = !transparent; m.needsUpdate = true; } }
    }
  }
}
