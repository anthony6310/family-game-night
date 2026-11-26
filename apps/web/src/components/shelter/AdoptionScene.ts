import {
  AdditiveBlending, BackSide, Box3, BoxGeometry, Float32BufferAttribute, Frustum, Sphere, WebGLRenderTarget, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage, Euler,
  Fog, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion,
  RepeatWrapping, RingGeometry, Scene, SRGBColorSpace, Sprite, SpriteMaterial, Vector3, WebGLRenderer, MathUtils,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ADOPTEE_COUNT, ADOPTEE_LEAVE_MS, ADOPTEE_NOPE_MS, GAME_INTRO_COUNT_SECONDS, SHELTER_PAN_SECONDS, ANIMAL_FLEE_SPEED, ANIMAL_SPEED, COUNTER_DEPTH, COUNTER_FRONT, COUNTER_HEIGHT, PAD_DEPTH, SHELTER_EYE_HEIGHT, SHELTER_PLAYER_RADIUS,
  SHELTER_PLAYER_SPEED, SPECIES, KIND_COUNT, speciesOf, adopteePos, facing, handoverSlot, obstacles, padRect, pickTarget, pillars, resolveMove,
  type AdopteeView, type AdoptionDayView, type ShelterPlayerView,
} from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { adoptedArpeggio, deskBell, footstep, glowHum, joyWhoop, padChime, plop, scoopUp, scurry, uhOh } from '../../audio/zooSounds';
import type { SoundFn } from '../../audio/snowSounds';
import { createNameTag, disposeNameTag } from '../labelTexture';
import { AnimalKit } from './AnimalKit';
import { makeSpeciesIcons } from './animalIcons';
import { PERSON_HEIGHT, adopteeLook, buildPerson, volunteerLook } from './People';
import { makeCarpetCanvas, makeFloorCanvas, makeJungleCanvas } from './shelterTextures';

/** How a volunteer is labelled and dressed. */
export interface VolunteerStyle {
  name: string;
  color: string;
}

/** What the screen needs to know about the player's surroundings (it changes the action button). */
export interface ShelterUi {
  highlight: number | null; // the animal in reach in front of you (it is lit up): what "pick up" would take
  nearAdoptee: boolean; // an adoptee is close enough to hand an animal to
  carrying: boolean;
}

const FOV_H = 72; // the horizontal field of view we want on any screen shape (the vertical one follows the aspect ratio, within limits)
const LOOK_PITCH = 1.15;
const CAMERA_FAR = 320;
const ROOF_Y = 16;
const PREDICT_SNAP = 4; // a server position farther than this from the predicted one replaces it
const PREDICT_PULL = 4; // how quickly the predicted position settles onto the server's (per second)
const MAX_AGE = 0.3; // never carry the motion forward more than this
const BUBBLE_SCALE = 1.35;
const BUBBLE_Y = PERSON_HEIGHT + 4.5;
const FIT_BUBBLE = 2.9; // the animal in a thought bubble is scaled to fit this
const FIT_CARRIED = 1.15; // the little animal floating over a carrier's head
const FIT_HELD = 0.62; // the little animal floating in front of you
const SWAY = [0.16, 0.1, 0.05, 0.12, 0.1, 0.07, 0.05, 0.05, 0.14, 0.13, 0.1, 0.04]; // how far each TYPE rocks as it waddles (the big ones less), in SPECIES order
const FISH = SPECIES.findIndex((s) => s.id === 'fish');
const HEART_COUNT = 40;
// The thought bubbles are little screens: each adopter's animal turns round inside a white cylinder in a separate scene that is never drawn to the screen
// (the "stage"), a camera looks at it, and the picture it takes is what the bubble shows. So the animal can never poke out of the cloud or cut into it.
const STAGE_SPACING = 40; // (stage i sits this far along x in its own scene, so the cylinders never touch)
const STAGE_RADIUS = 16;
const STAGE_FOV = 24;
const STAGE_PICTURE_WIDTH = 320; // pixels; the height follows the cloud's shape
const RISER = 1.0; // the adopters stand on a low platform behind the counter, so you see them from the chest up
const PAD_IDLE = new Color('#ffb52e'); // a hand-over carpet: golden, green when you stand on it holding an animal, grey when its adopter is leaving
const PAD_READY = new Color('#4cd27c');
const PAD_LEAVING = new Color('#98a1aa');

interface AnimalVis { id: number; kind: number; x: number; z: number; heading: number; mode: number; tx: number; tz: number; th: number; phase: number }
interface PlayerVis {
  id: string; root: Mesh; label: Sprite; x: number; z: number; yaw: number; vx: number; vz: number; phase: number;
  carry: Mesh | null; carryKind: number; spin: number;
}
interface SlotVis {
  id: number; kind: number; root: Group; person: Mesh; bubble: Group; shaker: Group; wallMat: MeshBasicMaterial; pivot: Group; animal: Mesh; rt: WebGLRenderTarget; stageCam: PerspectiveCamera;
  born: number; seenDone: number | null; seenNope: number | null; x: number; z: number;
}
interface Heart { sprite: Sprite; vx: number; vy: number; vz: number; age: number }

const ease = (u: number) => u * u * (3 - 2 * u);
const easeOutBack = (u: number) => { const c = 1.70158; const t = u - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class AdoptionScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(70, 1, 0.1, CAMERA_FAR);
  private heldScene = new Scene(); // the little animal floating in front of the player is drawn after everything else, so nothing can cover it
  private heldCamera = new PerspectiveCamera(70, 1, 0.1, 20);
  private heldMesh: Mesh | null = null;
  private heldKind = -1;
  private kit = new AnimalKit();
  /** A picture of each kind (see KIND_COUNT), for the request strip. */
  readonly icons: string[];
  private latest: AdoptionDayView | null = null;
  private latestAt = 0;
  private animals = new Map<number, AnimalVis>();
  private players = new Map<string, PlayerVis>();
  private slots: SlotVis[] = [];
  private hearts: Heart[] = [];
  private instanced: InstancedMesh[] = [];
  private lastCounts: number[] = new Array(KIND_COUNT).fill(0);
  private shadows!: InstancedMesh;
  private ring: Mesh;
  private highlightKind = -1;
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private solids;
  private width: number;
  private depth: number;
  private pred: { x: number; z: number } | null = null; // where this phone thinks the player is (it moves at once; the server's position only gently corrects it)
  private eye = { x: 0, z: 0, yaw: 0, pitch: 0, moving: false };
  private eyeYawSeen = false;
  private bobPhase = 0;
  private winner = { on: false, id: null as string | null };
  private camSmooth = { pos: new Vector3(), look: new Vector3(), ready: false };
  private uiLast: ShelterUi = { highlight: null, nearAdoptee: false, carrying: false };
  private lastCarrying = false;
  private lastHighlight: number | null = null; // the animal that was lit up a moment ago (a new one gets the glow sound)
  private lastGlowAt = 0;
  private lastAdoptions = 0; // the followed player's adoptions a frame ago (a rise means a hand-over just scored)
  private padKey = -1; // the carpet the player is standing on while holding an animal (its chime has played)
  private stepClock = 0.25; // seconds of walking since the last footstep
  private introHopSeen = new Set<number>(); // which adopters have had their hop sound during the opening pan
  private time = 0;
  /** Where the opening is: 'hold' (static on the first adopter), 'pan' (along the adopters, one after another), 'count' (the 3, 2, 1: into the player's eyes) or 'none'. */
  private intro = { phase: 'none' as 'none' | 'hold' | 'pan' | 'count', focus: 0, f: 0, c: 0, segSeconds: SHELTER_PAN_SECONDS / ADOPTEE_COUNT };
  private tmpCam = new PerspectiveCamera();
  private tmpPos = new Vector3();
  private tmpLook = new Vector3();
  private qEye = new Quaternion();
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));

  /** The player's own look direction and steering, written by the controls (the scene predicts movement from them at once; the server's idea only corrects it). */
  look = { yaw: 0, pitch: 0 };
  steer = { x: 0, z: 0 };
  serverNow: () => number = () => Date.now();
  /** The animal that would be picked up right now (read when the pick-up button is pressed). */
  highlightId: number | null = null;
  onUi: (ui: ShelterUi) => void = () => {};

  constructor(private container: HTMLElement, dims: { width: number; depth: number }, private styles: Record<string, VolunteerStyle>, private selfId: string | null) {
    this.width = dims.width;
    this.depth = dims.depth;
    this.solids = obstacles(dims);
    this.eyeId = selfId;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';
    this.disposables.push(this.renderer, this.kit);
    this.icons = makeSpeciesIcons(this.kit);
    this.buildWorld();
    this.buildCrowd();
    this.buildAdoptionLine();
    this.buildHearts();
    this.ring = new Mesh(new RingGeometry(0.9, 1.15, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#fff1a0', transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.disposables.push(this.ring.geometry as BufferGeometry, this.ring.material as MeshBasicMaterial);
    // The little animal in front of you: its own mini scene with its own light.
    this.heldScene.add(new HemisphereLight(0xffffff, 0xb5c0cc, 2.4));
    const held = new DirectionalLight(0xffffff, 2.2);
    held.position.set(1, 2, 2);
    this.heldScene.add(held);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private eyeId: string | null;

  // ---------- what React tells the scene ----------

  pushView(view: AdoptionDayView) {
    this.latest = view;
    this.latestAt = performance.now();
    const seen = new Set<number>();
    for (const [id, kind, x, z, heading, mode] of view.animals) {
      seen.add(id);
      let a = this.animals.get(id);
      if (!a) { a = { id, kind, x, z, heading, mode, tx: x, tz: z, th: heading, phase: Math.random() * 6 }; this.animals.set(id, a); }
      a.tx = x; a.tz = z; a.th = heading; a.mode = mode; a.kind = kind;
    }
    for (const id of this.animals.keys()) if (!seen.has(id)) this.animals.delete(id); // (picked up, or gone)
  }

  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); }

  /** Whose eyes the camera is looking through (a player: themselves; a spectator: the player they follow), or the winner's view at the end. */
  setCameraView(view: { targetId: string | null; winner?: boolean }) {
    this.winner = { on: !!view.winner, id: view.targetId };
    if (!view.winner) { this.eyeId = view.targetId; this.eyeYawSeen = false; }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const p of this.players.values()) { disposeNameTag(p.label); p.root.geometry.dispose(); }
    for (const s of this.slots) s.person.geometry.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.scene.traverse((o) => { if (o instanceof Mesh && !this.kit.models.some((m) => m.geometry === o.geometry)) { o.geometry.dispose?.(); } });
    this.renderer.domElement.remove();
  }

  // ---------- world ----------

  private buildWorld() {
    const sky = new Color('#dfe5ec');
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 55, 250);
    this.scene.add(new HemisphereLight(0xffffff, 0x9aa6b3, 1.55));
    const sun = new DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(40, 70, 30);
    this.scene.add(sun);
    const { width, depth } = this;
    const track = <T extends { dispose(): void }>(t: T) => { this.disposables.push(t); return t; };

    // The floor: pebbled tile (pale tile with small pebbles sparsely set in it); one picture covers 8 x 8 units.
    const floorTexture = track(new CanvasTexture(makeFloorCanvas()));
    floorTexture.colorSpace = SRGBColorSpace;
    floorTexture.wrapS = floorTexture.wrapT = RepeatWrapping;
    floorTexture.repeat.set(width / 8, depth / 8);
    floorTexture.anisotropy = 8;
    const floor = new Mesh(track(new PlaneGeometry(width, depth)), track(new MeshStandardMaterial({ map: floorTexture, roughness: 0.9 })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.buildWalls(track);
    const ground = new Mesh(track(new PlaneGeometry(900, 900)), track(new MeshStandardMaterial({ color: '#8f99a3', roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    this.scene.add(ground);
    // A yellow safety line round the edge of the floor.
    const lineMat = track(new MeshStandardMaterial({ color: '#f2c230', roughness: 0.8 }));
    for (const [w, d, x, z] of [[width, 0.7, 0, -depth / 2 + 0.35], [width, 0.7, 0, depth / 2 - 0.35], [0.7, depth, -width / 2 + 0.35, 0], [0.7, depth, width / 2 - 0.35, 0]] as const) {
      const strip = new Mesh(track(new BoxGeometry(w, 0.06, d)), lineMat);
      strip.position.set(x, 0.03, z);
      this.scene.add(strip);
    }
    // The adoption desk: a teal carpet under the counter and the hand-over pads, a long wooden counter the adopters stand behind, and a marked pad on the floor in front of each adopter.
    const rugLength = COUNTER_FRONT + PAD_DEPTH + 1;
    const rug = new Mesh(track(new PlaneGeometry(width - 4, rugLength - 1)), track(new MeshStandardMaterial({ color: '#3f7f8c', roughness: 1 })));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.03, -depth / 2 + 1 + (rugLength - 1) / 2);
    this.scene.add(rug);
    const rugEdge = new Mesh(track(new BoxGeometry(width - 4, 0.05, 0.4)), track(new MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.9 })));
    rugEdge.position.set(0, 0.04, -depth / 2 + rugLength);
    this.scene.add(rugEdge);
    const counterZ = -depth / 2 + COUNTER_FRONT - COUNTER_DEPTH / 2;
    const counter = new Mesh(track(new BoxGeometry(width - 4, COUNTER_HEIGHT, COUNTER_DEPTH)), track(new MeshStandardMaterial({ color: '#8a5a3c', roughness: 0.85, flatShading: true })));
    counter.position.set(0, COUNTER_HEIGHT / 2, counterZ);
    const counterTop = new Mesh(track(new BoxGeometry(width - 3.4, 0.28, COUNTER_DEPTH + 0.6)), track(new MeshStandardMaterial({ color: '#e6d8b8', roughness: 0.7, flatShading: true })));
    counterTop.position.set(0, COUNTER_HEIGHT + 0.14, counterZ);
    const kick = new Mesh(track(new BoxGeometry(width - 3.6, 0.35, 0.12)), track(new MeshStandardMaterial({ color: '#5e3b25', roughness: 0.9 })));
    kick.position.set(0, 0.2, counterZ + COUNTER_DEPTH / 2 + 0.05);
    const riser = new Mesh(track(new BoxGeometry(width - 4, RISER, COUNTER_FRONT - COUNTER_DEPTH - 1)), track(new MeshStandardMaterial({ color: '#6d6962', roughness: 1, flatShading: true })));
    riser.position.set(0, RISER / 2, -depth / 2 + 1 + (COUNTER_FRONT - COUNTER_DEPTH - 1) / 2);
    this.scene.add(counter, counterTop, kick, riser);
    this.buildPads(track);

    // The roof: dark underside, steel beams, hanging lights, and the pillars (the solid ones, at the same places the server uses).
    const roofW = width + 30, roofD = depth + 30;
    const roof = new Mesh(track(new PlaneGeometry(roofW, roofD)), track(new MeshBasicMaterial({ color: '#a9b4bf' })));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = ROOF_Y;
    this.scene.add(roof);
    const beamMat = track(new MeshBasicMaterial({ color: '#8793a0' }));
    // The beams run along the pillars (a girder over each row and each column of pillars), and the lights hang in the middle of each square the pillars make, so a light is never over a pillar.
    const posts = pillars({ width, depth });
    const colXs = [...new Set(posts.map((p) => p.x))].sort((a, b) => a - b);
    const rowZs = [...new Set(posts.map((p) => p.z))].sort((a, b) => a - b);
    const gx = colXs.length > 1 ? colXs[1] - colXs[0] : 26, gz = rowZs.length > 1 ? rowZs[1] - rowZs[0] : 26;
    const girders = new InstancedMesh(track(new BoxGeometry(1, 0.9, 1)), beamMat, colXs.length + rowZs.length + 2);
    const girder = (i: number, cx: number, cz: number, sx: number, sz: number) => girders.setMatrixAt(i, new Matrix4().compose(new Vector3(cx, ROOF_Y - 0.5, cz), new Quaternion(), new Vector3(sx, 1, sz)));
    let gi = 0;
    for (const z of [rowZs[0] - gz, ...rowZs]) if (Math.abs(z) < depth / 2) girder(gi++, 0, z, width, 0.7); // across the building over each row of pillars
    for (const x of colXs) girder(gi++, x, 0, 0.7, depth); // and along it over each column
    girders.count = gi;
    this.scene.add(girders);
    const panelPos: Matrix4[] = [];
    const lightXs = [colXs[0] - gx / 2, ...colXs.map((x) => x + gx / 2)];
    const lightZs = [rowZs[0] - gz / 2, ...rowZs.map((z) => z + gz / 2)];
    for (const x of lightXs) for (const z of lightZs) if (Math.abs(x) < width / 2 - 3 && Math.abs(z) < depth / 2 - 3) panelPos.push(new Matrix4().makeTranslation(x, ROOF_Y - 1.05, z));
    const panels = new InstancedMesh(track(new BoxGeometry(6, 0.2, 1.6)), track(new MeshBasicMaterial({ color: '#fff7df' })), Math.max(1, panelPos.length));
    panelPos.forEach((m, i) => panels.setMatrixAt(i, m));
    panels.count = panelPos.length;
    this.scene.add(panels);
    const pillarMesh = new InstancedMesh(track(new CylinderGeometry(0.9, 0.9, ROOF_Y, 10)), track(new MeshStandardMaterial({ color: '#8d99a6', roughness: 0.8, flatShading: true })), Math.max(1, posts.length));
    const bandMesh = new InstancedMesh(track(new CylinderGeometry(0.97, 0.97, 1.6, 10)), track(new MeshStandardMaterial({ color: '#f2c230', roughness: 0.8, flatShading: true })), Math.max(1, posts.length));
    posts.forEach((p, i) => { pillarMesh.setMatrixAt(i, new Matrix4().makeTranslation(p.x, ROOF_Y / 2, p.z)); bandMesh.setMatrixAt(i, new Matrix4().makeTranslation(p.x, 0.8, p.z)); });
    pillarMesh.count = posts.length; bandMesh.count = posts.length;
    this.scene.add(pillarMesh, bandMesh);

    // The sign over the adoption line, so the way back is always in sight.
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024; signCanvas.height = 192;
    const s = signCanvas.getContext('2d')!;
    s.fillStyle = '#2b6f7c'; s.fillRect(0, 0, 1024, 192);
    s.strokeStyle = '#f4f1e8'; s.lineWidth = 10; s.strokeRect(10, 10, 1004, 172);
    s.fillStyle = '#f4f1e8'; s.font = 'bold 118px system-ui, sans-serif'; s.textAlign = 'center'; s.textBaseline = 'middle';
    s.fillText('ADOPTIONS', 512, 100);
    const signTexture = track(new CanvasTexture(signCanvas));
    signTexture.colorSpace = SRGBColorSpace;
    const sign = new Mesh(track(new PlaneGeometry(30, 5.6)), track(new MeshBasicMaterial({ map: signTexture, side: DoubleSide })));
    sign.position.set(0, ROOF_Y - 4.2, -depth / 2 + 2.2);
    this.scene.add(sign);
    for (const sx of [-13, 13]) {
      const cable = new Mesh(track(new BoxGeometry(0.12, 4.4, 0.12)), beamMat);
      cable.position.set(sx, ROOF_Y - 1.7, -depth / 2 + 2.2);
      this.scene.add(cable);
    }
  }

  // ---------- the walls ----------

  /** The walls round the floor, painted with a flat jungle mural (the adoption centre is a bit of a jungle). */
  private buildWalls(track: <T extends { dispose(): void }>(t: T) => T) {
    const texture = track(new CanvasTexture(makeJungleCanvas()));
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = 8;
    const material = track(new MeshBasicMaterial({ map: texture, fog: false })); // (flat paint: unlit, and not washed out by the distance)
    const wall = (length: number, x: number, z: number, turn: number) => {
      const geometry = track(new PlaneGeometry(length, ROOF_Y));
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * length) / 64); // (the picture is 64 units wide)
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, ROOF_Y / 2, z);
      mesh.rotation.y = turn;
      this.scene.add(mesh);
    };
    wall(this.width, 0, -this.depth / 2, 0);
    wall(this.width, 0, this.depth / 2, Math.PI);
    wall(this.depth, -this.width / 2, 0, Math.PI / 2);
    wall(this.depth, this.width / 2, 0, -Math.PI / 2);
  }

  // ---------- the hand-over pads ----------

  private pads: MeshBasicMaterial[] = [];

  /** A carpet on the floor in front of each adopter: stand on it and the action button hands the animal over. */
  private buildPads(track: <T extends { dispose(): void }>(t: T) => T) {
    const texture = track(new CanvasTexture(makeCarpetCanvas())); // (a carpet with a border, a field of diamonds and a medallion; the material's color tints it)
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    const geometry = track(new PlaneGeometry(1, 1));
    const dims = { width: this.width, depth: this.depth };
    for (let i = 0; i < ADOPTEE_COUNT; i++) {
      const p = padRect(i, dims);
      const material = track(new MeshBasicMaterial({ map: texture, color: PAD_IDLE, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const pad = new Mesh(geometry, material);
      pad.rotation.x = -Math.PI / 2; // (the picture's top edge is towards the counter, so it reads the right way up from the south)
      pad.scale.set(p.x1 - p.x0, p.z1 - p.z0, 1);
      pad.position.set(p.cx, 0.06, p.cz);
      this.scene.add(pad);
      this.pads.push(material);
    }
  }

  // ---------- the crowd (one instanced mesh per kind) ----------

  private buildCrowd() {
    this.kit.models.forEach((model, i) => {
      const mesh = new InstancedMesh(model.geometry, this.kit.material, 1);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false; // (its bounds are not kept up to date as the animals move)
      mesh.count = 0;
      this.scene.add(mesh);
      this.instanced[i] = mesh;
    });
    const disc = new CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    this.disposables.push(disc);
    const shadowMat = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false });
    this.disposables.push(shadowMat);
    this.shadows = new InstancedMesh(disc, shadowMat, 1);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.scene.add(this.shadows);
  }

  /** Make an instanced mesh big enough for `n` instances (it is rebuilt once if the crowd outgrows it). */
  private ensureCapacity(i: number, n: number) {
    const old = this.instanced[i];
    if (old.instanceMatrix.count >= n) return;
    const mesh = new InstancedMesh(old.geometry, old.material, n + 16);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.remove(old);
    old.dispose();
    this.scene.add(mesh);
    this.instanced[i] = mesh;
  }

  // ---------- the adoption line ----------

  private bubbleFill!: BufferGeometry;
  private bubbleBox = new Box3();
  private bubbleScene = new Scene(); // the stages (one white cylinder per adopter, with their animal turning round in it): never drawn to the screen, only to the bubbles' pictures
  private stageWall!: BufferGeometry;
  private frustum = new Frustum();
  private frustumMatrix = new Matrix4();
  private sphere = new Sphere();
  private bubbleCentre = new Vector3();
  private bubbleOutline!: BufferGeometry;
  private outlineMat!: MeshBasicMaterial;

  private buildAdoptionLine() {
    const discs: [number, number, number][] = [[0, 0, 1.7], [-1.45, -0.15, 1.15], [1.45, -0.15, 1.15], [-0.8, 1.0, 1.1], [0.8, 1.0, 1.1], [0, 0.6, 1.5], [-0.55, -2.3, 0.42], [-0.25, -3.1, 0.26]];
    const make = (grow: number, z: number) => mergeGeometries(discs.map(([x, y, r]) => new CircleGeometry(r * grow, 28).translate(x, y, z)))!;
    this.bubbleFill = make(1, 0);
    this.bubbleOutline = make(1.1, -0.03);
    this.outlineMat = new MeshBasicMaterial({ color: '#27313f', side: DoubleSide });
    // The cloud shows the stage camera's picture: each point of the cloud looks up the matching point of the picture.
    this.bubbleFill.computeBoundingBox();
    this.bubbleBox.copy(this.bubbleFill.boundingBox!);
    const size = this.bubbleBox.getSize(new Vector3());
    const pos = this.bubbleFill.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) - this.bubbleBox.min.x) / size.x; uv[i * 2 + 1] = (pos.getY(i) - this.bubbleBox.min.y) / size.y; }
    this.bubbleFill.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    this.stageWall = new CylinderGeometry(STAGE_RADIUS, STAGE_RADIUS, 40, 28, 1, true);
    this.bubbleScene.add(new HemisphereLight(0xffffff, 0xc9d3de, 2.4));
    const stageSun = new DirectionalLight(0xffffff, 2.2);
    stageSun.position.set(10, 20, 30);
    this.bubbleScene.add(stageSun);
    this.disposables.push(this.bubbleFill, this.bubbleOutline, this.outlineMat, this.stageWall);
  }

  private buildSlots(view: AdoptionDayView) {
    const dims = { width: view.width, depth: view.depth };
    for (let i = 0; i < ADOPTEE_COUNT; i++) {
      const at = adopteePos(i, dims);
      const root = new Group();
      root.position.set(at.x, RISER, at.z);
      const bubble = new Group(); // turns to face the camera
      const shaker = new Group(); // shakes from side to side when the animal is wrong
      // This adopter's stage: a white cylinder (its wall turns red when the animal is wrong) with the animal turning round at its middle, and a camera looking at it.
      const size = this.bubbleBox.getSize(new Vector3()), centre = this.bubbleBox.getCenter(new Vector3());
      const stageAt = new Vector3(i * STAGE_SPACING, 0, 0);
      const wallMat = new MeshBasicMaterial({ color: '#ffffff', side: BackSide });
      const wall = new Mesh(this.stageWall, wallMat);
      wall.position.copy(stageAt);
      const pivot = new Group(); // turns round slowly
      const animal = new Mesh(this.kit.models[0].geometry, this.kit.material);
      pivot.add(animal);
      pivot.position.set(stageAt.x, stageAt.y + 0.3, stageAt.z); // (the same spot in the picture as it had in the cloud: its middle)
      this.bubbleScene.add(wall, pivot);
      const rt = new WebGLRenderTarget(STAGE_PICTURE_WIDTH, Math.round((STAGE_PICTURE_WIDTH * size.y) / size.x), { samples: 4 });
      rt.texture.colorSpace = SRGBColorSpace;
      const stageCam = new PerspectiveCamera(STAGE_FOV, size.x / size.y, 0.5, 80);
      const back = size.y / 2 / Math.tan(MathUtils.degToRad(STAGE_FOV / 2)); // far enough that the picture is exactly the cloud's size, 1 unit for 1 unit
      stageCam.position.set(stageAt.x + centre.x, stageAt.y + centre.y, stageAt.z + back);
      stageCam.lookAt(stageAt.x + centre.x, stageAt.y + centre.y, stageAt.z);
      const fillMat = new MeshBasicMaterial({ map: rt.texture, side: DoubleSide });
      const fill = new Mesh(this.bubbleFill, fillMat);
      const outline = new Mesh(this.bubbleOutline, this.outlineMat);
      shaker.add(outline, fill);
      bubble.add(shaker);
      bubble.scale.setScalar(BUBBLE_SCALE);
      bubble.position.set(0, BUBBLE_Y, 0.7);
      const person = new Mesh(buildPerson(adopteeLook(0)), this.kit.material);
      root.add(person, bubble);
      this.scene.add(root);
      this.slots.push({ id: -1, kind: -1, root, person, bubble, shaker, wallMat, pivot, animal, rt, stageCam, born: 0, seenDone: null, seenNope: null, x: at.x, z: at.z });
      this.disposables.push(wallMat, fillMat, rt);
    }
  }

  private buildHearts() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff4d6d';
    g.beginPath();
    g.moveTo(32, 56);
    g.bezierCurveTo(4, 36, 6, 8, 24, 10);
    g.bezierCurveTo(30, 11, 32, 16, 32, 18);
    g.bezierCurveTo(32, 16, 34, 11, 40, 10);
    g.bezierCurveTo(58, 8, 60, 36, 32, 56);
    g.fill();
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    this.disposables.push(texture);
    for (let i = 0; i < HEART_COUNT; i++) {
      const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new Sprite(material);
      sprite.visible = false;
      this.scene.add(sprite);
      this.hearts.push({ sprite, vx: 0, vy: 0, vz: 0, age: 99 });
      this.disposables.push(material);
    }
  }

  private burstHearts(x: number, y: number, z: number) {
    let n = 0;
    for (const h of this.hearts) {
      if (h.age < 1.4 || n >= 9) continue;
      h.age = 0; h.vx = (Math.random() - 0.5) * 4; h.vy = 3 + Math.random() * 2.5; h.vz = (Math.random() - 0.3) * 2;
      h.sprite.position.set(x, y, z);
      h.sprite.scale.setScalar(0.9 + Math.random() * 0.7);
      h.sprite.visible = true;
      n++;
    }
  }

  // ---------- per frame ----------

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    // Keep the same width of view on a tall phone as on a wide screen (within limits): the vertical field of view follows the aspect ratio.
    const vertical = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(FOV_H) / 2) / aspect)), 50, 100);
    this.camera.fov = vertical; this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.heldCamera.fov = vertical; this.heldCamera.aspect = aspect; this.heldCamera.updateProjectionMatrix();
  }

  private frame = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.update(dt);
    this.renderBubbles();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.heldMesh?.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.heldScene, this.heldCamera);
    }
  };

  /** Take each visible bubble's picture: its stage seen by its camera (the ones off screen are skipped). */
  private renderBubbles() {
    if (this.slots.length === 0) return;
    this.camera.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const slot of this.slots) {
      if (slot.id < 0) continue;
      this.sphere.set(this.bubbleCentre.set(slot.x, RISER + BUBBLE_Y, slot.z), 5);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      this.renderer.setRenderTarget(slot.rt);
      this.renderer.clear();
      this.renderer.render(this.bubbleScene, slot.stageCam);
    }
    this.renderer.setRenderTarget(null);
  }

  private update(dt: number) {
    const view = this.latest;
    if (!view) return;
    if (this.slots.length === 0) this.buildSlots(view);
    const age = MathUtils.clamp((this.serverNow() - view.t) / 1000, 0, MAX_AGE);
    const t = this.serverNow();
    const running = t >= view.startsAt && t < view.endsAt;

    this.updateIntro(view);
    this.updatePlayers(view, dt, age);
    this.updateEye(view, dt, age, running);
    this.updateAnimals(dt, age);
    this.updateSlots(view, dt);
    this.updateCamera(view, dt);
    this.updateHeld(view, dt);
    this.updateHearts(dt);
  }

  /** Everyone else: carried forward by their velocity, gently pulled onto the server's position. */
  private updatePlayers(view: AdoptionDayView, dt: number, age: number) {
    for (const [id, pv] of Object.entries(view.players)) {
      let v = this.players.get(id);
      if (!v) v = this.makePlayer(id, pv);
      const tx = pv.x + pv.vx * age, tz = pv.z + pv.vz * age;
      v.x += pv.vx * dt; v.z += pv.vz * dt;
      const err = Math.hypot(tx - v.x, tz - v.z);
      if (err > PREDICT_SNAP) { v.x = tx; v.z = tz; } else { const k = Math.min(1, 10 * dt); v.x += (tx - v.x) * k; v.z += (tz - v.z) * k; }
      v.yaw += angleDiff(v.yaw, pv.yaw) * Math.min(1, 12 * dt);
      v.vx = pv.vx; v.vz = pv.vz;
      const speed = Math.hypot(pv.vx, pv.vz);
      v.phase += dt * (speed > 0.5 ? 10 : 0);
      const bob = speed > 0.5 ? Math.abs(Math.sin(v.phase)) * 0.14 : 0;
      v.root.position.set(v.x, bob, v.z);
      v.root.rotation.set(0, v.yaw, speed > 0.5 ? Math.sin(v.phase) * 0.05 : 0, 'YXZ');
      const hidden = id === this.eyeId && !this.winner.on; // (you never see your own body)
      v.root.visible = !hidden;
      v.label.visible = !hidden;
      v.label.position.set(v.x, PERSON_HEIGHT + 1.0, v.z);
      // The animal they carry floats over their head.
      const carry = pv.carry;
      if (carry && !hidden) {
        if (!v.carry) { v.carry = new Mesh(this.kit.models[carry.kind].geometry, this.kit.material); this.scene.add(v.carry); v.carryKind = carry.kind; }
        if (v.carryKind !== carry.kind) { v.carry.geometry = this.kit.models[carry.kind].geometry; v.carryKind = carry.kind; }
        const model = this.kit.models[carry.kind];
        v.spin += dt * 2;
        v.carry.visible = true;
        v.carry.scale.setScalar(FIT_CARRIED / Math.max(model.height, model.length, model.width));
        v.carry.position.set(v.x, PERSON_HEIGHT + 2.4 + Math.sin(this.time * 3) * 0.12, v.z);
        v.carry.rotation.y = v.spin;
      } else if (v.carry) v.carry.visible = false;
    }
    for (const [id, v] of this.players) {
      if (id in view.players) continue;
      this.scene.remove(v.root, v.label, ...(v.carry ? [v.carry] : []));
      disposeNameTag(v.label); v.root.geometry.dispose();
      this.players.delete(id);
    }
  }

  private makePlayer(id: string, pv: ShelterPlayerView): PlayerVis {
    const style = this.styles[id] ?? { name: '?', color: '#94a3b8' };
    const root = new Mesh(buildPerson(volunteerLook(style.color, id)), this.kit.material);
    const label = createNameTag(style.name, style.color);
    label.scale.set(4.2, 1.05, 1);
    this.scene.add(root, label);
    const v: PlayerVis = { id, root, label, x: pv.x, z: pv.z, yaw: pv.yaw, vx: 0, vz: 0, phase: Math.random() * 6, carry: null, carryKind: -1, spin: 0 };
    this.players.set(id, v);
    return v;
  }

  /** Where the eyes are: yours (moved by your own steering at once, corrected by the server), or the followed player's. */
  private updateEye(view: AdoptionDayView, dt: number, age: number, running: boolean) {
    const id = this.eyeId;
    const own = id !== null && id === this.selfId && id in view.players;
    const pv = id ? view.players[id] : undefined;
    if (own && pv) {
      if (!this.pred) this.pred = { x: pv.x, z: pv.z };
      const sx = running ? this.steer.x : 0, sz = running ? this.steer.z : 0;
      const len = Math.hypot(sx, sz), scale = len > 1 ? 1 / len : 1;
      const to = resolveMove(this.pred.x + sx * scale * SHELTER_PLAYER_SPEED * dt, this.pred.z + sz * scale * SHELTER_PLAYER_SPEED * dt, SHELTER_PLAYER_RADIUS, { width: this.width, depth: this.depth }, this.solids);
      this.pred.x = to.x; this.pred.z = to.z;
      const tx = pv.x + pv.vx * age, tz = pv.z + pv.vz * age;
      if (Math.hypot(tx - this.pred.x, tz - this.pred.z) > PREDICT_SNAP) { this.pred.x = tx; this.pred.z = tz; }
      else { const k = Math.min(1, PREDICT_PULL * dt); this.pred.x += (tx - this.pred.x) * k; this.pred.z += (tz - this.pred.z) * k; }
      this.eye.x = this.pred.x; this.eye.z = this.pred.z;
      this.eye.yaw = this.look.yaw; this.eye.pitch = this.look.pitch;
      this.eye.moving = len > 0.05 && running;
    } else if (id) {
      const v = this.players.get(id);
      if (v && pv) {
        this.eye.x = v.x; this.eye.z = v.z;
        if (!this.eyeYawSeen) { this.eye.yaw = v.yaw; this.eyeYawSeen = true; } else this.eye.yaw += angleDiff(this.eye.yaw, v.yaw) * Math.min(1, 8 * dt);
        this.eye.pitch = -0.1;
        this.eye.moving = Math.hypot(pv.vx, pv.vz) > 0.5;
      }
    }
    this.bobPhase += dt * (this.eye.moving ? 9.5 : 0);
    if (this.eye.moving && id !== null && id === this.selfId) { // a soft footstep about every third of a second while you walk
      this.stepClock += dt;
      if (this.stepClock >= 0.32) { this.stepClock = 0; audio.playFlat(footstep, 1); }
    } else this.stepClock = 0.25; // (so the first step comes quickly)
  }

  private updateAnimals(dt: number, age: number) {
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ'), p = new Vector3(), sc = new Vector3(1, 1, 1);
    const counts = new Array<number>(KIND_COUNT).fill(0);
    for (const a of this.animals.values()) counts[a.kind]++;
    let total = 0;
    counts.forEach((n, i) => { this.ensureCapacity(i, n); total += n; });
    if (this.shadows.instanceMatrix.count < total) {
      const old = this.shadows;
      this.shadows = new InstancedMesh(old.geometry, old.material, total + 32);
      this.shadows.instanceMatrix.setUsage(DynamicDrawUsage); this.shadows.frustumCulled = false;
      this.scene.remove(old); old.dispose(); this.scene.add(this.shadows);
    }
    // Highlight: the animal in reach in front of the eyes (not while carrying one).
    const view = this.latest!;
    const eyeCarry = this.eyeId ? view.players[this.eyeId]?.carry : null;
    const list = [...this.animals.values()];
    const highlight = eyeCarry || !this.eyeId ? null : pickTarget(this.eye.x, this.eye.z, this.eye.yaw, list);
    this.highlightId = highlight;
    const used = new Array<number>(KIND_COUNT).fill(0);
    let shadowN = 0;
    let hl: AnimalVis | null = null;
    const colorBright = new Color(1.45, 1.45, 1.2), colorNormal = new Color(1, 1, 1);
    const colorWrites: { kind: number; index: number; bright: boolean }[] = [];
    for (const a of list) {
      const speed = a.mode === 0 ? 0 : a.mode === 2 ? ANIMAL_FLEE_SPEED : ANIMAL_SPEED;
      a.x += Math.cos(a.heading) * speed * dt; a.z += Math.sin(a.heading) * speed * dt;
      const tspeed = a.mode === 0 ? 0 : speed;
      const tx = a.tx + Math.cos(a.th) * tspeed * age, tz = a.tz + Math.sin(a.th) * tspeed * age;
      if (Math.hypot(tx - a.x, tz - a.z) > 5) { a.x = tx; a.z = tz; } else { const k = Math.min(1, 9 * dt); a.x += (tx - a.x) * k; a.z += (tz - a.z) * k; }
      a.heading += angleDiff(a.heading, a.th) * Math.min(1, 10 * dt);
      a.phase += dt * (a.mode === 0 ? 0 : a.mode === 2 ? 20 : 11);
      let roll = a.mode === 0 ? 0 : Math.sin(a.phase) * SWAY[speciesOf(a.kind)];
      let bob = a.mode === 0 ? 0 : Math.abs(Math.sin(a.phase)) * 0.07;
      let pitch = 0;
      if (speciesOf(a.kind) === FISH) { // a fish flops about on its side instead of walking
        const s = a.mode === 0 ? 0 : 1;
        bob = s * Math.max(0, Math.sin(a.phase * 0.55)) * 0.6; roll = s * Math.sin(a.phase * 0.55) * 0.9; pitch = s * Math.sin(a.phase * 0.55 + 1) * 0.3;
      }
      const index = used[a.kind]++;
      if (index >= this.instanced[a.kind].instanceMatrix.count) continue;
      e.set(pitch, Math.PI / 2 - a.heading, roll);
      q.setFromEuler(e);
      m.compose(p.set(a.x, bob, a.z), q, sc);
      this.instanced[a.kind].setMatrixAt(index, m);
      const r = this.kit.models[a.kind].groundRadius;
      m.compose(p.set(a.x, 0.06, a.z), q.identity(), sc.set(r * 0.9, 1, r * 0.9));
      this.shadows.setMatrixAt(shadowN++, m);
      sc.set(1, 1, 1);
      if (a.id === highlight) { hl = a; colorWrites.push({ kind: a.kind, index, bright: true }); }
    }
    this.instanced.forEach((mesh, i) => {
      mesh.count = Math.min(used[i], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      const dirty = this.highlightKind === i || colorWrites.some((c) => c.kind === i);
      if (dirty) {
        for (let k = 0; k < mesh.count; k++) mesh.setColorAt(k, colorNormal);
        for (const c of colorWrites) if (c.kind === i && c.index < mesh.count) mesh.setColorAt(c.index, colorBright);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
    this.highlightKind = hl ? (hl as AnimalVis).kind : -1;
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.lastCounts = used;
    // The glow on the floor under the lit-up animal.
    if (hl) {
      const target = hl as AnimalVis;
      const r = this.kit.models[target.kind].groundRadius + 0.5;
      this.ring.visible = true;
      this.ring.position.set(target.x, 0.08, target.z);
      this.ring.scale.setScalar(r * (1 + Math.sin(this.time * 6) * 0.06));
    } else this.ring.visible = false;
    // Tell the screen what the player can do now.
    const nearAdoptee = this.eyeId !== null && this.nearAdopteeNow(view);
    const carrying = !!eyeCarry;
    if (this.uiLast.highlight !== highlight || this.uiLast.nearAdoptee !== nearAdoptee || this.uiLast.carrying !== carrying) {
      this.uiLast = { highlight, nearAdoptee, carrying };
      this.onUi(this.uiLast);
    }
    if (this.eyeId !== null && this.eyeId === this.selfId) { // the player's own sounds (a spectator hears the room, not a volunteer's hands)
      const adoptions = view.players[this.eyeId]?.adoptions ?? 0;
      if (highlight !== null && highlight !== this.lastHighlight && performance.now() - this.lastGlowAt > 250) { this.lastGlowAt = performance.now(); audio.playFlat(glowHum, 0.6); } // a new animal came within reach
      if (carrying && !this.lastCarrying) audio.playFlat(scoopUp, 0.7); // picked up
      else if (!carrying && this.lastCarrying) {
        if (adoptions > this.lastAdoptions) audio.playFlat(adoptedArpeggio, 0.7); // handed over: a point
        else { // dropped: but not a wrong hand-over, which has its own sound (the adopter's "uh-oh")
          const slot = handoverSlot(this.eye.x, this.eye.z, { width: view.width, depth: view.depth });
          const ad = slot !== null ? view.adoptees[slot] : null;
          if (!(ad && ad.nopeAt !== null && this.serverNow() - ad.nopeAt < 800)) audio.playFlat(plop, 0.7);
        }
      }
      this.lastAdoptions = adoptions;
    }
    this.lastHighlight = highlight;
    this.lastCarrying = carrying;
  }

  /** True when the eyes stand on the pad of an adopter who is still waiting (so the action button would hand the animal over). */
  private nearAdopteeNow(view: AdoptionDayView): boolean {
    const slot = handoverSlot(this.eye.x, this.eye.z, { width: view.width, depth: view.depth });
    return slot !== null && view.adoptees[slot]?.doneAt === null;
  }

  private updateSlots(view: AdoptionDayView, dt: number) {
    const sNow = this.serverNow();
    const onPad = this.eyeId ? handoverSlot(this.eye.x, this.eye.z, { width: view.width, depth: view.depth }) : null;
    const holding = !!(this.eyeId && view.players[this.eyeId]?.carry);
    const padReady = onPad !== null && holding && view.adoptees[onPad]?.doneAt === null && this.eyeId === this.selfId ? onPad : -1;
    if (padReady !== -1 && padReady !== this.padKey) audio.playFlat(padChime, 0.6); // stepped onto a carpet holding an animal: it turns green
    this.padKey = padReady;
    this.pads.forEach((m, i) => {
      const leaving = view.adoptees[i]?.doneAt != null;
      m.color.copy(leaving ? PAD_LEAVING : onPad === i && holding ? PAD_READY : PAD_IDLE);
    });
    const camX = this.camera.position.x, camZ = this.camera.position.z;
    view.adoptees.forEach((ad: AdopteeView, i) => {
      const slot = this.slots[i];
      if (!slot) return;
      if (slot.id !== ad.id) { // a new person has stepped up
        if (slot.id !== -1) audio.playFlat(deskBell, 0.5); // (not for the first six, who are just there when the round opens)
        slot.id = ad.id; slot.born = performance.now(); slot.seenDone = null; slot.seenNope = null;
        slot.person.geometry.dispose();
        slot.person.geometry = buildPerson(adopteeLook(ad.id));
        slot.person.position.y = 0; slot.person.rotation.y = 0;
        slot.wallMat.color.set('#ffffff');
        slot.shaker.position.x = 0;
      }
      if (slot.kind !== ad.kind) {
        slot.kind = ad.kind;
        const model = this.kit.models[ad.kind];
        slot.animal.geometry = model.geometry;
        const k = FIT_BUBBLE / Math.max(model.height, model.length, model.width);
        slot.animal.scale.setScalar(k);
        slot.animal.position.set(0, -model.height * k * 0.5, 0); // centred in the cloud
      }
      slot.pivot.rotation.y += dt * 1.3;
      slot.bubble.rotation.y = Math.atan2(camX - slot.x, camZ - slot.z); // always faces the camera
      // Stepping up: the person and their bubble pop in.
      let scale = easeOutBack(Math.min(1, (performance.now() - slot.born) / 500));
      let bubbleScale = 1, hop = 0;
      // Happy: the adopter jumps for joy, the bubble pops, hearts fly; then they leave.
      if (ad.doneAt !== null) {
        const u = (sNow - ad.doneAt) / 1000;
        const total = ADOPTEE_LEAVE_MS / 1000;
        hop = Math.abs(Math.sin(u * 8)) * 0.9 * Math.max(0, 1 - u / total);
        bubbleScale = u < 0.2 ? 1 + u * 1.5 : Math.max(0, 1.3 - (u - 0.2) * 5);
        if (u > total - 0.5) scale *= Math.max(0, (total - u) / 0.5);
        if (slot.seenDone !== ad.doneAt) { slot.seenDone = ad.doneAt; this.burstHearts(slot.x, PERSON_HEIGHT + 0.6, slot.z + 0.8); if (u < 1) audio.playFlat(joyWhoop, 0.6); }
      }
      // The opening: as the camera reaches each adopter they jump for joy (the success hop, without the hearts) and their bubble gives a little pulse, so the pan has movement.
      if (ad.doneAt === null && this.intro.phase === 'pan' && i === this.intro.focus) {
        const h = Math.max(0, (this.intro.f - 0.3) * this.intro.segSeconds);
        hop = Math.abs(Math.sin(h * 9)) * 0.9 * Math.max(0, 1 - h / 0.9);
        if (h > 0 && h < 0.5) bubbleScale = 1 + 0.12 * Math.sin((h / 0.5) * Math.PI);
        if (h > 0 && !this.introHopSeen.has(i)) { this.introHopSeen.add(i); audio.playFlat(joyWhoop, 0.35); } // (a softer whoop for each hop of the pan)
      }
      slot.person.position.y = hop;
      slot.root.scale.setScalar(Math.max(0.0001, scale));
      slot.bubble.scale.setScalar(BUBBLE_SCALE * Math.max(0.0001, bubbleScale));
      // Wrong animal: the bubble turns red and shakes, and the adopter shakes their head.
      if (ad.nopeAt !== null) {
        const u = (sNow - ad.nopeAt) / ADOPTEE_NOPE_MS;
        if (slot.seenNope !== ad.nopeAt) { slot.seenNope = ad.nopeAt; if (u < 1) { audio.playFlat(uhOh, 0.7); audio.playFlat(scurry, 0.6, 0.15); } } // (the wrong animal is dropped and runs off)
        const decay = u >= 0 && u <= 1 ? 1 - u : 0;
        slot.wallMat.color.set('#ffffff').lerp(new Color('#ff4d4d'), Math.min(1, decay * 1.6));
        slot.shaker.position.x = Math.sin(u * 55) * 0.5 * decay;
        slot.person.rotation.y = Math.sin(u * 40) * 0.35 * decay;
      } else if (ad.doneAt === null) { slot.wallMat.color.set('#ffffff'); slot.shaker.position.x = 0; slot.person.rotation.y = 0; }
    });
  }

  private updateHearts(dt: number) {
    for (const h of this.hearts) {
      if (!h.sprite.visible) continue;
      h.age += dt;
      if (h.age > 1.4) { h.sprite.visible = false; continue; }
      h.vy -= 4 * dt;
      h.sprite.position.x += h.vx * dt; h.sprite.position.y += h.vy * dt; h.sprite.position.z += h.vz * dt;
      (h.sprite.material as SpriteMaterial).opacity = Math.min(1, (1.4 - h.age) * 2);
    }
  }

  /** Where the opening is, from the server's clock: a static moment on the first adopter, a pan along all the adopters, then the 3, 2, 1 that carries the camera into the player's eyes. */
  private updateIntro(view: AdoptionDayView) {
    const now = this.serverNow();
    const countStart = view.startsAt - GAME_INTRO_COUNT_SECONDS * 1000;
    const panStart = countStart - SHELTER_PAN_SECONDS * 1000;
    const it = this.intro;
    if (now >= view.startsAt) { it.phase = 'none'; return; }
    if (now >= countStart) { it.phase = 'count'; it.c = (now - countStart) / (GAME_INTRO_COUNT_SECONDS * 1000); return; }
    if (now >= panStart) {
      const u = ((now - panStart) / (SHELTER_PAN_SECONDS * 1000)) * ADOPTEE_COUNT; // (one adopter per unit)
      it.phase = 'pan'; it.focus = Math.min(ADOPTEE_COUNT - 1, Math.floor(u)); it.f = Math.min(1, u - it.focus);
      return;
    }
    it.phase = 'hold'; it.focus = 0; it.f = 0;
  }

  /** The camera's place while it looks at adopter `focus` (`f` is how far into that adopter's turn: it glides over from the previous one, then stays), in front of the counter, under the roof. */
  private panPose(focus: number, f: number, pos: Vector3, look: Vector3) {
    const dims = { width: this.width, depth: this.depth };
    const here = adopteePos(focus, dims), before = adopteePos(Math.max(0, focus - 1), dims);
    const x = focus === 0 ? here.x : before.x + (here.x - before.x) * ease(Math.min(1, f / 0.45));
    pos.set(x, 6.4, here.z + 15.5);
    look.set(x, 7.4, here.z);
  }

  private updateCamera(view: AdoptionDayView, dt: number) {
    const phase = this.intro.phase;
    // (for a draw at the end the camera pulls back inside the building, never through the roof)
    const overview = new Vector3(0, ROOF_Y - 4, this.depth * 0.46);
    const overviewLook = new Vector3(0, 2.5, -this.depth * 0.2);
    const eyePos = new Vector3(this.eye.x, SHELTER_EYE_HEIGHT + Math.sin(this.bobPhase) * 0.07, this.eye.z);
    const f = facing(this.eye.yaw);
    const eyeLook = new Vector3(this.eye.x + f.x * Math.cos(this.eye.pitch), eyePos.y + Math.sin(this.eye.pitch), this.eye.z + f.z * Math.cos(this.eye.pitch));

    let pos = eyePos, look = eyeLook, smooth = false;
    if (this.winner.on) {
      // The winner moment: the camera glides to the winner (from behind, so you see who it is), or, on a draw, pulls back over the whole shelter.
      const w = this.winner.id ? this.players.get(this.winner.id) : undefined;
      if (w) {
        const wf = facing(w.yaw);
        pos = new Vector3(w.x - wf.x * 7, 4.8, w.z - wf.z * 7);
        look = new Vector3(w.x, 2.4, w.z);
      } else { pos = overview; look = overviewLook; }
      smooth = true;
    }
    if (smooth) {
      const s = this.camSmooth;
      if (!s.ready) { s.pos.copy(this.camera.position); s.look.copy(eyeLook); s.ready = true; }
      const k = 1 - Math.exp(-2.6 * dt);
      s.pos.lerp(pos, k); s.look.lerp(look, k);
      this.camera.position.copy(s.pos);
      this.camera.lookAt(s.look);
    } else if (phase === 'hold' || phase === 'pan') {
      this.panPose(this.intro.focus, this.intro.f, this.tmpPos, this.tmpLook);
      this.camera.position.copy(this.tmpPos);
      this.camera.lookAt(this.tmpLook);
    } else if (phase === 'count') {
      // The countdown carries the camera on from the last adopter into the player's eyes, turning round as it goes.
      const u = ease(this.intro.c);
      this.panPose(ADOPTEE_COUNT - 1, 1, this.tmpPos, this.tmpLook);
      this.tmpCam.position.copy(this.tmpPos);
      this.tmpCam.lookAt(this.tmpLook);
      this.qEye.setFromEuler(new Euler(this.eye.pitch, this.eye.yaw + Math.PI, 0, 'YXZ'));
      this.camera.quaternion.copy(this.tmpCam.quaternion).slerp(this.qEye, u);
      this.camera.position.copy(this.tmpPos).lerp(eyePos, u);
    } else {
      this.camera.position.copy(pos);
      this.camera.rotation.set(this.eye.pitch, this.eye.yaw + Math.PI, 0, 'YXZ');
    }
    void view;
  }

  /** The little animal that floats in front of you (or of the player you follow) once you have picked one up. */
  private updateHeld(view: AdoptionDayView, dt: number) {
    const carry = this.eyeId && !this.winner.on ? view.players[this.eyeId]?.carry ?? null : null;
    if (!carry) { if (this.heldMesh) this.heldMesh.visible = false; return; }
    if (!this.heldMesh) { this.heldMesh = new Mesh(this.kit.models[carry.kind].geometry, this.kit.material); this.heldScene.add(this.heldMesh); this.heldKind = carry.kind; }
    if (this.heldKind !== carry.kind) { this.heldMesh.geometry = this.kit.models[carry.kind].geometry; this.heldKind = carry.kind; }
    const model = this.kit.models[carry.kind];
    const k = FIT_HELD / Math.max(model.height, model.length, model.width);
    this.heldMesh.visible = true;
    this.heldMesh.scale.setScalar(k);
    this.heldMesh.position.set(0, -0.62 - model.height * k * 0.5 + Math.sin(this.time * 3) * 0.03, -2.1); // low in front of you, bobbing
    this.heldMesh.rotation.y += dt * 1.6;
  }
}
