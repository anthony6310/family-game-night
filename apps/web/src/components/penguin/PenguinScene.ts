import {
  BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group,
  HemisphereLight, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PerspectiveCamera,
  RepeatWrapping, RingGeometry, Scene, Shape, ShapeGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader, TorusGeometry,
  Vector3, WebGLRenderer, BoxGeometry, ConeGeometry, SphereGeometry, LatheGeometry, Vector2, AdditiveBlending, Float32BufferAttribute, ExtrudeGeometry,
  type Texture,
} from 'three';
import { CREATURE_POINTS, type CreatureKind, type LoopView, type PenguinLassoView, type SkaterView } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { captureChime, cashIn, loopMiss, skateSwish } from '../../audio/iceSounds';
import type { SoundFn } from '../../audio/snowSounds';
import { SpectatorRig } from '../../spectate/SpectatorRig';
import type { CameraMode } from '../../spectate/useSpectatorCamera';
import { FleckSystem } from '../snowball/effects';
import { HeadKit } from './headKit';
import { createNameTag, disposeNameTag } from '../labelTexture';

/** How a skater is labelled and dressed. */
export interface SkaterStyle {
  name: string;
  color: string; // the parka, the ring under the skater, the trail and the name tag
  avatarUrl: string | null; // (not used by this model: the eskimo's face is black with glowing eyes. Kept so another place can show it.)
}

interface SkaterPose { x: number; z: number; vx: number; vz: number }
interface PenguinPose { kind: CreatureKind; x: number; z: number; heading: number; walking: boolean; caughtBy?: string }
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
// Just ONE head pokes out of the sack, whatever is inside (the head of the most valuable animal): how many are inside shows in how BIG the sack is.
/**
 * The sack grows with every penguin in it, by the SAME amount each time, in even steps from the size it has with ONE
 * animal (BAG_FIRST_SIZE) up to BAG_MAX_SIZE, which it reaches exactly when the bag is full (the server's bagCapacity, 6). That is about
 * 0.95, 1.4, 1.8, 2.2, 2.6, 3.0 times the sack's normal size for 1 to 6 animals. The cap is there so a very full sack stays funny rather than
 * covering the screen or hiding the skater from its own camera.
 */
/** How big each head is when it pokes out of the sack (before it is shrunk to stay head-sized on a big sack): a bear's head is bigger, so it is scaled down more. */
const SACK_HEAD_SCALE: Record<CreatureKind, number> = { penguin: 0.75, seal: 0.7, bear: 0.52 };
const BAG_FIRST_SIZE = 0.95;
const BAG_MAX_SIZE = 3;

const SKATE_SOUND_EVERY = 0.3; // seconds between swishes at full speed

interface SkaterVisual {
  root: Group; // moves and turns (faces where it is going)
  lean: Group; // the body, tilted forward with speed
  leftSkate: Mesh; rightSkate: Mesh;
  ring: Mesh; shadow: Mesh; label: Sprite;
  trail: Mesh; trailGeometry: BufferGeometry; trailPositions: Float32Array; trailColors: Float32Array;
  color: Color;
  phase: number; // where it is in its skating stride
  swishTimer: number;
  hop: number; // seconds since it caught something (a little jump of joy), large = not hopping
  bag: Group; // the sack on the skater's back that caught animals go into
  bagSack: Mesh;
  bagHeads: Record<CreatureKind, Group>; // the head poking out of the sack: only the one for the most valuable animal inside is shown
  lastBanked: number | null; // their score when last seen (a rise = they just cashed in)
}

interface PenguinVisual {
  root: Group; body: Group; shadow: Mesh;
  phase: number;
  kind: CreatureKind;
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
  private iglooBodies = new Map<string, Group>(); // each player's igloo (it grows as they cash in points)
  // The igloo, from the sketch: a wide, flat-topped dome like a loaf, with a low rounded tunnel entrance out of the front. All in units
  // of the igloo's radius (scaled up by the real size when it is built).
  private iglooDome = makeIglooDomeGeometry();
  private iglooTunnel = new ExtrudeGeometry(archShape(0.4), { depth: 0.8, bevelEnabled: false }); // an arch, extruded forward
  private iglooDoor = new ShapeGeometry(archShape(0.26)); // the dark opening in the end of the tunnel
  private iglooRing = new RingGeometry(0.97, 1, 48); // the cash-in zone's edge
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
  private coatGeometry = makeCoatGeometry(true); // the eskimo's coat: a rounded triangle that parts at the front of the hem (see makeCoatGeometry)
  private liningGeometry = makeCoatGeometry(false); // the inside of the coat: the same shape, whole, a little smaller, in black: it shows through where the coat parts
  private faceGeometry = new SphereGeometry(1, 12, 10); // the black face hollow (squashed into shape per use)
  private puffGeometry = new IcosahedronGeometry(1, 1); // one puff of the coat's fur
  private eyeGeometry = new SphereGeometry(1, 10, 8); // an eye: a long oval, squashed into shape
  private bootGeometry = new SphereGeometry(1, 8, 6); // a skate nub
  private furRing = new TorusGeometry(0.5, 0.15, 6, 12); // (the sack's rope)
  private faceDisc = new CircleGeometry(0.4, 16); // (the igloo's doorway)
  private bladeBox = new BoxGeometry(0.07, 0.09, 0.8);
  private glowTexture = makeGlowTexture(); // a soft round glow for behind the eyes
  private ringGeometry = new RingGeometry(1.25, 1.5, 32);
  private shadowGeometry = new CircleGeometry(1.1, 20);
  private penguinBody = new IcosahedronGeometry(0.62, 1);
  private penguinHead = new IcosahedronGeometry(0.4, 1);
  private beak = new ConeGeometry(0.12, 0.34, 6);
  private headKit = new HeadKit(); // the animals' heads
  private penguinTorso = makePenguinTorsoGeometry(); // a pear-shaped body: widest low down (see makePenguinTorsoGeometry)
  private foot = new CylinderGeometry(0.3, 0.3, 0.06, 3); // a flat webbed foot: a triangle with one corner (the toes) pointing forward
  private materials = {
    dark: new MeshStandardMaterial({ color: '#1e2a47', flatShading: true, roughness: 0.8 }),
    white: new MeshStandardMaterial({ color: '#f6fbff', flatShading: true, roughness: 0.9 }),
    orange: new MeshStandardMaterial({ color: '#ff9a1f', flatShading: true, roughness: 0.7 }),
    fur: new MeshStandardMaterial({ color: '#fffaf0', flatShading: true, roughness: 1 }),
    steel: new MeshStandardMaterial({ color: '#cfd8e3', flatShading: true, roughness: 0.3, metalness: 0.6 }),
    boot: new MeshStandardMaterial({ color: '#4a3426', flatShading: true, roughness: 0.9 }),
    hollow: new MeshStandardMaterial({ color: '#05060a', roughness: 1 }), // the black inside of the coat: the face and the opening down the front
    eyeGlow: new MeshBasicMaterial({ color: '#fff2a6' }), // the eyes: light yellow, unaffected by the lighting so they always glow
    coatInside: new MeshStandardMaterial({ color: '#05060a', roughness: 1, flatShading: true }),
    sealBody: new MeshStandardMaterial({ color: '#7f93a8', flatShading: true, roughness: 0.8 }),
    sealBelly: new MeshStandardMaterial({ color: '#cbd8e4', flatShading: true, roughness: 0.8 }),
    bearFur: new MeshStandardMaterial({ color: '#eef3f8', flatShading: true, roughness: 1 }),
    bearMuzzle: new MeshStandardMaterial({ color: '#f7eedb', flatShading: true, roughness: 1 }),
    nose: new MeshStandardMaterial({ color: '#0b0d14', roughness: 0.6 }),
    patch: new MeshStandardMaterial({ color: '#2a2f3a', roughness: 1 }), // the dark patch the bear's eyes sit on
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
      this.iglooDome, this.iglooTunnel, this.iglooDoor, this.iglooRing, this.bagGeometry, this.iglooFlagGeometry,
      this.renderer, this.flecks, this.headKit, this.coatGeometry, this.liningGeometry, this.faceGeometry, this.puffGeometry, this.eyeGeometry, this.bootGeometry, this.glowTexture, this.furRing, this.faceDisc, this.bladeBox,
      this.ringGeometry, this.shadowGeometry, this.penguinBody, this.penguinTorso, this.penguinHead, this.beak, this.foot,
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
    this.snapshots.push({ t: performance.now(), skaters, penguins: new Map(view.penguins.map((p) => [p.id, { kind: p.kind, x: p.x, z: p.z, heading: p.heading, walking: p.walking, caughtBy: p.caughtBy }])) });
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
    for (const v of this.skaters.values()) { v.trailGeometry.dispose(); v.trail.material instanceof MeshBasicMaterial && v.trail.material.dispose(); }
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

    const root = new Group();
    const lean = new Group();
    root.add(lean);

    // The eskimo is not a person: it is someone hiding inside a BIG COAT. The coat is a rounded triangle in the player's color
    // (wide at the hem, narrow and rounded at the top, and flatter front to back). There are no arms. All you see of whoever is inside
    // is a black hollow for a face with two glowing eyes, framed by the puffy white fur of the hood, and an opening down the front.
    const coat = new Mesh(this.coatGeometry, parka);
    coat.scale.set(1, 1, COAT_DEPTH);
    // The coat PARTS at the front of the hem, like a sweater or jacket that is open at the bottom: a V-shaped opening runs up from
    // the hem to the face. Behind it is the black lining (the same coat, whole, a little smaller), so the gap shows black inside.
    const lining = new Mesh(this.liningGeometry, this.materials.coatInside);
    lining.scale.set(0.93, 1, 0.93 * COAT_DEPTH);
    lean.add(coat, lining);
    // Everything on the front is built in a group that is tilted to follow the slope of the coat's front.
    const frontAt = (y: number) => coatRadiusAt((y - COAT_BASE_Y) / COAT_HEIGHT) * COAT_DEPTH; // how far forward the coat's surface is at height y
    const frontTilt = -Math.atan(COAT_SLOPE * COAT_DEPTH); // the front leans back as it goes up
    const faceY = COAT_BASE_Y + FACE_T * COAT_HEIGHT;
    const face = new Group();
    face.position.set(0, faceY, frontAt(faceY) - 0.04);
    face.rotation.x = frontTilt;
    const hollow = new Mesh(this.faceGeometry, this.materials.hollow); // the black face
    hollow.scale.set(0.46, 0.58, 0.2);
    face.add(hollow);
    // The eyes: long, rounded ovals (like a Bomb-omb's), light yellow, each with a soft glow behind it.
    for (const side of [-1, 1]) {
      const eye = new Mesh(this.eyeGeometry, this.materials.eyeGlow);
      eye.scale.set(0.1, 0.27, 0.05);
      eye.position.set(side * 0.18, 0.06, 0.17);
      const halo = new Sprite(this.track(new SpriteMaterial({ map: this.glowTexture, color: '#fff0a0', blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })));
      halo.scale.set(0.7, 0.9, 1);
      halo.position.set(side * 0.18, 0.06, 0.24);
      face.add(eye, halo);
    }
    // The fur of the hood: a ring of puffy white balls round the top and sides of the face (a fur-trimmed hood, like a fancy coat).
    for (let i = 0; i < FUR_PUFFS; i++) {
      const angle = -0.4 + (i / (FUR_PUFFS - 1)) * (Math.PI + 0.8); // from below the right cheek, over the top, to below the left cheek
      const puff = new Mesh(this.puffGeometry, this.materials.fur);
      puff.scale.setScalar(0.2 + Math.random() * 0.09);
      puff.position.set(Math.cos(angle) * 0.6 + (Math.random() - 0.5) * 0.05, Math.sin(angle) * 0.78 + (Math.random() - 0.5) * 0.05, 0.1 + Math.random() * 0.06);
      face.add(puff);
    }
    lean.add(face);
    // The bag: a lumpy sack on the skater's back. It swells with every penguin caught, and their heads poke out of the top.
    const bag = new Group();
    bag.position.set(0, COAT_BASE_Y + 0.55 * COAT_HEIGHT, -0.95); // on the back of the coat
    const bagSack = new Mesh(this.bagGeometry, this.materials.sack);
    const tie = new Mesh(this.furRing, this.materials.rope); // the rope tied round the neck of the sack
    tie.scale.setScalar(0.55);
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.5;
    bag.add(bagSack, tie);
    // One head for each kind of animal, all facing BACKWARD (out of the back of the skater, the way the sack faces); only the one
    // for the most valuable animal in the bag is shown (see updateBag).
    const bagHeads = {} as Record<CreatureKind, Group>;
    for (const kind of ['penguin', 'seal', 'bear'] as const) {
      const head = this.buildHead(kind);
      head.rotation.y = Math.PI; // facing back
      head.position.set(0, 0.62, 0);
      head.scale.setScalar(SACK_HEAD_SCALE[kind]);
      head.visible = false;
      bag.add(head);
      bagHeads[kind] = head;
    }
    bag.visible = false;
    lean.add(bag);

    // The legs are just little nubs (a skate each) that float under the coat, with a gap between.
    const makeSkate = (x: number) => {
      const boot = new Mesh(this.bootGeometry, this.materials.boot);
      boot.scale.set(0.26, 0.2, 0.4);
      const blade = new Mesh(this.bladeBox, this.materials.steel);
      blade.scale.set(1 / 0.26, 1 / 0.2, 1 / 0.4); // (undo the nub's squashing so the blade keeps its own shape)
      blade.position.set(0, -0.26, 0); // under the nub
      boot.add(blade);
      boot.position.set(x, 0.3, 0);
      root.add(boot);
      return boot;
    };
    const leftSkate = makeSkate(-0.45);
    const rightSkate = makeSkate(0.45);

    const ring = new Mesh(this.ringGeometry, this.track(new MeshBasicMaterial({ color: style.color, side: DoubleSide, transparent: true, opacity: 0.95 })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    const label = createNameTag(style.name, style.color); // on the top layer: the sack (or anything else) can never clip into it
    this.track({ dispose: () => disposeNameTag(label) });
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
    return { root, lean, leftSkate, rightSkate, ring, shadow, label, trail, trailGeometry, trailPositions, trailColors, color, phase: Math.random() * 6, swishTimer: 0, hop: 99, bag, bagSack, bagHeads, lastBanked: null };
  }

  private makePenguin(): PenguinVisual {
    const root = new Group();
    const body = new Group(); // everything that waddles
    root.add(body);
    // A penguin built from the sketches: a big pear-shaped body, a separate wide round head, an orange beak,
    // flat webbed feet, and two light-yellow oval eyes (like the eskimo's) on its face. Everything faces +z.
    const torso = new Mesh(this.penguinTorso, this.materials.dark);
    torso.scale.set(1, 1, 0.85); // flatter front to back than it is wide
    const belly = new Mesh(this.penguinBody, this.materials.white); // the pale front
    belly.scale.set(0.8, 1.2, 0.5);
    belly.position.set(0, 0.88, 0.42);
    const head = this.buildHead('penguin');
    head.position.set(0, 2.0, 0.04);
    body.add(torso, belly, head);
    // Feet: flat triangles at the bottom, toes pointing forward and turned out a little, like the sketch.
    for (const side of [-1, 1]) {
      const foot = new Mesh(this.foot, this.materials.orange);
      foot.position.set(side * 0.36, 0.05, 0.32);
      foot.rotation.y = side * 0.4;
      foot.scale.set(1, 1, 1.25);
      body.add(foot);
    }
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.setScalar(0.85);
    this.scene.add(root, shadow);
    return { root, body, shadow, phase: Math.random() * 6, kind: 'penguin', catch: null };
  }

  /** The head of each kind of animal (see HeadKit): the same heads are used on the full animals, in the sack and in the bag display on the screen. */
  private buildHead(kind: CreatureKind): Group {
    return this.headKit.build(kind);
  }

  /** A seal: a long, low, rounded body on its belly with a round head, two short front flippers and a pair of tail flippers. Faces +z. */
  private makeSeal(): PenguinVisual {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const oval = (material: MeshStandardMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0) => {
      const mesh = new Mesh(this.faceGeometry, material);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      body.add(mesh);
    };
    oval(this.materials.sealBody, 0.85, 0.78, 1.55, 0, 0.78, 0); // the long body
    oval(this.materials.sealBelly, 0.7, 0.5, 1.35, 0, 0.55, 0.1); // the pale underside
    const head = this.buildHead('seal');
    head.position.set(0, 1.15, 1.35);
    head.rotation.x = -0.3; // head held up
    body.add(head);
    for (const side of [-1, 1]) {
      oval(this.materials.sealBody, 0.48, 0.08, 0.26, side * 0.95, 0.3, 0.55, side * 0.7); // a front flipper, resting on the ice
      oval(this.materials.sealBody, 0.36, 0.08, 0.3, side * 0.3, 0.28, -1.6, side * 0.5); // half of the tail
    }
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.set(1.2, 1.2, 1.2);
    this.scene.add(root, shadow);
    return { root, body, shadow, phase: Math.random() * 6, kind: 'seal', catch: null };
  }

  /** A polar bear: bigger than the eskimo. A big white body on four thick legs, a hump of shoulders, a big head with a cream muzzle and round ears. Faces +z. */
  private makeBear(): PenguinVisual {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const oval = (material: MeshStandardMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const mesh = new Mesh(this.faceGeometry, material);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      body.add(mesh);
    };
    oval(this.materials.bearFur, 1.2, 1.1, 1.75, 0, 2.0, -0.1); // the body
    oval(this.materials.bearFur, 1.0, 0.8, 0.9, 0, 2.45, 0.85); // the shoulder hump
    for (const z of [-1, 1]) for (const side of [-1, 1]) {
      oval(this.materials.bearFur, 0.42, 1.05, 0.46, side * 0.68, 1.0, z * 0.95); // four thick legs
      oval(this.materials.bearMuzzle, 0.46, 0.18, 0.55, side * 0.68, 0.14, z * 0.95 + 0.12); // and their paws
    }
    oval(this.materials.bearFur, 0.28, 0.28, 0.28, 0, 2.35, -1.8); // a little round tail
    const head = this.buildHead('bear');
    head.position.set(0, 2.75, 1.75);
    body.add(head);
    const shadow = new Mesh(this.shadowGeometry, this.materials.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.set(1.9, 1.9, 1.9);
    this.scene.add(root, shadow);
    return { root, body, shadow, phase: Math.random() * 6, kind: 'bear', catch: null };
  }

  private makeCreature(kind: CreatureKind): PenguinVisual {
    return kind === 'seal' ? this.makeSeal() : kind === 'bear' ? this.makeBear() : this.makePenguin();
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
        const mine = this.latest.skaters[id];
        this.updateBag(v, mine?.carriedSpace ?? 0, mine?.topCarried ?? null, this.latest.bagCapacity, dt);
        this.updateTrail(v, pose, this.latest.skaters[id]);
      }
      this.updatePenguins(sampled.penguins, sampled.skaters, dt, time);
    }
    this.updateEffects(dt);
    this.updateIgloos(dt);
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
    // The name floats above the top of the coat, or above the top of the sack when that is higher (a big sack). It is also drawn on the
    // top layer, so even where they overlap nothing can cut into it.
    const bagTop = v.bag.visible ? v.bag.position.y + 0.66 * v.bag.scale.x + 0.9 : 0;
    v.label.position.set(pose.x, Math.max(COAT_BASE_Y + COAT_HEIGHT + 1.05, bagTop) + hopLift, pose.z);
    v.lean.rotation.x = Math.min(0.35, speed / 30); // lean forward into the glide

    // Stride: alternate the skates forwards and back, faster with speed, and swing the arms opposite.
    v.phase += dt * (2 + speed * 0.9);
    const stride = Math.sin(v.phase) * Math.min(1, speed / 6) * 0.45;
    v.leftSkate.position.z = stride;
    v.rightSkate.position.z = -stride;
    v.lean.rotation.z = Math.sin(v.phase) * Math.min(1, speed / 8) * 0.07; // the coat sways from side to side as it skates (no arms to swing)

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

  /** The bag on the skater's back: hidden when empty, and bigger (with more heads showing) the more space the animals in it take up. */
  /**
   * The sack. Its size is in proportion to how much SPACE the animals inside take up (a penguin or seal 1, a polar bear 3), in even steps
   * from the one-space size up to BAG_MAX_SIZE when all the bag's spaces are used. The head poking out is the one for the most valuable
   * animal inside, facing backwards.
   */
  private updateBag(v: SkaterVisual, space: number, top: CreatureKind | null, capacity: number, dt: number) {
    v.bag.visible = space > 0 || v.bag.scale.x > 0.05;
    const wanted = space <= 0 ? 0.01 : BAG_FIRST_SIZE + (BAG_MAX_SIZE - BAG_FIRST_SIZE) * Math.min(1, (space - 1) / Math.max(1, capacity - 1));
    const size = v.bag.scale.x + (wanted - v.bag.scale.x) * Math.min(1, 10 * dt); // grows and shrinks smoothly
    v.bag.scale.setScalar(size);
    v.bagSack.scale.set(1, 1.1, 1);
    // A big sack hangs further back and rides higher on the skater's back (it must not sink into the ice or into the coat).
    v.bag.position.set(0, Math.max(COAT_BASE_Y + 0.55 * COAT_HEIGHT, 0.15 + 0.7 * size), -(0.45 + 0.6 * size));
    // Only one head shows. It grows much more slowly than the sack, so the sack looks huge and the head stays a head.
    for (const kind of ['penguin', 'seal', 'bear'] as const) {
      const head = v.bagHeads[kind];
      head.visible = space > 0 && kind === top;
      head.scale.setScalar(SACK_HEAD_SCALE[kind] / Math.max(1, size) ** 0.7);
    }
    v.bag.rotation.z = Math.sin(v.phase * 0.5) * 0.06 * Math.min(1, space); // sways as they skate
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
    const [r, g, b] = [v.color.r * 0.55 + 0.45, v.color.g * 0.55 + 0.45, v.color.b * 0.55 + 0.45]; // the player's color, lightened towards ice-white
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
      if (!pv) { pv = this.makeCreature(pose.kind); this.penguins.set(id, pv); }
      pv.phase += dt * (pose.walking ? (pv.kind === 'bear' ? 6 : 11) : 1.5);
      pv.root.rotation.y = Math.PI / 2 - pose.heading;

      if (pose.caughtBy && !pv.catch) {
        // Just caught: remember where it was, celebrate there, and start the hop towards the catcher.
        pv.catch = { startedAt: time, from: new Vector3(pose.x, 0, pose.z), by: pose.caughtBy };
        this.celebrate(pose.x, pose.z, pose.caughtBy, pose.kind);
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
      if (pv.kind === 'seal') {
        // A seal slides: it stretches a little and lifts its head while it shoots along, and just breathes while it pauses.
        pv.body.rotation.x = pose.walking ? -0.1 : 0;
        pv.body.rotation.z = pose.walking ? Math.sin(pv.phase * 0.6) * 0.05 : 0;
        pv.body.scale.set(pose.walking ? 0.94 : 1 + Math.sin(pv.phase) * 0.012, 1, pose.walking ? 1.1 : 1);
        pv.body.position.y = 0;
      } else if (pv.kind === 'bear') {
        // A bear lumbers: a slow, heavy sway and bob.
        pv.body.rotation.z = pose.walking ? Math.sin(pv.phase) * 0.045 : 0;
        pv.body.position.y = pose.walking ? Math.abs(Math.sin(pv.phase)) * 0.1 : 0;
      } else {
        pv.body.rotation.z = pose.walking ? Math.sin(pv.phase) * 0.16 : 0; // the penguin's waddle
        pv.body.position.y = pose.walking ? Math.abs(Math.sin(pv.phase)) * 0.12 : 0;
      }
      pv.shadow.position.set(pose.x, 0.03, pose.z);
    }
  }

  /** A catch: sparkles of ice, a chime and a "+N" (what the animal is worth) over the catch, and the catcher does a little hop. Bigger animals make a bigger fuss. */
  private celebrate(x: number, z: number, by: string, kind: CreatureKind) {
    const points = CREATURE_POINTS[kind];
    this.flecks.burst(x, 1, z, 1, 0, 0.6 + 0.3 * points, 0.7 + 0.4 * points);
    audio.play(captureChime, x, z, 0.6 + 0.1 * points, 1);
    const catcher = this.skaters.get(by);
    if (catcher) catcher.hop = 0;
    // Into the bag: not points yet, so the color is not the gold of a cash-in. A penguin is white, a seal light blue, a bear warm yellow.
    this.floatText(`+${points}`, kind === 'bear' ? '#ffe08a' : kind === 'seal' ? '#9fdcff' : '#ffffff', x, z, 1.8 + 0.5 * points);
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

  /**
   * Builds every player's igloo, from the sketch: a wide dome with a flat-ish rounded top (like a loaf) and a low, rounded tunnel
   * entrance out of the front, whose end is a dark opening ringed in white. It faces the middle of the rink, has a flag in the
   * player's color on top, and a ring on the ice marking the cash-in zone. It GROWS with its owner's points (see updateIgloos).
   */
  private buildIgloos(view: PenguinLassoView) {
    this.iglooBuilt = true;
    const R = view.iglooRadius;
    for (const [id, spot] of Object.entries(view.igloos)) {
      const color = this.styles[id]?.color ?? '#ffffff';
      const group = new Group();
      const dome = new Mesh(this.iglooDome, this.materials.igloo);
      dome.scale.setScalar(R);
      const tunnel = new Mesh(this.iglooTunnel, this.materials.igloo);
      tunnel.scale.setScalar(R);
      tunnel.position.z = 0.6 * R; // from inside the dome out to 1.4 radii: a short stub, like the side view
      const door = new Mesh(this.iglooDoor, this.materials.iglooDark);
      door.scale.setScalar(R);
      door.position.z = 1.4 * R + 0.02; // on the end of the tunnel, so the white edge of the tunnel rings it
      const pole = new Mesh(this.iglooFlagGeometry, this.materials.rope);
      pole.scale.set(0.5, 1.6, 0.2);
      pole.position.set(0, 0.9 * R + 0.65, 0);
      const flag = new Mesh(this.iglooFlagGeometry, this.track(new MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 })));
      flag.scale.set(9, 0.8, 0.5); // a small square flag, wide enough to show from the front (the entrance side) and still show from the side
      flag.position.set(0.5, 0.9 * R + 1.1, 0);
      group.add(dome, tunnel, door, pole, flag);
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = Math.atan2(-spot.x, -spot.z); // the entrance faces the middle of the rink
      this.iglooBodies.set(id, group);
      const zone = new Mesh(this.iglooRing, this.track(new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.55, depthWrite: false })));
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

  /** Every igloo eases to the size the server says it is: bigger with every point its owner has cashed in. */
  private updateIgloos(dt: number) {
    if (!this.latest) return;
    for (const [id, group] of this.iglooBodies) {
      const wanted = this.latest.igloos[id]?.scale ?? 1;
      group.scale.setScalar(group.scale.x + (wanted - group.scale.x) * Math.min(1, 6 * dt));
    }
  }

  private iglooFillGeometry() {
    return this.track(new CircleGeometry(1, 48));
  }

  /** A closed loop: flash the area it enclosed in the skater's color, fading out (a loop with nothing in it gets a soft "zip"). */
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

// ---------- the igloo ----------

/** The igloo's dome, as a surface of revolution of a loaf-shaped outline: nearly vertical sides, rounded shoulders, a flat-ish top. Radius 1, height 0.9. */
function makeIglooDomeGeometry(): LatheGeometry {
  const outline: [number, number][] = [ // [radius, height]
    [1, 0], [1, 0.2], [0.97, 0.45], [0.88, 0.68], [0.7, 0.82], [0.42, 0.89], [0.001, 0.9],
  ];
  return new LatheGeometry(outline.map(([r, y]) => new Vector2(r, y)), 14);
}

/** An arch: a half circle of radius `r` standing on the ground (flat side down). Used for the igloo's tunnel and its doorway. */
function archShape(r: number): Shape {
  const shape = new Shape();
  shape.moveTo(r, 0);
  shape.absarc(0, 0, r, 0, Math.PI, false);
  shape.lineTo(r, 0);
  return shape;
}

// ---------- the penguin's body ----------

/** The penguin's body: an outline turned round into a pear, widest low down and narrowing up to the neck, with a rounded top. Flat low-poly facets. */
function makePenguinTorsoGeometry(): LatheGeometry {
  const outline: [number, number][] = [ // [radius, height]
    [0.001, 0.08], [0.4, 0.12], [0.66, 0.4], [0.74, 0.8], [0.68, 1.2], [0.52, 1.55], [0.32, 1.78], [0.001, 1.86],
  ];
  return new LatheGeometry(outline.map(([r, y]) => new Vector2(r, y)), 12);
}

// ---------- the eskimo's coat ----------

const COAT_BASE_Y = 0.55; // the hem floats this far above the ice (the skate nubs are under it)
const COAT_HEIGHT = 2.2; // (was 2.9: shorter, so it looks stockier and less long and thin)
const COAT_RADIUS = 1.55; // at the hem
const COAT_DEPTH = 0.68; // the coat is this much shallower front to back than it is wide, so from the side it is a slimmer egg
const COAT_SLOPE = (COAT_RADIUS * 0.78) / COAT_HEIGHT; // how fast the coat narrows as it rises (before the rounded top)
const FACE_T = 0.58; // where up the coat the face is (0 = hem, 1 = top)
const PART_TOP_T = 0.46; // the opening at the front of the coat runs from the hem up to here (it meets the face)
const PART_HEM_ANGLE = 0.33; // how wide the opening is at the hem: this many radians either side of the front (about half the coat's radius across)
const PART_TOP_ANGLE = 0.1; // ...and how wide it is at the top of the opening (a narrow channel down from the face)
const FUR_PUFFS = 13;

/** How wide the coat is (its radius) at `t` (0 = hem, 1 = top): a straight taper, with the top rounded off into a dome. */
function coatRadiusAt(t: number): number {
  const straight = COAT_RADIUS * (1 - 0.78 * Math.min(1, Math.max(0, t)));
  if (t <= 0.8) return straight;
  const u = Math.min(1, (t - 0.8) / 0.2); // 0..1 over the last fifth: round the top over
  return straight * Math.sqrt(Math.max(0, 1 - u * u));
}

/** How far (radians, either side of the front) the coat is cut away at height `t`: a V that is widest at the hem and narrows to a channel at PART_TOP_T. Zero above that. */
function partAngleAt(t: number): number {
  if (t >= PART_TOP_T) return 0;
  return PART_TOP_ANGLE + (PART_HEM_ANGLE - PART_TOP_ANGLE) * (1 - t / PART_TOP_T);
}

/**
 * The coat: its outline (see coatRadiusAt) turned round into a surface, so it reads as a rounded triangle from the front, with flat
 * low-poly facets. With `parted`, the front (the +z side) of the lower part is cut away in a V, so the coat is open at the bottom
 * like a jacket. Built ring by ring: each ring has the same number of points, spread over the part of the circle that is left.
 */
function makeCoatGeometry(parted: boolean): BufferGeometry {
  const rings = 16;
  const around = 14;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const radius = Math.max(0.001, coatRadiusAt(t));
    const y = COAT_BASE_Y + t * COAT_HEIGHT;
    const gap = parted ? partAngleAt(t) : 0; // angle of front left out (each side)
    for (let j = 0; j <= around; j++) {
      const angle = gap + ((Math.PI * 2 - 2 * gap) * j) / around; // 0 = straight ahead (+z); the cut is centred there
      positions.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    }
  }
  const row = around + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c, b, d, c); // (counter-clockwise seen from outside, so the faces point outwards)
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft round glow (bright in the middle, fading to nothing at the edge), drawn on a canvas: it goes behind the eyes. */
function makeGlowTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
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
  g.fillStyle = '#cde5f7'; // one flat color: a gradient would show seams where the texture tiles
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

/** Some text (like "+1") in a color with a dark outline, as a picture for a floating label. */
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
