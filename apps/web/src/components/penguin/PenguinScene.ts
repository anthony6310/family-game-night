import {
  BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group,
  HemisphereLight, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PerspectiveCamera,
  RepeatWrapping, RingGeometry, Scene, Shape, ShapeGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader, TorusGeometry,
  Vector3, WebGLRenderer, BoxGeometry, ConeGeometry, SphereGeometry,
  type Texture,
} from 'three';
import type { LoopView, PenguinLassoView, SkaterView } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { captureChime, cashIn, loopMiss, skateSwish } from '../../audio/iceSounds';
import type { SoundFn } from '../../audio/snowSounds';
import { SpectatorRig } from '../../spectate/SpectatorRig';
import type { CameraMode } from '../../spectate/useSpectatorCamera';
import { FleckSystem } from '../snowball/effects';
import { makeLabelTexture } from '../labelTexture';

/** How a skater is labelled and dressed. */
export interface SkaterStyle {
  name: string;
  color: string; // the parka, the ring under the skater, the trail and the name tag
  avatarUrl: string | null; // shown as the skater's face (null = a plain face)
}

interface SkaterPose { x: number; z: number; vx: number; vz: number }
interface PenguinPose { x: number; z: number; heading: number; walking: boolean; caughtBy?: string }
interface Snapshot {
  t: number; // when it ARRIVED (performance.now() timeline)
  skaters: Record<string, SkaterPose>;
  penguins: Map<number, PenguinPose>;
}

/** Draw a little in the past and blend between snapshots, exactly like Snowball (see INTERP_DELAY_MS there). */
const INTERP_DELAY_MS = 120;
const MAX_EXTRAPOLATE_MS = 150;

/** The follow camera: a steady view from behind and above the skater (the same for players and spectators following someone). */
const FOLLOW_VIEW = () => ({ height: 11, back: 12 });

const TRAIL_CAPACITY = 256; // most points one trail can draw (the server's trail is far shorter)
const TRAIL_HALF_WIDTH = 0.28;
const TRAIL_LIFT = 0.04; // just above the ice so it never z-fights with it
const LOOP_FLASH_SECONDS = 0.8;
const CATCH_FLIGHT_SECONDS = 0.8; // how long a caught penguin takes to hop into its catcher's arms
const PLUS_ONE_SECONDS = 1.1;
const BAG_HEADS = 4; // most penguin heads shown poking out of the bag
const SKATE_SOUND_EVERY = 0.3; // seconds between swishes at full speed

interface SkaterVisual {
  root: Group; // moves and turns (faces where it is going)
  lean: Group; // the body, tilted forward with speed
  leftSkate: Mesh; rightSkate: Mesh; leftArm: Mesh; rightArm: Mesh;
  ring: Mesh; shadow: Mesh; label: Sprite;
  trail: Mesh; trailGeometry: BufferGeometry; trailPositions: Float32Array; trailColors: Float32Array;
  color: Color;
  phase: number; // where it is in its skating stride
  swishTimer: number;
  hop: number; // seconds since it caught something (a little jump of joy), large = not hopping
  face: MeshStandardMaterial;
  bag: Group; // the sack on the skater's back that caught penguins go into
  bagSack: Mesh;
  bagHeads: Group[]; // penguin heads poking out of the sack (up to 4)
  lastBanked: number | null; // their score when last seen (a rise = they just cashed in)
}

interface PenguinVisual {
  root: Group; body: Group; shadow: Mesh;
  phase: number;
  catch: { startedAt: number; from: Vector3; by: string } | null;
}

/**
 * Everything three.js for the Penguin Lasso round, kept apart from React (the same shape as SnowballScene and
 * TapRaceScene): React hands it each server view (`pushView`) and a container; it owns the renderer, the loop and cleanup.
 *
 * Look: a flat, glossy pale-blue ice rink inside a low wall (the same wall and size rules as Snowball, but no hills or
 * ditches); eskimo skaters in parkas whose trail is a ribbon on the ice that fades towards its old end; round, waddling penguins.
 */
export class PenguinScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(55, 1, 0.1, 400);
  private snapshots: Snapshot[] = [];
  private latest: PenguinLassoView | null = null; // the newest raw view: the trails and loops come from it
  private skaters = new Map<string, SkaterVisual>();
  private penguins = new Map<number, PenguinVisual>();
  private flashes: { mesh: Mesh; material: MeshBasicMaterial; age: number }[] = [];
  private seenLoops = new Set<number>();
  private iglooBuilt = false; // the igloos are built from the first view (they never move)
  private iglooGeometries = [new SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), new CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI), new RingGeometry(0.97, 1, 48)];
  private bagGeometry = new IcosahedronGeometry(0.6, 1);
  private iglooFlagGeometry = new BoxGeometry(0.1, 1.1, 0.7);
  private pluses: { sprite: Sprite; age: number; x: number; z: number }[] = [];
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private textureLoader = new TextureLoader().setCrossOrigin('anonymous');
  private flecks = new FleckSystem(300);
  private rig: SpectatorRig;
  private view: { mode: CameraMode; targetId: string | null };
  private pan: { current: { x: number; z: number } } = { current: { x: 0, z: 0 } };
  private zoom = 1;
  // The countdown every game shares (see GAME_RULES.md #1): ticks for the last 5 seconds, then the whistle.
  private clock = createRoundClock((sound, gain) => this.playHere(sound, gain));

  // Shared shapes (one geometry, many meshes).
  private skaterBody = new CylinderGeometry(0.55, 0.9, 1.5, 8);
  private skaterHead = new IcosahedronGeometry(0.55, 1);
  private furRing = new TorusGeometry(0.5, 0.15, 6, 12);
  private furHem = new TorusGeometry(0.82, 0.14, 6, 12);
  private faceDisc = new CircleGeometry(0.4, 16);
  private limb = new BoxGeometry(0.2, 0.7, 0.2);
  private skateBox = new BoxGeometry(0.28, 0.14, 0.95);
  private bladeBox = new BoxGeometry(0.06, 0.1, 1.05);
  private ringGeometry = new RingGeometry(1.25, 1.5, 32);
  private shadowGeometry = new CircleGeometry(1.1, 20);
  private penguinBody = new IcosahedronGeometry(0.62, 1);
  private penguinHead = new IcosahedronGeometry(0.4, 1);
  private beak = new ConeGeometry(0.12, 0.34, 6);
  private flipper = new BoxGeometry(0.1, 0.55, 0.28);
  private foot = new BoxGeometry(0.3, 0.07, 0.42);
  private eye = new SphereGeometry(0.07, 6, 6);
  private materials = {
    dark: new MeshStandardMaterial({ color: '#1e2a47', flatShading: true, roughness: 0.8 }),
    white: new MeshStandardMaterial({ color: '#f6fbff', flatShading: true, roughness: 0.9 }),
    orange: new MeshStandardMaterial({ color: '#ff9a1f', flatShading: true, roughness: 0.7 }),
    fur: new MeshStandardMaterial({ color: '#fffaf0', flatShading: true, roughness: 1 }),
    steel: new MeshStandardMaterial({ color: '#cfd8e3', flatShading: true, roughness: 0.3, metalness: 0.6 }),
    boot: new MeshStandardMaterial({ color: '#4a3426', flatShading: true, roughness: 0.9 }),
    sack: new MeshStandardMaterial({ color: '#a0763f', flatShading: true, roughness: 1 }),
    rope: new MeshStandardMaterial({ color: '#e8d8b0', flatShading: true, roughness: 1 }),
    igloo: new MeshStandardMaterial({ color: '#f4fbff', flatShading: true, roughness: 0.7 }),
    iglooDark: new MeshStandardMaterial({ color: '#27384f', flatShading: true, roughness: 1 }),
    shadow: new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }),
    eye: new MeshBasicMaterial({ color: '#10131f' }),
  };

  constructor(
    private container: HTMLElement,
    private arenaRadius: number,
    private trailMax: number,
    private styles: Record<string, SkaterStyle>,
    selfId: string | null,
  ) {
    this.view = { mode: 'follow', targetId: selfId };
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(
      ...this.iglooGeometries, this.bagGeometry, this.iglooFlagGeometry,
      this.renderer, this.flecks, this.skaterBody, this.skaterHead, this.furRing, this.furHem, this.faceDisc, this.limb, this.skateBox, this.bladeBox,
      this.ringGeometry, this.shadowGeometry, this.penguinBody, this.penguinHead, this.beak, this.flipper, this.foot, this.eye,
      ...Object.values(this.materials),
    );
    this.rig = new SpectatorRig(this.camera, arenaRadius, FOLLOW_VIEW);
    this.buildWorld();
    this.scene.add(this.flecks.object);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------

  /** Hand over the latest server view (about 20 a second). */
  pushView(view: PenguinLassoView) {
    this.latest = view;
    if (!this.iglooBuilt) this.buildIgloos(view);
    this.checkCashIns(view);
    const skaters: Record<string, SkaterPose> = {};
    for (const [id, s] of Object.entries(view.skaters)) skaters[id] = { x: s.x, z: s.z, vx: s.vx, vz: s.vz };
    this.snapshots.push({ t: performance.now(), skaters, penguins: new Map(view.penguins.map((p) => [p.id, { x: p.x, z: p.z, heading: p.heading, walking: p.walking, caughtBy: p.caughtBy }])) });
    if (this.snapshots.length > 10) this.snapshots.shift();
    this.newLoops(view.loops);
  }

  /** Seconds left in the round: the last 5 tick, then the whistle (GAME_RULES.md #1). */
  setSecondsLeft(secondsLeft: number) {
    this.clock.update(secondsLeft);
  }

  /** Which skater the camera follows, or the free camera. (Players follow themselves; spectators choose.) */
  setCameraView(view: { mode: CameraMode; targetId: string | null }) {
    this.view = view;
  }

  /** The free camera's movement input: an object whose `current` is read every frame (a React ref). */
  setPanSource(pan: { current: { x: number; z: number } }) {
    this.pan = pan;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const v of this.skaters.values()) { v.trailGeometry.dispose(); v.trail.material instanceof MeshBasicMaterial && v.trail.material.dispose(); v.face.dispose(); }
    for (const f of this.flashes) { f.mesh.geometry.dispose(); f.material.dispose(); }
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  /** Sounds that belong to the whole round (the clock) play at the listener, so everyone hears them equally loud. */
  private playHere(sound: SoundFn, gain: number) {
    audio.play(sound, this.rig.focusX, this.rig.focusZ, gain, 1);
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  // ---------- world ----------

  private buildWorld() {
    const sky = new Color('#cfe4fa');
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 70, 220);
    this.scene.add(new HemisphereLight(0xffffff, 0xa9c4e4, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(-40, 30, 10);
    this.scene.add(sun);

    // The rink: ONE flat disc with a procedural ice texture (pale blue with scratches). No hills or ditches here.
    const texture = this.track(makeIceTexture());
    texture.repeat.set(this.arenaRadius / 9, this.arenaRadius / 9);
    const floor = new Mesh(this.track(new CircleGeometry(this.arenaRadius, 64)), this.track(new MeshStandardMaterial({ map: texture, roughness: 0.22, metalness: 0.05 })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Plain snowy ground beyond the wall, and the same low wall with a white rim as Snowball.
    const outside = new Mesh(this.track(new RingGeometry(this.arenaRadius - 0.05, this.arenaRadius * 8, 64, 1)), this.track(new MeshLambertMaterial({ color: '#e3edf8' })));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.05;
    this.scene.add(outside);
    const wallRadius = this.arenaRadius + 0.3;
    const wall = new Mesh(this.track(new CylinderGeometry(wallRadius, wallRadius, 1.4, 48, 1, true)), this.track(new MeshLambertMaterial({ color: '#a9c7e8', side: DoubleSide })));
    wall.position.y = 0.7;
    this.scene.add(wall);
    const rim = new Mesh(this.track(new TorusGeometry(wallRadius, 0.3, 6, 48)), this.track(new MeshLambertMaterial({ color: '#ffffff' })));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.4;
    this.scene.add(rim);
  }

  // ---------- building the characters ----------

  private makeSkater(id: string): SkaterVisual {
    const style = this.styles[id] ?? { name: '?', color: '#3b82f6', avatarUrl: null };
    const color = new Color(style.color);
    const parka = this.track(new MeshStandardMaterial({ color: style.color, flatShading: true, roughness: 0.85 }));
    const face = new MeshStandardMaterial({ color: '#f2c9a0', roughness: 0.9 }); // plain skin colour until an avatar loads

    const root = new Group();
    const lean = new Group();
    root.add(lean);
    const body = new Mesh(this.skaterBody, parka);
    body.position.y = 1.05;
    const hem = new Mesh(this.furHem, this.materials.fur); // fur trim at the bottom of the parka
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.3;
    const head = new Mesh(this.skaterHead, parka); // the hood
    head.scale.set(1.2, 1.1, 1.15);
    head.position.set(0, 2.15, -0.05);
    const fur = new Mesh(this.furRing, this.materials.fur); // fur ring framing the face
    fur.position.set(0, 2.15, 0.4);
    const faceMesh = new Mesh(this.faceDisc, face); // the face: the player's avatar
    faceMesh.position.set(0, 2.15, 0.5);
    const leftArm = new Mesh(this.limb, parka);
    const rightArm = new Mesh(this.limb, parka);
    leftArm.position.set(-0.75, 1.45, 0);
    rightArm.position.set(0.75, 1.45, 0);
    lean.add(body, hem, head, fur, faceMesh, leftArm, rightArm);

    // The bag: a lumpy sack on the skater's back. It swells with every penguin caught, and their heads poke out of the top.
    const bag = new Group();
    bag.position.set(0, 1.6, -0.95);
    const bagSack = new Mesh(this.bagGeometry, this.materials.sack);
    const tie = new Mesh(this.furRing, this.materials.rope); // the rope tied round the neck of the sack
    tie.scale.setScalar(0.55);
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.5;
    bag.add(bagSack, tie);
    const bagHeads: Group[] = [];
    for (let i = 0; i < BAG_HEADS; i++) {
      const head = new Group();
      const skull = new Mesh(this.penguinHead, this.materials.dark);
      skull.scale.setScalar(0.7);
      const beak = new Mesh(this.beak, this.materials.orange);
      beak.scale.setScalar(0.7);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, -0.02, 0.3);
      head.add(skull, beak);
      const angle = (i / BAG_HEADS) * Math.PI * 2;
      head.position.set(Math.cos(angle) * 0.22, 0.62, Math.sin(angle) * 0.22);
      head.rotation.y = -angle + Math.PI / 2;
      head.visible = false;
      bag.add(head);
      bagHeads.push(head);
    }
    bag.visible = false;
    lean.add(bag);

    const makeSkate = (x: number) => {
      const boot = new Mesh(this.skateBox, this.materials.boot);
      const blade = new Mesh(this.bladeBox, this.materials.steel);
      blade.position.y = -0.1;
      boot.add(blade);
      boot.position.set(x, 0.2, 0);
      root.add(boot);
      return boot;
    };
    const leftSkate = makeSkate(-0.3);
    const rightSkate = makeSkate(0.3);

    const ring = new Mesh(this.ringGeometry, this.track(new MeshBasicMaterial({ color: style.color, side: DoubleSide, transparent: true, opacity: 0.95 })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    const label = new Sprite(this.track(new SpriteMaterial({ map: this.track(makeLabelTexture(style.name, style.color)), transparent: true })));
    label.scale.set(4.2, 1.05, 1);

    // The trail: a flat ribbon on the ice (rebuilt every frame from the server's trail points), faded towards its old end.
    const trailGeometry = new BufferGeometry();
    const trailPositions = new Float32Array(TRAIL_CAPACITY * 2 * 3);
    const trailColors = new Float32Array(TRAIL_CAPACITY * 2 * 4);
    trailGeometry.setAttribute('position', new BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('color', new BufferAttribute(trailColors, 4));
    const indices: number[] = [];
    for (let i = 0; i < TRAIL_CAPACITY - 1; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    trailGeometry.setIndex(indices);
    trailGeometry.setDrawRange(0, 0);
    const trail = new Mesh(trailGeometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));
    trail.frustumCulled = false; // its bounds change every frame
    trail.renderOrder = 1;

    this.scene.add(root, ring, shadow, label, trail);
    if (style.avatarUrl) this.loadAvatar(style.avatarUrl, face);
    return { root, lean, leftSkate, rightSkate, leftArm, rightArm, ring, shadow, label, trail, trailGeometry, trailPositions, trailColors, color, phase: Math.random() * 6, swishTimer: 0, hop: 99, face, bag, bagSack, bagHeads, lastBanked: null };
  }

  /** Puts the player's profile picture on their skater's face once it has downloaded (a plain face until then, or if it fails). */
  private loadAvatar(url: string, material: MeshStandardMaterial) {
    this.textureLoader.load(url, (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      this.disposables.push(texture);
      material.color.set('#ffffff'); // show the picture's own colours
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, () => {});
  }

  private makePenguin(): PenguinVisual {
    const root = new Group();
    const body = new Group(); // everything that waddles
    root.add(body);
    const torso = new Mesh(this.penguinBody, this.materials.dark);
    torso.scale.set(0.95, 1.25, 0.8);
    torso.position.y = 0.95;
    const belly = new Mesh(this.penguinBody, this.materials.white);
    belly.scale.set(0.75, 1.05, 0.5);
    belly.position.set(0, 0.92, 0.28);
    const head = new Mesh(this.penguinHead, this.materials.dark);
    head.position.set(0, 1.98, 0.02);
    const beak = new Mesh(this.beak, this.materials.orange);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 1.93, 0.5);
    const leftEye = new Mesh(this.eye, this.materials.white);
    const rightEye = new Mesh(this.eye, this.materials.white);
    leftEye.position.set(-0.17, 2.06, 0.34);
    rightEye.position.set(0.17, 2.06, 0.34);
    const pupilL = new Mesh(this.eye, this.materials.eye);
    const pupilR = new Mesh(this.eye, this.materials.eye);
    pupilL.scale.setScalar(0.55);
    pupilR.scale.setScalar(0.55);
    pupilL.position.set(-0.17, 2.06, 0.4);
    pupilR.position.set(0.17, 2.06, 0.4);
    const leftFlipper = new Mesh(this.flipper, this.materials.dark);
    const rightFlipper = new Mesh(this.flipper, this.materials.dark);
    leftFlipper.position.set(-0.68, 1.1, 0);
    rightFlipper.position.set(0.68, 1.1, 0);
    leftFlipper.rotation.z = 0.35;
    rightFlipper.rotation.z = -0.35;
    const leftFoot = new Mesh(this.foot, this.materials.orange);
    const rightFoot = new Mesh(this.foot, this.materials.orange);
    leftFoot.position.set(-0.28, 0.05, 0.12);
    rightFoot.position.set(0.28, 0.05, 0.12);
    body.add(torso, belly, head, beak, leftEye, rightEye, pupilL, pupilR, leftFlipper, rightFlipper, leftFoot, rightFoot);
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.setScalar(0.85);
    this.scene.add(root, shadow);
    return { root, body, shadow, phase: Math.random() * 6, catch: null };
  }

  // ---------- per frame ----------

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    const aspect = width / height;
    this.zoom = aspect < 1 ? Math.min(1.7, 1 + (1 - aspect) * 0.8) : 1; // portrait phones see less sideways: step back
    this.camera.updateProjectionMatrix();
    this.flecks.setViewport(height * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** Where everything should be drawn at time `t`, blended from the two snapshots around it (skaters also coast briefly past the newest). */
  private sample(t: number): { skaters: Record<string, SkaterPose>; penguins: Map<number, PenguinPose> } | null {
    const snaps = this.snapshots;
    if (snaps.length === 0) return null;
    const last = snaps[snaps.length - 1];
    if (t >= last.t) {
      const seconds = Math.min(t - last.t, MAX_EXTRAPOLATE_MS) / 1000;
      const skaters: Record<string, SkaterPose> = {};
      for (const [id, s] of Object.entries(last.skaters)) skaters[id] = { ...s, x: s.x + s.vx * seconds, z: s.z + s.vz * seconds };
      return { skaters, penguins: last.penguins };
    }
    if (t <= snaps[0].t) return snaps[0];
    let i = 0;
    while (snaps[i + 1].t < t) i++;
    const [from, to] = [snaps[i], snaps[i + 1]];
    const alpha = (t - from.t) / (to.t - from.t);
    const skaters: Record<string, SkaterPose> = {};
    for (const [id, b] of Object.entries(to.skaters)) {
      const a = from.skaters[id];
      skaters[id] = a ? { ...b, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha } : b;
    }
    const penguins = new Map<number, PenguinPose>();
    for (const [id, b] of to.penguins) {
      const a = from.penguins.get(id);
      if (!a) { penguins.set(id, b); continue; }
      const turn = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)); // shortest way round
      penguins.set(id, { ...b, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, heading: a.heading + turn * alpha });
    }
    return { skaters, penguins };
  }

  private frame = (time: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    audio.setListener(this.rig.focusX, this.rig.focusZ); // you hear from where the camera is looking

    const sampled = this.sample(time - INTERP_DELAY_MS);
    const poses = sampled?.skaters ?? null;
    if (sampled && this.latest) {
      for (const id of [...this.skaters.keys()]) if (!(id in sampled.skaters)) this.removeSkater(id); // a player left
      for (const [id, pose] of Object.entries(sampled.skaters)) {
        const v = this.skaters.get(id) ?? this.addSkater(id);
        this.updateSkater(v, pose, dt);
        this.updateBag(v, this.latest.skaters[id]?.carried ?? 0, dt);
        this.updateTrail(v, pose, this.latest.skaters[id]);
      }
      this.updatePenguins(sampled.penguins, sampled.skaters, dt, time);
    }
    this.updateEffects(dt);
    // Camera: follow a skater, or fly the free camera (see SpectatorRig). Size 1: the follow view doesn't depend on size.
    const followed = this.view.targetId && poses ? poses[this.view.targetId] : undefined;
    this.rig.update(dt, this.view.mode, followed && { x: followed.x, y: 0, z: followed.z, size: 1 }, this.pan.current, this.zoom);
    this.flecks.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private addSkater(id: string): SkaterVisual {
    const v = this.makeSkater(id);
    this.skaters.set(id, v);
    return v;
  }

  private removeSkater(id: string) {
    const v = this.skaters.get(id);
    if (!v) return;
    this.scene.remove(v.root, v.ring, v.shadow, v.label, v.trail);
    v.trailGeometry.dispose();
    this.skaters.delete(id);
  }

  /** Positions, turns and animates one skater: faces where it is going, leans into speed, strides, swings its arms, and swishes. */
  private updateSkater(v: SkaterVisual, pose: SkaterPose, dt: number) {
    const speed = Math.hypot(pose.vx, pose.vz);
    if (speed > 0.5) v.root.rotation.y += Math.atan2(Math.sin(Math.atan2(pose.vx, pose.vz) - v.root.rotation.y), Math.cos(Math.atan2(pose.vx, pose.vz) - v.root.rotation.y)) * Math.min(1, 10 * dt); // turn smoothly
    v.hop += dt;
    const hopLift = v.hop < 0.5 ? 1.1 * 4 * (v.hop / 0.5) * (1 - v.hop / 0.5) : 0; // a little jump of joy after a catch
    v.root.position.set(pose.x, hopLift, pose.z);
    v.ring.position.set(pose.x, 0.05, pose.z);
    v.shadow.position.set(pose.x, 0.03, pose.z);
    v.shadow.scale.setScalar(1 - 0.25 * Math.min(1, hopLift));
    v.label.position.set(pose.x, 3.9 + hopLift, pose.z);
    v.lean.rotation.x = Math.min(0.35, speed / 30); // lean forward into the glide

    // Stride: alternate the skates forwards and back, faster with speed, and swing the arms opposite.
    v.phase += dt * (2 + speed * 0.9);
    const stride = Math.sin(v.phase) * Math.min(1, speed / 6) * 0.45;
    v.leftSkate.position.z = stride;
    v.rightSkate.position.z = -stride;
    v.leftArm.rotation.x = -stride * 1.2;
    v.rightArm.rotation.x = stride * 1.2;

    // The sound of the blades, quieter when slow, played where the skater is (you hear nearby skaters, not far ones).
    if (speed > 1.5) {
      v.swishTimer -= dt;
      if (v.swishTimer <= 0) {
        const strength = Math.min(1, speed / 10);
        audio.play(skateSwish, pose.x, pose.z, 0.1 + 0.2 * strength, strength);
        v.swishTimer = (SKATE_SOUND_EVERY + 0.25 * (1 - strength)) * (0.8 + Math.random() * 0.4);
      }
    }
  }

  /** The bag on the skater's back: hidden when empty, and bigger (with more heads showing) the more penguins are in it. */
  private updateBag(v: SkaterVisual, carried: number, dt: number) {
    v.bag.visible = carried > 0 || v.bag.scale.x > 0.05;
    const wanted = carried > 0 ? 0.85 + Math.min(carried, 8) * 0.1 : 0.01;
    v.bag.scale.setScalar(v.bag.scale.x + (wanted - v.bag.scale.x) * Math.min(1, 10 * dt)); // grows and shrinks smoothly
    v.bagSack.scale.set(1, 1.1, 1);
    v.bagHeads.forEach((h, i) => { h.visible = i < carried; });
    v.bag.rotation.z = Math.sin(v.phase * 0.5) * 0.06 * Math.min(1, carried); // sways as they skate
  }

  /**
   * Rebuilds a skater's trail ribbon. The server's trail is up to date, but the skater is drawn ~0.1 s in the past, so the
   * trail is cut where the drawn skater actually is (so it never pokes out in front). The ribbon fades from solid at the
   * skater to nearly gone at its old end: the further back along the trail, the fainter it is.
   */
  private updateTrail(v: SkaterVisual, pose: SkaterPose, server: SkaterView | undefined) {
    if (!server) return;
    const pts = cutTrailAt(server.trail, pose.x, pose.z);
    const n = Math.min(pts.length, TRAIL_CAPACITY);
    if (n < 2) { v.trailGeometry.setDrawRange(0, 0); return; }
    // Distance from the skater along the trail, for the fade.
    const behind = new Array<number>(n).fill(0);
    for (let i = n - 2; i >= 0; i--) behind[i] = behind[i + 1] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const [r, g, b] = [v.color.r * 0.55 + 0.45, v.color.g * 0.55 + 0.45, v.color.b * 0.55 + 0.45]; // the player's colour, lightened towards ice-white
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const [sx, sz] = [-dz * TRAIL_HALF_WIDTH, dx * TRAIL_HALF_WIDTH]; // sideways of the direction of travel
      v.trailPositions.set([pts[i][0] + sx, TRAIL_LIFT, pts[i][1] + sz, pts[i][0] - sx, TRAIL_LIFT, pts[i][1] - sz], i * 6);
      const fade = Math.min(1, behind[i] / this.trailMax); // 0 at the skater, 1 at the longest the trail can be
      const alpha = Math.max(0.04, 0.95 * (1 - fade ** 1.4));
      v.trailColors.set([r, g, b, alpha, r, g, b, alpha], i * 8);
    }
    v.trailGeometry.attributes.position.needsUpdate = true;
    v.trailGeometry.attributes.color.needsUpdate = true;
    v.trailGeometry.setDrawRange(0, (n - 1) * 6);
  }

  /** Poses every penguin: waddle while walking, face the way it walks; a caught one hops into its catcher's arms and is gone. */
  private updatePenguins(poses: Map<number, PenguinPose>, skaters: Record<string, SkaterPose>, dt: number, time: number) {
    for (const [id, pv] of [...this.penguins]) {
      if (!poses.has(id)) { this.scene.remove(pv.root, pv.shadow); this.penguins.delete(id); } // gone from the ice
    }
    for (const [id, pose] of poses) {
      let pv = this.penguins.get(id);
      if (!pv) { pv = this.makePenguin(); this.penguins.set(id, pv); }
      pv.phase += dt * (pose.walking ? 11 : 1.5);
      pv.root.rotation.y = Math.PI / 2 - pose.heading;

      if (pose.caughtBy && !pv.catch) {
        // Just caught: remember where it was, celebrate there, and start the hop towards the catcher.
        pv.catch = { startedAt: time, from: new Vector3(pose.x, 0, pose.z), by: pose.caughtBy };
        this.celebrate(pose.x, pose.z, pose.caughtBy);
      }
      if (pv.catch) {
        const u = Math.min(1, (time - pv.catch.startedAt) / (CATCH_FLIGHT_SECONDS * 1000));
        const catcher = skaters[pv.catch.by];
        const toX = catcher ? catcher.x : pv.catch.from.x, toZ = catcher ? catcher.z : pv.catch.from.z;
        const x = pv.catch.from.x + (toX - pv.catch.from.x) * u;
        const z = pv.catch.from.z + (toZ - pv.catch.from.z) * u;
        const y = 4.5 * 4 * u * (1 - u) + 1.2 * u; // an arc up and over, ending at the catcher's chest
        pv.root.position.set(x, y, z);
        pv.root.scale.setScalar(Math.max(0.01, 1 - u * u)); // shrinks as it is scooped up
        pv.root.rotation.y += u * 12; // a happy spin
        pv.body.rotation.z = 0;
        pv.shadow.position.set(x, 0.03, z);
        pv.shadow.scale.setScalar(0.85 * (1 - u));
        continue;
      }
      pv.root.position.set(pose.x, 0, pose.z);
      pv.body.rotation.z = pose.walking ? Math.sin(pv.phase) * 0.16 : 0; // the waddle
      pv.body.position.y = pose.walking ? Math.abs(Math.sin(pv.phase)) * 0.12 : 0;
      pv.shadow.position.set(pose.x, 0.03, pose.z);
    }
  }

  /** A catch: sparkles of ice, a chime and a "+1" over the catcher, and the catcher does a little hop. */
  private celebrate(x: number, z: number, by: string) {
    this.flecks.burst(x, 1, z, 1, 0, 0.8, 0.9);
    audio.play(captureChime, x, z, 0.7, 1);
    const catcher = this.skaters.get(by);
    if (catcher) catcher.hop = 0;
    this.floatText('+1', '#ffffff', x, z, 2.2); // into the bag: not points yet, so a plain white +1
  }

  /** Floating text that rises and fades at a place on the ice. */
  private floatText(text: string, color: string, x: number, z: number, size: number) {
    const material = new SpriteMaterial({ map: this.track(makeFloatTexture(text, color)), transparent: true, depthTest: false });
    const sprite = new Sprite(material);
    sprite.scale.set(size * 2, size, 1);
    sprite.renderOrder = 5;
    this.scene.add(sprite);
    this.pluses.push({ sprite, age: 0, x, z });
  }

  /** Someone's score went up: they cashed in at their igloo. Chime, sparkles and a big gold "+N" over the igloo. */
  private checkCashIns(view: PenguinLassoView) {
    for (const [id, s] of Object.entries(view.skaters)) {
      const v = this.skaters.get(id);
      if (!v) continue;
      if (v.lastBanked !== null && s.banked > v.lastBanked) {
        const igloo = view.igloos[id];
        if (igloo) {
          this.flecks.burst(igloo.x, 2.5, igloo.z, 1, 0, 1.2, 1.4);
          audio.play(cashIn, igloo.x, igloo.z, 0.9, 1);
          this.floatText(`+${s.banked - v.lastBanked}`, '#ffd84a', igloo.x, igloo.z, 3.2);
          v.hop = 0;
        }
      }
      v.lastBanked = s.banked;
    }
  }

  /** Builds every player's igloo: a white dome with a dark doorway facing the middle of the rink, a flag in their colour, and a ring on the ice marking the cash-in zone. */
  private buildIgloos(view: PenguinLassoView) {
    this.iglooBuilt = true;
    const [dome, tunnel, ringShape] = this.iglooGeometries;
    for (const [id, spot] of Object.entries(view.igloos)) {
      const color = this.styles[id]?.color ?? '#ffffff';
      const group = new Group();
      const body = new Mesh(dome, this.materials.igloo);
      body.scale.set(view.iglooRadius, view.iglooRadius * 0.8, view.iglooRadius);
      const entrance = new Group(); // a short tunnel (half a cylinder lying on its side) out of the front
      const tube = new Mesh(tunnel, this.materials.igloo);
      tube.scale.set(view.iglooRadius * 0.45, view.iglooRadius * 0.9, view.iglooRadius * 0.45);
      tube.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      const door = new Mesh(this.faceDisc, this.materials.iglooDark); // the dark doorway
      door.scale.setScalar(view.iglooRadius * 0.4);
      door.position.set(0, view.iglooRadius * 0.28, view.iglooRadius * 0.46);
      entrance.add(tube, door);
      entrance.position.set(0, 0, view.iglooRadius * 0.85);
      const pole = new Mesh(this.iglooFlagGeometry, this.materials.rope);
      pole.scale.set(0.5, 1.6, 0.2);
      pole.position.set(0, view.iglooRadius * 0.8 + 0.7, 0);
      const flag = new Mesh(this.iglooFlagGeometry, this.track(new MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 })));
      flag.scale.set(0.3, 0.8, 1.3);
      flag.position.set(0, view.iglooRadius * 0.8 + 1.1, 0.6);
      group.add(body, entrance, pole, flag);
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = Math.atan2(-spot.x, -spot.z); // the doorway faces the middle of the rink
      const zone = new Mesh(ringShape, this.track(new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.55, depthWrite: false })));
      zone.rotation.x = -Math.PI / 2;
      zone.scale.setScalar(view.cashRadius);
      zone.position.set(spot.x, 0.05, spot.z);
      const fill = new Mesh(this.iglooFillGeometry(), this.track(new MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false })));
      fill.rotation.x = -Math.PI / 2;
      fill.scale.setScalar(view.cashRadius);
      fill.position.set(spot.x, 0.045, spot.z);
      this.scene.add(group, zone, fill);
    }
  }

  private iglooFillGeometry() {
    return this.track(new CircleGeometry(1, 48));
  }

  /** A closed loop: flash the area it enclosed in the skater's colour, fading out (a loop with nothing in it gets a soft "zip"). */
  private newLoops(loops: LoopView[]) {
    for (const loop of loops) {
      if (this.seenLoops.has(loop.id)) continue;
      this.seenLoops.add(loop.id);
      const color = this.styles[loop.playerId]?.color ?? '#ffffff';
      const shape = new Shape();
      loop.points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z))); // (the shape's y is the ground's -z once laid flat)
      const geometry = new ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      mesh.position.y = 0.06;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.flashes.push({ mesh, material, age: 0 });
      // Did it catch anything? The catch itself plays its own chime; an empty loop just zips shut.
      const caught = this.latest?.penguins.some((p) => p.caughtBy === loop.playerId && insideLoop(p.x, p.z, loop.points));
      if (!caught) {
        const [cx, cz] = loop.points.reduce(([ax, az], [x, z]) => [ax + x / loop.points.length, az + z / loop.points.length], [0, 0]);
        audio.play(loopMiss, cx, cz, 0.35, 1);
      }
    }
    if (this.seenLoops.size > 200) this.seenLoops = new Set([...this.seenLoops].slice(-50)); // never grows forever
  }

  /** Ages and removes the loop flashes and "+1" labels. */
  private updateEffects(dt: number) {
    for (const f of [...this.flashes]) {
      f.age += dt;
      f.material.opacity = 0.55 * Math.max(0, 1 - f.age / LOOP_FLASH_SECONDS);
      if (f.age >= LOOP_FLASH_SECONDS) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.material.dispose();
        this.flashes.splice(this.flashes.indexOf(f), 1);
      }
    }
    for (const p of [...this.pluses]) {
      p.age += dt;
      const u = p.age / PLUS_ONE_SECONDS;
      p.sprite.position.set(p.x, 3 + u * 3, p.z); // floats up
      p.sprite.material.opacity = Math.max(0, 1 - u * u);
      if (u >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.pluses.splice(this.pluses.indexOf(p), 1);
      }
    }
  }
}

// ---------- helpers ----------

/**
 * The server's trail, cut at the skater's drawn position: the trail runs up to the point nearest the skater (searching
 * the newest stretch of it), and ends exactly at the skater, so the ribbon always ends under the skater's feet.
 */
function cutTrailAt(trail: [number, number][], x: number, z: number): [number, number][] {
  if (trail.length < 2) return trail;
  let bestIndex = trail.length - 2;
  let bestPoint: [number, number] = trail[trail.length - 1];
  let bestDist = Infinity;
  for (let i = trail.length - 2; i >= Math.max(0, trail.length - 14); i--) {
    const [ax, az] = trail[i], [bx, bz] = trail[i + 1];
    const sx = bx - ax, sz = bz - az;
    const len2 = sx * sx + sz * sz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / len2));
    const px = ax + t * sx, pz = az + t * sz;
    const d = Math.hypot(px - x, pz - z);
    if (d < bestDist - 1e-6) { bestDist = d; bestIndex = i; bestPoint = [px, pz]; }
  }
  return [...trail.slice(0, bestIndex + 1), bestPoint, [x, z]];
}

/** Point-in-polygon (for the empty-loop sound; the server decided the real catches). */
function insideLoop(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Tileable pale-blue ice with faint white scratches and a few darker cracks, drawn on a canvas at runtime. */
function makeIceTexture(): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#cde5f7'; // one flat colour: a gradient would show seams where the texture tiles
  g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) { // scratches from old skating
    g.strokeStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 0.5 + Math.random() * 1.2;
    const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI, l = 10 + Math.random() * 50;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { // drawn wrapped so the texture tiles seamlessly
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); g.stroke();
    }
  }
  for (let i = 0; i < 6; i++) { // a few faint cracks
    g.strokeStyle = 'rgba(120,160,200,0.22)';
    g.lineWidth = 1;
    let x = Math.random() * size, y = Math.random() * size;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Some text (like "+1") in a colour with a dark outline, as a picture for a floating label. */
function makeFloatTexture(text: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.font = 'bold 96px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = '#14142a';
  g.strokeText(text, 128, 66);
  g.fillStyle = color;
  g.fillText(text, 128, 66);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
