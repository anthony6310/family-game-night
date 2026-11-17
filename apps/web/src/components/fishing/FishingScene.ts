import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, DoubleSide, BackSide,
  Float32BufferAttribute, Fog, Group, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points,
  PointsMaterial, Quaternion, RepeatWrapping, RingGeometry, Scene, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, Sprite, TorusGeometry, TubeGeometry,
  Vector3, WebGLRenderer, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FISHING_BREACH_SECONDS, type FishView, type FishingView } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { createRoundClock } from '../../audio/roundClock';
import { fishCatch, rodSwish, splash } from '../../audio/fishSounds';
import type { SoundFn } from '../../audio/snowSounds';
import { createNameTag, disposeNameTag } from '../labelTexture';
import { FISH_LENGTH, FishKit } from '../snowball/fish';
import { SparkSystem } from '../taprace/sparks';

/** How a player is drawn: their name tag and the color of their weight and lane. */
export interface AnglerStyle {
  name: string;
  color: string;
}

/**
 * The fishing scene: ONE 3D world, seen three ways over a round (all driven by the server clock, so everyone sees the same moments together).
 *
 *   1. THE OPENING. First person, standing on a wooden pier with the sea in front of you, the sky and clouds above, and your rod in the
 *      foreground at the bottom right. The rod winds back and whips forward, the hook arcs out and splashes in. Then the camera pulls back
 *      and dives into the water to look at the hook as it sinks to the bottom.
 *   2. THE FISHING. Underwater it plays like a 2D game: the hook stays at one height on the screen and the whole ocean (the fish, the seabed) slides
 *      past it, which makes the hook look as if it is being reeled up. The color of the water stays the same all the way. Lanes are the
 *      boundaries a hook can't leave. (Under the hood the camera rises and the layer stays put: it looks identical, and it is simpler.)
 *   3. THE PILES. When the hooks are about to break the surface (the finish line, `endDepth`, a little under the surface) the screen flashes and the camera goes high above the pier:
 *      each player's catch is a pile of fish on the dock, some of them flopping. The winner moment zooms in on the biggest pile.
 *
 * x runs along the pier (one lane per player), y is up (the sea is y = 0, the bottom y = -depth), z is away from the pier: the pier is at
 * positive z, the hooks live in the z = PLAY_Z plane (out in front of the pier), and the open sea stretches off to negative z. Nothing here decides anything: the server says
 * where every hook and fish is; this only draws it (and moves fish smoothly between the ~20 snapshots a second).
 */

// ---------- tuning (how it looks) ----------
const UNDER_VIEW_HEIGHT = 18; // how much ocean (world units, from top to bottom of the screen) a landscape screen shows
const MIN_VIEW_LANES = 1.5; // never show less than this many lanes across (a tall phone screen)
const MAX_VIEW_LANES = 3.2; // ...or more than this many (so you can see fish coming from the lanes next to yours)
const HOOK_SCREEN_HEIGHT = 0.18; // the hooks sit this far (as a fraction of the screen's height) below the middle of the screen
const POV_FOV = 58;
const UNDER_FOV = 40;
const DOCK_FOV = 42;
const HOOK_SMALL = 0.4; // ...and its size while it hangs from the rod
const HOOK_SCALE = 0.81; // how big the hook is drawn (the catch area on the server is about the size of the hook's opening at the previous, 40% bigger size)
const FISH_FOLLOW_RATE = 10; // how quickly a fish is pulled to where the server says it should be
const HOOK_FOLLOW_RATE = 22;
const CAUGHT_FLY_SECONDS = 0.85; // a caught fish is pulled up to the hook over this long
const OCEAN_COLOR = '#146fa6'; // the water's color underwater: the same everywhere, at every depth

// The cast timeline (seconds from the start of the round, at full length: it is squeezed if the sequence is shorter).
const CAST_FULL = 7.5;
const WIND_START = 0.6;
const WIND_BACK = 1.3; // the rod is fully back
const RELEASE = 1.7; // the rod has whipped forward: the hook is let go
const LAND = 2.7; // the hook splashes into the water; after this it sinks until the cast is over
const CUT_DELAY = 0.7; // the picture CUTS from the pier camera to the play-area camera this long after the splash (so the splash is seen first)

// The pier. The deck's walking surface is DECK_Y; people stand at Z_STAND; the deck's front edge (with the railing) is at Z_EDGE.
const DECK_Y = 2.4;
const Z_EDGE = 6;
const Z_STAND = 7.9; // where people stand: close to the railing, so a rod held out over it clears it (the rod is raised too, see ROD_BASE_HEIGHT)
const DECK_DEPTH = 30; // deep enough that the far (back) edge is never in the overhead shot: only floor boards
const PIER_REACH = 260; // the pier runs this far past the lanes on each side, so neither end is ever seen
const RAIL_HEIGHT = 1.05;
// The rod (a curved tube, built pointing along +x and then turned): handle at the base, thin springy tip.
const ROD_SCALE = 0.9;
const ROD_BASE_HEIGHT = 1.45; // how high above the deck the grip is held: high enough that the rod and the guides under it pass over the railing (3.45 up)
// The rod's blank (the long thin part) is straight, built along +x starting just in front of the grip. The line guides (the little loops the line
// runs through) hang under it at these points along it, big near the reel and small at the tip, as in the sketch.
// It is perfectly straight and in line with the grip (all the points are level), so grip and blank are one line.
const ROD_CURVE = new CatmullRomCurve3([new Vector3(0.6, 0, 0), new Vector3(2.4, 0, 0), new Vector3(4.2, 0, 0), new Vector3(5.8, 0, 0)]);
const GUIDE_U = [0.16, 0.38, 0.58, 0.78, 0.97]; // how far along the blank each guide is (0..1)
const GUIDE_RADIUS = [0.11, 0.09, 0.075, 0.06, 0.045];
const ROD_GUIDES = GUIDE_U.map((u, i) => { const p = ROD_CURVE.getPoint(u); return new Vector3(p.x, p.y - GUIDE_RADIUS[i] - 0.035, p.z); }); // (the middle of each loop)
const ROD_TIP = ROD_GUIDES[ROD_GUIDES.length - 1].clone(); // the last guide: the line leaves the rod here
const REEL_LINE_POINT = new Vector3(0.78, -0.2, 0); // where the line comes off the reel
const HANG_LENGTH = 1.5; // how far the hook hangs below the rod tip before the cast
const CAST_GRAVITY = -24; // how hard the cast hook is pulled down in flight (units per second squared)
const ROD_REST_PITCH = 16; // degrees up from level
const ROD_REST_YAW = 38; // degrees to the left of straight ahead
const ROD_BACK_PITCH = 75;
const ROD_FORWARD_PITCH = 6;
const ROD_FORWARD_YAW = 3;

// The play area (the plane the hooks are fished in) is this far OUT in front of the pier, so a cast really throws the hook forward.
// (Seen from above: the pier is a strip near you, and the play area is a line across the water some way ahead of it.)
const PLAY_Z = -9;

const SURFACE_SCREEN_HEIGHT = 0.08; // in the closing shot the middle of the screen is this far (as a fraction of its height) above the surface
// How far each fish's head sits out from the hook along its rib, by step (fish 0, 1, 2, 3, then the pattern repeats). Step 0 is right on the hook.
const HEAD_STAGGER = [0, 0.09, 0.44, 0.66];
const HANG_LEAD_SECONDS = 1.5; // the closing shot's camera starts to pan up to the surface this long before the hooks reach it

/**
 * How much of the full splash a hook with `fish` fish on it throws up. Three sizes, eased into each other so there is no jump between them:
 * a SMALL splash (up to about 5 fish) is half the full one, a MEDIUM one (about 15) is 0.525 of it (three quarters, less another 30%), and a BIG one
 * (30 or more) the full splash.
 */
const SPLASH_SMALL = 0.5, SPLASH_MEDIUM = 0.525;
function splashAmount(fish: number): number {
  if (fish <= 5) return SPLASH_SMALL;
  if (fish <= 15) return lerp(SPLASH_SMALL, SPLASH_MEDIUM, (fish - 5) / 10);
  if (fish <= 30) return lerp(SPLASH_MEDIUM, 1, (fish - 15) / 15);
  return 1;
}

/**
 * How big the wet patch under a pile is, as a fraction of the full (big) one. Like the splash sizes: a SMALL catch (up to about 5 fish) and a MEDIUM
 * one (about 15) get half-size patches; a BIG one (30 or more) gets the full patch; in between it eases.
 */
function wetSize(fish: number): number {
  if (fish <= 15) return 0.5;
  if (fish <= 30) return lerp(0.5, 1, (fish - 15) / 15);
  return 1;
}

const WATER_PALETTE: [number, number, number][] = [[0.78, 0.95, 1], [0.5, 0.84, 0.94], [0.27, 0.7, 0.9], [1, 1, 1]]; // splash droplets: the colors of the water and its foam

const DOCK_SEA_FRACTION = 0.2; // in the overhead shot the ocean takes up this much of the picture, at the top (so 80% is pier)
const PILE_Z = Z_EDGE + 9; // where each player's pile of fish lies on the dock: well back from the front edge, leaving room for the count between the pile and the edge

const FISH_COLORS = [
  { body: '#ff8a3d', belly: '#ffd9a8', fin: '#e8591a' },
  { body: '#ffd23f', belly: '#fff3b0', fin: '#e0a800' },
  { body: '#3ec7b9', belly: '#c4f3ec', fin: '#1f8f86' },
  { body: '#ff6f91', belly: '#ffd1dc', fin: '#d63f66' },
  { body: '#9b7cf2', belly: '#ddd2ff', fin: '#6c4fc9' },
  { body: '#6fd16f', belly: '#d6f5c9', fin: '#3a9a3a' },
] as const;

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A small repeatable random generator, so the seabed and the piles look the same for everyone (and every time) in a given room. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the closing animation's speed profile ----------
// The hooks go from the finish line to above the water in one smooth swell of speed: SLOW for the first 10% of the animation (as slow as the ascent
// was, so there is no jolt), FAST for the next 70%, then SLOW again for the last 20%, with every change eased (no sudden steps). Speed is drawn
// as `outroShape(u)` (0..1 of its peak, u = how far through the animation), and `outroProgress` is how much of the distance is covered by then.
const OUTRO_SECONDS = 2; // how long the main swell takes (after the anticipation)
const OUTRO_SPEEDUP = 3; // the peak speed, as a multiple of the speed they were rising at (300%)
const OUTRO_START_SPEED = 0.08; // (of the peak) the hook is nearly still at the bottom of its dip, so it starts slowly
const OUTRO_END_SPEED = 0.06;
// ANTICIPATION: before the swell, the hook sinks a little (the way a rod winds back before a cast), so the launch has something to spring from.
const ANTICIPATION_SECONDS = 0.4;
const ANTICIPATION_DIP = 0.9; // how far it sinks, in units
const outroShape = (u: number) => {
  const up = smooth(0.03, 0.17, u), down = smooth(0.72, 0.88, u); // the two eased changes, around 10% and 80% of the way through
  return (OUTRO_START_SPEED + (1 - OUTRO_START_SPEED) * up) * (1 - down) + OUTRO_END_SPEED * down;
};
// THE WEIGHT: when the hook reaches its highest point it drops back a little, as if the fish on it have pulled it down (a heavier catch drops further).
// The drop is quick: its peak speed is DROP_SPEEDUP times the speed they were rising at (180%), then it settles with a tiny bounce.
const DROP_SPEEDUP = 1.8;
const dropDistance = (fish: number) => clamp(0.45 + fish * 0.02, 0.45, 1.2);
const OUTRO_STEPS = 400;
const OUTRO_TABLE = (() => { // how much of the distance is covered by each point in the animation (0..1)
  const table = new Float32Array(OUTRO_STEPS + 1);
  for (let i = 1; i <= OUTRO_STEPS; i++) table[i] = table[i - 1] + outroShape((i - 0.5) / OUTRO_STEPS);
  const total = table[OUTRO_STEPS];
  for (let i = 0; i <= OUTRO_STEPS; i++) table[i] /= total;
  return { table, mean: total / OUTRO_STEPS };
})();
const OUTRO_MEAN = OUTRO_TABLE.mean; // the average of the shape (so: average speed = this x the peak)
function outroProgress(u: number): number {
  const x = clamp(u, 0, 1) * OUTRO_STEPS, i = Math.min(OUTRO_STEPS - 1, Math.floor(x));
  return lerp(OUTRO_TABLE.table[i], OUTRO_TABLE.table[i + 1], x - i);
}
/** The point in the animation (0..1) at which `fraction` of the distance has been covered. */
function outroInverse(fraction: number): number {
  const t = OUTRO_TABLE.table;
  let lo = 0, hi = OUTRO_STEPS;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] < fraction) lo = mid; else hi = mid; }
  return (lo + (fraction - t[lo]) / Math.max(1e-9, t[hi] - t[lo])) / OUTRO_STEPS;
}

interface FishObject {
  group: Group;
  tail: Mesh;
  x: number; // where it is drawn now
  y: number;
  serverX: number; // where the server last said it was, and when we heard it
  serverAt: number;
  serverY: number;
  dir: 1 | -1;
  speed: number;
  size: number;
  caughtBy?: string;
  caughtSince: number; // when we first saw it caught (performance.now), for the reel-in
  caughtFrom: { x: number; y: number };
}

interface Angler {
  id: string;
  color: string;
  laneIndex: number;
  rod: Group;
  rodSway: number; // each rod sways a little differently
  hook: Group;
  line: Mesh;
  tag: Sprite;
  x: number; // where the hook is drawn (sideways)
  targetX: number;
  seenAt: boolean;
  chain: Mesh[]; // the line from the reel, through each guide, to the rod tip (the line from the tip to the hook is `line`)
  hookPos: Vector3 | null; // the hook in the air before it lands (swinging from the rod tip, then flying)
  hookPrev: Vector3;
  released: Vector3 | null; // where the hook was when it was let go
  hookQuat: Quaternion; // which way the hook is turned
  hooked: HookedFish[]; // every fish this player has caught: they stay on the hook, dragged up to the surface
  prevX: number; // for working out how fast the hook is moving sideways (the fish trail behind it)
  vx: number;
  sprayed: boolean; // has the spray of coming out of the water been shown
}

/** A fish that is on a hook: it flew to the hook when it was caught and now hangs from it, being dragged up. */
interface HookedFish { obj: FishObject; since: number; from: { x: number; y: number }; phase: number }

interface PileFish { mesh: Mesh; baseY: number; baseRotX: number; flops: boolean; nextFlop: number; flopStart: number; phase: number }
interface Pile { id: string; x: number; radius: number; above: number; below: number; fish: PileFish[]; tags: Sprite[] } // (above/below: how far the pile and its count reach towards the sea / away from it, from the middle of the pile)

interface Ripple { mesh: Mesh; age: number }
interface Floater { sprite: Sprite; age: number; x: number; y: number }

export class FishingScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(POV_FOV, 1, 0.1, 2500);
  private rafId = 0;
  private lastFrame = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private disposables: { dispose(): void }[] = [];

  private latest: FishingView | null = null;
  private built = false;
  private laneWidth = 9;
  private total = 0;
  private depth = 56;
  private anglers = new Map<string, Angler>();
  private fish = new Map<number, FishObject>();
  private hookedIds = new Set<number>(); // fish that are on a hook now (they are no longer swimming in the ocean, whatever the server's list says)
  private sparks = new SparkSystem(2500, false); // the splashes: the Tap Race sparks, made solid and water-colored
  private ripples: Ripple[] = [];
  private floaters: Floater[] = [];
  private view: { targetId: string | null; winner: boolean } = { targetId: null, winner: false };

  // The parts of the world, so each mode can show only what it needs.
  private ocean = new Group(); // everything below the surface (the layer the fishing happens in)
  private skyGroup = new Group(); // the sky dome and the clouds
  private sea!: Mesh; // the sea's surface (seen from above)
  private seaTexture!: CanvasTexture;
  private pileGroup = new Group();
  private pierGroup = new Group(); // the deck, posts and railing: shown for the opening and the overhead shot, hidden while the camera is at the play area
  private backdrop!: Mesh; // (really a Group of two walls)   the plain ocean-colored wall behind the play area (below the surface); above the surface you see the sky
  private farWall!: Mesh;
  private foam!: Mesh; // the bright line of the sea's surface on that wall
  private piles: Pile[] = [];
  private pilesBuilt = false;
  private lineMaterial!: MeshBasicMaterial;
  private flash!: Mesh; // a white sheet in front of the camera, for the cut from the water to the dock
  private flashMaterial!: MeshBasicMaterial;

  // the camera (smoothed)
  private cx = 0;
  private cy = 0;
  private vw = 20;
  private dockX = 0;
  private dockZ = PILE_Z;
  private dockHeight = 20;
  private aspect = 1;
  private cameraStarted = false;
  private dockStarted = false;

  private kelp: { mesh: Mesh; phase: number }[] = [];
  private bubbles!: Points;
  private bubbleSpeed!: Float32Array;
  private bubblesNeedPlacing = false;
  private clock = createRoundClock((sound, gain) => this.playHere(sound, gain));
  private soundedCast = new Set<string>(); // which of the cast sounds have played (once each per player)
  private pileFishGeometries: BufferGeometry[] = [];
  private wetDark = new MeshStandardMaterial({ color: '#1f4a78', transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); // (wet wood: darker, glossy and bluish)
  private wetSheen = new MeshStandardMaterial({ color: '#4db3ee', transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }); // (a faint bluish film of water)
  private pileFishMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: DoubleSide });

  // The fish are the Snowball fish model (see snowball/fish.ts), in six colors, with real eyes. One kit per color shares its geometry and materials.
  private fishKits = FISH_COLORS.map((c) => new FishKit({ body: c.body, fin: c.fin, eyes: 'round' }));

  constructor(
    private container: HTMLElement,
    private serverNow: () => number,
    private styles: Record<string, AnglerStyle>,
    selfId: string | null,
  ) {
    this.view = { targetId: selfId, winner: false };
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(
      this.renderer, this.pileFishMaterial, ...this.fishKits,
    );
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(-20, 40, 30);
    this.scene.add(sun);
    this.ocean.position.z = PLAY_Z; // everything underwater lives around the play area, out in front of the pier
    this.scene.add(this.camera, this.ocean, this.skyGroup, this.pileGroup, this.pierGroup);
    this.pileGroup.visible = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------

  /** Hand over the latest server view (about 20 a second). */
  pushView(view: FishingView) {
    this.latest = view;
    if (!this.built) this.build(view);
    const now = performance.now();
    for (const [id, hook] of Object.entries(view.hooks)) {
      const angler = this.anglers.get(id);
      if (!angler) continue;
      if (!angler.seenAt) { angler.x = hook.x; angler.seenAt = true; }
      angler.targetX = hook.x;
    }
    // A player who left: their rod and hook go away (the lane stays).
    for (const [id, angler] of this.anglers) if (!(id in view.hooks)) this.removeAngler(id, angler);

    const present = new Set<number>();
    for (const f of view.fish) {
      present.add(f.id);
      if (this.hookedIds.has(f.id)) continue; // already on a hook
      let obj = this.fish.get(f.id);
      if (!obj) obj = this.addFish(f, now);
      obj.serverX = f.x; obj.serverY = f.y; obj.serverAt = now; obj.dir = f.dir; obj.speed = f.speed;
      if (f.caughtBy && this.anglers.has(f.caughtBy)) { this.onCaught(obj, f.id, f.caughtBy, now); continue; }
      obj.caughtBy = f.caughtBy;
    }
    // Someone who joined (or looked) late has not seen these fish being caught: put the missing ones on the hook straight away.
    for (const [id, angler] of this.anglers) {
      const caught = view.hooks[id]?.fish ?? 0;
      for (let n = angler.hooked.length; n < caught; n++) {
        const made = this.addFish({ id: -(this.hookedIds.size + 1) * 1000 - n, x: angler.x, y: -view.hookDepth, dir: 1, speed: 0, size: 1.3 + Math.random() * 1.3, variant: Math.floor(Math.random() * 6) }, now);
        this.fish.forEach((o, key) => { if (o === made) this.fish.delete(key); });
        this.attach(angler, made, now - 1000, false);
      }
    }
    for (const [id, obj] of this.fish) if (!present.has(id)) { this.ocean.remove(obj.group); this.fish.delete(id); } // swam out of range, or was reeled in
  }

  /** Seconds left in the round: the last 5 tick, then the whistle (GAME_RULES.md #1). */
  setSecondsLeft(secondsLeft: number) {
    this.clock.update(secondsLeft);
  }

  /**
   * Whose lane the camera follows (null = pull back to see everything). Players follow themselves; spectators pick.
   * `winner` is true during the winner moment: on the dock the camera then zooms right in on that player's pile.
   */
  setCameraView(view: { targetId: string | null; winner?: boolean }) {
    this.view = { targetId: view.targetId, winner: view.winner ?? false };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const a of this.anglers.values()) disposeNameTag(a.tag);
    for (const f of this.floaters) disposeNameTag(f.sprite);
    for (const p of this.piles) for (const t of p.tags) disposeNameTag(t);
    this.sparks.dispose();
    this.wetDark.dispose(); this.wetSheen.dispose();
    this.pileFishGeometries.forEach((g) => g.dispose());
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  private playHere(sound: SoundFn, gain: number) {
    audio.play(sound, this.cx, this.cy, gain, 1);
  }
  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  // ---------- the world ----------

  private build(view: FishingView) {
    this.built = true;
    this.laneWidth = view.laneWidth;
    this.depth = view.depth;
    this.total = view.lanes.length * view.laneWidth;
    const { total } = this;
    const mid = total / 2;
    const rand = seeded(view.startsAt);

    this.buildSky(rand, mid);
    this.buildSea(mid);
    this.buildSeabed(rand, mid);
    this.buildLanes(view);
    this.buildPier(view, mid);
    this.buildAnglers(view, rand);

    // Bubbles and drifting specks of plankton, kept near the camera (underwater only).
    const count = 140;
    const bubbleGeometry = this.track(new BufferGeometry());
    bubbleGeometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    this.bubbleSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) this.bubbleSpeed[i] = 0.15 + rand() * 0.45;
    const dot = document.createElement('canvas'); // a soft round dot (a points material is square without one)
    dot.width = dot.height = 32;
    const dg = dot.getContext('2d')!;
    const glow = dg.createRadialGradient(16, 16, 2, 16, 16, 15);
    glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(0.6, 'rgba(255,255,255,0.7)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = glow;
    dg.fillRect(0, 0, 32, 32);
    this.bubbles = new Points(bubbleGeometry, this.track(new PointsMaterial({ map: this.track(new CanvasTexture(dot)), color: '#e6fbff', size: 9, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false })));
    this.bubbles.frustumCulled = false;
    this.ocean.add(this.bubbles);
    this.bubblesNeedPlacing = true;

    // The splashes (Tap Race's spark streaks, solid and water-colored) fall freely: nothing for them to bounce on.
    this.sparks.floorAt = () => -1000;
    this.scene.add(this.sparks.object);

    // The white sheet for the cut from the water to the dock.
    this.flashMaterial = this.track(new MeshBasicMaterial({ color: '#eafcff', transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    this.flash = new Mesh(this.track(new PlaneGeometry(6, 6)), this.flashMaterial);
    this.flash.position.z = -1;
    this.flash.renderOrder = 999;
    this.camera.add(this.flash);
  }

  /** The sky: a big dome that is light at the horizon and deeper blue overhead, and a scattering of soft clouds. */
  private buildSky(rand: () => number, mid: number) {
    const domeGeometry = this.track(new SphereGeometry(1200, 24, 14));
    const colors: number[] = [];
    const horizon = new Color('#d9efff'), zenith = new Color('#58abea');
    const p = domeGeometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const c = horizon.clone().lerp(zenith, clamp(p.getY(i) / 1200, 0, 1) ** 0.7);
      colors.push(c.r, c.g, c.b);
    }
    domeGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const dome = new Mesh(domeGeometry, this.track(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
    dome.renderOrder = -10;
    this.skyGroup.add(dome); // (children[0]: it follows the camera, see `frame`)

    const cloudMaterial = this.track(new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.96, fog: false }));
    const cloudGeometry = this.track(new SphereGeometry(1, 14, 10));
    for (let i = 0; i < 26; i++) {
      const cloud = new Group();
      const puffs = 4 + Math.floor(rand() * 4);
      for (let b = 0; b < puffs; b++) {
        const puff = new Mesh(cloudGeometry, cloudMaterial);
        puff.scale.set(14 + rand() * 12, 6 + rand() * 4, 8);
        puff.position.set((b - puffs / 2) * 14 + rand() * 5, rand() * 4, rand() * 6);
        cloud.add(puff);
      }
      cloud.position.set(mid + (rand() - 0.5) * 700, 38 + rand() * 60, -170 - rand() * 330);
      this.skyGroup.add(cloud);
    }
  }

  /** The sea: a big plane with little white wave marks (seen from above), and the cross-section wall that stands in for it at the play area. */
  private buildSea(mid: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#26a8cf';
    g.fillRect(0, 0, 256, 256);
    const rand = seeded(7);
    g.strokeStyle = 'rgba(235,252,255,0.55)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) { // small "~" wave marks
      const x = rand() * 256, y = rand() * 256, w = 12 + rand() * 18;
      for (const dx of [0, -256, 256]) for (const dy of [0, -256, 256]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + w / 2, y + dy - 7, x + dx + w, y + dy);
        g.stroke();
      }
    }
    this.seaTexture = this.track(new CanvasTexture(c));
    this.seaTexture.wrapS = this.seaTexture.wrapT = RepeatWrapping;
    this.seaTexture.colorSpace = SRGBColorSpace;
    this.seaTexture.repeat.set(70, 70);
    const geometry = this.track(new PlaneGeometry(1500, 1500));
    this.sea = new Mesh(geometry, this.track(new MeshStandardMaterial({ map: this.seaTexture, roughness: 0.35, metalness: 0.1 })));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.set(mid, 0, -400);
    this.scene.add(this.sea);
    // The wall behind the play area. Seen from the play-area camera the world is a cross-section: ocean color below the surface (the same at every
    // depth), sky above it, and a bright line where the two meet. That is what lets the camera pan up to the surface at the end.
    // Two walls of the same color: a short one right behind the play area (just the stretch near the surface, so its top edge lines up with the
    // surface line exactly), and a tall far one that stands in for the rest of the depth (which lets the seabed scenery sit in front of it).
    this.backdrop = new Group() as unknown as Mesh;
    const wallMaterial = this.track(new MeshBasicMaterial({ color: OCEAN_COLOR, fog: false }));
    const nearWall = new Mesh(this.track(new PlaneGeometry(3000, 30)), wallMaterial);
    nearWall.position.set(mid, -15, PLAY_Z - 1.1);
    const farWall = new Mesh(this.track(new PlaneGeometry(3000, 700)), wallMaterial);
    farWall.position.set(mid, -350, PLAY_Z - 70);
    this.farWall = farWall; // (its top edge is moved each frame, see `frame`)
    this.backdrop.add(nearWall, farWall);
    this.scene.add(this.backdrop);
    this.foam = new Mesh(this.track(new PlaneGeometry(3000, 0.32)), this.track(new MeshBasicMaterial({ color: '#eafcff', transparent: true, opacity: 0.85, fog: false })));
    this.foam.position.set(mid, 0, PLAY_Z - 1.0);
    this.scene.add(this.foam);
  }

  /** The seabed (a big sandy floor, rocks, coral, swaying kelp), in the underwater layer. The same everywhere, from the round's seed. */
  private buildSeabed(rand: () => number, mid: number) {
    const { total, depth } = this;
    const floorY = -(depth + 1.2);
    const sand = new Mesh(this.track(new PlaneGeometry(900, 520)), this.track(new MeshStandardMaterial({ color: '#cdb98a', roughness: 1 })));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(mid, floorY, -200);
    this.ocean.add(sand);
    const rockGeometry = this.track(new IcosahedronGeometry(1, 0));
    const rockMaterials = ['#6b7c8f', '#566879', '#7d8d9e'].map((c) => this.track(new MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 })));
    const coralMaterials = ['#ff7aa8', '#ff9a52', '#c06bff'].map((c) => this.track(new MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8 })));
    const kelpMaterial = this.track(new MeshStandardMaterial({ color: '#2f9e5b', roughness: 0.8 }));
    const kelpGeometry = this.track(new CylinderGeometry(0.07, 0.16, 1, 6, 1));
    kelpGeometry.translate(0, 0.5, 0); // grows up from its base
    // Scenery goes in rows from just in front of the fishing plane to far behind it, so the camera sees real depth.
    for (let row = 0; row < 4; row++) {
      const z = 2 - row * 5 - rand() * 2;
      for (let x = -14; x < total + 14; x += 2 + rand() * 3) {
        const pick = rand();
        if (pick < 0.35) {
          const rock = new Mesh(rockGeometry, rockMaterials[Math.floor(rand() * 3)]);
          rock.scale.set(0.8 + rand() * 1.8, 0.5 + rand() * 1.3, 0.8 + rand());
          rock.position.set(x, floorY + 0.1, z);
          rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          this.ocean.add(rock);
        } else if (pick < 0.6) {
          const coral = new Group();
          const material = coralMaterials[Math.floor(rand() * 3)];
          for (let b = 0; b < 3; b++) {
            const blob = new Mesh(rockGeometry, material);
            blob.scale.set(0.3 + rand() * 0.3, 0.5 + rand() * 0.8, 0.3);
            blob.position.set((b - 1) * 0.45, 0.4 + rand() * 0.3, 0);
            coral.add(blob);
          }
          coral.position.set(x, floorY, z);
          this.ocean.add(coral);
        } else {
          for (let b = 0; b < 3; b++) {
            const stalk = new Mesh(kelpGeometry, kelpMaterial);
            stalk.scale.set(1, 2.5 + rand() * 4, 1);
            stalk.position.set(x + b * 0.35, floorY, z + rand() * 0.8);
            this.ocean.add(stalk);
            this.kelp.push({ mesh: stalk, phase: rand() * 6 });
          }
        }
      }
    }
  }

  /** Lanes: a tinted strip for each player and dashed lines at the edges (the limits of how far a hook can move). */
  private buildLanes(view: FishingView) {
    const { depth } = this;
    const dashCanvas = document.createElement('canvas');
    dashCanvas.width = 8; dashCanvas.height = 64;
    const g = dashCanvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 8, 36);
    const dashTexture = this.track(new CanvasTexture(dashCanvas));
    dashTexture.wrapT = RepeatWrapping;
    dashTexture.colorSpace = SRGBColorSpace;
    const laneHeight = depth + 1.2;
    dashTexture.repeat.set(1, laneHeight / 1.6);
    const dashMaterial = this.track(new MeshBasicMaterial({ map: dashTexture, transparent: true, opacity: 0.6, depthWrite: false }));
    const dashGeometry = this.track(new PlaneGeometry(0.14, laneHeight));
    const laneGeometry = this.track(new PlaneGeometry(this.laneWidth, laneHeight));
    view.lanes.forEach((id, i) => {
      const color = this.styles[id]?.color ?? '#ffffff';
      const tint = new Mesh(laneGeometry, this.track(new MeshBasicMaterial({ color, transparent: true, opacity: id === this.view.targetId ? 0.17 : 0.08, depthWrite: false })));
      tint.position.set((i + 0.5) * this.laneWidth, -laneHeight / 2, -1);
      this.ocean.add(tint);
    });
    for (let i = 0; i <= view.lanes.length; i++) {
      const line = new Mesh(dashGeometry, dashMaterial);
      line.position.set(i * this.laneWidth, -laneHeight / 2, -0.5);
      this.ocean.add(line);
    }
  }

  /** The pier: a plank deck on posts, with a railing along the front edge. */
  private buildPier(view: FishingView, mid: number) {
    const { total } = this;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const rand = seeded(11);
    for (let i = 0; i < 8; i++) { // eight planks, each a slightly different brown, with a dark gap between them
      const shade = 150 + Math.floor(rand() * 26);
      g.fillStyle = `rgb(${shade + 14},${shade - 22},${shade - 70})`;
      g.fillRect(0, i * 32, 256, 32);
      g.fillStyle = 'rgba(60,35,15,0.9)';
      g.fillRect(0, i * 32, 256, 2);
      for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(70,40,18,0.18)'; g.fillRect(rand() * 256, i * 32 + 4 + rand() * 22, 30 + rand() * 60, 1.5); } // grain
    }
    const planks = this.track(new CanvasTexture(c));
    planks.wrapS = planks.wrapT = RepeatWrapping;
    planks.colorSpace = SRGBColorSpace;
    const width = total + 2 * PIER_REACH;
    planks.repeat.set(width / 7, 1);
    const wood = this.track(new MeshStandardMaterial({ map: planks, roughness: 0.9 }));
    const woodDark = this.track(new MeshStandardMaterial({ color: '#6d4c2a', roughness: 1, flatShading: true }));
    const woodRail = this.track(new MeshStandardMaterial({ color: '#8b5e34', roughness: 0.9, flatShading: true }));
    const deck = new Mesh(this.track(new BoxGeometry(width, 0.5, DECK_DEPTH)), wood);
    deck.position.set(mid, DECK_Y - 0.25, Z_EDGE + DECK_DEPTH / 2);
    this.pierGroup.add(deck);
    // The posts and the railing repeat for hundreds of units each way, so each kind is MERGED into one mesh (one draw call, not hundreds).
    const merged = (geometry: BufferGeometry, material: Material, places: [number, number, number][]) => {
      const copies = places.map(([x, y, z]) => geometry.clone().translate(x, y, z));
      const mesh = new Mesh(mergeGeometries(copies)!, material);
      this.track(mesh.geometry);
      mesh.frustumCulled = false;
      this.pierGroup.add(mesh);
    };
    // Posts under the deck, down into the water, along the front and the back.
    const posts: [number, number, number][] = [];
    for (let x = -PIER_REACH; x <= total + PIER_REACH; x += 4.5) for (const z of [Z_EDGE + 0.5, Z_EDGE + DECK_DEPTH - 0.5]) posts.push([x, DECK_Y - 0.5 - 3.5 + 0.2, z]);
    merged(this.track(new CylinderGeometry(0.28, 0.32, 7, 8)), woodDark, posts);
    // The railing along the front edge: posts every few units and two rails.
    const railPosts: [number, number, number][] = [];
    for (let x = -PIER_REACH; x <= total + PIER_REACH; x += 3) railPosts.push([x, DECK_Y + RAIL_HEIGHT / 2, Z_EDGE + 0.25]);
    merged(this.track(new BoxGeometry(0.22, RAIL_HEIGHT, 0.22)), woodRail, railPosts);
    const railGeometry = this.track(new BoxGeometry(width, 0.16, 0.2));
    for (const y of [RAIL_HEIGHT, RAIL_HEIGHT * 0.5]) {
      const rail = new Mesh(railGeometry, woodRail);
      rail.position.set(mid, DECK_Y + y, Z_EDGE + 0.25);
      this.pierGroup.add(rail);
    }
  }

  /** One angler (a rod with a line to a hook with a colored weight, and a name) for each player. */
  private buildAnglers(view: FishingView, rand: () => number) {
    // The rod, as in the sketch: a thick CORK GRIP, separated from the long thin springy BLANK by a chrome ring and a rubber collar; five LINE GUIDES
    // (small loops, big to small) hanging under the blank; and a REEL under the rod just in front of the grip. Built once, then copied for each player.
    const template = new Group();
    const mat = (color: string, roughness: number, metalness = 0) => this.track(new MeshStandardMaterial({ color, roughness, metalness }));
    const cork = mat('#c79a62', 0.9), rubber = mat('#262a33', 0.8), chrome = mat('#dfe6ee', 0.25, 0.85), navy = mat('#1f2c46', 0.3, 0.2), gunmetal = mat('#3a4350', 0.4, 0.6);
    const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => { const m = new Mesh(this.track(geometry), material); m.position.set(x, y, z); template.add(m); return m; };
    const along = (g: BufferGeometry) => g.rotateZ(Math.PI / 2); // (cylinders stand up by default: lay them along the rod)
    add(along(new CylinderGeometry(0.105, 0.105, 1.37, 14)), cork, -0.265, 0, 0); // the grip
    add(along(new CylinderGeometry(0.115, 0.115, 0.1, 14)), rubber, -0.98, 0, 0); // the rubber butt cap
    add(along(new CylinderGeometry(0.118, 0.118, 0.09, 14)), rubber, 0.46, 0, 0); // the collar at the front of the grip
    add(along(new CylinderGeometry(0.085, 0.085, 0.13, 14)), chrome, 0.55, 0, 0); // the chrome ring where the blank joins the grip
    // the blank: a tube that thins from the grip to the tip
    const blank = new BufferGeometry();
    {
      const segments = 40, radial = 8, frames = ROD_CURVE.computeFrenetFrames(segments, false);
      const positions: number[] = [], indices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const u = i / segments, p = ROD_CURVE.getPointAt(u), r = lerp(0.062, 0.016, u ** 0.8);
        for (let j = 0; j <= radial; j++) {
          const a2 = (j / radial) * Math.PI * 2, n = frames.normals[i], bn = frames.binormals[i];
          positions.push(p.x + (n.x * Math.cos(a2) + bn.x * Math.sin(a2)) * r, p.y + (n.y * Math.cos(a2) + bn.y * Math.sin(a2)) * r, p.z + (n.z * Math.cos(a2) + bn.z * Math.sin(a2)) * r);
        }
      }
      for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) { const q = i * (radial + 1) + j; indices.push(q, q + radial + 1, q + 1, q + 1, q + radial + 1, q + radial + 2); }
      blank.setAttribute('position', new Float32BufferAttribute(positions, 3));
      blank.setIndex(indices);
      blank.computeVertexNormals();
    }
    add(blank, navy, 0, 0, 0);
    const tipEnd = ROD_CURVE.getPoint(1);
    add(new SphereGeometry(0.02, 8, 6), chrome, tipEnd.x, tipEnd.y, tipEnd.z);
    // the line guides: a loop under the blank on a short stem, turned so the line can pass straight through it
    GUIDE_U.forEach((u, i) => {
      const p = ROD_CURVE.getPoint(u), tangent = ROD_CURVE.getTangent(u), c = ROD_GUIDES[i];
      const ring = add(new TorusGeometry(GUIDE_RADIUS[i], 0.014, 6, 16), chrome, c.x, c.y, c.z);
      ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent);
      add(new CylinderGeometry(0.011, 0.011, 0.06, 5), chrome, p.x, p.y - 0.03, p.z); // the stem from the blank to the loop
    });
    // the reel: a spool between two flanges, a foot clamped under the rod, and a crank on the side
    const reel = new Group();
    reel.position.set(0.78, -0.33, 0);
    reel.scale.setScalar(0.75);
    const reelPart = (g: BufferGeometry, m: Material, x: number, y: number, z: number) => { const mesh = new Mesh(this.track(g), m); mesh.position.set(x, y, z); reel.add(mesh); return mesh; };
    reelPart(new CylinderGeometry(0.15, 0.15, 0.16, 18).rotateX(Math.PI / 2), gunmetal, 0, 0, 0); // the spool (it holds the line)
    reelPart(new CylinderGeometry(0.22, 0.22, 0.025, 20).rotateX(Math.PI / 2), chrome, 0, 0, 0.09); // the flanges
    reelPart(new CylinderGeometry(0.22, 0.22, 0.025, 20).rotateX(Math.PI / 2), chrome, 0, 0, -0.09);
    reelPart(new BoxGeometry(0.1, 0.2, 0.09), gunmetal, 0, 0.2, 0); // the stem up to the foot
    reelPart(new BoxGeometry(0.62, 0.05, 0.1), chrome, 0, 0.3, 0); // the foot, clamped under the rod
    reelPart(new BoxGeometry(0.26, 0.03, 0.03), chrome, 0.12, -0.02, 0.2); // the crank arm...
    reelPart(new SphereGeometry(0.05, 10, 8), rubber, 0.26, -0.02, 0.2); // ...and its knob
    template.add(reel);

    this.lineMaterial = this.track(new MeshBasicMaterial({ color: '#f4f7fa' }));
    const lineGeometry = this.track(new CylinderGeometry(1, 1, 1, 5));
    const hookCurve = new CatmullRomCurve3([new Vector3(-0.3, 0.55, 0), new Vector3(-0.3, -0.1, 0), new Vector3(-0.22, -0.45, 0), new Vector3(0.05, -0.55, 0), new Vector3(0.3, -0.4, 0), new Vector3(0.32, -0.1, 0)]);
    const hookGeometry = this.track(new TubeGeometry(hookCurve, 24, 0.045, 6));
    const barbGeometry = this.track(new SphereGeometry(0.07, 8, 6));
    const eyeletGeometry = this.track(new TorusGeometry(0.1, 0.03, 6, 12));
    const hookMaterial = this.track(new MeshStandardMaterial({ color: '#dfe6ee', metalness: 0.8, roughness: 0.25 }));
    const weightGeometry = this.track(new SphereGeometry(0.24, 14, 10));

    view.lanes.forEach((id, i) => {
      if (!(id in view.hooks)) return;
      const color = this.styles[id]?.color ?? '#ffffff';
      const laneX = (i + 0.5) * this.laneWidth;
      const rod = template.clone(); // (shares the template's geometry and materials)
      rod.scale.setScalar(ROD_SCALE);
      rod.position.set(laneX + 0.7, DECK_Y + ROD_BASE_HEIGHT, Z_STAND + 0.2);
      this.scene.add(rod);

      const hook = new Group();
      hook.add(new Mesh(hookGeometry, hookMaterial));
      const barb = new Mesh(barbGeometry, hookMaterial);
      barb.position.set(0.32, -0.1, 0);
      hook.add(barb);
      const eyelet = new Mesh(eyeletGeometry, hookMaterial);
      eyelet.position.set(-0.3, 0.68, 0);
      hook.add(eyelet);
      const weight = new Mesh(weightGeometry, this.track(new MeshStandardMaterial({ color, roughness: 0.4 })));
      weight.position.set(-0.3, 1.0, 0);
      hook.add(weight);
      hook.scale.setScalar(HOOK_SCALE);
      this.scene.add(hook);

      const line = new Mesh(lineGeometry, this.lineMaterial);
      this.scene.add(line);
      const chain = ROD_GUIDES.map(() => { const seg = new Mesh(lineGeometry, this.lineMaterial); this.scene.add(seg); return seg; }); // reel -> guide 1 -> ... -> the tip
      const tag = createNameTag(this.styles[id]?.name ?? '?', color);
      tag.scale.set(3.6, 0.9, 1);
      this.scene.add(tag);
      this.anglers.set(id, { id, color, laneIndex: i, rod, rodSway: rand() * 6, hook, line, tag, x: laneX, targetX: laneX, seenAt: false, chain, hookPos: null, hookPrev: new Vector3(), released: null, hookQuat: new Quaternion(), hooked: [], prevX: laneX, vx: 0, sprayed: false });
    });
  }

  // ---------- fish ----------

  private addFish(f: FishView, now: number): FishObject {
    const size = f.size; // its length: the model's body is FISH_LENGTH long, so it is scaled to fit (its nose, the mouth, is at the front: x + dir x size / 2)
    const group = new Group();
    const model = this.fishKits[f.variant % 6].create();
    model.scale.setScalar(size / FISH_LENGTH);
    group.add(model);
    const tail = model.userData.tail as Mesh;
    group.rotation.y = f.dir === 1 ? 0 : Math.PI;
    group.position.z = ((f.id % 7) - 3) * 0.06;
    this.ocean.add(group);
    const obj: FishObject = { group, tail, x: f.x, y: f.y, serverX: f.x, serverY: f.y, serverAt: now, dir: f.dir, speed: f.speed, size, caughtSince: 0, caughtFrom: { x: f.x, y: f.y } };
    this.fish.set(f.id, obj);
    return obj;
  }

  /** One fish as a single mesh (all its parts merged, colored per vertex), length 1: used for the piles on the dock, where there can be hundreds. */
  private pileFishGeometry(variant: number): BufferGeometry {
    const cached = this.pileFishGeometries[variant];
    if (cached) return cached;
    // Build one model, then bake every part (in its place, colored per vertex from its material) into a single mesh of length 1.
    const model = this.fishKits[variant % 6].create();
    model.scale.setScalar(1 / FISH_LENGTH);
    model.updateMatrixWorld(true);
    const parts: BufferGeometry[] = [];
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const col = new Color((mesh.material as MeshStandardMaterial).color);
      const count = g.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colors.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new BufferAttribute(colors, 3));
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
      parts.push(g.index ? g.toNonIndexed() : g);
    });
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    this.pileFishGeometries[variant] = merged;
    return merged;
  }

  /** A fish was just hooked: it leaves the swimming fish and goes onto the hook for good (see `updateHooked`), with the catch sound and a "+1". */
  private onCaught(obj: FishObject, id: number, by: string, now: number) {
    const angler = this.anglers.get(by);
    if (!angler || !this.latest) return;
    this.fish.delete(id);
    this.hookedIds.add(id);
    this.attach(angler, obj, now, true);
    const hookY = -this.hookDepthNow();
    audio.play(fishCatch, angler.x, hookY, by === this.view.targetId ? 0.9 : 0.4, 1);
    const sprite = createNameTag('+1', angler.color);
    sprite.scale.set(2.4, 0.6, 1);
    this.scene.add(sprite);
    this.floaters.push({ sprite, age: 0, x: angler.x, y: hookY + 1.2 });
  }

  private attach(angler: Angler, obj: FishObject, since: number, _fresh: boolean) {
    obj.group.rotation.set(0, 0, 0); // (it was turned to face the way it swam: now it hangs head up)
    angler.hooked.push({ obj, since, from: { x: obj.x, y: -obj.y }, phase: Math.random() * 6 });
  }

  // ---------- the piles of fish on the dock ----------

  /** Build every player's pile of caught fish on the dock (once, when the hooks come out of the water: the counts are final by then). */
  private buildPiles() {
    this.pilesBuilt = true;
    const v = this.latest!;
    const rand = seeded(v.startsAt + 99);
    v.lanes.forEach((id, i) => {
      const hook = v.hooks[id];
      if (!hook) return;
      const count = hook.fish;
      const x = (i + 0.5) * this.laneWidth;
      const radius = count === 0 ? 1 : Math.min(this.laneWidth * 0.47, 0.62 * Math.sqrt(count) + 0.9); // a heap this wide (never wider than its lane)
      if (count > 0) this.pileGroup.add(this.wetPatch(x, radius, count, rand));
      const fish: PileFish[] = [];
      for (let n = 0; n < count; n++) {
        const mesh = new Mesh(this.pileFishGeometry(Math.floor(rand() * 6)), this.pileFishMaterial);
        const size = 1.1 + rand() * 0.9;
        mesh.scale.setScalar(size);
        // Scatter over a disc, with the middle of the heap piled higher; each fish lies on its side, pointing a random way.
        const angle = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (radius - size * 0.4);
        const height = 0.14 + (1 - r / radius) * Math.min(1.3, 0.25 * Math.sqrt(count)) + rand() * 0.18;
        const baseRotX = (rand() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rand() - 0.5) * 0.5);
        mesh.position.set(x + Math.cos(angle) * r, DECK_Y + height, PILE_Z + Math.sin(angle) * r);
        mesh.rotation.set(baseRotX, rand() * Math.PI * 2, (rand() - 0.5) * 0.3, 'YXZ');
        this.pileGroup.add(mesh);
        // About a third of them are still alive enough to flop now and then.
        fish.push({ mesh, baseY: mesh.position.y, baseRotX, flops: rand() < 0.35, nextFlop: rand() * 2.5, flopStart: -1, phase: rand() * 6 });
      }
      const color = this.styles[id]?.color ?? '#ffffff';
      // Only the COUNT is shown, above the pile (between the pile and the front edge): just the number, drawn bigger the more fish there are
      // (from 0.8 to 3.2 units tall). No name or label.
      const numberHeight = clamp(0.8 + 0.35 * Math.sqrt(count), 0.8, 3.2);
      const total = createNameTag(`${count}`, color);
      total.scale.set(numberHeight * 2.1 * 4, numberHeight * 2.1, 1); // (the picture is 4 times as wide as tall, and the digits fill about half its height)
      total.position.set(x, DECK_Y + 2.2, PILE_Z - radius - numberHeight * 0.55 - 0.7);
      this.pileGroup.add(total);
      this.piles.push({ id, x, radius, above: radius + 0.7 + numberHeight * 1.1, below: radius + 0.8, fish, tags: [total] });
    });
  }

  /**
   * The wet patch under a pile, so the dock looks as if the fish have just come out of the water: a dark, glossy, slightly bluish blob a bit wider
   * than the pile (so a bigger catch makes a bigger patch), with a few small puddles scattered around its edge.
   */
  private wetPatch(x: number, radius: number, count: number, rand: () => number): Group {
    const group = new Group();
    const size = wetSize(count); // (the whole patch is scaled by this: small and medium catches get half-size patches)
    const blob = (cx: number, cz: number, r: number, wobble: number) => {
      const shape = new Shape();
      const n = 72, phase = rand() * 6, lobes = 2 + Math.floor(rand() * 2);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, rr = r * (1 + wobble * Math.sin(a * lobes + phase) + wobble * 0.3 * Math.sin(a * 4 + phase * 2));
        if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      const dark = new Mesh(new ShapeGeometry(shape), this.wetDark);
      const sheen = new Mesh(dark.geometry, this.wetSheen);
      for (const m of [dark, sheen]) { m.rotation.x = -Math.PI / 2; m.position.set(cx, DECK_Y + 0.02, cz); m.renderOrder = 1; group.add(m); } // (turned to lie flat, facing up)
      sheen.position.y += 0.005;
      sheen.scale.setScalar(0.82);
    };
    const mainRadius = Math.min(radius * 1.25 + 0.6, this.laneWidth * 0.5 - 0.25) * size;
    blob(x, PILE_Z, mainRadius, 0.07); // (never wider than the lane)
    // A few separate puddles round the edge. Each is placed with its centre OUTSIDE the main patch's edge, so no puddle can overlap the patch by
    // more than about half of itself (never more than 60%), and they are kept clear of each other too (each is tried in up to 12 places).
    const puddles: { x: number; z: number; r: number }[] = [];
    const wanted = 3 + Math.floor(radius / 1.5);
    for (let i = 0; i < wanted; i++) {
      const r = (0.2 + rand() * 0.35) * (0.6 + 0.4 * size);
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = rand() * Math.PI * 2, d = mainRadius * 1.1 + r * (0.25 + rand() * 1.2);
        const px = x + Math.cos(a) * d, pz = PILE_Z + Math.sin(a) * d;
        const clear = puddles.every((q) => Math.hypot(q.x - px, q.z - pz) > q.r + r + 0.15);
        if (!clear || Math.abs(px - x) > this.laneWidth * 0.5 - r) continue; // (overlapping another puddle, or out of the lane: try again)
        puddles.push({ x: px, z: pz, r });
        blob(px, pz, r, 0.12);
        break;
      }
    }
    return group;
  }

  private moveFlops(seconds: number) {
    for (const pile of this.piles) {
      for (const f of pile.fish) {
        if (!f.flops) continue;
        if (f.flopStart < 0 && seconds > f.nextFlop) f.flopStart = seconds;
        if (f.flopStart < 0) continue;
        const p = (seconds - f.flopStart) / 0.4; // a flop lasts 0.4 s: a small hop, a flip of the body and a wriggle
        if (p >= 1) { f.flopStart = -1; f.nextFlop = seconds + 1.4 + Math.random() * 3; f.mesh.position.y = f.baseY; f.mesh.rotation.x = f.baseRotX; continue; }
        const hop = Math.sin(p * Math.PI);
        f.mesh.position.y = f.baseY + hop * 0.35;
        f.mesh.rotation.x = f.baseRotX + hop * 0.5 * Math.sin(f.phase);
        f.mesh.rotation.z = Math.sin(p * Math.PI * 4 + f.phase) * 0.25 * hop;
      }
    }
  }

  // ---------- timing ----------

  /** Seconds since the round began, and the cast's length (the cast is squeezed if the server's sequence is shorter than the full one). */
  private castClock() {
    const v = this.latest!;
    const length = (v.ascentStartsAt - v.startsAt) / 1000;
    const t = (this.serverNow() - v.startsAt) / 1000;
    return { t, length, k: Math.min(1, length / CAST_FULL) };
  }

  /** How deep the hooks are right now: sinking during the cast, then rising at the server's steady speed. */
  private hookDepthNow(): number {
    const v = this.latest!;
    const { t, length, k } = this.castClock();
    if (t >= length) {
      const total = (v.endsAt - v.ascentStartsAt) / 1000;
      return v.depth - (v.depth - v.endDepth) * clamp((t - length) / total, 0, 1); // (to the finish line, a little under the surface)
    }
    const land = LAND * k;
    if (t < land) return 0;
    const p = (t - land) / Math.max(0.01, length - land);
    return v.depth * (p * p * (3 - 2 * p)); // slow as it first goes under, quicker in the middle, gentle as it nears the bottom (the camera has to keep up with it)
  }

  /**
   * The closing animation's timings, from the view. The distance the hooks travel is whatever the speed profile needs: the peak speed is
   * OUTRO_SPEEDUP times the speed they were rising at, held by the profile's shape (see `outroShape`) for OUTRO_SECONDS.
   */
  private outro(): { distance: number; seconds: number; breachAfter: number } {
    const v = this.latest!;
    const distance = OUTRO_SPEEDUP * v.ascentSpeed * OUTRO_MEAN * OUTRO_SECONDS; // (from the bottom of the dip)
    const toSurface = v.endDepth + ANTICIPATION_DIP; // how far up the surface is from the bottom of the dip
    return { distance, seconds: OUTRO_SECONDS, breachAfter: ANTICIPATION_SECONDS + OUTRO_SECONDS * outroInverse(toSurface / distance) };
  }

  /**
   * Where the hooks are drawn, in height. While they are in the water it is just minus their depth. At the finish line (a little under the surface:
   * "0 m") the players lose control and the closing animation takes the hooks the rest of the way up and out of the water, as one smooth swell of
   * speed: slow, then fast, then slow again, settling high above the water where they hang and sway. First, a small ANTICIPATION: they sink a little. (See `outroShape`.)
   */
  private hookWorldY(serverMs: number, fish = 0): number {
    const v = this.latest!;
    if (serverMs < v.endsAt) return -this.hookDepthNow();
    const { distance, seconds } = this.outro();
    const after = (serverMs - v.endsAt) / 1000;
    const bottom = -v.endDepth - ANTICIPATION_DIP;
    if (after < ANTICIPATION_SECONDS) return -v.endDepth - ANTICIPATION_DIP * smooth(0, 1, after / ANTICIPATION_SECONDS); // anticipation: sink a little
    const u = (after - ANTICIPATION_SECONDS) / seconds;
    if (u < 1) return bottom + distance * outroProgress(u);
    const top = bottom + distance;
    // At the top the weight of the fish pulls the hook down a little: a quick drop (an eased move whose peak speed is DROP_SPEEDUP times the ascent
    // speed: for a smoothstep move, peak = 1.5 x distance / time), then a small bounce that dies away, then a gentle sway.
    const since = after - ANTICIPATION_SECONDS - seconds;
    if (fish > 0) {
      const drop = dropDistance(fish), dropSeconds = (1.5 * drop) / (DROP_SPEEDUP * v.ascentSpeed);
      if (since < dropSeconds) return top - drop * smooth(0, 1, since / dropSeconds);
      const settle = since - dropSeconds;
      return top - drop + drop * 0.18 * Math.exp(-7 * settle) * Math.sin(settle * 16) + Math.sin(settle * 3) * 0.04;
    }
    return top + Math.sin(since * 3) * 0.04;
  }

  // ---------- drawing ----------

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.cameraStarted = false; // (snap the camera to its new framing, rather than gliding there)
    this.dockStarted = false;
  }

  /** A rod's direction: `pitch` degrees up from level and `yaw` degrees to the left of straight ahead (out over the sea, towards -z). */
  private rodQuaternion(pitch: number, yaw: number, out: Quaternion): Quaternion {
    const th = rad(pitch), ps = rad(yaw);
    const forward = new Vector3(-Math.sin(ps) * Math.cos(th), Math.sin(th), -Math.cos(ps) * Math.cos(th));
    const up = new Vector3(0, 1, 0);
    const y = up.clone().addScaledVector(forward, -up.dot(forward)).normalize();
    const z = new Vector3().crossVectors(forward, y);
    return out.setFromRotationMatrix(new Matrix4().makeBasis(forward, y, z));
  }

  private rodTip(a: Angler, pitch: number, yaw: number): Vector3 {
    const q = this.rodQuaternion(pitch, yaw, new Quaternion());
    return ROD_TIP.clone().multiplyScalar(ROD_SCALE).applyQuaternion(q).add(a.rod.position);
  }

  private frame = (time: number) => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const now = performance.now();
    if (!this.latest || !this.built) { this.renderer.render(this.scene, this.camera); return; }
    const v = this.latest;
    const seconds = time / 1000;
    const { t, length, k } = this.castClock();
    const serverMs = this.serverNow();
    const depthNow = this.hookDepthNow();
    const hookY = -depthNow; // (for framing the camera)
    const hookWorldY = this.hookWorldY(serverMs); // (where the hooks are drawn: the same, until they come out of the water and carry on up)
    // The closing shot: from the moment the hooks reach the surface, the camera (still at the play area, never turning to the pier) shows them
    // coming out of the water with their fish. After BREACH seconds it cuts to the overhead shot of the dock and the piles.
    const dockAt = v.endsAt + FISHING_BREACH_SECONDS * 1000;
    const inDock = serverMs >= dockAt;
    // Which camera is showing: the one on the pier (the opening) or the one at the play area. It is a straight cut, with a quick flash over it:
    // 0 = the pier camera, 1 = the play-area camera. (Nothing flies from one to the other.)
    const cutAtMs = v.startsAt + (LAND + CUT_DELAY) * k * 1000;
    const dive = t >= length || serverMs >= cutAtMs ? 1 : 0;

    if (inDock && !this.pilesBuilt) this.buildPiles();
    const atPlayArea = dive === 1 && !inDock;
    this.ocean.visible = !inDock;
    this.pileGroup.visible = inDock;
    this.pierGroup.visible = !atPlayArea; // (the pier is not seen from the play-area camera)
    this.sea.visible = !atPlayArea;
    this.backdrop.visible = this.foam.visible = atPlayArea;
    for (const a of this.anglers.values()) { a.hook.visible = a.line.visible = !inDock; a.rod.visible = !inDock && !atPlayArea; if (inDock) a.tag.visible = false; }

    if (!inDock) this.updateAnglers(seconds, dt, t, length, k, hookWorldY, dive, serverMs);
    this.updateCamera(dt, hookY, dive, inDock, serverMs, hookWorldY);
    audio.setListener(this.cx, this.cy);

    // The flash for the cut: white in, the switch, white out.
    const pulse = (at: number, fadeIn: number, fadeOut: number) => (serverMs < at ? smooth(at - fadeIn, at, serverMs) : 1 - smooth(at, at + fadeOut, serverMs));
    this.flashMaterial.opacity = Math.max(pulse(dockAt, 260, 500), pulse(cutAtMs, 160, 350));

    // From the play area the world is a cross-section (ocean color below the surface, sky above), so there is no background color to set.
    this.scene.background = null;
    this.scene.fog = atPlayArea ? new Fog(OCEAN_COLOR, 30, 150) : new Fog('#d9efff', 90, 800);
    this.skyGroup.children[0].position.copy(this.camera.position); // the sky dome travels with the camera, so it is always all around you
    this.foam.position.y = Math.sin(seconds * 1.4) * 0.06; // the surface line bobs a little
    // The far wall's top edge: at the surface while the camera is underwater, and lowered (out of sight behind the near wall) once the camera is above it.
    const camY = this.camera.position.y;
    this.farWall.position.y = (camY >= 0 ? -4 * camY - 2 : 0) - 350;

    // Fish.
    for (const obj of this.fish.values()) {
      const sinceServer = (now - obj.serverAt) / 1000;
      if (obj.caughtBy) {
        const angler = this.anglers.get(obj.caughtBy);
        const p = clamp((now - obj.caughtSince) / 1000 / CAUGHT_FLY_SECONDS, 0, 1);
        const ease = p * p * (3 - 2 * p);
        const tx = angler ? angler.x : obj.x, ty = hookY;
        obj.group.position.set(obj.caughtFrom.x + (tx - obj.caughtFrom.x) * ease, obj.caughtFrom.y + (ty - obj.caughtFrom.y) * ease, 1.2);
        obj.group.rotation.z = Math.sin(p * Math.PI * 6) * 0.5 * (1 - p);
        obj.group.scale.setScalar(1 - 0.85 * ease);
        obj.tail.rotation.y = Math.sin(seconds * 25) * 0.7;
        continue;
      }
      const predicted = obj.serverX + obj.dir * obj.speed * sinceServer;
      obj.x = Math.abs(predicted - obj.x) > 3 ? predicted : obj.x + (predicted - obj.x) * Math.min(1, dt * FISH_FOLLOW_RATE);
      obj.y += (obj.serverY - obj.y) * Math.min(1, dt * FISH_FOLLOW_RATE);
      obj.group.position.set(obj.x, -obj.y, obj.group.position.z);
      obj.tail.rotation.y = Math.sin(seconds * (6 + obj.speed) + obj.size * 5) * 0.45; // the tail wags faster for a faster fish
    }

    this.seaTexture.offset.set(seconds * 0.004, seconds * 0.002); // the sea's wave marks drift
    for (const k2 of this.kelp) k2.mesh.rotation.z = Math.sin(seconds * 0.9 + k2.phase) * 0.12;
    if (atPlayArea) this.moveBubbles(dt);
    this.sparks.update(dt);
    this.moveRipples(dt);
    this.moveFloaters(dt);
    if (inDock) this.moveFlops(seconds);
    this.renderer.render(this.scene, this.camera);
  };

  /** Rods, hooks, lines and name tags: the cast, then the hooks following the server. */
  private updateAnglers(seconds: number, dt: number, t: number, length: number, k: number, hookY: number, dive: number, serverMs: number) {
    for (const a of this.anglers.values()) {
      const laneX = (a.laneIndex + 0.5) * this.laneWidth;
      let pitch = ROD_REST_PITCH + 1.2 * Math.sin(seconds * 1.7 + a.rodSway); // the rod sways a little
      let yaw = ROD_REST_YAW;
      let hx = laneX, hy = hookY, hz = PLAY_Z;
      let hs = HOOK_SCALE; // the hook is small while it is up near the rod (and close to the camera), and grows to full size as it flies out
      if (t < length) {
        // The cast. The rod's angle over time: rest, wind BACK (the hook swings along with it), whip FORWARD (it stays forward) and, at the very
        // moment it gets there, the hook is let go and flies out to sea; only after it lands does the rod ease back to rest.
        if (t < WIND_START * k) { pitch = ROD_REST_PITCH; yaw = ROD_REST_YAW; }
        else if (t < WIND_BACK * k) { const u = smooth(WIND_START * k, WIND_BACK * k, t); pitch = lerp(ROD_REST_PITCH, ROD_BACK_PITCH, u); yaw = lerp(ROD_REST_YAW, 8, u); }
        else if (t < RELEASE * k) { const u = smooth(WIND_BACK * k, RELEASE * k, t) ** 0.7; pitch = lerp(ROD_BACK_PITCH, ROD_FORWARD_PITCH, u); yaw = lerp(8, ROD_FORWARD_YAW, u); }
        else if (t < LAND * k) { pitch = ROD_FORWARD_PITCH; yaw = ROD_FORWARD_YAW; }
        else { const u = smooth(0, 1, (t - LAND * k) / (0.9 * k)); pitch = lerp(ROD_FORWARD_PITCH, ROD_REST_PITCH, u); yaw = lerp(ROD_FORWARD_YAW, ROD_REST_YAW, u); }
      }
      this.rodQuaternion(pitch, yaw, a.rod.quaternion);
      a.rod.updateMatrixWorld();
      const tip = this.rodTip(a, pitch, yaw);

      let hanging = false; // is the hook still on the line hanging from the rod (so it points along the line)?
      if (t < RELEASE * k) {
        // Held: the hook hangs from the rod tip on its line like a pendulum, so it is dragged along by the rod as it swings back and then whips forward.
        if (!a.hookPos) { a.hookPos = tip.clone(); a.hookPos.y -= HANG_LENGTH; a.hookPrev.copy(a.hookPos); }
        const swing = a.hookPos.clone().sub(a.hookPrev).multiplyScalar(0.985);
        a.hookPrev.copy(a.hookPos);
        a.hookPos.add(swing);
        a.hookPos.y += CAST_GRAVITY * 0.7 * dt * dt;
        const off = a.hookPos.clone().sub(tip), dist = off.length();
        if (dist > HANG_LENGTH) a.hookPos.copy(tip).addScaledVector(off, HANG_LENGTH / dist); // (the line is only so long)
        hs = HOOK_SMALL; hx = a.hookPos.x; hy = a.hookPos.y; hz = a.hookPos.z;
        hanging = true;
        if (t > WIND_BACK * k && !this.soundedCast.has(`swish-${a.id}`)) { this.soundedCast.add(`swish-${a.id}`); audio.play(rodSwish, hx, hy, 0.25, 1); }
      } else if (t < LAND * k) {
        // The CAST: from the instant the rod arrives forward, the hook is thrown out from where it was, as a ball would be, to land in the water at its
        // lane (the flight is worked out so that it lands exactly then). The line plays out behind it.
        if (!a.released) a.released = (a.hookPos ?? tip.clone().add(new Vector3(0, -HANG_LENGTH, 0))).clone();
        const from = a.released, T = (LAND - RELEASE) * k, tau = t - RELEASE * k, g = CAST_GRAVITY / (k * k);
        const vy = (0 - from.y - 0.5 * g * T * T) / T;
        hx = from.x + ((laneX - from.x) / T) * tau;
        hz = from.z + ((PLAY_Z - from.z) / T) * tau;
        hy = from.y + vy * tau + 0.5 * g * tau * tau;
        hs = lerp(HOOK_SMALL, HOOK_SCALE, smooth(0, 1, tau / T));
        hanging = true;
      } else if (!this.soundedCast.has(`splash-${a.id}`)) {
        this.soundedCast.add(`splash-${a.id}`);
        this.splashAt(laneX);
        audio.play(splash, laneX, 0, 0.45, 1);
      }

      // After the splash the hook is in the plane the fishing happens in: sideways it follows the server (smoothed), its height is the shared depth.
      if (t >= LAND * k) { a.x += (a.targetX - a.x) * Math.min(1, dt * (a.id === this.view.targetId ? HOOK_FOLLOW_RATE : HOOK_FOLLOW_RATE * 0.7)); hx = a.x; hy = hookY; hz = PLAY_Z; }
      if (t >= length && this.latest && serverMs >= this.latest.endsAt) hy = this.hookWorldY(serverMs, this.latest.hooks[a.id]?.fish ?? 0); // (after the finish line each hook has its own height: a heavier catch drops further)

      // Which way the hook faces: before it lands, its bend points away from the rod along the line (so in the cast it looks like it is pointing out
      // to sea, nose first); once it is in the water it turns to hang straight down, side-on to the camera. (It turns smoothly, never snapping.)
      const toward = new Vector3(hx - tip.x, hy - tip.y, hz - tip.z).normalize();
      const wanted = hanging ? new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), toward) : new Quaternion();
      a.hookQuat.slerp(wanted, Math.min(1, dt * 16));
      a.hook.quaternion.copy(a.hookQuat);
      a.hook.scale.setScalar(hs);
      const origin = new Vector3(0, 0.25 * hs, 0).applyQuaternion(a.hookQuat).add(new Vector3(hx, hy, hz)); // (the hook is placed by the middle of its opening)
      a.hook.position.copy(origin);

      // The line: from the reel, through each guide, to the tip (all part of the rod, only seen from the pier), then from the tip to the hook's eyelet.
      // From the play-area camera (the rods are not in the picture) the line just runs straight up out of the top of the screen.
      const eyelet = new Vector3(-0.3 * hs, 0.68 * hs, 0).applyQuaternion(a.hookQuat).add(origin);
      const points = [REEL_LINE_POINT, ...ROD_GUIDES].map((p) => a.rod.localToWorld(p.clone()));
      a.chain.forEach((seg, i) => { seg.visible = dive < 1; if (dive < 1) this.placeLine(seg, points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z, 0.011); });
      if (dive >= 1) this.placeLine(a.line, eyelet.x, eyelet.y + 90, PLAY_Z, eyelet.x, eyelet.y, eyelet.z);
      else this.placeLine(a.line, tip.x, tip.y, tip.z, eyelet.x, eyelet.y, eyelet.z, hanging ? 0.014 : 0.035); // (thin in the air, where it is close to the camera)
      this.updateHooked(a, hx, hy, dt, seconds, performance.now());
      // The splash as the hook comes out of the water: bigger the more fish it is carrying. (Someone arriving long after it happened doesn't get one.)
      if (!a.sprayed && serverMs >= this.latest!.endsAt) {
        const breachAt = this.latest!.endsAt + this.outro().breachAfter * 1000;
        if (serverMs >= breachAt) {
          a.sprayed = true;
          if (serverMs - breachAt < 1500) { this.splashAt(hx, a.hooked.length, false); audio.play(splash, hx, 0, Math.min(1, 0.4 + a.hooked.length * 0.03), 1); }
        }
      }
      a.tag.position.set(hx, hy + 1.8, hz + 1);
      a.tag.visible = dive >= 1; // no names floating about during the cast (they would show through the pier)
    }
  }

  /**
   * Every fish a player has caught stays on their hook and is dragged up with it, so the cluster grows all round (and comes out of the water
   * at the end). They hang head up from the hook, trailing below it; when the hook slides sideways they trail behind it, leaning away from the
   * way it is going (further down, the more they lean), and they all squirm: a wriggle of the body and a fast flap of the tail.
   */
  private updateHooked(a: Angler, hx: number, hy: number, dt: number, seconds: number, now: number) {
    a.vx += ((hx - a.prevX) / Math.max(dt, 0.001) - a.vx) * Math.min(1, dt * 8);
    a.prevX = hx;
    const n = a.hooked.length;
    const scale = clamp(1.05 - 0.006 * n, 0.6, 1.05); // the more fish, the smaller each is drawn, so a big catch still fits
    const lean = clamp(-a.vx * 0.035, -0.45, 0.45);
    a.hooked.forEach((h, i) => {
      // The fish fan out from the hook like the ribs of an umbrella: every head is at the hook and the bodies spread out downwards, the first
      // ones nearly straight down and later ones wider (a repeating spread, so a fish never moves when more are added). A sideways-moving hook
      // swings the whole fan the other way, and each fish sags a little towards the ground and squirms.
      const spread = (((i * 0.618034 + 0.5) % 1) - 0.5) * 2; // -1..1
      const angle = spread * rad(68) + lean; // from straight down, towards the right when positive
      const size = h.obj.size * scale;
      const wriggle = Math.sin(seconds * (9 + (h.phase % 3)) + h.phase) * (0.22 + 0.06 * Math.sin(seconds * 1.3 + h.phase));
      const droop = angle * 0.85 + wriggle * 0.5; // (the outer fish hang a little closer to straight down)
      const dirX = Math.sin(droop), dirY = -Math.cos(droop); // the way the body points, from the head
      const apexX = hx - 0.05 + Math.sin(seconds * 7 + h.phase) * 0.02, apexY = hy - 0.15 - (i % 5) * 0.12;
      const out = size * 0.5 + HEAD_STAGGER[i % 4]; // (the heads are staggered along their rib, so the fan is a cone of fish rather than a knot of heads)
      const targetX = apexX + dirX * out;
      const targetY = apexY + dirY * out - Math.abs(Math.sin(angle)) * size * 0.1;
      const p = smooth(0, 1, (now - h.since) / 450); // it flies to the hook, then hangs
      h.obj.group.position.set(lerp(h.from.x, targetX, p), lerp(h.from.y, targetY, p), 0.1 + (i % 7) * 0.03);
      h.obj.group.rotation.z = lerp(0, Math.PI / 2 + droop, p) + Math.sin(p * Math.PI * 4) * 0.4 * (1 - p); // (the head, +x, points back up at the hook)
      h.obj.group.scale.setScalar(lerp(1, scale, p));
      h.obj.tail.rotation.y = Math.sin(seconds * (16 + (h.phase % 5)) + h.phase) * 0.8;
    });
  }

  private placeLine(line: Mesh, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, thickness = 0.035) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const length = Math.hypot(dx, dy, dz) || 0.001;
    line.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    line.scale.set(thickness, length, thickness);
    line.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx / length, dy / length, dz / length));
  }

  /** The camera: on the pier for the opening, then a cut to the play area, then (at the end) high above the dock. */
  private updateCamera(dt: number, hookY: number, dive: number, inDock: boolean, serverMs: number, hookWorldY: number) {
    const lanes = this.latest!.lanes;
    const total = this.total;
    const followed = this.view.targetId ? lanes.indexOf(this.view.targetId) : -1;
    const followedX = followed >= 0 ? (followed + 0.5) * this.laneWidth : total / 2;

    if (inDock) { this.updateDockCamera(dt, followed, followedX); return; }

    // Underwater framing: the followed lane (or the whole ocean), with the hooks a little below the middle of the screen.
    const wantWidth = followed >= 0
      ? clamp(UNDER_VIEW_HEIGHT * this.aspect, this.laneWidth * MIN_VIEW_LANES, Math.min(total + 2, this.laneWidth * MAX_VIEW_LANES))
      : total + 2;
    let wantX = followedX;
    if (total + 2 > wantWidth) wantX = clamp(wantX, wantWidth / 2 - 1, total - wantWidth / 2 + 1);
    else wantX = total / 2;
    const vh = wantWidth / this.aspect;
    // The closing shot: as the hooks reach the surface the camera pans up (it does not turn) until the surface is low in the picture,
    // with room above it for the hooks to come out into.
    const endsAt = this.latest!.endsAt;
    const pan = smooth(endsAt - HANG_LEAD_SECONDS * 1000, endsAt + 700, serverMs);
    // Once the hooks are launched out of the water the camera rises with them (but keeps the surface in sight for as long as it can).
    const wantY = Math.max(lerp(hookY + vh * HOOK_SCREEN_HEIGHT, vh * SURFACE_SCREEN_HEIGHT, pan), serverMs >= endsAt ? hookWorldY * 0.8 - 1.5 + vh * SURFACE_SCREEN_HEIGHT : -Infinity); // (follows the hooks up more closely, and a little below them, so the hooks and their fish end up near the middle of the screen)
    if (!this.cameraStarted) { this.cx = wantX; this.vw = wantWidth; this.cy = wantY; this.cameraStarted = true; }
    const ease = Math.min(1, dt * 4);
    this.cx += (wantX - this.cx) * ease;
    this.vw += (wantWidth - this.vw) * ease;
    this.cy = wantY; // (the height follows the hooks exactly: they already move smoothly, and they sink fast during the cast)
    const underDistance = (this.vw / this.aspect / 2) / Math.tan(rad(UNDER_FOV / 2));
    const underPos = new Vector3(this.cx, this.cy, PLAY_Z + underDistance);
    const underQuat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(underPos, new Vector3(this.cx, this.cy, PLAY_Z), new Vector3(0, 1, 0)));

    // On the pier: standing behind the followed player's rod, looking out to sea (and a little down, so the sea fills the middle of the picture).
    const eye = new Vector3(followedX + 0.1, DECK_Y + 1.75, Z_STAND + 1.3);
    const povQuat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, new Vector3(followedX - 1.2, DECK_Y + 1.75 - 2.4, Z_STAND - 20), new Vector3(0, 1, 0)));

    this.camera.up.set(0, 1, 0);
    const onPlayArea = dive >= 1;
    this.camera.position.copy(onPlayArea ? underPos : eye);
    this.camera.quaternion.copy(onPlayArea ? underQuat : povQuat);
    // (a tall phone screen needs a wider view from the pier, or the rod, which sweeps across the whole width, would be off the sides)
    const povFov = clamp((2 * Math.atan(Math.tan(rad(34)) / this.aspect) * 180) / Math.PI, POV_FOV, 95);
    this.camera.fov = onPlayArea ? UNDER_FOV : povFov;
    this.camera.updateProjectionMatrix();
  }

  /** High above the dock, looking straight down with the sea at the top of the picture. Zooms in on the followed lane's pile (and closer still for the winner). */
  private updateDockCamera(dt: number, followed: number, followedX: number) {
    const pile = followed >= 0 ? this.piles.find((p) => p.id === this.view.targetId) : undefined;
    const tan = Math.tan(rad(DOCK_FOV / 2));
    const portrait = Math.min(1, this.aspect);
    // The picture is 80% pier and DOCK_SEA_FRACTION (20%) ocean: the pier's front edge is kept that far down from the top. How big the
    // frame has to be then follows from what must fit: the count above a pile and the pile itself, each with some spare room.
    const f = DOCK_SEA_FRACTION, pad = 1.5;
    const needed = (above: number, below: number) => Math.max((Z_EDGE + pad + above - PILE_Z) / (2 * f), (PILE_Z + below + pad - Z_EDGE) / (2 - 2 * f)); // (half the height of the frame, in units on the deck)
    let wantX: number, wantHeight: number;
    if (pile) {
      wantX = pile.x;
      wantHeight = (Math.max(6.5, needed(pile.above, pile.below)) / (tan * portrait)) * (this.view.winner ? 1 : 1.25); // (the winner's pile fills the screen; the others are a little further back)
    } else {
      wantX = followed >= 0 ? followedX : this.total / 2;
      const fit = needed(Math.max(0, ...this.piles.map((p) => p.above)), Math.max(0, ...this.piles.map((p) => p.below))) / tan;
      wantHeight = followed >= 0 ? Math.max(12, fit) : Math.max(10, fit, (this.total / 2 + 4) / (tan * this.aspect));
    }
    if (!this.dockStarted) { this.dockX = wantX; this.dockHeight = wantHeight; this.dockStarted = true; }
    const ease = Math.min(1, dt * (this.view.winner ? 2.2 : 4));
    this.dockX += (wantX - this.dockX) * ease;
    this.dockHeight += (wantHeight - this.dockHeight) * ease;
    // The camera's position along the pier follows from its height, so the front edge stays 20% of the way down however far it has zoomed.
    this.dockZ = Z_EDGE + this.dockHeight * tan * (1 - 2 * f);
    const eye = new Vector3(this.dockX, DECK_Y + this.dockHeight, this.dockZ);
    const up = new Vector3(0, 0, -1); // the sea (towards -z) is at the top of the picture
    this.camera.up.copy(up);
    this.camera.position.copy(eye);
    this.camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(eye, new Vector3(this.dockX, DECK_Y, this.dockZ), up));
    this.camera.fov = DOCK_FOV;
    this.camera.updateProjectionMatrix();
    this.cx = this.dockX; this.cy = DECK_Y;
  }

  /** Bubbles rise and stop at the surface; any that fall outside the camera's view are brought round to the other side of it. */
  private moveBubbles(dt: number) {
    const position = this.bubbles.geometry.getAttribute('position');
    const array = position.array as Float32Array;
    const h = this.vw / this.aspect;
    const left = this.cx - this.vw / 2 - 1, right = this.cx + this.vw / 2 + 1, bottom = this.cy - h / 2 - 1, top = this.cy + h / 2 + 1;
    for (let i = 0; i < this.bubbleSpeed.length; i++) {
      let x = array[i * 3], y = array[i * 3 + 1];
      if (this.bubblesNeedPlacing) { x = left + Math.random() * (right - left); y = bottom + Math.random() * (top - bottom); }
      y += this.bubbleSpeed[i] * dt;
      x += Math.sin(y * 1.3 + i) * 0.1 * dt;
      if (x < left) x += right - left; else if (x > right) x -= right - left;
      if (y > top) y = bottom + (y - top);
      else if (y < bottom) y = top - (bottom - y);
      if (y > -0.4) y = bottom + Math.random() * 2; // reached the surface: start again from below
      array[i * 3] = x; array[i * 3 + 1] = y; array[i * 3 + 2] = 0.5;
    }
    this.bubblesNeedPlacing = false;
    position.needsUpdate = true;
  }

  /**
   * A splash where the hook meets the surface: a fan of water-colored spark streaks (the Tap Race sparks) thrown up and out. A hook coming out of the
   * water with fish on it makes a bigger one: the more fish, the more, higher and thicker the droplets. A hook just landing from the cast is small.
   */
  private splashAt(x: number, fish = 0, ring = true) {
    const power = fish === 0 ? 0.3 : Math.min(2.2, 0.4 + fish * 0.03);
    this.sparks.splash(x, 0.05, PLAY_Z + 0.5, power, WATER_PALETTE, fish === 0 ? 1 : splashAmount(fish));
    if (!ring) return;
    const wave = new Mesh(new RingGeometry(0.3, 0.4, 32), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }));
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(x, 0.05, PLAY_Z);
    this.scene.add(wave);
    this.ripples.push({ mesh: wave, age: 0 });
  }

  private moveRipples(dt: number) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      r.mesh.scale.setScalar(1 + r.age * 6);
      (r.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - r.age / 1.3));
      if (r.age > 1.3) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as Material).dispose(); this.ripples.splice(i, 1); }
    }
  }

  private moveFloaters(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.sprite.position.set(f.x, f.y + f.age * 2, PLAY_Z + 2);
      f.sprite.material.opacity = Math.max(0, 1 - f.age / 0.9);
      if (f.age > 0.9) { this.scene.remove(f.sprite); disposeNameTag(f.sprite); this.floaters.splice(i, 1); }
    }
  }

  private removeAngler(id: string, a: Angler) {
    for (const h of a.hooked) this.ocean.remove(h.obj.group);
    this.scene.remove(a.rod, a.hook, a.line, a.tag, ...a.chain);
    disposeNameTag(a.tag);
    this.anglers.delete(id);
  }
}
