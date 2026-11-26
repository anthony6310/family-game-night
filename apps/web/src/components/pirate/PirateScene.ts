import { WhaleActor } from './WhaleActor';
import { WHALE_TUNING, breachEvents, whaleVisitAt } from '@fgn/shared';
import {
  AdditiveBlending, BoxGeometry, Color, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Quaternion, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, Vector3, WebGLRenderer, BackSide, CylinderGeometry, Object3D,
} from 'three';
import {
  DECK_Y, WICK_MS, RELOAD_MS, aimDir, enemyOf, pivotLocal, shipPose, shotPoint, sideOf, stationLocal,
  type PirateBroadsideView, type PiratePlayerView, type PirateShotView, type TeamId,
} from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { cannonBoom, hitReceived, readyClang, reloadChain, seaSplash, shipHit, whaleBlocked, whaleRumble, whaleSplash, whaleSpout, wickBurn, wickLight } from '../../audio/pirateSounds';
import { createNameTag, disposeNameTag } from '../labelTexture';
import { SparkSystem } from '../taprace/sparks';
import {
  MAST_HEIGHTS, MAST_XS, billowSail, buildBarrel, buildCarriage, buildDeck, buildFittings, buildRigging, buildFlag, buildHull, buildBore, buildSail, makeSailTexture, makeSeaMaterial, makeSoftTexture,
  makeWakeTexture, makeWakeFadeTexture, waveFlag, buildWheel, WHEEL_RADIUS, type SailRig,
} from './PirateModels';

/** How a pirate is labelled. */
export interface CrewStyle { name: string; color: string }

const FOV_H = 72;
const EYE_BEHIND = 0.4; // how far behind the barrel's pivot the player's eyes are (it was 2.9 at first): this far forward the back of the cannon falls behind the camera and is cropped
const EYE_HEIGHT = 3.6; // how far above the deck the eyes are: high enough that the barrel sits low in the picture and does not hide the target
const TEAM_COLOR: Record<TeamId, string> = { yellow: '#ffd23d', purple: '#8e44ad' };
const CAM_FOLLOW_YAW = 0.7; // the view turns this much of the way with the cannon (the barrel then moves across the view)
const CAM_FOLLOW_PITCH = 0.45;
const BALL_POOL = 24;
const BREACH = breachEvents(WHALE_TUNING); // (the moments of the big breach: the splash sound lands on `enter`)
const MUZZLE_SMOKE_SHARE = 0.2; // the grey smoke of a cannon firing: 80% less than before
const MUZZLE_SPARK_SHARE = 0.85; // the sparks of a cannon firing: 15% fewer than before
const BLAST_SCALE = 1.8; // (the smoke of it is then 20% less, and the sparks 40% more and 50% bigger) // the flash, flame and smoke of a cannon firing: 80% more than at first
const WICK_AT_Z = 1.4; // the wick grows out of the top of the barrel about half way up what the player can see of it (the back of the cannon is cropped off the screen)
// The recoil: the whole cannon (the barrel on its wheeled carriage) rolls straight back along the deck by this share of the barrel's length, very fast, and then rolls forward to its firing place over the reload; the wheels turn as it goes.
const BARREL_FULL_LENGTH = 3.12;
const RECOIL_FRACTION = 0.4;
const RECOIL_SNAP_MS = 60;
// Screen shake: your own cannon firing, and (half as much) your ship being hit. Other cannons firing never shake your screen.
const SHAKE_FIRE = 0.455; // (0.35, then 30% stronger)
const SHAKE_HIT_RECEIVED = SHAKE_FIRE * 0.5;
const PUFF_POOL = 420;
// From the deck of their own ship the players see through its masts, yards and sails (so a mast never hides the target); the other ship is drawn solid.
const GHOST_RIGGING = 0.12;
const GHOST_SAILS = 0.22;
// The sparks (the same spark effect as Tap Race), fiery orange only.
const FIRE_COLORS: [number, number, number][] = [[1, 0.42, 0.04], [1, 0.52, 0.08], [1, 0.34, 0.02], [1, 0.6, 0.12]];
const SPLINTER_POOL = 70;

interface CannonVis {
  id: string; team: TeamId; slot: number; count: number;
  pivot: Group; // turns with the aim
  carriage: Group; wheels: Mesh[]; cord: Mesh; spark: Sprite; tag: Sprite;
  yaw: number; pitch: number; // what is drawn (smoothed for other people's cannons)
  litAt: number | null; lastBoomAt: number;
}
interface ShipVis { team: TeamId; group: Group; sails: SailRig[]; flag: ReturnType<typeof buildFlag>; cannons: Map<string, CannonVis>; wakeTextures: Texture[]; ghost: { rigging: MeshStandardMaterial; sails: MeshStandardMaterial[] } }
interface Splinter { mesh: Mesh; vel: Vector3; spin: Vector3; age: number; life: number; size: number }
interface Puff { sprite: Sprite; mat: SpriteMaterial; vel: Vector3; age: number; life: number; s0: number; s1: number; grav: number; drag: number; alpha: number }

const ease = (u: number) => u * u * (3 - 2 * u);
const v3 = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);

export class PirateScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(70, 1, 0.1, 900);
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private time = 0;
  private latest: PirateBroadsideView | null = null;
  private ships = {} as Record<TeamId, ShipVis>;
  private sea: ShaderMaterial;
  private clouds: Group[] = [];
  private balls: Mesh[] = [];
  private puffs: Puff[] = [];
  private splinters: Splinter[] = [];
  private sparks = new SparkSystem(900);
  private seen = new Map<number, { fired: boolean; landed: boolean }>();
  private wickSeen = new Map<string, number>();
  private eyeId: string | null;
  private winner = { on: false, team: null as TeamId | null };
  private camSmooth = { pos: new Vector3(), quat: new Quaternion(), ready: false };
  private shake = 0;
  /** Review-page hooks: anything that wants a say each frame (returns a shake level), and a camera that replaces the game's. */
  frameHook: ((dt: number, time: number) => number | void) | null = null;
  cameraOverride: ((camera: PerspectiveCamera, shake: number) => void) | null = null;
  /** The whale's three visits are drawn from the view's schedule; the review page turns this off and drives its own. */
  whaleEnabled = true;
  private whale!: WhaleActor;
  private whaleHeard = new Set<string>(); // which of the whale's sounds have played
  get world() { return this.scene; }
  get cam() { return this.camera; }
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  private soft = makeSoftTexture();
  private tmp = { v: new Vector3(), q: new Quaternion(), m: new Matrix4(), q2: new Quaternion(), look: new Matrix4() };

  /** Where the player's own cannon points, written by the aiming controls (the scene moves the barrel at once; the server's idea only follows). */
  aim = { yaw: 0, pitch: 0.4 };
  /** The start countdown's camera move, 0 (a view of both ships) .. 1 (the player's eyes). */
  introFactor: () => number = () => 1;
  serverNow: () => number = () => Date.now();

  constructor(private container: HTMLElement, private styles: Record<string, CrewStyle>, private selfId: string | null) {
    this.eyeId = selfId;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer, this.soft);
    this.sea = makeSeaMaterial();
    this.disposables.push(this.sea);
    this.buildWorld();
    this.ships.yellow = this.buildShip('yellow');
    this.ships.purple = this.buildShip('purple');
    this.whale = new WhaleActor(this.scene);
    this.buildBalls();
    this.buildPuffs();
    this.buildSplinters();
    this.sparks.floorAt = () => -60; // (sparks just fall: nothing for them to bounce on)
    this.scene.add(this.sparks.object);
    this.disposables.push(this.sparks);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------

  pushView(view: PirateBroadsideView) {
    this.latest = view;
    for (const team of ['yellow', 'purple'] as const) this.syncCannons(this.ships[team], view);
  }
  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); }
  /** Whose cannon the camera looks along (a player: their own; a spectator: the one they follow), or at the end the winning ship (null team = a draw: both ships). */
  setCameraView(view: { targetId: string | null; winner?: boolean; winnerTeam?: TeamId | null }) {
    this.winner = { on: !!view.winner, team: view.winnerTeam ?? null };
    if (!view.winner) this.eyeId = view.targetId;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.whale.dispose();
    for (const ship of Object.values(this.ships)) for (const c of ship.cannons.values()) disposeNameTag(c.tag);
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as unknown as { dispose?: () => void; map?: Texture | null } | undefined;
      if (mat) { mat.map?.dispose?.(); mat.dispose?.(); }
    });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  // ---------- the world ----------

  private buildWorld() {
    const sky = new Color('#bfe1ee');
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 140, 420);
    this.scene.add(new HemisphereLight(0xffffff, 0x6fa2c0, 1.5));
    const sun = new DirectionalLight(0xfff0cf, 2.4);
    sun.position.set(60, 90, 40);
    this.scene.add(sun);
    // The sky: a dome that goes from deep blue overhead to pale at the horizon.
    const dome = new Mesh(new SphereGeometry(700, 24, 16), new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); vec3 c = mix(vec3(0.75,0.88,0.94), vec3(0.22,0.5,0.82), pow(h, 0.55)); gl_FragColor = vec4(c, 1.0); }',
    }));
    this.scene.add(dome);
    // The sea.
    const sea = new Mesh(new PlaneGeometry(900, 900, 300, 300).rotateX(-Math.PI / 2), this.sea);
    sea.frustumCulled = false;
    this.scene.add(sea);
    // Clouds drifting past (towards the stern, like the sea): flat white puffs, part of the feeling of sailing.
    const cloudMat = new MeshBasicMaterial({ color: '#ffffff', fog: false });
    this.disposables.push(cloudMat);
    const ball = new SphereGeometry(1, 8, 6);
    this.disposables.push(ball);
    for (let i = 0; i < 18; i++) {
      const cloud = new Group();
      const n = 4 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) { const puff = new Mesh(ball, cloudMat); puff.scale.set(8 + Math.random() * 8, 3 + Math.random() * 2.5, 6 + Math.random() * 5); puff.position.set((k - n / 2) * 9, Math.random() * 2, (Math.random() - 0.5) * 6); cloud.add(puff); }
      cloud.position.set((Math.random() - 0.5) * 800, 70 + Math.random() * 50, (Math.random() - 0.5) * 700);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  // ---------- a ship ----------

  private buildShip(team: TeamId): ShipVis {
    const color = TEAM_COLOR[team];
    const group = new Group();
    group.rotation.order = 'YZX'; // (the same order as the shared maths: roll first, then pitch, then yaw)
    const track = <T extends { dispose(): void }>(t: T) => { this.disposables.push(t); return t; };
    const hull = new Mesh(track(buildHull(color)), track(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: DoubleSide })));
    const deckBuilt = buildDeck();
    const deck = new Mesh(track(deckBuilt.geometry), track(new MeshStandardMaterial({ map: track(deckBuilt.texture), roughness: 0.9 })));
    const fittings = new Mesh(track(buildFittings(team, color)), track(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })));
    const riggingMat = track(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }));
    const rigging = new Mesh(track(buildRigging()), riggingMat);
    group.add(hull, deck, fittings, rigging);
    const sailTexture = track(makeSailTexture(color));
    const sails: SailRig[] = [];
    MAST_XS.forEach((x, i) => {
      const lower = buildSail(sailTexture, x + 0.2, 7.3, 4.7, i * 1.7 + (team === 'yellow' ? 0 : 1));
      const upper = buildSail(sailTexture, x + 0.2, 12.5, MAST_HEIGHTS[i] - 0.9 - 12.5, i * 1.7 + 0.9 + (team === 'yellow' ? 0 : 1));
      for (const s of [lower, upper]) { group.add(s.mesh); sails.push(s); track(s.geometry); }
    });
    const flag = buildFlag(color);
    flag.mesh.position.set(0.2, MAST_HEIGHTS[1] + 0.2, 0);
    group.add(flag.mesh);
    track(flag.geometry);
    // Foam streaming along each side of the hull, towards the stern.
    const wakeTexture = track(makeWakeTexture());
    const wakeMat = track(new MeshBasicMaterial({ map: wakeTexture, alphaMap: track(makeWakeFadeTexture()), transparent: true, depthWrite: false, opacity: 0.8, blending: AdditiveBlending }));
    const wakeLength = 34 * 1.5; // from the bow to half a ship's length beyond the stern
    const wakeGeo = track(new PlaneGeometry(wakeLength, 3.2));
    for (const s of [-1, 1]) {
      const wake = new Mesh(wakeGeo, wakeMat);
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(17 - wakeLength / 2, 0.3, s * (4.7 + 1.1));
      group.add(wake);
    }
    // (the wakes live in the ship's group so they rock with it; the water is never far from the hull)
    this.scene.add(group);
    return { team, group, sails, flag, cannons: new Map(), wakeTextures: [wakeTexture], ghost: { rigging: riggingMat, sails: sails.map((s) => s.mesh.material as MeshStandardMaterial) } };
  }

  private cannonGeos: ReturnType<typeof this.makeCannonGeos> | null = null;
  private makeCannonGeos() {
    const barrel = buildBarrel(), carriage = buildCarriage(), bore = buildBore(), wheel = buildWheel();
    this.disposables.push(barrel, carriage, bore, wheel);
    return { barrel, carriage, bore, wheel, boreMat: new MeshBasicMaterial({ color: '#050506' }), ironMat: new MeshStandardMaterial({ color: '#2a2d33', roughness: 0.45, metalness: 0.55, flatShading: true }), woodMat: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }) };
  }

  /** One cannon per pirate on this ship (made when they appear, removed when they leave). */
  private syncCannons(ship: ShipVis, view: PirateBroadsideView) {
    if (!this.cannonGeos) { this.cannonGeos = this.makeCannonGeos(); this.disposables.push(this.cannonGeos.ironMat, this.cannonGeos.woodMat, this.cannonGeos.boreMat); }
    const geos = this.cannonGeos;
    const here = Object.entries(view.players).filter(([, p]) => p.team === ship.team);
    for (const [id, p] of here) {
      if (ship.cannons.has(id)) continue;
      const side = sideOf(ship.team);
      const count = view.crew[ship.team];
      const station = stationLocal(ship.team, p.slot, count);
      const pivotAt = pivotLocal(ship.team, p.slot, count);
      const carriage = new Group(); // the wooden carriage and its four wheels: it rolls back when the cannon fires
      carriage.position.set(station[0], station[1], station[2]);
      carriage.rotation.y = side === 1 ? 0 : Math.PI;
      carriage.add(new Mesh(geos.carriage, geos.woodMat));
      const wheels: Mesh[] = [];
      for (const wx of [-0.82, 0.82]) for (const wz of [-0.6, 1.2]) {
        const wheel = new Mesh(geos.wheel, geos.woodMat);
        wheel.position.set(wx, WHEEL_RADIUS, wz);
        carriage.add(wheel); wheels.push(wheel);
      }
      const pivot = new Group();
      pivot.position.set(pivotAt[0], pivotAt[1], pivotAt[2]);
      const barrel = new Mesh(geos.barrel, geos.ironMat);
      pivot.add(barrel);
      pivot.add(new Mesh(geos.bore, geos.boreMat)); // the dark inside of the muzzle
      const cord = new Mesh(new CylinderGeometry(0.025, 0.025, 1, 6).translate(0, 0.5, 0), new MeshBasicMaterial({ color: '#d8b878' }));
      const cordDir = new Vector3(0, 0.95, -0.3).normalize();
      cord.position.set(0, 0.43, WICK_AT_Z);
      cord.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), cordDir);
      pivot.add(cord);
      const spark = new Sprite(new SpriteMaterial({ map: this.soft, color: '#ff9a2e', blending: AdditiveBlending, transparent: true, depthWrite: false }));
      spark.visible = false;
      pivot.add(spark);
      const style = this.styles[id] ?? { name: '?', color: TEAM_COLOR[ship.team] };
      const tag = createNameTag(style.name, TEAM_COLOR[ship.team]);
      tag.scale.set(3.2, 0.8, 1);
      tag.position.set(pivotAt[0], pivotAt[1] + 1.9, pivotAt[2] - side * 0.6);
      ship.group.add(carriage, pivot, tag);
      ship.cannons.set(id, { id, team: ship.team, slot: p.slot, count, pivot, carriage, wheels, cord, spark, tag, yaw: p.yaw, pitch: p.pitch, litAt: null, lastBoomAt: -1e9 });
    }
    for (const [id, c] of ship.cannons) {
      if (id in view.players) continue;
      ship.group.remove(c.carriage, c.pivot, c.tag);
      disposeNameTag(c.tag);
      ship.cannons.delete(id);
    }
  }

  // ---------- cannonballs and effects ----------

  private buildBalls() {
    const geo = new SphereGeometry(0.5, 12, 10);
    const mat = new MeshStandardMaterial({ color: '#1b1d22', roughness: 0.4, metalness: 0.5 });
    this.disposables.push(geo, mat);
    for (let i = 0; i < BALL_POOL; i++) { const b = new Mesh(geo, mat); b.visible = false; this.scene.add(b); this.balls.push(b); }
  }
  private buildPuffs() {
    for (let i = 0; i < PUFF_POOL; i++) {
      const mat = new SpriteMaterial({ map: this.soft, transparent: true, depthWrite: false });
      const sprite = new Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.puffs.push({ sprite, mat, vel: new Vector3(), age: 99, life: 1, s0: 1, s1: 1, grav: 0, drag: 0, alpha: 1 });
    }
  }
  /** Wood splinters: thin, sharp shards (some long like torn planks, some short) in raw and dark wood colors, that tumble as they fly. */
  private buildSplinters() {
    const shard = new BoxGeometry(0.07, 0.05, 0.75).translate(0, 0, 0);
    const chunk = new BoxGeometry(0.16, 0.09, 0.4);
    const colors = ['#c79a63', '#a87a48', '#6b4426', '#8a5a35', '#d8b27a'];
    const mats = colors.map((color) => new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
    this.disposables.push(shard, chunk, ...mats);
    for (let i = 0; i < SPLINTER_POOL; i++) {
      const mesh = new Mesh(i % 4 === 0 ? chunk : shard, mats[i % mats.length]);
      mesh.visible = false;
      this.scene.add(mesh);
      this.splinters.push({ mesh, vel: new Vector3(), spin: new Vector3(), age: 99, life: 1, size: 1 });
    }
  }
  private splinter(at: Vector3, vel: Vector3) {
    const sp = this.splinters.find((q) => q.age >= q.life);
    if (!sp) return;
    sp.age = 0; sp.life = this.rand(0.9, 1.6); sp.size = this.rand(0.7, 1.5);
    sp.vel.copy(vel);
    sp.spin.set(this.rand(-14, 14), this.rand(-14, 14), this.rand(-14, 14));
    sp.mesh.position.copy(at);
    sp.mesh.rotation.set(this.rand(0, 6), this.rand(0, 6), this.rand(0, 6));
    sp.mesh.scale.setScalar(sp.size);
    sp.mesh.visible = true;
  }
  private updateSplinters(dt: number) {
    for (const sp of this.splinters) {
      if (!sp.mesh.visible) continue;
      sp.age += dt;
      if (sp.age >= sp.life) { sp.mesh.visible = false; continue; }
      sp.vel.y -= 16 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      sp.mesh.rotation.x += sp.spin.x * dt; sp.mesh.rotation.y += sp.spin.y * dt; sp.mesh.rotation.z += sp.spin.z * dt;
      const u = sp.age / sp.life;
      sp.mesh.scale.setScalar(sp.size * (u < 0.7 ? 1 : (1 - u) / 0.3)); // (they shrink away at the end)
      if (sp.mesh.position.y < 0.1) sp.mesh.visible = false; // (into the sea)
    }
  }

  private puff(pos: Vector3, vel: Vector3, o: { life: number; s0: number; s1: number; color: string; additive?: boolean; grav?: number; drag?: number; alpha?: number }) {
    const p = this.puffs.find((q) => q.age >= q.life);
    if (!p) return;
    p.age = 0; p.life = o.life; p.s0 = o.s0; p.s1 = o.s1; p.grav = o.grav ?? 0; p.drag = o.drag ?? 0; p.alpha = o.alpha ?? 1;
    p.vel.copy(vel);
    p.mat.color.set(o.color);
    p.mat.blending = o.additive ? AdditiveBlending : 1;
    p.mat.needsUpdate = true;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
  }
  private updatePuffs(dt: number) {
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.sprite.visible = false; continue; }
      const u = p.age / p.life;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * u);
      p.mat.opacity = p.alpha * (1 - u) * Math.min(1, u * 8 + 0.2);
    }
  }
  private rand(a: number, b: number) { return a + Math.random() * (b - a); }

  /** How far back the barrel is (0 = in its firing place, 1 = at full recoil), `ageMs` after the shot: it snaps back very fast, then eases home over the 2 second reload. */
  private recoilAmount(ageMs: number): number {
    if (ageMs < 0) return 0;
    if (ageMs < RECOIL_SNAP_MS) return ageMs / RECOIL_SNAP_MS;
    const u = (ageMs - RECOIL_SNAP_MS) / RELOAD_MS;
    return u >= 1 ? 0 : 1 - ease(u);
  }

  private splash(at: Vector3) {
    for (let i = 0; i < 18; i++) this.puff(at, new Vector3(this.rand(-3, 3), this.rand(5, 10), this.rand(-3, 3)), { life: this.rand(0.8, 1.3), s0: 0.8, s1: 1.8, color: '#eaf6ff', grav: 16, alpha: 0.9 });
    for (let i = 0; i < 6; i++) this.puff(at, new Vector3(this.rand(-1.5, 1.5), this.rand(0.5, 2), this.rand(-1.5, 1.5)), { life: 1.2, s0: 1.5, s1: 5, color: '#f4fbff', alpha: 0.55, drag: 1.5 });
  }
  private hitBurst(at: Vector3) {
    this.puff(at, new Vector3(), { life: 0.25, s0: 3, s1: 7, color: '#ffd27a', additive: true });
    for (let i = 0; i < 26; i++) this.splinter(at, new Vector3(this.rand(-7, 7), this.rand(1.5, 9), this.rand(-7, 7))); // wood splinters fly out of the hit
    for (let i = 0; i < 6; i++) this.puff(at, new Vector3(this.rand(-1.5, 1.5), this.rand(1, 3), this.rand(-1.5, 1.5)), { life: this.rand(1.2, 1.9), s0: 1.6, s1: 5, color: '#6b6e75', alpha: 0.7, drag: 0.8 });
  }
  /** Throw some sparks (the Tap Race spark effect, fiery orange only) from a point: `count` is per second for a steady source, called once per frame with a share of it. */
  private throwSparks(at: Vector3, dirSpeed: number, spread: number, scale: number) {
    const n = Math.random() < 0.6 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = FIRE_COLORS[Math.floor(Math.random() * FIRE_COLORS.length)];
      // (small: the wick is close to the player's eyes, so a spark only needs to be a few millimetres of core and a short streak)
      this.sparks.emit(at.x, at.y, at.z, this.rand(-spread, spread), this.rand(0.6, spread + 0.8), this.rand(-spread, spread), this.rand(0.008, 0.016) * 1.5 * scale, this.rand(0.3, 0.6), r, g, b, true, 0.16 * 1.5); // (50% bigger than at first)
    }
    void dirSpeed;
  }

  /** The cannon fires: fire and smoke pour out of the end of the barrel (80% bigger and more of it than at first): a flash, a jet of flame, a spray of fiery sparks and a heavy plume of smoke. */
  private muzzleBlast(at: Vector3, dir: Vector3) {
    const K = BLAST_SCALE;
    this.puff(at, dir.clone().multiplyScalar(2), { life: 0.14, s0: 2 * K, s1: 4.2 * K, color: '#ffe9a8', additive: true, alpha: 0.8 });
    for (let i = 0; i < Math.round(16 * K); i++) this.puff(at.clone().addScaledVector(dir, this.rand(0, 0.8 * K)), dir.clone().multiplyScalar(this.rand(9, 20) * 1.4).add(new Vector3(this.rand(-1.2, 1.2) * K, this.rand(-0.6, 1.6) * K, this.rand(-1.2, 1.2) * K)), { life: this.rand(0.1, 0.26) * 1.4, s0: this.rand(1.6, 2.6) * K, s1: 0.5 * K, color: i % 2 ? '#ff8a1c' : '#ffd45a', additive: true, drag: 3 });
    for (let i = 0; i < Math.round(24 * K * 1.4 * MUZZLE_SPARK_SHARE); i++) { // (40% more sparks, then 15% fewer)
      const [r, g, b] = FIRE_COLORS[Math.floor(Math.random() * FIRE_COLORS.length)];
      const v = dir.clone().multiplyScalar(this.rand(7, 20)).add(new Vector3(this.rand(-5, 5), this.rand(-1, 5), this.rand(-5, 5)));
      this.sparks.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.rand(0.05, 0.1) * 1.5, this.rand(0.4, 0.9), r, g, b, true, 0.8 * 1.5); // (50% bigger)
    }
    for (let i = 0; i < Math.round(9 * K * 0.8 * MUZZLE_SMOKE_SHARE); i++) this.puff(at.clone().addScaledVector(dir, this.rand(0, 1.2 * K)), dir.clone().multiplyScalar(this.rand(2, 7) * 1.2).add(new Vector3(this.rand(-1, 1), this.rand(0.5, 2), this.rand(-1, 1))), { life: this.rand(1.2, 2.2) * 1.4, s0: 1.2 * K, s1: 4.5 * K, color: '#9a9ea6', alpha: 0.75, drag: 1.1 });
  }

  // ---------- per frame ----------

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(FOV_H) / 2) / aspect)), 50, 100);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    const hook = this.frameHook?.(dt, this.time);
    if (typeof hook === 'number') this.shake = Math.max(this.shake, hook);
    this.update(dt);
    this.cameraOverride?.(this.camera, this.shake);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    const view = this.latest;
    this.sea.uniforms.uTime.value = this.time;
    this.sea.uniforms.uFog.value.set('#bfe1ee');
    for (const c of this.clouds) { c.position.x -= 5 * dt; if (c.position.x < -420) c.position.x += 840; } // (clouds stream past too)
    if (!view) return;
    const t = (this.serverNow() - view.startsAt) / 1000; // the round's clock: the ships' rocking is a function of it
    for (const team of ['yellow', 'purple'] as const) this.poseShip(this.ships[team], t);
    for (const team of ['yellow', 'purple'] as const) this.ships[team].group.updateMatrixWorld(true);
    this.updateCannons(view, dt);
    this.updateShots(view, dt);
    this.updatePuffs(dt);
    this.updateSplinters(dt);
    this.sparks.update(dt);
    this.updateGhosts();
    this.updateWhale(view, t);
    this.updateCamera(view, dt);
  }

  private poseShip(ship: ShipVis, t: number) {
    const pose = shipPose(ship.team, t);
    const side = sideOf(ship.team);
    ship.group.position.set(0, pose.heave, -side * pose.lane); // (the ships drift closer and further apart)
    ship.group.rotation.set(pose.roll, pose.yaw, pose.pitch); // (order YZX)
    for (const s of ship.sails) billowSail(s, this.time);
    waveFlag(ship.flag, this.time);
    for (const tex of ship.wakeTextures) tex.offset.x = (this.time * 0.3) % 1; // the foam streams towards the stern (about 15 units a second)
  }

  /** The cannons: the barrel follows its aim, the wick burns visibly (shrinking with a spark at its end), and the barrel kicks back when it fires. */
  private updateCannons(view: PirateBroadsideView, dt: number) {
    const now = this.serverNow();
    for (const ship of Object.values(this.ships)) {
      for (const [id, c] of ship.cannons) {
        const p = view.players[id];
        if (!p) continue;
        if (id === this.selfId) { c.yaw = this.aim.yaw; c.pitch = this.aim.pitch; }
        else { const k = Math.min(1, 12 * dt); c.yaw += (p.yaw - c.yaw) * k; c.pitch += (p.pitch - c.pitch) * k; }
        const dir = aimDir(ship.team, c.yaw, c.pitch);
        const d = this.tmp.v.set(dir[0], dir[1], dir[2]);
        c.pivot.quaternion.setFromRotationMatrix(this.tmp.look.lookAt(d, new Vector3(0, 0, 0), new Vector3(0, 1, 0))); // (the barrel's z points along the aim and its up stays up: it never rolls, so the wick is always on top)
        const base = pivotLocal(ship.team, c.slot, c.count);
        // The whole cannon rolls back along the deck (away from the way it fires), the wheels turning backwards as it goes and forwards as it comes home.
        const back = this.recoilAmount(now - c.lastBoomAt) * RECOIL_FRACTION * BARREL_FULL_LENGTH;
        const side = sideOf(ship.team);
        c.pivot.position.set(base[0], base[1], base[2] - side * back);
        const st = stationLocal(ship.team, c.slot, c.count);
        c.carriage.position.set(st[0], st[1], st[2] - side * back);
        for (const w of c.wheels) w.rotation.x = -back / WHEEL_RADIUS;
        c.tag.visible = id !== this.eyeId;
        // the wick
        const lit = p.wickAt !== null;
        const cordLen = 0.39;
        if (lit) {
          const rem = 1 - MathUtils.clamp((now - p.wickAt!) / WICK_MS, 0, 1);
          c.cord.visible = rem > 0.02;
          c.cord.scale.y = cordLen * rem;
          const tip = new Vector3(0, 0.43, WICK_AT_Z).addScaledVector(new Vector3(0, 0.95, -0.3).normalize(), cordLen * rem);
          c.spark.visible = true;
          c.spark.position.copy(tip);
          c.spark.scale.setScalar(0.25 + 0.09 * Math.sin(this.time * 40 + c.slot) + 0.03 * Math.random());
          const w = c.pivot.localToWorld(tip.clone());
          this.throwSparks(w, 0, 1.6, 1 + Math.random() * 0.4); // sparks fly off the burning end, all fiery orange
          if (c.litAt !== p.wickAt) { c.litAt = p.wickAt; if (now - p.wickAt! < 400) { audio.playFlat(wickLight, id === this.selfId ? 0.5 : 0.18); if (id === this.eyeId) audio.playFlat(wickBurn, 0.35); } }
        } else {
          c.spark.visible = false;
          c.cord.visible = now >= p.readyAt; // used up while reloading, a fresh one when ready
          c.cord.scale.y = cordLen;
          c.litAt = null;
        }
      }
    }
  }

  /** The whale's visits (peek, then blow, then the big breach), at the times the server drew for this round. Its leap shakes the screen. */
  private updateWhale(view: PirateBroadsideView, t: number) {
    const visit = this.whaleEnabled ? whaleVisitAt(view.whale, t) : null;
    if (!visit) { this.whale.hide(); return; }
    this.whaleSounds(visit.kind, visit.t);
    const shake = this.whale.update(visit.kind, visit.t, WHALE_TUNING, this.camera, this.renderer.domElement.height);
    this.shake = Math.max(this.shake, shake);
  }

  /** The whale's sounds, each played once as its moment arrives (never for someone who joins late: a moment more than a second old is skipped). */
  private whaleSounds(kind: 'peek' | 'blow' | 'breach', t: number) {
    const once = (key: string, at: number, play: () => void) => {
      if (t < at || t > at + 1 || this.whaleHeard.has(key)) return;
      this.whaleHeard.add(key);
      play();
    };
    if (kind === 'blow') once('spout', WHALE_TUNING.blowSeconds * WHALE_TUNING.blowAt, () => audio.playFlat(whaleSpout, 0.5));
    if (kind === 'breach') {
      once('rumble', 0, () => audio.playFlat(whaleRumble, 0.7, 0.4)); // (builds with the growing screen shake)
      once('splash', BREACH.enter, () => audio.playFlat(whaleSplash, 0.8));
    }
  }

  private updateShots(view: PirateBroadsideView, dt: number) {
    const now = this.serverNow();
    const myTeam = this.eyeId ? view.players[this.eyeId]?.team ?? null : null;
    let ball = 0;
    for (const s of view.shots) {
      let st = this.seen.get(s.id);
      if (!st) { st = { fired: false, landed: false }; this.seen.set(s.id, st); }
      const tau = (now - s.launchAt) / 1000;
      const dur = (s.endAt - s.launchAt) / 1000;
      if (!st.fired && now >= s.launchAt) {
        st.fired = true;
        const c = this.ships[s.team].cannons.get(s.owner);
        if (c) c.lastBoomAt = s.launchAt;
        if (now - s.launchAt < 800) this.fireEffects(s, c, myTeam);
      }
      if (tau >= 0 && tau < dur && ball < this.balls.length) {
        const b = this.balls[ball++];
        const p = shotPoint(s, tau);
        b.position.set(p[0], p[1], p[2]);
        b.visible = true;
        if (Math.random() < dt * 22) this.puff(b.position, new Vector3(this.rand(-0.3, 0.3), this.rand(0, 0.4), this.rand(-0.3, 0.3)), { life: 0.9, s0: 0.5, s1: 1.4, color: '#c9ccd2', alpha: 0.45 });
      }
      if (!st.landed && now >= s.endAt) {
        st.landed = true;
        if (now - s.endAt < 800) this.landEffects(s, myTeam);
      }
    }
    for (; ball < this.balls.length; ball++) this.balls[ball].visible = false;
    if (this.seen.size > 80) for (const id of [...this.seen.keys()].slice(0, 40)) this.seen.delete(id);
    this.shake *= Math.exp(-5 * dt);
  }

  private fireEffects(s: PirateShotView, c: CannonVis | undefined, myTeam: TeamId | null) {
    const at = v3(s.p0);
    const dir = new Vector3(s.v0[0], s.v0[1], s.v0[2]).normalize();
    this.muzzleBlast(at, dir);
    const mine = s.owner === this.eyeId;
    audio.playFlat(cannonBoom, mine ? 0.9 : s.team === myTeam ? 0.55 : 0.4, 0, mine ? 1 : s.team === myTeam ? 0.6 : 0.4);
    if (mine) {
      this.shake = Math.max(this.shake, SHAKE_FIRE); // (only your own cannon shakes your screen)
      audio.playFlat(reloadChain, 0.5, 0.5); // the reload starts once the boom has died down...
      audio.playFlat(readyClang, 0.55, Math.max(0.1, (s.launchAt + RELOAD_MS - this.serverNow()) / 1000)); // ...and the clang says the cannon is ready (as the FIRE button turns green)
    }
    void c;
  }

  private landEffects(s: PirateShotView, myTeam: TeamId | null) {
    if (s.hit && s.hitLocal) {
      const enemy = this.ships[enemyOf(s.team)];
      const at = enemy.group.localToWorld(v3(s.hitLocal));
      this.hitBurst(at);
      const onMyShip = myTeam !== null && enemyOf(s.team) === myTeam;
      audio.playFlat(onMyShip ? hitReceived : shipHit, onMyShip ? 0.9 : 0.55, 0, onMyShip ? 1 : 0.6); // (a ball hitting your own ship has its own, more dramatic sound)
      if (onMyShip) this.shake = Math.max(this.shake, SHAKE_HIT_RECEIVED); // (a hit on your ship: half the shake of firing your own cannon)
    } else if (s.blocked) { // it struck the leaping whale: a burst of spray where it hit
      this.hitBurst(v3(s.blocked));
      audio.playFlat(whaleBlocked, 0.5, 0, 0.6);
    } else if (s.splash) {
      this.splash(v3(s.splash));
      audio.playFlat(seaSplash, 0.4, 0, 0.5);
    }
  }

  /** The people on a ship see through its masts, yards and sails (while looking out of their own cannon); the ship across the water is always solid. */
  private updateGhosts() {
    const view = this.latest;
    const eyeTeam = view && this.eyeId ? view.players[this.eyeId]?.team ?? null : null;
    const looking = !this.winner.on ? ease(MathUtils.clamp((this.introFactor() - 0.6) / 0.4, 0, 1)) : 0; // (not while the camera is still out over the sea, or at the end)
    for (const ship of Object.values(this.ships)) {
      const mine = eyeTeam === ship.team ? looking : 0;
      const set = (m: MeshStandardMaterial, ghost: number) => {
        const opacity = 1 + (ghost - 1) * mine;
        const transparent = opacity < 0.999;
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
        m.opacity = opacity; m.depthWrite = !transparent;
      };
      set(ship.ghost.rigging, GHOST_RIGGING);
      for (const m of ship.ghost.sails) set(m, GHOST_SAILS);
    }
  }

  // ---------- the camera ----------

  private overviewPose(): { pos: Vector3; quat: Quaternion } {
    const pos = new Vector3(-58, 22, 0);
    const m = new Matrix4().lookAt(pos, new Vector3(0, 6, 0), new Vector3(0, 1, 0));
    return { pos, quat: new Quaternion().setFromRotationMatrix(m) };
  }

  /** The eyes of the cannon being followed: behind the barrel, on the ship, so they rock with it. The view turns part of the way with the aim. */
  private eyePose(view: PirateBroadsideView): { pos: Vector3; quat: Quaternion } | null {
    const p: PiratePlayerView | undefined = this.eyeId ? view.players[this.eyeId] : undefined;
    if (!p) return null;
    const ship = this.ships[p.team];
    const c = this.eyeId ? ship.cannons.get(this.eyeId) : undefined;
    const aim = c ?? p;
    const side = sideOf(p.team);
    const st = stationLocal(p.team, p.slot, view.crew[p.team]);
    const eye = new Vector3(st[0], DECK_Y + EYE_HEIGHT, st[2] - side * EYE_BEHIND); // (forward of where it was, so the back of the cannon falls behind the camera and is cropped)
    const d = aimDir(p.team, aim.yaw * CAM_FOLLOW_YAW, aim.pitch * CAM_FOLLOW_PITCH - 0.12);
    const look = new Matrix4().lookAt(eye, eye.clone().add(new Vector3(d[0], d[1], d[2])), new Vector3(0, 1, 0));
    const local = new Quaternion().setFromRotationMatrix(look);
    return { pos: ship.group.localToWorld(eye.clone()), quat: ship.group.quaternion.clone().multiply(local) };
  }

  private updateCamera(view: PirateBroadsideView, dt: number) {
    const eye = this.eyePose(view);
    const intro = this.introFactor();
    let pos: Vector3, quat: Quaternion;
    let smooth = false;
    if (this.winner.on) {
      // The winner moment: the camera glides to the outer side of the winning ship (so you see its flag and sails), or, on a draw, pulls back to see both ships.
      if (this.winner.team) {
        const side = sideOf(this.winner.team);
        const lane = shipPose(this.winner.team, (this.serverNow() - view.startsAt) / 1000).lane;
        pos = new Vector3(8, 11, -side * (lane + 30));
        quat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(pos, new Vector3(0, 8, -side * lane), new Vector3(0, 1, 0)));
      } else { const o = this.overviewPose(); pos = o.pos; quat = o.quat; }
      smooth = true;
    } else if (eye && intro < 1) {
      const o = this.overviewPose(), u = ease(intro);
      pos = o.pos.clone().lerp(eye.pos, u);
      quat = o.quat.clone().slerp(eye.quat, u);
    } else if (eye) { pos = eye.pos; quat = eye.quat; }
    else { const o = this.overviewPose(); pos = o.pos; quat = o.quat; }

    if (smooth) {
      const s = this.camSmooth;
      if (!s.ready) { s.pos.copy(this.camera.position); s.quat.copy(this.camera.quaternion); s.ready = true; }
      const k = 1 - Math.exp(-2.4 * dt);
      s.pos.lerp(pos, k); s.quat.slerp(quat, k);
      this.camera.position.copy(s.pos); this.camera.quaternion.copy(s.quat);
    } else {
      this.camera.position.copy(pos); this.camera.quaternion.copy(quat);
      if (this.shake > 0.01) { // a shake when your cannon fires or your ship is hit
        const sh = this.shake * 0.02;
        this.camera.rotateX((Math.random() - 0.5) * sh); this.camera.rotateY((Math.random() - 0.5) * sh); this.camera.rotateZ((Math.random() - 0.5) * sh * 0.6);
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.12; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.12;
      }
    }
  }
}

void RELOAD_MS; void Object3D;
