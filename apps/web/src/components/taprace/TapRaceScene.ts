import {
  AmbientLight, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, TextureLoader, WebGLRenderer,
  type Texture,
} from 'three';
import { audio } from '../../audio/spatialAudio';
import { typewriterClick } from '../../audio/clickSounds';
import { createRoundClock } from '../../audio/roundClock';
import { SpectatorRig } from '../../spectate/SpectatorRig';
import { SparkSystem } from './sparks';
import type { CameraMode } from '../../spectate/useSpectatorCamera';

/** One player's button: its colour and name. (Fixed when the round starts.) */
export interface ButtonStyle {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null; // the player's profile picture, shown on top of their button (null = just their colour)
}

/** Layout of the board: every button sits in a grid, `CELL_W` apart across and `CELL_D` apart down, so names have room under each button. */
const CELL_W = 7.5;
const CELL_D = 9.5;
const MAX_COLUMNS = 4; // 8 players = 4 across, 2 down
const BUTTON_RADIUS = 2.2;
const PRESS_DEPTH = 0.4; // how far a button sinks when pressed
const REST_HEIGHT = 0.55; // height of a button's top when it is up
const BASE_TOP = 0.62; // the top of the dark base the button sits in: where the sparks come from
/** The sparks turn rainbow when this many seconds (or fewer) are left, and the very last second throws more than twice as many. */
const RAINBOW_SECONDS = 3;
const FRENZY_SECONDS = 1;
const WELL_RADIUS = BUTTON_RADIUS + 0.5; // the middle of the well around the button, between the button's edge and the base's edge

interface ButtonVisual {
  id: string;
  x: number;
  z: number;
  top: Mesh; // the part that moves down when pressed
  face: Mesh; // the flat disc on top that shows the count
  faceTexture: CanvasTexture;
  faceContext: CanvasRenderingContext2D;
  count: number; // what is drawn on the face now
  press: number; // 1 = just pressed, fades back to 0 as the button springs up
  faceScale: number; // how big the number is drawn now (it starts small and grows with every tap)
}

/**
 * Everything three.js for the Tap Race round, kept apart from React (the same split as Snowball): React gives it the
 * latest counts (`setCounts`) and a container; it owns the renderer, the animation loop and all cleanup.
 *
 * The scene is ONE board holding every player's button, laid out in a grid. Players look down at their own button from a
 * fixed spot above it (no camera controls); a spectator follows any player's view or flies a free camera over the whole
 * board. The camera itself is the game-agnostic SpectatorRig, the same one Snowball uses.
 */
export class TapRaceScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(55, 1, 0.1, 400);
  private buttons = new Map<string, ButtonVisual>();
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private rig: SpectatorRig;
  private view: { mode: CameraMode; targetId: string | null };
  private pan: { current: { x: number; z: number } } = { current: { x: 0, z: 0 } };
  private zoom = 1; // pulls the camera back on narrow (portrait) screens
  private textureLoader = new TextureLoader().setCrossOrigin('anonymous'); // profile pictures may live on another site (Supabase)
  private sparks = new SparkSystem();
  private clicksThisFrame = 0; // other players' clicks are limited per frame so a room of fast tappers stays a pleasant clatter, not a wall of noise
  private progress = 0; // how far through the round we are, 0..1: sparks get fiercer and redder as it grows
  private secondsLeft = Infinity; // in the last few seconds the sparks turn rainbow
  private clock = createRoundClock((sound, gain) => this.playHere(sound, gain)); // the ticking countdown and the final whistle

  constructor(
    private container: HTMLElement,
    styles: ButtonStyle[],
    private selfId: string | null,
  ) {
    this.view = { mode: 'follow', targetId: selfId };
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer);
    this.scene.background = new Color('#1a1a2e'); // the same colour as the rest of the app, so the board floats in the page

    const { positions, reach } = layout(styles.length);
    // The free camera may roam over the whole board and a little beyond; its height is set from this too.
    this.rig = new SpectatorRig(this.camera, reach + 6, () => ({ height: 9.5, back: 4.8 })); // players see their button from almost straight above
    this.buildWorld(reach);
    this.scene.add(this.sparks.object);
    this.disposables.push(this.sparks);
    styles.forEach((style, i) => this.addButton(style, positions[i]));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** The latest tap count for each player. A button whose count went up is pressed (a quick spring) and its face redrawn. */
  setCounts(counts: Record<string, number>) {
    for (const button of this.buttons.values()) {
      const n = counts[button.id] ?? 0;
      if (n === button.count) continue;
      if (n > button.count) {
        button.press = 1;
        // Sparks fly from the button: one burst per tap counted (a batch of several taps arriving at once makes a few bursts, not dozens).
        for (let k = 0; k < Math.min(n - button.count, 3); k++) {
          this.sparks.burst(button.x, BASE_TOP, button.z, this.progress, WELL_RADIUS, this.progress, this.secondsLeft <= RAINBOW_SECONDS, this.secondsLeft <= FRENZY_SECONDS); // from the well around the button (the border of the base)
          this.click(button);
        }
      }
      button.count = n;
      this.drawFace(button);
    }
  }

  /** The typewriter click for one press, heard from where that button is: your own is full volume, everyone else's quieter and fading with distance. */
  private click(button: ButtonVisual) {
    const mine = button.id === this.selfId;
    if (!mine && this.clicksThisFrame >= 6) return;
    if (!mine) this.clicksThisFrame++;
    audio.play(typewriterClick, button.x, button.z, mine ? 0.9 : 0.4, 0.4 + 0.6 * this.progress); // harder, louder-sounding strikes later in the round
  }

  /** How far through the round we are (0 at the start, 1 at the end) and how many seconds are left. The sparks grow in count and size, and shift from yellow to red, with the first; the last second turns them rainbow. */
  setProgress(progress: number, secondsLeft: number) {
    this.progress = Math.min(1, Math.max(0, progress));
    this.secondsLeft = secondsLeft;

    this.clock.update(secondsLeft); // ticks for the last 5 seconds, then a whistle
  }

  /** Plays a sound that belongs to the whole round rather than a place on the board (the clock, the whistle): at the listener, so it is the same volume everywhere. */
  private playHere(sound: Parameters<typeof audio.play>[0], gain: number) {
    audio.play(sound, this.rig.focusX, this.rig.focusZ, gain, 1);
  }

  /** Spectators: which player's view to follow, or the free camera. (Players never call this: they follow their own button.) */
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
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }
  private disposed = false;

  // ---------- world ----------

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private buildWorld(reach: number) {
    this.scene.add(new AmbientLight('#ffffff', 1.1));
    const sun = new DirectionalLight('#ffffff', 1.6);
    sun.position.set(-6, 14, 9);
    this.scene.add(sun);

    // The floor: a big dark disc under the whole board.
    const floor = new Mesh(this.track(new CircleGeometry(reach + 14, 64)), this.track(new MeshStandardMaterial({ color: '#26264a', roughness: 1 })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
  }

  private addButton(style: ButtonStyle, at: { x: number; z: number }) {
    const group = new Group();
    group.position.set(at.x, 0, at.z);

    // A dark base the button sits in...
    const base = new Mesh(
      this.track(new CylinderGeometry(BUTTON_RADIUS + 0.45, BUTTON_RADIUS + 0.6, 0.5, 40)),
      this.track(new MeshStandardMaterial({ color: '#3a3a5c', roughness: 0.7, metalness: 0.2 })),
    );
    base.position.y = 0.25;
    // ...a ring in the player's colour around it, so you can tell whose it is from anywhere...
    const rim = new Mesh(
      this.track(new CylinderGeometry(BUTTON_RADIUS + 0.62, BUTTON_RADIUS + 0.62, 0.12, 40)),
      this.track(new MeshStandardMaterial({ color: style.color, roughness: 0.5, emissive: style.color, emissiveIntensity: 0.25 })),
    );
    rim.position.y = 0.06;
    // ...and the button itself, which sinks when pressed.
    // A cylinder has three surfaces (side, top, bottom), so it takes three materials: the side and bottom are the player's
    // colour, and the TOP gets the profile picture once it has loaded (until then, or for a guest without one, the colour).
    const sideMaterial = this.track(new MeshStandardMaterial({ color: style.color, roughness: 0.4, emissive: style.color, emissiveIntensity: 0.12 }));
    const capMaterial = this.track(new MeshStandardMaterial({ color: style.color, roughness: 0.45, emissive: style.color, emissiveIntensity: 0.12 }));
    const top = new Mesh(this.track(new CylinderGeometry(BUTTON_RADIUS, BUTTON_RADIUS, 0.8, 40)), [sideMaterial, capMaterial, sideMaterial]);
    if (style.avatarUrl) this.loadAvatar(style.avatarUrl, capMaterial);
    top.position.y = REST_HEIGHT;

    // The count, drawn on a flat disc lying on the button's top (a canvas turned into a texture).
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const faceContext = canvas.getContext('2d')!;
    const faceTexture = this.track(new CanvasTexture(canvas));
    faceTexture.colorSpace = SRGBColorSpace;
    const face = new Mesh(
      this.track(new CircleGeometry(BUTTON_RADIUS * 0.92, 40)),
      this.track(new MeshBasicMaterial({ map: faceTexture, transparent: true })),
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.41; // just above the top's flat surface (it is 0.8 thick, centred on the mesh)
    top.add(face);

    // The player's name, lying flat on the floor in front of (south of) the button, so it reads upright from the usual camera.
    const label = new Mesh(
      this.track(new PlaneGeometry(6.4, 1.6)),
      this.track(new MeshBasicMaterial({ map: this.track(makeNameTexture(style.name + (style.id === this.selfId ? ' (you)' : ''), style.color)), transparent: true })),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.03, BUTTON_RADIUS + 1.9);

    group.add(base, rim, top, label);
    this.scene.add(group);

    const visual: ButtonVisual = { id: style.id, x: at.x, z: at.z, top, face, faceTexture, faceContext, count: 0, press: 0, faceScale: faceScaleFor(0) };
    this.buttons.set(style.id, visual);
    this.drawFace(visual);
  }

  /** Loads a profile picture and puts it on a button's top. If it can't be loaded, the button just stays its colour. */
  private loadAvatar(url: string, material: MeshStandardMaterial) {
    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        // A cylinder's top face maps a picture a quarter turn off, so turn it back: the picture's top then points the way the camera's top does.
        texture.center.set(0.5, 0.5);
        texture.rotation = Math.PI / 2;
        this.disposables.push(texture);
        material.map = texture;
        material.color.set('#ffffff'); // the picture's own colours, not tinted by the player's colour
        material.emissive.set('#ffffff'); // a little self-light so the picture isn't dimmed by the shading
        material.emissiveIntensity = 0.28;
        material.emissiveMap = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => {},
    );
  }

  /** Draws a button's count (or "TAP!" on your own button until you have tapped) onto its face. */
  private drawFace(button: ButtonVisual) {
    const ctx = button.faceContext;
    ctx.clearRect(0, 0, 256, 256);
    const hint = button.id === this.selfId && button.count === 0;
    const text = hint ? 'TAP!' : String(button.count);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The count is the game's UI: big, dead centre, in white with a thick dark outline so it stays readable on top of any picture
    // (the picture is just for fun, and is allowed to be covered).
    ctx.font = `bold ${hint ? 96 : text.length > 3 ? 100 : text.length > 2 ? 130 : 160}px system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 24;
    ctx.strokeStyle = '#14142a'; // dark navy: contrasts with the white number and with the light, colourful pictures
    ctx.strokeText(text, 128, 134);
    ctx.fillText(text, 128, 134);
    button.faceTexture.needsUpdate = true;
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
  }

  private frame = (time: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    if (this.disposed) return;
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;

    // Buttons spring back up after a press (a quick, slightly springy ease).
    for (const button of this.buttons.values()) {
      button.press = Math.max(0, button.press - dt * 7);
      button.top.position.y = REST_HEIGHT - PRESS_DEPTH * button.press;
      // The number grows as taps add up: it eases towards its size for the current count, with a little extra pop on each press.
      const wanted = button.id === this.selfId && button.count === 0 ? HINT_SCALE : faceScaleFor(button.count);
      button.faceScale += (wanted - button.faceScale) * (1 - Math.exp(-14 * dt));
      const faceSize = button.faceScale * (1 + 0.16 * button.press);
      button.face.scale.set(faceSize, faceSize, 1);
    }

    this.sparks.update(dt);
    this.clicksThisFrame = 0;
    audio.setListener(this.rig.focusX, this.rig.focusZ); // you hear from where the camera is looking

    const followed = this.view.targetId ? this.buttons.get(this.view.targetId) : undefined;
    this.rig.update(dt, this.view.mode, followed && { x: followed.x, y: 0, z: followed.z, size: 0 }, this.pan.current, this.zoom);
    this.renderer.render(this.scene, this.camera);
  };
}

// ---------- helpers ----------

/**
 * How big the number on a button is (1 = fills the face), by its tap count: it starts small (30%) and grows noticeably with
 * every tap, quickly at first and then more slowly, until it fills the button (at around 50 taps).
 */
export function faceScaleFor(count: number): number {
  return 0.3 + 0.7 * (1 - Math.exp(-count / 22));
}

/** The "TAP!" prompt on your own button before your first tap is bigger than the smallest number, so it can be read. */
const HINT_SCALE = 0.62;

/** Positions of `count` buttons in a grid (up to MAX_COLUMNS across, rows centred), centred on the origin; and how far the board reaches from the middle. */
export function layout(count: number): { positions: { x: number; z: number }[]; reach: number } {
  const columns = Math.min(Math.max(count, 1), MAX_COLUMNS);
  const rows = Math.ceil(count / columns);
  const positions: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, count - row * columns); // the last row may be shorter: centre it
    const col = i - row * columns;
    positions.push({ x: (col - (inRow - 1) / 2) * CELL_W, z: (row - (rows - 1) / 2) * CELL_D });
  }
  const halfWidth = ((columns - 1) * CELL_W) / 2 + CELL_W / 2;
  const halfDepth = ((rows - 1) * CELL_D) / 2 + CELL_D / 2;
  return { positions, reach: Math.hypot(halfWidth, halfDepth) };
}

/** A player's name as a texture for a flat label: white text with a dark outline so it reads on any floor. */
function makeNameTexture(name: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 80;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  while (ctx.measureText(name).width > 480 && size > 28) {
    size -= 4; // long names shrink to fit
    ctx.font = `bold ${size}px system-ui, sans-serif`;
  }
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(26, 26, 46, 0.9)';
  ctx.strokeText(name, 256, 66);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 256, 66);
  ctx.fillStyle = color;
  ctx.fillRect(176, 112, 160, 8); // a bar in the player's colour under the name
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
