import {
  AmbientLight, BoxGeometry, BufferGeometry, CylinderGeometry, DirectionalLight, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster,
  Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRANCH_ANGLES_DEG, FLAKE_COUNT, FLAKE_RADIUS_FRAC, HAND_SWAP_MS, STEM_LENGTHS, decodeDesign, flakeOnScreen, flakePose, type SnowflakeMatchView } from '@fgn/shared';
import { NightCamp } from './NightCamp';
import { createRoundClock } from '../../audio/roundClock';
import { audio } from '../../audio/spatialAudio';

export interface FlakeStyle { id: string; name: string; color: string }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (x: number) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
const FOV = 60;
const FLAKE_Z = -6; // the plane the flakes fall in, in front of the camera
const HAND_Z = -1.4; // the plane the hand is drawn in (a child of the camera), bottom right
const HAND_Y = 0.62; // how far down the hand rests (a fraction of half the screen's height): low, so the flakes have the room
const PARTICLES = 28;
const BORDER = 0.03; // how much wider the dark border is than the snowflake, on each side (in snowflake-widths)
const HAND_FLAKE_SIZE = 0.3; // the held snowflake's width, in hand units: about the width of the palm
const WRONG_SHAKE = 0.3; // how hard the screen shakes when you tap a wrong flake (world units of camera jolt)

/**
 * One snowflake design as a real 3D object (a flat-shaded relief, with thickness): six identical arms round a hub, each a stem with side branches and a tip, all made of small bars joined into ONE geometry.
 * It is 1 across (a little more with a `pad`), tips included, so scaling the mesh by the width wanted sizes it. It faces +z (the camera) and is given a gentle tilt and spin when drawn.
 */
function buildFlakeGeometry(design: number, pad = 0): BufferGeometry {
  const d = decodeDesign(design), R = 0.43, T = 0.055 + 2 * pad, DEPTH = 0.05; // (`pad` thickens every bar, tip and hub by the same amount all round: that is how the dark border behind a snowflake is made, so it is an even width everywhere)
  const L = R * STEM_LENGTHS[d.stem], ang = (BRANCH_ANGLES_DEG[d.angle] * Math.PI) / 180, branch = R * 0.3, r0 = R * 0.12;
  const at = d.pairs === 1 ? [0.55] : d.pairs === 2 ? [0.4, 0.7] : [0.3, 0.52, 0.74];
  const bar = (x1: number, y1: number, x2: number, y2: number): BufferGeometry => { // a bar from one point to another
    const g = new BoxGeometry(Math.hypot(x2 - x1, y2 - y1) + T * 0.6, T, DEPTH);
    g.rotateZ(Math.atan2(y2 - y1, x2 - x1)); g.translate((x1 + x2) / 2, (y1 + y2) / 2, 0); return g;
  };
  const arm: BufferGeometry[] = [bar(0, r0, 0, L)]; // (the arm points up here)
  for (const t of at) for (const side of [-1, 1]) arm.push(bar(0, L * t, side * Math.sin(ang) * branch, L * t + Math.cos(ang) * branch));
  if (d.tip === 1) arm.push(new SphereGeometry(0.048 + pad, 7, 5).translate(0, L + 0.03, 0)); // a dot
  if (d.tip === 2) for (const side of [-1, 1]) arm.push(bar(0, L, side * R * 0.14, L + R * 0.17)); // a fork
  if (d.tip === 3) arm.push(new BoxGeometry(0.085 + 2 * pad, 0.085 + 2 * pad, DEPTH).rotateZ(Math.PI / 4).translate(0, L + 0.05, 0)); // a diamond
  const parts: BufferGeometry[] = [];
  for (let a = 0; a < 6; a++) for (const g of arm) parts.push(g.clone().rotateZ((a * Math.PI) / 3));
  if (d.center === 0) parts.push(new CylinderGeometry(R * 0.11 + pad, R * 0.11 + pad, DEPTH * 1.4, 6).rotateX(Math.PI / 2)); // a plain hub
  if (d.center === 2) parts.push(new CylinderGeometry(R * 0.2 + pad, R * 0.2 + pad, DEPTH * 1.4, 10).rotateX(Math.PI / 2)); // a big dot
  if (d.center === 1) for (let k = 0; k < 6; k++) { // a hexagon ring
    const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3, rr = R * 0.2;
    parts.push(bar(Math.sin(a0) * rr, Math.cos(a0) * rr, Math.sin(a1) * rr, Math.cos(a1) * rr));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  for (const g of arm) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * Everything three.js for Snowflake Match. FIRST PERSON: the camera is your eyes, snowflakes fall in front of you, and your gloved hand (a brown mitten, in a sleeve in your colour with a puffy white cuff, like the
 * Penguin Lasso eskimo's coat) holds one snowflake on its palm at the bottom right. The scene draws the view and decides nothing: where a flake is comes from the shared `flakePose` and the clock; a tap is turned into
 * a flake number by `pickAt`. A spectator sees the followed player's hand. Wrong taps shake the screen.
 */
export class SnowflakeMatchScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 50);
  private view: SnowflakeMatchView | null = null;
  private followId: string | null;
  private colorOf = new Map<string, string>();
  private geoms = new Map<number, BufferGeometry>(); // one 3D geometry per design, built when first needed
  private flakes: { group: Group; body: Mesh; outline: Mesh; material: MeshStandardMaterial; design: number }[] = [];
  private world: { x: number; y: number; on: boolean }[] = [];
  private hidden = new Map<number, { born: number; t: number }>(); // flakes you have just tapped: gone until the server has given them a new fall
  private flash = new Map<number, number>(); // a wrongly tapped flake flashes red until this time
  private hand = new Group();
  private handFlake!: { group: Group; body: Mesh; outline: Mesh; material: MeshStandardMaterial; design: number };
  private shownFor: string | null = null; // whose hand is on show
  private fieldFor: string | null = null; // whose field of flakes is on show (everyone has their own)
  private lastHand = -1; // the design on show in that hand
  private handX = 0; // where the hand rests across the screen
  private handShake = 0; // when (performance.now) the hand was last shaken by a wrong tap; it shakes side to side for HAND_SWAP_MS
  private handPop: { t: number; design: number } | null = null; // the held flake has just been matched: it pops, the hand moves, and the next one shows HAND_SWAP_MS later
  private sleeve!: MeshStandardMaterial;
  private particles: { mesh: Mesh; material: MeshBasicMaterial; vel: Vector3; life: number; max: number; base: number }[] = [];
  private shake = 0;
  private halfH = 1;
  private halfW = 1;
  private handScale = 1;
  private aspect = 1;
  private disposables: { dispose(): void }[] = [];
  private camp = new NightCamp(); // the 3D night camp behind everything, seen through frosted glass: scenery only
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private winnerView = false;
  private raycaster = new Raycaster();
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  /** The start countdown's move, 0 (the hand is down out of sight) .. 1 (up); set by the game screen from the server's clock. */
  introFactor: () => number = () => 1;

  constructor(private container: HTMLElement, private serverNow: () => number, styles: FlakeStyle[], follow: string | null) {
    this.followId = follow;
    for (const s of styles) this.colorOf.set(s.id, s.color);
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.autoClear = false; // (the camp draws the background itself, then the game is drawn over it)
    this.disposables.push(this.renderer);
    this.scene.add(new AmbientLight('#ffffff', 1.0));
    const sun = new DirectionalLight('#fff4dc', 1.2); sun.position.set(-2, 3, 2); this.scene.add(sun);

    for (let i = 0; i < FLAKE_COUNT; i++) {
      const f = this.makeFlakeObject(); f.group.visible = false;
      this.scene.add(f.group); this.flakes.push(f);
      this.world.push({ x: 0, y: 0, on: false });
    }
    this.buildHand();
    this.camera.add(this.hand); this.scene.add(this.camera);

    const bit = new IcosahedronGeometry(0.06, 0);
    this.disposables.push(bit);
    for (let i = 0; i < PARTICLES; i++) {
      const material = new MeshBasicMaterial({ color: '#ffffff' }), mesh = new Mesh(bit, material); mesh.visible = false;
      this.scene.add(mesh); this.particles.push({ mesh, material, vel: new Vector3(), life: 0, max: 1, base: 1 }); this.disposables.push(material);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** A 3D snowflake object: the relief itself (icy white, lit, with a faint glow) over a slightly bigger dark copy behind it that outlines it so it reads against anything. Its design is set when it is drawn. */
  private makeFlakeObject() {
    const material = new MeshStandardMaterial({ color: '#f2f9ff', emissive: '#8fc0ff', emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.05, flatShading: true });
    const dark = new MeshBasicMaterial({ color: '#10203f' });
    const body = new Mesh(undefined, material), outline = new Mesh(undefined, dark);
    outline.position.z = -0.04; // (the border: the same snowflake with every bar thickened evenly, set just behind)
    const group = new Group(); group.add(outline, body);
    this.disposables.push(material, dark);
    return { group, body, outline, material, design: -1 };
  }
  private geoOf(design: number): BufferGeometry {
    let g = this.geoms.get(design);
    if (!g) { g = buildFlakeGeometry(design); this.geoms.set(design, g); }
    return g;
  }
  private borderOf(design: number): BufferGeometry {
    let g = this.geoms.get(design + 100000);
    if (!g) { g = buildFlakeGeometry(design, BORDER); this.geoms.set(design + 100000, g); }
    return g;
  }
  private setDesign(f: { body: Mesh; outline: Mesh; design: number }, design: number) {
    if (f.design === design) return;
    f.design = design; f.body.geometry = this.geoOf(design); f.outline.geometry = this.borderOf(design);
  }

  /** The gloved hand, in units where 1 = half the screen's height at the hand's distance: a brown mitten, a sleeve in the player's colour, a ring of puffy white fur at the cuff, and the held snowflake on the palm. */
  private buildHand() {
    const brown = new MeshStandardMaterial({ color: '#7a4a24', flatShading: true, roughness: 0.9 });
    this.sleeve = new MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.85 });
    const fur = new MeshStandardMaterial({ color: '#fffaf0', flatShading: true, roughness: 1 });
    const palm = new SphereGeometry(0.2, 10, 8), thumb = new SphereGeometry(0.085, 8, 6), puff = new IcosahedronGeometry(0.065, 1);
    const arm = new CylinderGeometry(0.2, 0.15, 1.1, 9, 3);
    this.disposables.push(brown, this.sleeve, fur, palm, thumb, puff, arm);
    const mitten = new Mesh(palm, brown); mitten.scale.set(1, 1.15, 0.75);
    const thumbMesh = new Mesh(thumb, brown); thumbMesh.position.set(0.17, 0.06, 0.03); thumbMesh.scale.set(1, 1.3, 0.9); thumbMesh.rotation.z = -0.4;
    // the sleeve runs from the cuff down and to the right, off the screen
    const dir = new Vector3(0.55, -0.83, 0).normalize(), cuff = dir.clone().multiplyScalar(0.26);
    const sleeve = new Mesh(arm, this.sleeve);
    sleeve.position.copy(cuff).addScaledVector(dir, 0.55); sleeve.rotation.z = Math.atan2(-dir.x, dir.y);
    const rim = new Group(); rim.position.copy(cuff);
    const side = new Vector3(-dir.y, dir.x, 0);
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, p = new Mesh(puff, fur); p.position.copy(side).multiplyScalar(Math.cos(a) * 0.17).add(new Vector3(0, 0, Math.sin(a) * 0.17)); rim.add(p); }
    this.hand.add(mitten, thumbMesh, sleeve, rim);
    // the snowflake in the hand: on the palm of the glove, facing you
    this.handFlake = this.makeFlakeObject();
    this.handFlake.group.position.set(-0.01, 0.01, 0.17);
    this.hand.add(this.handFlake.group);
    this.hand.rotation.x = -0.18;
  }

  pushView(view: SnowflakeMatchView) { this.view = view; }
  /** Whose hand is shown: yours, the one a spectator follows, or the winner's. */
  setFollow(id: string | null) { this.followId = id; }
  setWinnerView(on: boolean) { this.winnerView = on; }
  setSecondsLeft(s: number) { this.clock.update(s); }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    const t = Math.tan((FOV * Math.PI) / 360);
    this.halfH = t * -FLAKE_Z; this.halfW = this.halfH * this.aspect;
    const hh = t * -HAND_Z, hw = hh * this.aspect;
    this.camp.layout(this.aspect);
    this.handScale = hh;
    this.hand.scale.setScalar(hh);
    this.handX = hw * (this.aspect < 0.8 ? 0.28 : 0.55);
    this.hand.position.set(this.handX, -hh * HAND_Y, HAND_Z);
  }

  /** The flakes on show: the followed player's own field (everyone has their own). */
  private fieldOf(): { design: number; born: number; lane: number }[] | null {
    return this.view && this.followId ? this.view.players[this.followId]?.flakes ?? null : null;
  }

  /** Which flake is under this point of the screen (the nearest on screen within reach of its middle), or null. */
  pickAt(clientX: number, clientY: number): { flake: number; design: number; x: number; y: number } | null {
    const field = this.fieldOf();
    if (!this.view || !field) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width < 1) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)), this.camera);
    const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -FLAKE_Z), new Vector3());
    if (!hit) return null;
    const reach = FLAKE_RADIUS_FRAC * 2 * this.halfH * 1.35;
    let best = -1, bestD = reach;
    this.world.forEach((w, i) => { if (!w.on) return; const d = Math.hypot(w.x - hit.x, w.y - hit.y); if (d < bestD) { bestD = d; best = i; } });
    return best < 0 ? null : { flake: best, design: field[best].design, x: this.world[best].x, y: this.world[best].y };
  }

  /** You have tapped flake i: it vanishes (a burst) until the server gives it a new fall; or, if it was wrong, it flashes red and the screen shakes. */
  tapped(i: number, correct: boolean) {
    const field = this.fieldOf();
    if (!this.view || !field) return;
    const w = this.world[i];
    if (correct) {
      this.hidden.set(i, { born: field[i].born, t: performance.now() });
      this.burst(w.x, w.y, ['#ffffff', '#bfe4ff', '#8fd0ff']);
      if (this.lastHand >= 0 && !this.handPop) this.popHand(this.lastHand); // (the flake in your hand pops too, as the next one is on its way)
    } else {
      this.flash.set(i, performance.now() + 350);
      this.burst(w.x, w.y, ['#ff6b6b', '#ff9a9a'], 10);
      this.shake = Math.max(this.shake, WRONG_SHAKE);
      this.handShake = performance.now(); // (and the hand shakes its head: side to side, as strongly as it lifts for a match)
    }
  }

  private burst(x: number, y: number, colors: string[], count = PARTICLES, z = FLAKE_Z + 0.2, size = 1) {
    let n = 0;
    for (const p of this.particles) {
      if (n >= count) break;
      n++;
      const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 2.6) * size;
      p.mesh.position.set(x, y, z); p.vel.set(Math.cos(a) * sp, Math.sin(a) * sp + 0.8 * size, 0); p.base = size;
      p.max = p.life = 0.5 + Math.random() * 0.4; p.material.color.set(colors[n % colors.length]); p.mesh.visible = true;
    }
  }

  /** The held snowflake has been matched: it pops in white particles where it sits on the glove, and the hand moves; the next snowflake shows HAND_SWAP_MS later. */
  private popHand(design: number) {
    this.handPop = { t: performance.now(), design };
    this.camera.updateMatrixWorld(true);
    const at = this.handFlake.group.getWorldPosition(new Vector3());
    this.burst(at.x, at.y, ['#ffffff', '#ffffff', '#e8f6ff'], 24, at.z + 0.05, 0.22);
  }

  /** Can the player tap now? Not while the hand is swapping its snowflake (the server ignores taps then too). */
  canTap(): boolean { return !this.handPop || performance.now() - this.handPop.t >= HAND_SWAP_MS; }

  private frame = (t: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000); this.lastFrame = t;
    const v = this.view;
    this.camp.update(t / 1000);
    if (v) this.draw(v, this.serverNow(), dt);
    this.camp.render(this.renderer, t / 1000); // the background first: the camp, through the frosted glass
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera); // then the game, crisp, on top
  };

  private draw(v: SnowflakeMatchView, now: number, dt: number) {
    const nowMs = performance.now(), r = FLAKE_RADIUS_FRAC * 2 * this.halfH;
    const field = this.followId ? v.players[this.followId]?.flakes : undefined;
    if (this.fieldFor !== this.followId) { this.fieldFor = this.followId; this.hidden.clear(); this.flash.clear(); } // (a different player's field: nothing carries over)
    for (let i = 0; i < FLAKE_COUNT; i++) {
      const fl = this.flakes[i], f = field?.[i];
      if (!f) { fl.group.visible = false; this.world[i] = { x: 0, y: 0, on: false }; continue; }
      const pose = flakePose(i, f.born, f.lane, now);
      const x = (pose.nx - 0.5) * 2 * this.halfW, y = this.halfH - pose.ny * 2 * this.halfH, on = flakeOnScreen(pose.ny);
      const hid = this.hidden.get(i);
      if (hid && (f.born !== hid.born || nowMs - hid.t > 900)) this.hidden.delete(i); // (the server has given it a new fall, or has not heard of the tap: it is back)
      const hidden = !!this.hidden.get(i);
      this.world[i] = { x, y, on: on && !hidden };
      fl.group.visible = !hidden;
      this.setDesign(fl, f.design);
      const flashing = (this.flash.get(i) ?? 0) > nowMs;
      fl.material.color.set(flashing ? '#ff6b6b' : '#f2f9ff'); fl.material.emissive.set(flashing ? '#ff3030' : '#8fc0ff');
      fl.group.position.set(x, y, FLAKE_Z + i * 0.001);
      fl.group.rotation.set(0.3 * Math.sin(nowMs / 1250 + i * 1.7), 0.3 * Math.sin(nowMs / 1650 + i * 2.3), pose.spin); // (a gentle tilt shows it is solid; the spin is about its own middle)
      fl.group.scale.setScalar(2 * r);
    }

    // the hand: whoever is followed, sliding up into view as the countdown ends
    const id = this.followId, pv = id ? v.players[id] : undefined;
    this.hand.visible = !!pv;
    if (pv) {
      this.sleeve.color.set(this.colorOf.get(id!) ?? '#ffffff');
      const d = pv.hand[0] ?? -1;
      if (this.shownFor !== id) { this.shownFor = id; this.lastHand = d; this.handPop = null; } // (a different hand: no pop)
      else if (d !== this.lastHand) { // the design in the hand changed: that was a match (for a spectator, or any match this phone did not see being tapped)
        if (!this.handPop || this.handPop.design !== this.lastHand) this.popHand(this.lastHand);
        this.lastHand = d;
      }
      // the held flake: gone while it pops, then the next one pops in
      let flakeScale = 1, since = Infinity;
      if (this.handPop) {
        since = nowMs - this.handPop.t;
        const stillOld = d === this.handPop.design; // (the server has not given the next one yet)
        if (since < HAND_SWAP_MS || (stillOld && since < 2000)) flakeScale = 0;
        else { const u = clamp((since - HAND_SWAP_MS) / 260, 0, 1); flakeScale = 1 + 0.5 * Math.sin(u * Math.PI) * (1 - u); if (u >= 1 || stillOld) this.handPop = null; }
      }
      const hf = this.handFlake;
      if (d >= 0) this.setDesign(hf, d);
      hf.group.visible = d >= 0 && flakeScale > 0.01;
      hf.group.scale.setScalar(HAND_FLAKE_SIZE * Math.max(0.01, flakeScale));
      // the hand moves when a match pops: it lifts and wobbles over HAND_SWAP_MS, then settles
      const u = this.handPop && since < HAND_SWAP_MS ? since / HAND_SWAP_MS : 1, lift = u < 1 ? 0.1 * Math.sin(Math.PI * u) : 0, wobble = u < 1 ? 0.2 * Math.sin(u * Math.PI * 3) * (1 - u) : 0;
      const up = smooth(this.introFactor());
      this.hand.position.y = -this.handScale * (HAND_Y + (1 - up) * 1.3 - lift);
      this.hand.rotation.z = wobble;
      const su = (nowMs - this.handShake) / HAND_SWAP_MS; // a wrong tap: the hand swings side to side, the same size and length as the lift of a match
      this.hand.position.x = this.handX + (su >= 0 && su < 1 ? this.handScale * 0.1 * Math.sin(su * Math.PI * 4) * (1 - su * 0.5) : 0);
    }

    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt; p.vel.y -= 3 * p.base * dt; p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.base * Math.max(0.05, p.life / p.max)); p.mesh.rotation.z += dt * 5;
      if (p.life <= 0) p.mesh.visible = false;
    }

    if (this.shake > 0.003) { // the view jolts by a different small amount each frame, and settles quickly
      this.camera.position.set((Math.random() - 0.5) * 2 * this.shake, (Math.random() - 0.5) * 2 * this.shake, 0);
      this.camera.rotation.z = (Math.random() - 0.5) * 2 * this.shake * 0.12;
      this.shake *= Math.exp(-9 * dt);
    } else { this.shake = 0; this.camera.position.set(0, 0, 0); this.camera.rotation.z = 0; }
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.camp.dispose();
    for (const g of this.geoms.values()) g.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.domElement.remove();
  }
}

