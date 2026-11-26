import {
  AdditiveBlending, AmbientLight, BoxGeometry, CanvasTexture, CatmullRomCurve3, TubeGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  Fog, Float32BufferAttribute, IcosahedronGeometry, LatheGeometry, Points, PointsMaterial, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, RepeatWrapping, RingGeometry, Scene, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, Matrix4, Quaternion, Euler,
  WebGLRenderer, BufferGeometry, type Material,
} from 'three';
import {
  BAG_MOUTH_HEIGHT, BAG_NECK_RADIUS, BAG_TILT, BAG_TOP_EXTRA, SANTA_NEUTRAL_BAG_COLOR, lobPlan, type SantaBagView, type SantaKickedView, type SantaLandedView, type SantaSackView } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { giftGrab, giftIn, giftMiss, giftToss } from '../../audio/santaSounds';
import { createNameTag, disposeNameTag } from '../labelTexture';
import { SparkSystem } from '../taprace/sparks';
import type { Pull } from '../ThrowPad';

/** How an elf is labelled and dressed (the player's own color, as in every game: GAME_RULES.md #7). */
export interface ElfStyle { name: string; color: string }

// The camera: behind your elf and high up, looking along the way the elf faces (towards the bags, with the sleigh beyond them).
const CAM_BACK = 7; // this far behind the elf...
const CAM_HEIGHT = 27; // ...and this high...
const CAM_AHEAD = 13; // ...looking at the floor this far in front of the elf (a steep angle, so the bags' mouths can be seen)
const FOV_MIN = 62; // (a tall phone screen is given a wider view, so the whole route of the bags still fits across it)
const FOV_MAX = 88;
const MOUTH_HEIGHT = BAG_MOUTH_HEIGHT; // (the bag's shape, tilt and the zones that judge gifts are shared with the server: packages/shared/src/santaBag.ts)
const PILE_MAX = 18; // how many gifts are drawn in an elf's pile (it never shrinks: the gifts never run out)
const THROW_ANIM = 0.3; // seconds for the arm swing


const CHRISTMAS_WRAPS = ['#c62828', '#2e7d32', '#f5f1e8', '#1565c0', '#f2c14e', '#8e24aa', '#00897b', '#ef6c00']; // red, green, white, blue, gold, plum, teal, orange: the wrapping on the gifts in the piles
// The shape of a bag, as a profile (radius, height) in mouths, from the middle of its base up to its top: OPEN (a round belly, a neck, a wide mouth with a rolled lip) and SHUT (the same bag with its neck
// cinched: a pear shape gathered to a narrow neck at the top). Both have the same number of points, so the bag can be morphed smoothly from one to the other (the whole body is drawn in, not just the neck).
const BAG_OPEN: [number, number][] = [[0, 0], [0.7, 0.02], [1.05, 0.25], [1.28, 0.7], [1.3, 1.15], [1.15, 1.6], [0.97, 1.95], [0.9, 2.1], [0.88, 2.18], [0.95, 2.25], [1.02, 2.3]];
const BAG_SHUT: [number, number][] = [[0, 0], [0.7, 0.02], [1.05, 0.25], [1.26, 0.7], [1.22, 1.1], [0.98, 1.5], [0.6, 1.9], [0.33, 2.12], [0.21, 2.26], [0.2, 2.4], [0, 2.52]];
const BAG_SEGMENTS = 28;
const LIP_TUBE = 0.14, LIP_RADIAL = 10, LIP_TUBULAR = 32; // the lip's tube (in bag radii) and how many segments round it and along it
const NECK = 7; // the point of the profile where the ribbon goes round the neck
const BAG_UP = new Vector3(0, 1, 0);
const BOW_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4); // (the bow's extra 45 degrees about the bag's z axis)
const D2R = Math.PI / 180;
const BOW_BASE = new Quaternion().setFromEuler(new Euler(Math.PI, 0, Math.PI / 4)); // (turned 180 degrees about its own x, and 45 about its z)
const BOW_FINE = new Quaternion().setFromEuler(new Euler(30 * D2R, 0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, -9 * D2R, 0))).multiply(new Quaternion().setFromEuler(new Euler(0, 0, 66 * D2R))); // (then 30, -9 and 66 degrees about the bow's own x, y and z)
const BOW_SIZE = 1.15; // (the bow is 15% bigger than it was)
const KNOT_ANGLE = 0.9; // the knot of the ribbon (and the bow) is on this side of the neck (radians round the neck)
const TOP = 10; // the point at the top (the lip when open)

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const angleDiff = (a: number, b: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

interface Elf { group: Group; armL: Group; armR: Group; held: Group | null; tag: Sprite; yaw: number; wantYaw: number; throwAge: number; x: number; z: number; restYaw: number; pile: Group[]; style: ElfStyle }
interface BagVisual {
  id: number; group: Group; tilt: Group; mouth: Object3D; body: MeshStandardMaterial; rim: MeshStandardMaterial; halo: MeshBasicMaterial; haloMesh: Mesh;
  shape: LatheGeometry; r: number; lipGroup: Group; inside: Mesh; ring: Mesh; tails: Group; tailSegs: Mesh[]; lip: Mesh; bowPivot: Group; bowGroup: Group; bowLoops: Mesh[]; heap: Group; heapKey: string; heapGifts: Group[]; color: Color; glow: number; cinch: number; strobe: number; wasShut: boolean; scale: number; view: SantaBagView; x: number; z: number; y: number;
}
interface Flight { group: Group; shadow: Mesh; v: SantaSackView['flying'][number] }
type EffectKind = 'in' | 'miss' | 'kick';
interface Effect { kind: EffectKind; group: Group; age: number; x: number; y: number; z: number; bag: number | null; at: number; owner: string; vx?: number; vz?: number }
interface Flash { sprite: Sprite; age: number; life: number; size: number }
interface Floater { sprite: Sprite; age: number; x: number; y: number; z: number }

/**
 * Everything three.js for a Santa's Sack round, kept apart from React (the same shape as the other scenes): React hands it each server view (`pushView`)
 * and a container; it owns the renderer, the loop and the cleanup.
 *
 * Look: a workshop floor. Your camera sits high behind YOUR elf, who stands among a pile of gift boxes in your own color, and looks past them at the big bags
 * floating round a circle in the middle of the room, each tilted so its open mouth faces you, with Santa's sleigh at the top of the map, beyond them.
 * A bag glows in the color of the player who is winning it. Full bags float away to the sleigh, flash gold, and come back empty.
 */
export class SantaSackScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV_MIN, 1, 0.1, 500);
  private latest: SantaSackView | null = null;
  private built = false;
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private aspect = 1;
  private sparks = new SparkSystem(1200, true);
  /** The start countdown's camera move, 0 (high above the whole room) .. 1 (behind your elf); set by the game screen from the server's clock. */
  introFactor: () => number = () => 1;
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain)); // the countdown every game shares (GAME_RULES.md #1)

  private elves = new Map<string, Elf>();
  private bags = new Map<number, BagVisual>();
  private flights = new Map<number, Flight>();
  private seenLanded = new Set<number>();
  private seenKicked = new Set<number>();
  private effects: Effect[] = [];
  private flashes: Flash[] = [];
  private floaters: Floater[] = [];
  private view: { targetId: string | null } = { targetId: null }; // whose elf the camera is behind (null = high over the whole room)
  private camPos = new Vector3(); private camLook = new Vector3(); private camStarted = false;
  private aim: Pull | null = null;
  private aimGroup = new Group();
  private aimTube: Mesh; // the arc the gift would fly (a thick tube: thicker the harder you pull)
  private aimHead: Mesh; // its arrowhead
  private candyTexture: CanvasTexture; // the red and white diagonal stripes of the arc
  private aimRing: Mesh; // the cursor at the end of the arc, in the air at the height of the bags' mouths (plus 15%), turned to face the incoming gift
  private selfId: string | null;

  // Shared shapes and materials (one geometry, many meshes).
  private giftGeometries: BufferGeometry[] = [];
  private giftSizes: [number, number, number][] = [[0.9, 0.9, 0.9], [1.15, 0.6, 0.9], [0.8, 1.15, 0.8], [1.25, 0.75, 0.8], [0.75, 0.75, 0.75], [0.9, 0.8, 0.9]]; // (kinds: a cube, a flat box, a tall box, a long box, a small cube, a round tin)
  private ribbonMaterial: MeshStandardMaterial;
  private ownerMaterials = new Map<string, MeshStandardMaterial>();
  private ribbonVariants: MeshStandardMaterial[] = []; // (the ribbons on the pile's gifts: striped, gold, white, red, green; thrown gifts always have the red-and-white striped one)
  private bowGeometry = new SphereGeometry(0.16, 8, 6);
  private shadowGeometry = new CircleGeometry(0.5, 16);
  private shadowMaterial = new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });
  private glowTexture: CanvasTexture;
  private snow: Points | null = null; // the falling snow
  private pineTrunk = new CylinderGeometry(0.3, 0.45, 1.8, 7);
  private pineCones = [new ConeGeometry(2.4, 2.8, 8), new ConeGeometry(1.9, 2.4, 8), new ConeGeometry(1.35, 2, 8)];
  private pineCaps = [new ConeGeometry(1.5, 1.2, 8), new ConeGeometry(1.2, 1, 8), new ConeGeometry(0.85, 0.9, 8)];
  private pineMaterials = { trunk: new MeshStandardMaterial({ color: '#5a3d26', roughness: 1 }), leaves: new MeshStandardMaterial({ color: '#1f5a3a', roughness: 0.9, flatShading: true }), snow: new MeshStandardMaterial({ color: '#f4f9ff', roughness: 1, flatShading: true }) };

  constructor(private container: HTMLElement, private serverNow: () => number, private styles: Record<string, ElfStyle>, selfId: string | null) {
    this.selfId = selfId;
    this.view = { targetId: selfId };
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.glowTexture = makeGlowTexture();
    this.ribbonMaterial = new MeshStandardMaterial({ map: makeStripeTexture(), roughness: 0.5 }); // red and white stripes on every ribbon
    this.giftGeometries = this.giftSizes.map(([w, h, d], i) => (i === 5 ? new CylinderGeometry(w / 2, w / 2, h, 14) : new BoxGeometry(w, h, d)));
    this.ribbonVariants = [this.ribbonMaterial, ...['#f2c14e', '#ffffff', '#d32f2f', '#2e7d32'].map((c) => new MeshStandardMaterial({ color: c, roughness: 0.45, metalness: c === '#f2c14e' ? 0.5 : 0 }))];
    this.disposables.push(this.renderer, this.sparks, this.glowTexture, this.pineTrunk, ...this.pineCones, ...this.pineCaps, this.pineMaterials.trunk, this.pineMaterials.leaves, this.pineMaterials.snow, ...this.ribbonVariants, this.ribbonMaterial.map!, this.bowGeometry, this.shadowGeometry, this.shadowMaterial, ...this.giftGeometries);
    // The aim marker (the player's own pull): a line from the elf and a ring where the throw will come down.
    const lineMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    const ringGeometry = new RingGeometry(0.85, 1, 32);
    this.disposables.push(lineMaterial, ringGeometry);
    // The arc and its arrowhead are a see-through candy cane: diagonal red and white stripes that spiral round the tube, with the same transparency as the plain line had.
    this.candyTexture = makeCandyTexture();
    const candyMaterial = new MeshBasicMaterial({ map: this.candyTexture, transparent: true, opacity: 0.85, depthWrite: false });
    this.disposables.push(candyMaterial, this.candyTexture);
    this.aimTube = new Mesh(new BufferGeometry(), candyMaterial);
    this.aimHead = new Mesh(new ConeGeometry(1, 1, 12), candyMaterial);
    this.aimRing = new Mesh(ringGeometry, lineMaterial);
    this.aimGroup.add(this.aimTube, this.aimHead, this.aimRing);
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.sparks.floorAt = () => 0;
    this.scene.add(this.sparks.object);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------

  pushView(view: SantaSackView) {
    this.latest = view;
    if (!this.built) this.build(view);
    // Bags: what each is doing (who leads it, whether it is away).
    for (const b of view.bags) {
      let v = this.bags.get(b.id);
      if (!v) v = this.addBag(b);
      v.view = b;
    }
    // Gifts in the air.
    const airborne = new Set<number>();
    for (const f of view.flying) {
      airborne.add(f.id);
      const known = this.flights.get(f.id);
      if (!known) this.launch(f);
      else {
        if (f.bounces > known.v.bounces) audio.play(giftMiss, f.x0, f.z0, 0.5, 1); // it bounced off a bag
        known.v = f;
      }
    }
    for (const [id, f] of this.flights) if (!airborne.has(id)) { this.scene.remove(f.group, f.shadow); this.flights.delete(id); }
    // Gifts that have just come down.
    for (const l of view.landed) {
      if (this.seenLanded.has(l.id)) continue;
      this.seenLanded.add(l.id);
      if (this.serverNow() - l.at < 700) this.land(l); // (someone arriving late does not see the old ones)
    }
    // Gifts pushed out of a full bag: each tumbles out of the mouth and falls (a picture only).
    for (const k of view.kicked) {
      if (this.seenKicked.has(k.id)) continue;
      this.seenKicked.add(k.id);
      if (this.serverNow() - k.at < 700) this.kickOut(k);
    }
    for (const id of [...this.elves.keys()]) if (!(id in view.players)) this.removeElf(id);
  }

  /** Seconds left in the round: the last 5 tick, then the whistle (GAME_RULES.md #1). */
  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); }

  /** Whose elf the camera is behind: your own (players), the one a spectator follows, or the winner during the winner moment. null = high over the whole room (a draw). */
  setCameraView(view: { targetId: string | null }) { this.view = view; }

  /** The local player's pull (as the pad reports it), or null when they are not aiming. Draws the line and the landing ring. */
  setAim(aim: Pull | null) { this.aim = aim; }

  /**
   * Turns a pull (in screen directions: the pad's dx is towards the right of the screen, dz towards the bottom) into a direction on the floor, for YOUR camera:
   * the screen's up is the way your elf faces and its right is the elf's right hand. Pulling back (down) throws forward.
   */
  toWorld(pull: Pull): { x: number; z: number } {
    const st = this.selfId ? this.latest?.stations[this.selfId] : undefined;
    const f = { x: Math.cos(st?.facing ?? -Math.PI / 2), z: Math.sin(st?.facing ?? -Math.PI / 2) };
    const r = { x: -f.z, z: f.x }; // (the right-hand side)
    return { x: f.x * -pull.dz + r.x * pull.dx, z: f.z * -pull.dz + r.z * pull.dx };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const e of this.elves.values()) disposeNameTag(e.tag);
    for (const b of this.bags.values()) { b.body.dispose(); b.rim.dispose(); b.halo.dispose(); }
    for (const f of this.floaters) disposeNameTag(f.sprite);
    for (const f of this.flashes) f.sprite.material.dispose();
    this.ownerMaterials.forEach((m) => m.dispose());
    this.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry?.dispose?.(); });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  private track<T extends { dispose(): void }>(thing: T): T { this.disposables.push(thing); return thing; }

  // ---------- the world ----------

  private build(view: SantaSackView) {
    this.built = true;
    // The setting: a forest clearing in the snow, on a pale winter day. Snow underfoot, a ring of snowy pine trees round the clearing, soft drifts, and snow falling.
    const sky = new Color('#c7def2');
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 70, 190);
    this.scene.add(new HemisphereLight(0xeaf3ff, 0xb9c9de, 1.7), new AmbientLight(0xffffff, 0.3));
    const sun = new DirectionalLight(0xfff6e5, 1.9);
    sun.position.set(-18, 44, 22);
    this.scene.add(sun);
    const flat = (geometry: BufferGeometry, material: Material, y: number, x = 0, z = 0) => { const m = new Mesh(this.track(geometry), this.track(material)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); this.scene.add(m); return m; };
    // The snow: a wide pale plain with a little texture, and a slightly bluer trodden circle for the clearing itself.
    const snowTexture = this.track(makeSnowTexture());
    snowTexture.repeat.set(24, 24);
    flat(new CircleGeometry(160, 64), new MeshStandardMaterial({ color: '#f3f8ff', map: snowTexture, roughness: 1 }), -0.02);
    flat(new CircleGeometry(40, 64), new MeshStandardMaterial({ color: '#e4eefb', roughness: 1 }), 0);
    const R = view.orbit.radius;
    flat(new RingGeometry(R - 0.18, R + 0.18, 96), new MeshBasicMaterial({ color: '#a9c1de' }), 0.03); // (the route the bags follow, trodden into the snow)
    // The pine trees: a ring of them round the clearing (a few rows, different heights), with snow on their branches.
    const rng = mulberry(7);
    for (let ring = 0; ring < 3; ring++) {
      const count = 46 + ring * 14;
      for (let i = 0; i < count; i++) {
        const a = ((i + rng() * 0.8) / count) * Math.PI * 2, r = 44 + ring * 11 + rng() * 6;
        this.addPine(Math.cos(a) * r, Math.sin(a) * r, 1.5 + rng() * 1.3);
      }
    }
    // Snowdrifts and a few rocks at the edge of the clearing.
    const driftMat = this.track(new MeshStandardMaterial({ color: '#f7fbff', roughness: 1 }));
    const rockMat = this.track(new MeshStandardMaterial({ color: '#7f8ea3', roughness: 1, flatShading: true }));
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, r = 33 + rng() * 9;
      const drift = new Mesh(this.track(new SphereGeometry(1, 10, 6)), driftMat);
      drift.scale.set(2 + rng() * 3, 0.5 + rng() * 0.6, 1.6 + rng() * 2.2);
      drift.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.scene.add(drift);
      if (i % 4 === 0) { const rock = new Mesh(this.track(new IcosahedronGeometry(0.9 + rng() * 0.8, 0)), rockMat); rock.position.set(Math.cos(a + 0.2) * (r - 2), 0.5, Math.sin(a + 0.2) * (r - 2)); rock.rotation.set(rng() * 3, rng() * 3, 0); this.scene.add(rock); }
    }
    // Falling snow: a cloud of small flakes that drift down round the clearing (moved in the loop).
    const flakes = 450;
    const positions = new Float32Array(flakes * 3);
    for (let i = 0; i < flakes; i++) { positions[i * 3] = (rng() - 0.5) * 110; positions[i * 3 + 1] = rng() * 34; positions[i * 3 + 2] = (rng() - 0.5) * 110; }
    const flakeGeometry = this.track(new BufferGeometry());
    flakeGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.snow = new Points(flakeGeometry, this.track(new PointsMaterial({ color: '#ffffff', size: 0.34, transparent: true, opacity: 0.9, depthWrite: false })));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    for (const [id, st] of Object.entries(view.stations)) this.buildElf(id, st);
  }

  /** A snowy pine tree: a trunk and three layers of dark green branches, each with a cap of snow. */
  private addPine(x: number, z: number, scale: number) {
    const g = new Group();
    const trunk = new Mesh(this.pineTrunk, this.pineMaterials.trunk);
    trunk.position.y = 0.9;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const branches = new Mesh(this.pineCones[i], this.pineMaterials.leaves);
      branches.position.y = 2.2 + i * 1.7;
      const snowCap = new Mesh(this.pineCaps[i], this.pineMaterials.snow);
      snowCap.position.y = 2.2 + i * 1.7 + 0.42;
      g.add(branches, snowCap);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    this.scene.add(g);
  }

  /** An elf (seen from behind it is a pointed hat over a round little body), the mat it stands on, its name, and its pile of gifts in a ring round it. */
  private buildElf(id: string, st: { x: number; z: number; facing: number }) {
    const style = this.styles[id] ?? { name: '?', color: '#ffffff' };
    const mat = (color: string, rough = 0.7) => this.track(new MeshStandardMaterial({ color, roughness: rough, flatShading: true }));
    const g = new Group();
    const tunic = new Mesh(this.track(new CylinderGeometry(0.55, 0.75, 1.3, 12)), mat(style.color));
    tunic.position.y = 0.95;
    const beltBand = new Mesh(this.track(new CylinderGeometry(0.66, 0.68, 0.16, 12)), mat('#2b2b2b'));
    beltBand.position.y = 0.85;
    const head = new Mesh(this.track(new SphereGeometry(0.5, 14, 10)), mat('#f2c9a5'));
    head.position.y = 1.95;
    const hat = new Mesh(this.track(new ConeGeometry(0.55, 1.5, 12)), mat(style.color));
    hat.position.set(-0.05, 2.95, 0); hat.rotation.z = 0.15;
    const brim = new Mesh(this.track(new TorusGeometry(0.52, 0.13, 8, 16)), mat('#fff'));
    brim.rotation.x = Math.PI / 2; brim.position.y = 2.3;
    const pom = new Mesh(this.track(new SphereGeometry(0.18, 8, 6)), mat('#fff'));
    pom.position.set(-0.3, 3.7, 0);
    const nose = new Mesh(this.track(new SphereGeometry(0.1, 8, 6)), mat('#e07a5f'));
    nose.position.set(0.5, 1.92, 0);
    const earL = new Mesh(this.track(new ConeGeometry(0.12, 0.45, 6)), mat('#f2c9a5')); earL.position.set(0, 2.0, -0.55); earL.rotation.x = -Math.PI / 2.4;
    const earR = earL.clone(); earR.position.z = 0.55; earR.rotation.x = Math.PI / 2.4;
    const arm = () => { const a = new Group(); const limb = new Mesh(this.track(new CylinderGeometry(0.15, 0.15, 0.95, 8)), mat(style.color)); limb.position.y = -0.45; const hand = new Mesh(this.track(new SphereGeometry(0.18, 8, 6)), mat('#fff')); hand.position.y = -0.98; a.add(limb, hand); return a; };
    const armL = arm(), armR = arm();
    armL.position.set(0, 1.5, -0.62); armR.position.set(0, 1.5, 0.62);
    g.add(tunic, beltBand, head, hat, brim, pom, nose, earL, earR, armL, armR);
    g.position.set(st.x, 0, st.z);
    g.rotation.y = -st.facing; // (the elf's local +x is the way it faces)
    g.scale.setScalar(1.3);
    this.scene.add(g);
    // The mat under the elf, in the player's color.
    const matDisc = new Mesh(this.track(new CircleGeometry(1.7, 28)), this.track(new MeshStandardMaterial({ color: style.color, roughness: 0.9 })));
    matDisc.rotation.x = -Math.PI / 2; matDisc.position.set(st.x, 0.03, st.z);
    this.scene.add(matDisc);
    // The pile: gifts in the player's color in an arc round the elf (the sides and the back, so the way ahead is clear), some stacked a second high.
    const fx = Math.cos(st.facing), fz = Math.sin(st.facing);
    const pile: Group[] = [];
    for (let i = 0; i < PILE_MAX; i++) {
      const gift = this.makeGift(CHRISTMAS_WRAPS[(i * 5 + id.length) % CHRISTMAS_WRAPS.length], i % 6, this.ribbonVariants[i % this.ribbonVariants.length]); // (the pile is a mix of Christmas wrapping; what the elf throws is in the player's color)
      const a = Math.PI * 0.55 + (i / (PILE_MAX - 1)) * Math.PI * 0.9 + rand(-0.08, 0.08); // (angle from the elf's front: round the left side, the back and the right side)
      const r = 2.1 + (i % 3) * 0.5 + rand(0, 0.2);
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r; // (in the elf's frame: x ahead, z to its right)
      gift.position.set(st.x + fx * lx - fz * lz, this.giftSizes[i % 6][1] / 2 + (i >= PILE_MAX - 6 ? 0.8 : 0), st.z + fz * lx + fx * lz);
      gift.rotation.y = rand(0, Math.PI);
      this.scene.add(gift);
      pile.push(gift);
    }
    // The name hangs above the hat, on the top layer (GAME_RULES.md #6).
    const tag = createNameTag(style.name, style.color);
    tag.scale.set(4.2, 1.05, 1);
    tag.position.set(st.x, 6.3, st.z);
    this.scene.add(tag);
    this.elves.set(id, { group: g, armL, armR, held: null, tag, yaw: st.facing, wantYaw: st.facing, throwAge: 9, x: st.x, z: st.z, restYaw: st.facing, pile, style });
  }

  private removeElf(id: string) {
    const e = this.elves.get(id);
    if (!e) return;
    this.scene.remove(e.group, e.tag, ...e.pile);
    disposeNameTag(e.tag);
    this.elves.delete(id);
  }

  // ---------- gifts ----------

  private ownerMaterial(color: string): MeshStandardMaterial {
    let m = this.ownerMaterials.get(color);
    if (!m) { m = new MeshStandardMaterial({ color, roughness: 0.55 }); this.ownerMaterials.set(color, m); }
    return m;
  }

  /** A gift: a box (or a round tin) in the thrower's color with a red-and-white striped ribbon; its shape comes from `kind` (a few shapes, all about the same size). */
  private makeGift(color: string, kind: number, ribbon: MeshStandardMaterial = this.ribbonMaterial): Group {
    const k = kind % 6;
    const [w, h, d] = this.giftSizes[k];
    const g = new Group();
    g.add(new Mesh(this.giftGeometries[k], this.ownerMaterial(color)));
    const r1 = new Mesh<BufferGeometry>(new BoxGeometry(w + 0.05, h + 0.05, 0.16), ribbon), r2 = new Mesh<BufferGeometry>(new BoxGeometry(0.16, h + 0.05, d + 0.05), ribbon);
    if (k === 5) { r1.geometry = new CylinderGeometry(w / 2 + 0.03, w / 2 + 0.03, 0.18, 14); r1.position.y = 0.05; r2.visible = false; }
    g.add(r1, r2);
    const bow = new Mesh(this.bowGeometry, ribbon);
    bow.position.y = h / 2 + 0.05;
    g.add(bow);
    return g;
  }

  private colorOf(id: string) { return this.styles[id]?.color ?? '#ffffff'; }

  /** A gift is thrown: it flies an arc from the elf to where it will come down, spinning, with a shadow; the elf swings its arms and turns to face the throw. */
  private launch(f: SantaSackView['flying'][number]) {
    const group = this.makeGift(this.colorOf(f.owner), f.kind);
    const shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(group, shadow);
    this.flights.set(f.id, { group, shadow, v: f });
    const elf = this.elves.get(f.owner);
    if (elf && f.bounces === 0 && this.serverNow() - f.t0 < 500) {
      elf.throwAge = 0;
      elf.wantYaw = Math.atan2(f.vz, f.vx);
      audio.play(giftToss, f.x0, f.z0, f.owner === this.selfId ? 0.7 : 0.4, 1);
    }
  }

  /** Where a bag's middle is on its route at server time `at`. */
  private orbitAt(b: SantaBagView, at: number): { x: number; z: number; angle: number } {
    const v = this.latest!;
    const a = b.slot + v.orbit.speed * ((at - v.startsAt) / 1000);
    return { x: Math.cos(a) * v.orbit.radius, z: Math.sin(a) * v.orbit.radius, angle: a };
  }

  /**
   * A gift is pushed out of a full bag: it starts in the mouth, keeps the bag's own sideways speed (the bag is travelling round its route) with only a little push outward, and falls to the floor
   * tumbling, then shrinks away. It never flies out and it touches nothing: it is a picture, not part of the physics.
   */
  private kickOut(k: SantaKickedView) {
    const bag = this.bags.get(k.bag);
    const group = this.makeGift(this.colorOf(k.owner), k.kind);
    const start = new Vector3(0, 4, 0);
    let vx = 0, vz = 0;
    if (bag) {
      bag.mouth.getWorldPosition(start);
      const a = this.orbitAt(bag.view, k.at), b2 = this.orbitAt(bag.view, k.at + 100);
      vx = (b2.x - a.x) * 10 + Math.cos(a.angle) * 0.9; vz = (b2.z - a.z) * 10 + Math.sin(a.angle) * 0.9; // (the bag's own speed, plus a gentle push away from the middle)
    }
    group.position.copy(start);
    this.scene.add(group);
    this.effects.push({ kind: 'kick', group, age: 0, x: start.x, y: start.y, z: start.z, bag: k.bag, at: k.at, owner: k.owner, vx, vz });
    audio.play(giftMiss, start.x, start.z, 0.4, 0.8);
  }

  /** The heap in a bag's mouth: its gifts (up to 5), each in its thrower's color, in two layers (3, then 2). It is rebuilt whenever the bag's gifts change; a new one pops in just after the thrown gift has dropped in. */
  private syncHeap(b: BagVisual, seconds: number, cinch: number) {
    const gifts = b.view.gifts ?? [];
    const key = gifts.map((x) => x.owner + ':' + x.kind).join('|');
    if (key !== b.heapKey) {
      const grew = gifts.length > b.heapGifts.length;
      for (const g of b.heapGifts) b.heap.remove(g);
      b.heapGifts = gifts.map((x, i) => {
        const g = this.makeGift(this.colorOf(x.owner), x.kind);
        const layer = i < 3 ? 0 : 1, n = layer === 0 ? 3 : 2, j = layer === 0 ? i : i - 3;
        const a = (j / n) * Math.PI * 2 + (layer === 0 ? 0.5 : 1.6), rad = (layer === 0 ? 0.42 : 0.2) * b.r;
        g.position.set(Math.cos(a) * rad, b.r * 2.12 + 0.4 + layer * 0.85, Math.sin(a) * rad);
        g.rotation.set(0.15 * Math.sin(i * 3.1), i * 1.9, 0.15 * Math.cos(i * 2.3));
        g.userData.born = grew && i === gifts.length - 1 ? seconds + 0.25 : -1e9; // (only a gift that has just gone in pops in)
        b.heap.add(g);
        return g;
      });
      b.heapKey = key;
    }
    for (const g of b.heapGifts) { const u = clamp((seconds - (g.userData.born as number)) / 0.25, 0, 1); g.scale.setScalar(Math.max(0.001, 0.3 + 0.7 * smooth(u)) * (u <= 0 ? 0.001 : 1)); }
    b.heap.visible = cinch < 0.25; // (the heap is inside the bag: it goes when the mouth cinches shut)
  }

  /** A gift has come down: into a bag (it drops into the mouth with a gold flash and sparkles and disappears), or onto the floor (it bounces, then fades). */
  private land(l: SantaLandedView) {
    const group = this.makeGift(this.colorOf(l.owner), l.kind);
    group.position.set(l.x, l.y, l.z);
    this.scene.add(group);
    this.effects.push({ kind: l.bag !== null ? 'in' : 'miss', group, age: 0, x: l.x, y: l.y, z: l.z, bag: l.bag, at: l.at, owner: l.owner });
    if (l.bag === null) audio.play(giftMiss, l.x, l.z, 0.5, 1);
  }

  // ---------- bags ----------

  /**
   * A bag: a big round-bellied sack with a narrow neck and a rolled lip round its open mouth, leaning OUTWARD (away from the middle of its route). It can be CINCHED: the whole bag is morphed from its
   * open shape (BAG_OPEN) to a pear shape gathered at the top (BAG_SHUT), the lip closes up, and a red-and-white striped ribbon that hung loose round the neck pulls tight and ties in a bow (see `shapeBag`).
   * It takes the color of the player who controls it.
   */
  private addBag(b: SantaBagView): BagVisual {
    const r = b.radius;
    const group = new Group(), tilt = new Group();
    const body = this.track(new MeshStandardMaterial({ color: SANTA_NEUTRAL_BAG_COLOR, roughness: 0.9, side: DoubleSide, flatShading: true, emissive: '#000000', emissiveIntensity: 0 }));
    const rim = this.track(new MeshStandardMaterial({ color: '#e8d9a8', roughness: 0.7, emissive: '#000000', emissiveIntensity: 0 }));
    const shape = this.track(new LatheGeometry(BAG_OPEN.map(([x, y]) => new Vector2(x * r, y * r)), BAG_SEGMENTS));
    const bag = new Mesh(shape, body);
    // The rolled lip round the mouth and the dark inside (they follow the top of the shape and vanish as it closes).
    const lipGroup = new Group();
    const lip = new Mesh(this.track(new TorusGeometry(r * 1.0, r * LIP_TUBE, LIP_RADIAL, LIP_TUBULAR)), rim); // (a round tube of the same thickness all the way round; `shapeBag` pulls its ring in as the bag closes but the tube keeps its thickness)
    lip.rotation.x = Math.PI / 2;
    lipGroup.add(lip);
    const inside = new Mesh(this.track(new CircleGeometry(r * 0.92, 24)), this.track(new MeshBasicMaterial({ color: '#2a1a0e' })));
    inside.rotation.x = -Math.PI / 2;
    // The ribbon (red and white stripes): a band round the neck (it tightens with the neck), two tails that hang loose down the body when the bag is open, and a bow when it is cinched.
    const stripes = (repeatX: number, repeatY: number) => { const t = makeRibbonTexture(); t.repeat.set(repeatX, repeatY); return this.track(new MeshStandardMaterial({ map: this.track(t), roughness: 0.5, side: DoubleSide })); };
    const ring = new Mesh(this.track(new TorusGeometry(r * 0.95, r * 0.1, 8, 36)), stripes(10, 1));
    ring.rotation.x = Math.PI / 2;
    const tails = new Group(), tailMaterial = stripes(4, 1);
    tailMaterial.map!.center.set(0.5, 0.5); tailMaterial.map!.rotation = Math.PI / 2; // (the stripes go ACROSS the ribbon's width, not down its length)
    const tailGeometry = this.track(new BoxGeometry(r * 0.24, 1, r * 0.04));
    const tailSegs = [0, 1, 2, 3, 4].map(() => new Mesh(tailGeometry, tailMaterial)); // (tail A is the first three, tail B the last two: short flat strips that follow the body's surface)
    tails.add(...tailSegs);
    // The bow: tied on the SIDE of the cinched neck (at the knot where the tails start), its two loops sticking out sideways, across the neck (not up out of the mouth), and flopping a little.
    // `bowPivot` turns to the side of the neck the knot is on; `bowGroup` is moved to the knot (see shapeBag).
    const bowPivot = new Group(), bowGroup = new Group(), bowMaterial = stripes(2, 2), bowLoops: Mesh[] = [];
    for (const side of [-1, 1]) {
      const loop = new Mesh(this.track(new TorusGeometry(r * 0.24, r * 0.07, 8, 18)), bowMaterial);
      loop.rotation.y = Math.PI / 2; // (the loop lies in the plane of the neck's side: it reaches along the neck's width, not out of its mouth)
      loop.scale.set(1.55, 1, 1);
      loop.userData.side = side;
      loop.position.set(r * 0.06, -r * 0.05, side * r * 0.4);
      bowGroup.add(loop);
      bowLoops.push(loop);
    }
    bowGroup.add(new Mesh(this.track(new SphereGeometry(r * 0.11, 8, 6)), bowMaterial));
    bowPivot.add(bowGroup);
    const mouth = new Object3D(); // (the middle of the mouth: where a gift goes in; 2.3 mouths up)
    mouth.position.y = r * MOUTH_HEIGHT;
    const heap = new Group();
    tilt.add(bag, lipGroup, inside, ring, tails, bowPivot, mouth, heap);
    tilt.rotation.x = BAG_TILT; // (leaning out: the group is turned so that its +z points away from the middle, see the loop)
    group.add(tilt);
    // The glow: a soft ring of light on the snow round the bag (shown for the bag's controller and for the closing warning).
    const halo = this.track(new MeshBasicMaterial({ map: this.glowTexture, color: '#ffffff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    const haloMesh = new Mesh(this.track(new CircleGeometry(r * 2.6, 32)), halo);
    haloMesh.rotation.x = -Math.PI / 2; haloMesh.position.y = 0.08;
    this.scene.add(haloMesh, group);
    const p = this.orbitAt(b, this.serverNow());
    const v: BagVisual = { id: b.id, group, tilt, mouth, body, rim, halo, haloMesh, shape, r, lipGroup, inside, ring, tails, tailSegs, lip, bowPivot, bowGroup, bowLoops, heap, heapKey: '\u0000', heapGifts: [], color: new Color(SANTA_NEUTRAL_BAG_COLOR), glow: 0, cinch: -1, strobe: 0, wasShut: false, scale: 1, view: b, x: p.x, z: p.z, y: 0 };
    this.bags.set(b.id, v);
    this.shapeBag(v, 0);
    return v;
  }

  /** Draws a bag cinched by `c` (0 = open, 1 = cinched shut): the whole body is morphed between the two profiles; the lip, the inside, the ribbon's band, its loose tails and its bow follow. */
  private shapeBag(b: BagVisual, c: number) {
    if (Math.abs(b.cinch - c) < 1e-4) return; // (nothing changed)
    b.cinch = c;
    const r = b.r, e = c * c * (3 - 2 * c); // (eased)
    const pr = BAG_OPEN.map(([x], j) => (x + (BAG_SHUT[j][0] - x) * e) * r), py = BAG_OPEN.map(([, y], j) => (y + (BAG_SHUT[j][1] - y) * e) * r);
    const n = BAG_OPEN.length, pos = b.shape.getAttribute('position') as Float32BufferAttribute;
    for (let i = 0; i <= BAG_SEGMENTS; i++) {
      const phi = (i / BAG_SEGMENTS) * Math.PI * 2, sin = Math.sin(phi), cos = Math.cos(phi);
      for (let j = 0; j < n; j++) pos.setXYZ(i * n + j, pr[j] * sin, py[j], pr[j] * cos);
    }
    pos.needsUpdate = true;
    b.shape.computeVertexNormals();
    // The lip and the dark inside sit at the top and close up with it.
    // (the lip never goes: when cinched it is a small gathered frill round the pinched top, above the ribbon)
    const lipR = r * (1 - 0.7 * e); // (the ring pulls in to 0.3 radii, but the tube keeps its round, even thickness)
    b.lipGroup.position.y = py[TOP] + (py[9] - py[TOP]) * e;
    b.lipGroup.scale.set(1, 1, 1);
    b.lipGroup.visible = true;
    const lp = b.lip.geometry.getAttribute('position') as Float32BufferAttribute, tube = r * LIP_TUBE;
    for (let j = 0, k = 0; j <= LIP_RADIAL; j++) for (let i = 0; i <= LIP_TUBULAR; i++, k++) {
      const u = (i / LIP_TUBULAR) * Math.PI * 2, v = (j / LIP_RADIAL) * Math.PI * 2;
      lp.setXYZ(k, (lipR + tube * Math.cos(v)) * Math.cos(u), (lipR + tube * Math.cos(v)) * Math.sin(u), tube * Math.sin(v));
    }
    lp.needsUpdate = true;
    b.inside.position.y = py[9] - 0.05 * r;
    b.inside.scale.setScalar(Math.max(0.001, pr[9] / (BAG_OPEN[9][0] * r)));
    b.inside.visible = e < 0.5;
    // The ribbon's band goes round the neck and tightens with it.
    b.ring.position.y = py[NECK];
    b.ring.scale.set(Math.max(0.05, (pr[NECK] + 0.05 * r) / (0.95 * r)), Math.max(0.05, (pr[NECK] + 0.05 * r) / (0.95 * r)), 1);
    // The tails always hang down the body from the knot on the ribbon's band: loose while the bag is open, and still draped down the pear-shaped body when it is cinched and the ribbon is tied.
    b.tails.visible = true;
    b.tails.position.set(0, 0, 0);
    b.tails.rotation.y = 0;
    // The tails hang from the knot and drape over the body, like loose ribbon would: from the knot on the top side of the neck they slide round the body towards its LOW side (the side that points at the floor, as the bag leans) and hang off it, going down.
    // Each tail is a few short flat strips, one between each two neighbouring points of the profile; the azimuth (the way round the bag) drifts towards the low side as the strip goes down. (`phi` is the lathe's angle: x = radius * sin, z = radius * cos; the low side is phi = 0.)
    const phi0 = Math.PI / 2 + KNOT_ANGLE;
    const lift = 0.05 * r, A = new Vector3(), B = new Vector3(), dir = new Vector3(), nor = new Vector3(), xa = new Vector3(), m4 = new Matrix4();
    const at = (j: number, phi: number, out: Vector3) => out.set((pr[j] + lift) * Math.sin(phi), py[j], (pr[j] + lift) * Math.cos(phi));
    const tailsOf: [number[], number][] = [[[NECK, 6, 5, 4], 1.3], [[NECK, 6, 5], 0.3]]; // (the profile points each tail passes, and how far round it drifts, in radians: they fan out from the knot, one going well round the body and the other staying nearer)
    let seg = 0;
    for (const [pts, drift] of tailsOf) {
      for (let k = 0; k + 1 < pts.length; k++) {
        const t0 = k / (pts.length - 1), t1 = (k + 1) / (pts.length - 1), mesh = b.tailSegs[seg++];
        at(pts[k], phi0 - drift * t0, A); at(pts[k + 1], phi0 - drift * t1, B);
        dir.copy(B).sub(A); const len = dir.length(); dir.divideScalar(len || 1);
        const phim = phi0 - drift * (t0 + t1) / 2;
        nor.set(Math.sin(phim), 0, Math.cos(phim)); nor.addScaledVector(dir, -nor.dot(dir)).normalize(); // (the flat face looks out of the body)
        xa.crossVectors(dir, nor);
        m4.makeBasis(xa, dir, nor);
        mesh.quaternion.setFromRotationMatrix(m4);
        mesh.position.copy(A).add(B).multiplyScalar(0.5);
        mesh.scale.set(1, Math.max(0.001, len * 1.06), 1);
      }
    }
    // The bow is tied at the same knot when the bag is cinched (it pops in as the neck closes), on the side of the neck, its loops across the neck.
    const bowShow = Math.max(0, (e - 0.55) / 0.45);
    b.bowGroup.visible = bowShow > 0.02;
    // The bow sits 0.25 bag radii further out than the neck, on the side of the knot (a place in the bag's own axes: the pivot is put there), and its whole turn is: round to the knot's side,
    // then 45 degrees more about the bag's z axis (the way it leans), which is the pose chosen in the bow harness.
    b.bowPivot.position.set(pr[NECK] + 0.03 * r + 0.25 * r, py[NECK], 0).applyAxisAngle(BAG_UP, KNOT_ANGLE);
    b.bowPivot.quaternion.setFromAxisAngle(BAG_UP, KNOT_ANGLE).premultiply(BOW_TURN);
    b.bowGroup.position.set(0, 0, 0);
    b.bowGroup.quaternion.copy(BOW_BASE).multiply(BOW_FINE); // (the bow's own turn: the base pose, then the final adjustment chosen in the bow harness about its own axes)
    b.bowGroup.scale.setScalar(Math.max(0.001, bowShow * BOW_SIZE));
  }

  // ---------- the loop ----------

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.aspect = w / h;
    this.renderer.setSize(w, h);
    this.camera.aspect = this.aspect;
    // A tall (phone) screen is given a wider view, so the whole route of the bags still fits across it.
    this.camera.fov = clamp((2 * Math.atan(0.6 / this.aspect) * 180) / Math.PI, FOV_MIN, FOV_MAX);
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    const v = this.latest;
    if (!v) { this.renderer.render(this.scene, this.camera); return; }
    const seconds = nowMs / 1000;
    const serverMs = this.serverNow();
    const k = 1 - Math.exp(-6 * dt);

    // Bags: round the route, leaning outward (away from the middle). Each one strobes for the 3 seconds before it is cinched shut (faster and brighter as it gets closer), the neck is drawn tight
    // and stays tight for 15 seconds, then loosens. A bag takes the color of the player who controls it (and glows in it). (Where a bag is and whether it is shut are worked out from the
    // server's clock: every phone sees the same.)
    for (const b of this.bags.values()) {
      const bv = b.view;
      const orbit = this.orbitAt(bv, serverMs);
      b.x = orbit.x; b.z = orbit.z; b.y = 0; b.scale = 1;
      const ox = Math.cos(orbit.angle), oz = Math.sin(orbit.angle), lean = bv.radius * MOUTH_HEIGHT * Math.sin(BAG_TILT);
      b.group.position.set(orbit.x - ox * lean, 0, orbit.z - oz * lean); // (the mouth is over the spot on the route the server judges by; the body sits a little inward of it)
      b.group.rotation.y = Math.PI / 2 - orbit.angle; // (its +z, the way it leans, points away from the middle)
      b.tilt.rotation.x = BAG_TILT + Math.sin(seconds * 1.4 + b.id) * 0.02;
      b.haloMesh.position.set(orbit.x - ox * lean * 0.5, 0.08, orbit.z - oz * lean * 0.5);
      const { closeAt, openAt } = bv.lid;
      const shut = serverMs >= closeAt && serverMs < openAt;
      // The colors: the controller's color (it fades between players) and a glow in it; neutral brown and no glow when nobody controls it.
      const lead = bv.leader ? new Color(this.colorOf(bv.leader)) : null;
      const k = 1 - Math.exp(-6 * dt);
      b.color.lerp(lead ?? new Color(SANTA_NEUTRAL_BAG_COLOR), k);
      b.glow += ((lead ? 1 : 0) - b.glow) * k;
      b.body.color.copy(b.color);
      b.body.emissive.copy(b.color); b.body.emissiveIntensity = 0.5 * b.glow;
      b.rim.emissive.copy(b.color); b.rim.emissiveIntensity = 0.35 * b.glow;
      b.halo.color.copy(b.color); b.halo.opacity = 0.75 * b.glow;
      // The warning strobe (it overrides the glow): flashes whose speed and brightness rise through the 3 seconds (2 a second up to 10), amber turning red.
      const warn = serverMs >= closeAt - v.warnMs && serverMs < closeAt ? (serverMs - (closeAt - v.warnMs)) / v.warnMs : -1; // 0..1 through the warning, -1 outside it
      if (warn >= 0) {
        b.strobe += (2 + 8 * warn) * dt;
        const on = Math.sin(b.strobe * Math.PI * 2) > 0 ? 1 : 0.15;
        const flash = (0.25 + 0.75 * warn) * on;
        const c = new Color('#ffb000').lerp(new Color('#ff1e1e'), warn);
        b.body.emissive.copy(c); b.rim.emissive.copy(c); b.halo.color.copy(c);
        b.body.emissiveIntensity = flash * 0.9; b.rim.emissiveIntensity = flash * 0.7; b.halo.opacity = Math.max(b.halo.opacity, flash * 0.9);
      } else b.strobe = 0;
      b.haloMesh.visible = b.halo.opacity > 0.02;
      // The cinch: the neck is squeezed tight like a drawstring bag (quickly, with a little overshoot) when it shuts, and loosens again when it opens.
      const since = serverMs - closeAt, sinceOpen = serverMs - openAt;
      let cinch = 0;
      if (shut) { const u = clamp(since / 450, 0, 1); cinch = since < 450 ? 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * 0.08 : 1; }
      else if (serverMs >= openAt && sinceOpen < 350) cinch = 1 - smooth(sinceOpen / 350);

      this.shapeBag(b, Math.min(1, Math.max(0, cinch)));
      this.syncHeap(b, seconds, cinch);
      if (b.bowGroup.visible) b.bowLoops.forEach((loop, i) => { const side = loop.userData.side as number; loop.rotation.x = side * 0.07 * Math.sin(seconds * 2.2 + b.id * 1.3 + i); loop.position.y = -b.r * (0.05 + 0.02 * Math.sin(seconds * 2.2 + b.id * 1.3 + i + 1)); }); // (the bow keeps the pose set in shapeBag and only flops a very little round it)
      if (shut !== b.wasShut) { // the bag has just been cinched or let go: a pull (a thunk) or a loosening pop (not for someone arriving mid-round)
        if (Math.abs(serverMs - (shut ? closeAt : openAt)) < 800) audio.playFlat(shut ? giftMiss : giftGrab, shut ? 0.5 : 0.35);
        b.wasShut = shut;
      }
    }

    // Gifts in the air: they move by gravity (each throw has its own) from the last (position, velocity) the server sent (a new one comes at every bounce), spinning, with a shadow on the floor.
    for (const f of this.flights.values()) {
      const dtf = Math.max(0, (serverMs - f.v.t0) / 1000);
      const x = f.v.x0 + f.v.vx * dtf, z = f.v.z0 + f.v.vz * dtf;
      const y = Math.max(0.4, f.v.y0 + f.v.vy * dtf + 0.5 * f.v.g * dtf * dtf);
      f.group.position.set(x, y, z);
      f.group.rotation.set(seconds * 7, seconds * 5, 0);
      f.shadow.position.set(x, 0.06, z);
      f.shadow.scale.setScalar(clamp(1 - y * 0.07, 0.35, 1) * 1.2);
    }

    // Gifts that have landed.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      if (e.kind === 'kick') {
        // Tumbling out of the mouth and falling: down by gravity with the bag's own sideways speed (no more once it is on the floor), spinning; then it shrinks away.
        const t = e.age, y = Math.max(0.45, e.y - 0.5 * 16 * t * t), onFloor = y <= 0.451, slide = onFloor ? 0.25 : 1;
        e.group.position.set(e.x + (e.vx ?? 0) * Math.min(t, 0.9) * slide, y, e.z + (e.vz ?? 0) * Math.min(t, 0.9) * slide);
        if (!onFloor) e.group.rotation.set(t * 6, t * 4, t * 5);
        e.group.scale.setScalar(t > 1.0 ? Math.max(0.01, 1 - (t - 1.0) / 0.4) : 1);
        if (t > 1.4) this.dropEffect(i);
      } else if (e.kind === 'in') {
        const bag = e.bag !== null ? this.bags.get(e.bag) : undefined;
        const mouthAt = new Vector3(e.x, 1, e.z);
        if (bag) bag.mouth.getWorldPosition(mouthAt);
        const mouth = { x: mouthAt.x, y: mouthAt.y, z: mouthAt.z };
        if (e.age === dt) { // the moment it goes in: a gold flash and sparkles at the mouth, a jingle
          this.flash(mouth.x, mouth.y, mouth.z, (bag?.view.radius ?? 1.5) * 2.4, 0.45);
          this.sparks.burst(mouth.x, mouth.y + 0.3, mouth.z, 0.4, 1.4, 0.85, false, false);
          audio.playFlat(giftIn, 0.5);
        }
        const u = smooth(e.age / 0.3);
        e.group.position.set(lerp(e.x, mouth.x, u), lerp(e.y, mouth.y, u), lerp(e.z, mouth.z, u));
        e.group.scale.setScalar(Math.max(0.01, 1 - u)); // (the gift is not shown in the bag: it just disappears into it)
        if (e.age > 0.32) this.dropEffect(i);
      } else {
        const bounce = Math.abs(Math.sin(e.age * 9)) * 0.7 * Math.exp(-e.age * 3.2);
        e.group.position.y = 0.45 + bounce;
        e.group.scale.setScalar(e.age > 1.1 ? Math.max(0.01, 1 - (e.age - 1.1) / 0.4) : 1);
        if (e.age > 1.5) this.dropEffect(i);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { // gold flashes
      const f = this.flashes[i];
      f.age += dt;
      const u = f.age / f.life;
      f.sprite.scale.setScalar(f.size * (0.5 + u * 0.9));
      f.sprite.material.opacity = Math.max(0, 1 - u);
      if (u >= 1) { this.scene.remove(f.sprite); f.sprite.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) { // the "+5" rising from the sleigh
      const f = this.floaters[i];
      f.age += dt;
      f.sprite.position.set(f.x, f.y + f.age * 3, f.z);
      f.sprite.material.opacity = Math.max(0, 1 - f.age / 1.1);
      if (f.age > 1.1) { this.scene.remove(f.sprite); disposeNameTag(f.sprite); this.floaters.splice(i, 1); }
    }

    // The elves: face their rest direction (the bags) or the throw they just made (or the pull in progress), swing their arms; your own elf holds a gift while you pull.
    const own = this.selfId ? this.elves.get(this.selfId) : undefined;
    const aimDir = this.aim && own ? this.toWorld(this.aim) : null;
    if (own && this.selfId) {
      const wantHeld = Boolean(this.aim);
      if (wantHeld && !own.held) { own.held = this.makeGift(this.colorOf(this.selfId), 0); own.held.position.set(0.85, 1.55, 0); own.held.scale.setScalar(0.85); own.group.add(own.held); } // (it just pops into the elf's hands)
      if (!wantHeld && own.held) { own.group.remove(own.held); own.held = null; }
    }
    for (const [id, e] of this.elves) {
      e.throwAge += dt;
      if (id === this.selfId && aimDir && this.aim && this.aim.power >= v.throwMinPower) e.wantYaw = Math.atan2(aimDir.z, aimDir.x);
      else if (e.throwAge > 0.7) e.wantYaw = e.restYaw;
      e.yaw += angleDiff(e.yaw, e.wantYaw) * Math.min(1, dt * 12);
      e.group.rotation.y = -e.yaw;
      const holding = e.held !== null;
      let armAngle = holding ? 1.25 : -0.15 + Math.sin(seconds * 2 + e.x) * 0.06;
      if (e.throwAge < THROW_ANIM) { const u = e.throwAge / THROW_ANIM; armAngle = u < 0.3 ? lerp(1.25, -0.7, smooth(u / 0.3)) : lerp(-0.7, 2.6, smooth((u - 0.3) / 0.7)); }
      e.armL.rotation.z = armAngle; e.armR.rotation.z = armAngle;
    }

    // The aim marker (only for the local player, only while they pull).
    if (own && this.aim && aimDir && this.aim.power >= v.throwMinPower) {
      // The arc the gift would fly for this pull (the same sum the server uses): from the elf's hands, up and over, to the ring at the end. It is a thick tube, 2.5 times as thick as the first
      // thin line, and gets thicker the harder you pull (up to twice as thick again), with an arrowhead and the ring (the cursor) at its end.
      const power = this.aim.power;
      const range = v.rangeMin + (v.rangeMax - v.rangeMin) * power;
      const l = Math.hypot(aimDir.x, aimDir.z) || 1, dx = aimDir.x / l, dz = aimDir.z / l;
      const plan = lobPlan(v.lob, range);
      const hand = new Vector3(own.x, v.lob.handHeight, own.z), vel = new Vector3((dx * range) / plan.flight, plan.vy, (dz * range) / plan.flight);
      const points: Vector3[] = [];
      for (let i = 0; i <= 28; i++) { const t = (plan.flight * i) / 28; points.push(new Vector3(hand.x + vel.x * t, hand.y + vel.y * t - 0.5 * plan.g * t * t, hand.z + vel.z * t)); }
      const end = points[points.length - 1], tangent = end.clone().sub(points[points.length - 3]).normalize();
      const radius = 0.18 * (1 + 0.8 * power); // (0.18 thick: about 2.5 times the first thin line; up to 1.8 times that when pulling as hard as you can)
      const head = radius * 5; // (the arrowhead's length)
      const body = points.slice(0, -2); body.push(end.clone().addScaledVector(tangent, -head * 0.8)); // (the tube stops where the arrowhead starts)
      this.aimTube.geometry.dispose();
      const curve = new CatmullRomCurve3(body);
      this.aimTube.geometry = new TubeGeometry(curve, 28, radius, 12, false);
      this.candyTexture.repeat.set(curve.getLength() / (radius * 9), 1); // (the stripes keep the same size however long or thick the arc is)
      this.aimHead.scale.set(radius * 2.4, head, radius * 2.4);
      this.aimHead.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
      this.aimHead.position.copy(end).addScaledVector(tangent, -head * 0.3);
      this.aimRing.position.copy(end);
      this.aimRing.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent); // (the ring faces the gift coming at it, like the cursor in the sketch)
      this.aimRing.scale.setScalar(2.6);
      this.aimGroup.visible = true;
    } else this.aimGroup.visible = false;

    if (this.snow) { // falling snow: drifts down and a little sideways, and starts again at the top
      const pos = this.snow.geometry.getAttribute('position') as Float32BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * (1.6 + (i % 5) * 0.35);
        if (y < 0) y += 34;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(seconds * 0.7 + i) * dt * 0.6);
      }
      pos.needsUpdate = true;
    }
    this.sparks.update(dt);
    this.updateCamera(dt, v);
    this.renderer.render(this.scene, this.camera);
  };

  private flash(x: number, y: number, z: number, size: number, life: number) {
    const sprite = new Sprite(new SpriteMaterial({ map: this.glowTexture, color: '#ffd866', transparent: true, blending: AdditiveBlending, depthWrite: false }));
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size * 0.5);
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0, life, size });
  }

  private dropEffect(i: number) { const e = this.effects[i]; this.scene.remove(e.group); this.effects.splice(i, 1); }

  /**
   * The camera: high behind the followed elf, looking along the way it faces. The start countdown begins high over the whole room and settles in behind your elf by GO;
   * in the winner moment it glides to the winner's elf (null = back up over the whole room, which is also what a draw shows).
   */
  private updateCamera(dt: number, v: SantaSackView) {
    const st = this.view.targetId ? v.stations[this.view.targetId] : undefined;
    const overviewPos = new Vector3(0, 52, 34), overviewLook = new Vector3(0, 0, -3); // (over the whole room)
    let pos = overviewPos.clone(), look = overviewLook.clone();
    if (st) {
      const f = { x: Math.cos(st.facing), z: Math.sin(st.facing) };
      pos = new Vector3(st.x - f.x * CAM_BACK, CAM_HEIGHT, st.z - f.z * CAM_BACK);
      look = new Vector3(st.x + f.x * CAM_AHEAD, 0, st.z + f.z * CAM_AHEAD);
    }
    const intro = smooth(this.introFactor());
    if (intro < 1) { pos = overviewPos.clone().lerp(pos, intro); look = overviewLook.clone().lerp(look, intro); } // (the opening: from over the whole room to behind your elf, placed exactly by the clock)
    if (!this.camStarted || intro < 1) { this.camPos.copy(pos); this.camLook.copy(look); this.camStarted = true; }
    else { const k = 1 - Math.exp(-3 * dt); this.camPos.lerp(pos, k); this.camLook.lerp(look, k); }
    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    audio.setListener(this.camLook.x, this.camLook.z);
  }
}

/** A soft round glow (white in the middle fading to nothing), used tinted and added on top: the bags' halos, the gold flashes. */
function makeGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Red and white diagonal stripes for every ribbon. */
function makeStripeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#d32f2f';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 8 + 32, 32); g.lineTo(i * 16 + 32, 32); g.closePath(); g.fill(); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A wood-plank floor, drawn on a small canvas and repeated. */
function makePlankTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const colors = ['#b88a54', '#a97b47', '#c19760', '#b0804d'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = colors[i];
    g.fillRect(0, i * 64, 256, 64);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, i * 64, 256, 2);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(Math.random() * 256, i * 64 + 6 + Math.random() * 50, 30 + Math.random() * 80, 1.5); }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(((i * 97) % 256), i * 64, 2, 64);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A small seeded random number generator, so the forest is the same on every phone. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Snow: pale blue-white with faint sparkles and soft shading, repeated across the ground. */
function makeSnowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(150,180,215,${0.05 + Math.random() * 0.06})`; g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Bold red and white stripes for a bag's ribbon (a few wide stripes, so they stay readable from far away). */
/** Diagonal red and white stripes that tile in both directions (45 degrees on the texture: they spiral round the tube like a candy cane). */
function makeCandyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e5322d';
  for (let i = -2; i <= 3; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 - 64, 64); g.lineTo(i * 32 - 64, 64);
    g.closePath(); g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function makeRibbonTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#d32f2f';
  g.fillRect(0, 0, 16, 32);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}
