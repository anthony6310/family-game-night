import {
  BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Points, ShaderMaterial,
  Vector3, type PerspectiveCamera, type Scene,
} from 'three';
import { SparkSystem } from '../taprace/sparks';
import { WHALES, buildWhaleGeometry, whaleSurface } from './WhaleModels';
import { WHALE_LENGTH, breachEvents, durationOf, lerp, shakeAt, whalePose, whaleToWorld, type WhaleKind, type WhalePose, type WhaleTuning } from './whaleAnim';

/**
 * The whale in the scene: its body, the shadow and foam on the water, and the spray. Everything is a pure function of the animation time `t`
 * (nothing is simulated), so the review page can scrub. The game will drive it from the round's clock the same way.
 */
const GRAVITY = 9;
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

class Spray {
  readonly points: Points;
  private pos: Float32Array; private size: Float32Array; private alpha: Float32Array; private tint: Float32Array;
  private geo = new BufferGeometry();
  private material: ShaderMaterial;
  count = 0;
  constructor(private capacity: number) {
    this.pos = new Float32Array(capacity * 3); this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity); this.tint = new Float32Array(capacity * 3);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aTint', new BufferAttribute(this.tint, 3));
    this.material = new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aTint; uniform float uScale; varying float vA; varying vec3 vT;
        void main(){ vA = aAlpha; vT = aTint; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vT; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.35, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vT, a); }`,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }
  begin() { this.count = 0; }
  add(x: number, y: number, z: number, size: number, alpha: number, r = 1, g = 1, b = 1) {
    if (this.count >= this.capacity || alpha <= 0.005) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.size[i] = size; this.alpha[i] = Math.min(1, alpha);
    this.tint[i * 3] = r; this.tint[i * 3 + 1] = g; this.tint[i * 3 + 2] = b;
  }
  end(camera: PerspectiveCamera, heightPx: number) {
    for (let i = this.count; i < this.capacity; i++) this.alpha[i] = 0;
    this.geo.setDrawRange(0, this.count);
    for (const k of ['position', 'aSize', 'aAlpha', 'aTint']) (this.geo.getAttribute(k) as BufferAttribute).needsUpdate = true;
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}

function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.55, 'rgba(255,255,255,0)'); grad.addColorStop(0.8, 'rgba(255,255,255,1)'); grad.addColorStop(0.92, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}
function discTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

interface Patch { mesh: Mesh; material: MeshBasicMaterial }

export class WhaleActor {
  readonly group = new Group();
  private inner = new Group();
  private spray = new Spray(1800);
  private patches: Patch[] = [];
  private shadow: Patch;
  private collar: Patch;
  private textures: CanvasTexture[] = [];
  private whaleMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: DoubleSide });
  private bend = { value: 0 };
  private swim = { value: 0 };
  private phase = { value: 0 };
  private geometry = buildWhaleGeometry(WHALES[2]);
  private blowhole: Vector3;
  private used = 0;
  private sparks = new SparkSystem(9000, false); // the water: Tap Race's spark streaks, solid and in the sea's own colors
  private lastT = -1;
  private active = false;
  private waterScale = 1;
  private lastKind: WhaleKind | null = null;

  constructor(world: Scene) {
    this.whaleMaterial.onBeforeCompile = (shader) => { // arch the body: nose and tail dip below the middle (the shading is flat, so it is lit as bent)
      shader.uniforms.uBend = this.bend; shader.uniforms.uSwim = this.swim; shader.uniforms.uPhase = this.phase;
      shader.vertexShader = 'uniform float uBend; uniform float uSwim; uniform float uPhase;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float zz = position.z / ${(WHALE_LENGTH / 2).toFixed(1)}; transformed.y -= uBend * zz * zz;
          float tail = clamp(0.5 - zz * 0.5, 0.0, 1.0); transformed.y += uSwim * 0.9 * tail * tail * sin(uPhase - position.z * 0.28); }`);
    };
    const mesh = new Mesh(this.geometry, this.whaleMaterial);
    mesh.frustumCulled = false;
    this.inner.add(mesh);
    this.group.add(this.inner);
    this.group.visible = false;
    world.add(this.group);
    world.add(this.spray.points);
    this.sparks.floorAt = () => -1000;
    world.add(this.sparks.object);
    const ring = ringTexture(), disc = discTexture();
    this.textures.push(ring, disc);
    const make = (map: CanvasTexture, color: string, order: number): Patch => {
      const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, color, opacity: 0, fog: false });
      const m = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
      m.renderOrder = order; m.visible = false; m.frustumCulled = false;
      world.add(m);
      return { mesh: m, material };
    };
    this.shadow = make(disc, '#04202e', 1);
    this.collar = make(disc, '#ffffff', 3);
    for (let i = 0; i < 40; i++) this.patches.push(make(ring, '#ffffff', 2));
    const S = whaleSurface();
    const p = S.P(0.2, Math.PI / 2);
    this.blowhole = new Vector3(0, p.y + 0.1, p.z);
  }

  dispose() {
    this.group.removeFromParent(); this.spray.points.removeFromParent();
    this.sparks.object.removeFromParent(); this.sparks.dispose(); this.spray.dispose(); this.geometry.dispose(); this.whaleMaterial.dispose();
    for (const p of [...this.patches, this.shadow, this.collar]) { p.mesh.removeFromParent(); p.material.dispose(); p.mesh.geometry.dispose(); }
    this.textures.forEach((t) => t.dispose());
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false; this.spray.begin(); this.spray.count = 0; this.sparks.clear(); this.lastT = -1;
    for (const p of [...this.patches, this.shadow, this.collar]) p.mesh.visible = false;
  }

  // ---- helpers for the water effects
  private ringAt(x: number, z: number, t: number, t0: number, dur: number, r0: number, r1: number, alpha: number, squash = 1) {
    const p = this.patches[this.used]; if (!p) return;
    const k = (t - t0) / dur;
    if (k < 0 || k > 1) return;
    this.used++;
    const r = lerp(r0, r1, 1 - (1 - k) * (1 - k));
    p.mesh.visible = true; p.mesh.position.set(x, 0.5, z); p.mesh.scale.set(r * 2 * squash, 1, r * 2);
    const fadeIn = Math.min(1, k * 5); p.material.opacity = alpha * fadeIn * fadeIn * Math.pow(1 - k, 1.6);
  }
  /** Draw the whale at time `t` of animation `kind`. Returns the camera shake level for this moment. */
  update(kind: WhaleKind, t: number, tune: WhaleTuning, camera: PerspectiveCamera, heightPx: number): number {
    if (tune.water !== this.waterScale) { this.waterScale = tune.water; this.lastT = -1; } // (a new size: replay from a little earlier)
    this.active = true;
    this.stepWater(kind, t, tune);
    this.spray.begin(); this.used = 0;
    for (const p of this.patches) { p.mesh.visible = false; p.material.opacity = 0; }
    const pose = whalePose(kind, t, tune);
    this.group.visible = t >= 0 && t <= durationOf(kind, tune) && pose.y > -40;
    this.group.position.set(pose.x, pose.y, pose.z); this.group.rotation.set(0, pose.yaw, 0);
    this.inner.rotation.set(-pose.pitch, 0, pose.roll, 'XYZ');
    this.bend.value = pose.bend; this.swim.value = pose.swim; this.phase.value = t * 3.2;
    this.group.updateMatrixWorld(true);

    const dur = durationOf(kind, tune);
    if (kind === 'peek' || kind === 'blow') this.surfaceEffects(kind, t, dur, pose, tune);
    else this.breachEffects(t, pose, tune);

    this.spray.end(camera, heightPx);
    return shakeAt(kind, t, tune);
  }

  private body(pose: WhalePose, z: number, y = 0): Vector3 { return whaleToWorld(pose, new Vector3(0, y, z)); }


  // ================================================================ the water: the fishing game's droplets, thrown big
  /** The droplets run in slow motion (so they hang in the air like the whale does): the system is stepped at this share of real time. */
  private static TS = 0.55;
  private static PALETTE: [number, number, number][] = [[0.043, 0.298, 0.49], [0.075, 0.43, 0.6], [0.114, 0.596, 0.722], [0.05, 0.36, 0.55]]; // (the sea's deep and shallow colors from the sea shader, and between)

  /** One droplet, thrown with a REAL-time velocity (units/s) and life (s). */
  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, width: number, life: number, length = 0.5) {
    const TS = WhaleActor.TS, [r, g, b] = WhaleActor.PALETTE[Math.floor(Math.random() * WhaleActor.PALETTE.length)];
    const k = this.waterScale, v = Math.sqrt(k); // (a smaller splash: thinner droplets, thrown less far; height goes with speed squared)
    this.sparks.emit(x, y, z, (vx * v) / TS, (vy * v) / TS, (vz * v) / TS, width * k, life * TS, r, g, b, true, length);
  }
  private static rand = (a: number, b: number) => a + Math.random() * (b - a);

  /** A radial splash: `n` droplets thrown up and out from a spot on the water (spread along x by `spreadX`, since the whale is long). */
  private splashBurst(x: number, z: number, n: number, up: [number, number], out: number, width: number, spreadX = 0, life: [number, number] = [1.6, 3.2]) {
    const R = WhaleActor.rand;
    for (let i = 0; i < n; i++) {
      const a = R(0, Math.PI * 2), v = out * Math.sqrt(Math.random());
      this.drop(x + R(-spreadX, spreadX), 0.4, z + R(-1.5, 1.5), Math.cos(a) * v * 0.7, R(up[0], up[1]), Math.sin(a) * v, width * R(0.7, 1.3), R(life[0], life[1]));
    }
  }
  /** Droplets pouring off the body over a stretch of time (rate in droplets a second). */
  private poured(kind: WhaleKind, t: number, dt: number, from: number, to: number, rate: number, tune: WhaleTuning, width = 0.3) {
    const a = Math.max(from, t - dt), b = Math.min(to, t);
    if (b <= a) return;
    const R = WhaleActor.rand;
    for (let i = 0, n = rate * (b - a) + Math.random(); i < n; i++) {
      const p = whalePose(kind, t, tune), w = whaleToWorld(p, new Vector3(R(-3.5, 3.5), R(-1.5, 3.5), R(-WHALE_LENGTH * 0.45, WHALE_LENGTH * 0.4)));
      if (w.y < 0.6) continue;
      this.drop(w.x, w.y, w.z, R(-1.5, 1.5), R(-1, 2), R(-3, 3), width * R(0.7, 1.2), R(0.9, 1.7), 0.35);
    }
  }
  /** The blow-hole spout (soft white spray): two jets leaning a little apart, shooting up and spreading into mist; the jets leave from wherever the hole is at that moment. */
  private plume(t: number, t0: number, tune: WhaleTuning, poseAt: (bt: number) => WhalePose) {
    const n = 170;
    for (let i = 0; i < n; i++) {
      const f = i / n, bt = t0 + f * tune.blowDur * 0.55, h = hash(i + 5), h2 = hash(i * 3 + 1), h3 = hash(i * 7 + 2);
      const age = t - bt, life = 1.5 + h * 0.9;
      if (age < 0 || age > life) continue;
      const jet = i % 2 ? 1 : -1, k = age / life;
      const power = Math.sin(Math.PI * Math.min(1, f * 1.15 + 0.1));
      const vy = (tune.blowHeight * 1.05 + h2 * 3) * (0.55 + 0.45 * power), vz = jet * (1.2 + h3 * 1.6), vx = (h - 0.5) * 2.6 - 0.8;
      const g = GRAVITY * 0.7;
      const ob = whaleToWorld(poseAt(bt), this.blowhole);
      const x = ob.x + vx * age, y = ob.y + vy * age - 0.5 * g * age * age, z = ob.z + vz * age;
      if (y < 0.3) continue;
      const grow = Math.min(1, age / 0.25); // (each puff swells and fades in out of the hole instead of popping into being)
      this.spray.add(x, y, z, (0.5 + 0.8 * grow) + age * 2.0, 0.85 * grow * (1 - k * k) * (0.5 + 0.5 * power), 0.95, 0.99, 1);
    }
  }
  private mist(t: number, t0: number, tune: WhaleTuning, poseAt: (bt: number) => WhalePose) {
    const o = whaleToWorld(poseAt(t0 + tune.blowDur * 0.5), this.blowhole);
    for (let i = 0; i < 40; i++) {
      const bt = t0 + 0.3 + hash(i + 70) * tune.blowDur * 0.6, age = t - bt, life = 2.4; if (age < 0 || age > life) continue;
      const k = age / life;
      this.spray.add(o.x - 0.6 * age + (hash(i) - 0.5) * 3, o.y + tune.blowHeight * (0.5 + 0.4 * hash(i + 2)) - age * 0.5, o.z + (hash(i + 9) - 0.5) * 4, 3 + age * 2.5, 0.3 * Math.min(1, age / 0.6) * (1 - k), 0.95, 0.99, 1);
    }
    this.ringAt(o.x, 0, t, t0, 1.8, 2, 9, 0.35, 1.2);
  }

  /** The events of an animation, in order: [time, what to throw]. Thrown once as time passes them (the review page replays from a bit earlier when you scrub). */
  private events(kind: WhaleKind, tune: WhaleTuning): { at: number; fire: () => void }[] {
    const ev: { at: number; fire: () => void }[] = [];
    if (kind === 'peek') return ev; // (the partial breach throws no water droplets, only the foam rings on the sea)
    if (kind === 'blow') {
      const dur = durationOf(kind, tune), up = dur * 0.2, down = dur * 0.74;
      const at = (tt: number) => whaleToWorld(whalePose(kind, tt, tune), new Vector3(0, 0, 9));
      ev.push({ at: up, fire: () => this.splashBurst(at(up).x, 0, 190, [9, 20], 11, 0.32, 6) });
      ev.push({ at: up + 0.35, fire: () => this.splashBurst(at(up).x - 4, 0, 120, [7, 15], 8, 0.3, 8) });
      ev.push({ at: down, fire: () => this.splashBurst(at(down).x - 6, 0, 170, [8, 18], 10, 0.32, 9) });
    } else {
      const e = breachEvents(tune), x0 = -tune.travel / 2, x1 = tune.travel / 2;
      ev.push({ at: e.exit - 0.1, fire: () => this.splashBurst(x0, 0, 620, [18, 38], 16, 0.4, 5) });
      ev.push({ at: e.exit + 0.15, fire: () => this.splashBurst(x0, 0, 380, [26, 46], 8, 0.45, 4, [2.2, 3.8]) });
      ev.push({ at: e.enter - 0.15, fire: () => this.splashBurst(x1, 0, 1100, [20, 40], 20, 0.42, 8) });
      ev.push({ at: e.enter + 0.1, fire: () => this.splashBurst(x1, 0, 700, [28, 50], 10, 0.48, 6, [2.4, 4.2]) });
      ev.push({ at: e.enter + 0.4, fire: () => this.splashBurst(x1, 0, 500, [12, 22], 22, 0.45, 12) });
    }
    return ev;
  }

  /** Advance the droplets to time `t` (stepping from a bit earlier when the time jumped, so scrubbing shows the spray that belongs to that moment). */
  private stepWater(kind: WhaleKind, t: number, tune: WhaleTuning) {
    const step = (tt: number, dt: number) => {
      for (const e of this.events(kind, tune)) if (e.at > tt - dt && e.at <= tt) e.fire();
      if (kind === 'blow') {
        const dur = durationOf(kind, tune);
        this.poured(kind, tt, dt, dur * 0.2, dur * 0.2 + 2.2, 90, tune);
        this.poured(kind, tt, dt, dur * 0.74, dur * 0.74 + 1.6, 60, tune);
      } else if (kind === 'breach') {
        const e = breachEvents(tune);
        this.poured('breach', tt, dt, e.exit, e.enter, 320, tune, 0.34);
      }
      this.sparks.update(dt * WhaleActor.TS);
    };
    const jumped = this.lastKind !== kind || t < this.lastT || t - this.lastT > 0.3 || this.lastT < 0;
    if (jumped) {
      this.sparks.clear();
      const from = Math.max(0, t - 7);
      for (let tt = from; tt < t; tt += 1 / 30) step(tt + 1 / 30, 1 / 30);
    } else step(t, t - this.lastT);
    this.lastT = t; this.lastKind = kind;
  }

  private surfaceEffects(kind: WhaleKind, t: number, dur: number, pose: WhalePose, tune: WhaleTuning) {
    const near = pose.y > -9.5 ? clamp01((pose.y + 9.5) / 6) : 0;
    this.setCollar(pose, near * 0.85, 11 + Math.abs(pose.pitch) * 8);
    this.setShadow(pose, 0.4 * (1 - clamp01((pose.y + 10) / 8)) + 0.05, 1);
    const mid = this.body(pose, 0);
    const up = dur * 0.2, down = dur * 0.74;
    this.ringAt(mid.x, 0, t, up - 0.2, 3.2, 6, 17, 0.7, 1.5);
    this.ringAt(mid.x, 0, t, up + 0.5, 3.6, 4, 22, 0.45, 1.5);
    this.ringAt(mid.x, 0, t, down, 3.4, 5, 16, 0.55, 1.5);
    if (kind === 'blow') { const t0 = dur * tune.blowAt, hold = whalePose('blow', t0 + tune.blowDur * 0.5, tune); this.plume(t, t0, tune, () => hold); this.mist(t, t0, tune, () => hold); }
  }

  private setCollar(pose: WhalePose, alpha: number, len: number) {
    const c = this.collar;
    c.mesh.visible = alpha > 0.01; c.mesh.position.set(pose.x, 0.45, pose.z); c.mesh.scale.set(len * 1.5, 1, 14);
    c.material.opacity = alpha;
  }
  private setShadow(pose: WhalePose, alpha: number, scale: number) {
    const s = this.shadow;
    s.mesh.visible = alpha > 0.01; s.mesh.position.set(pose.x, 0.4, pose.z); s.mesh.scale.set(WHALE_LENGTH * 1.25 * scale, 1, 15 * scale);
    s.material.opacity = alpha;
  }

  private breachEffects(t: number, pose: WhalePose, tune: WhaleTuning) {
    const ev = breachEvents(tune);
    const x0 = -tune.travel / 2, x1 = tune.travel / 2;
    // before the leap: a dark shape swells under the water and the sea boils
    const env = 1 - clamp01((t - ev.launch) / 1.8); // (it all dies away smoothly once the whale is out)
    if (env > 0) {
      const k = clamp01(t / tune.antic);
      this.setShadow({ ...pose, x: x0 }, 0.85 * Math.pow(k, 1.2) * env, 0.6 + 0.6 * k);
      for (let i = 0; i < 12; i++) this.ringAt(x0 + (hash(i) - 0.5) * 14, (hash(i + 3) - 0.5) * 7, t, 0.3 + i * (tune.antic - 0.6) / 12, 2.2, 1.5, 6 + 4 * hash(i + 7), 0.55 + 0.4 * k, 1.2);
      for (let i = 0; i < 440; i++) { // bubbles popping on the surface (small and many)
        const bt = hash(i + 1) * tune.antic, age = (t - bt) % 1.2;
        if (t < 0.5 || bt > t || bt < 0.4) continue;
        const k2 = age / 1.2;
        this.spray.add(x0 + (hash(i + 4) - 0.5) * 24, 0.5 + (2.5 + 3 * k) * Math.sin(Math.PI * k2) * hash(i + 6), (hash(i + 8) - 0.5) * 10, (0.9 + 0.8 * k) * 0.5, 0.8 * (1 - k2) * (0.3 + k) * env, 0.92, 0.98, 1);
      }
    }
    this.ringAt(x0, 0, t, ev.exit - 0.2, 4.6, 6, 28, 0.85, 1.4);
    this.ringAt(x0, 0, t, ev.exit + 0.4, 5.0, 4, 34, 0.55, 1.4);
    // the shadow of the whale on the water while it is in the air
    if (t > ev.exit && t < ev.enter + 1) this.setShadow(pose, 0.3 * clamp01((pose.y - 2) / 12) * (t < ev.enter ? 1 : 0), 1.0);
    this.plume(t, ev.apexAt - tune.blowDur * 0.35, tune, (bt) => whalePose('breach', bt, tune));
    this.mist(t, ev.apexAt - tune.blowDur * 0.35, tune, (bt) => whalePose('breach', bt, tune));
    this.ringAt(x1, 0, t, ev.enter - 0.1, 5.0, 8, 40, 1.0, 1.35);
    this.ringAt(x1, 0, t, ev.enter + 0.5, 5.5, 6, 52, 0.75, 1.35);
    this.ringAt(x1, 0, t, ev.enter + 1.2, 6.0, 5, 58, 0.5, 1.35);
    // foam left on the sea, fading
    if (t > ev.enter) { const k = clamp01((t - ev.enter) / (tune.settle + 0.5)); this.setCollar({ ...pose, x: x1 }, 0.9 * (1 - k), 26); } else this.collar.mesh.visible = false;
  }
}
