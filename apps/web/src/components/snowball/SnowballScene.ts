import {
  CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, HemisphereLight,
  IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PerspectiveCamera,
  RepeatWrapping, RingGeometry, Scene, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector3, WebGLRenderer,
  type Texture,
} from 'three';
import type { SnowballBall } from '@fgn/shared';

/** How a player's ball is labelled and marked. */
export interface BallStyle {
  name: string;
  color: string; // CSS colour of the ring under the ball and the name tag
}

/** One ball's position at one moment (what we interpolate between). */
interface Pose {
  x: number;
  z: number;
  radius: number;
  vx: number;
  vz: number;
  immune: boolean;
}

interface Snapshot {
  t: number; // when it ARRIVED (performance.now() timeline)
  balls: Record<string, SnowballBall>;
}

interface BallVisual {
  ball: Mesh;
  material: MeshStandardMaterial;
  ring: Mesh;
  shadow: Mesh;
  label: Sprite;
  last: { x: number; z: number } | null; // where it was drawn last frame (to work out the roll)
}

/**
 * Phones get ~20 snapshots a second but the screen draws 60 frames a second. So we draw a little in
 * the PAST (INTERP_DELAY_MS), blending between the two snapshots that surround that moment: smooth
 * movement at the price of ~0.1 s of delay. If snapshots stop arriving we coast on the last
 * velocity for a moment (MAX_EXTRAPOLATE_MS) instead of freezing.
 */
const INTERP_DELAY_MS = 120;
const MAX_EXTRAPOLATE_MS = 150;

/**
 * Everything three.js for the Snowball round, kept apart from React. React gives it snapshots
 * (`pushSnapshot`) and a container; it owns the renderer, the animation loop and all cleanup.
 *
 * Look: a textured white ground disc, a low wall, and plain white low-poly balls (an icosphere with
 * flat shading). Snow is NOT simulated or rendered as geometry: the ground is one cheap texture.
 */
export class SnowballScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(55, 1, 0.1, 400);
  private snapshots: Snapshot[] = [];
  private visuals = new Map<string, BallVisual>();
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();

  // Shared by every ball (one geometry, many meshes).
  private ballGeometry = new IcosahedronGeometry(1, 1); // 80 triangles: clearly a ball, clearly low poly
  private ringGeometry = new RingGeometry(1.15, 1.4, 32);
  private shadowGeometry = new CircleGeometry(1.1, 24);

  // Smoothed camera state.
  private focus = new Vector3();
  private cameraRadius = 1;
  private zoom = 1; // pulls the camera back on narrow (portrait) screens

  constructor(
    private container: HTMLElement,
    private arenaRadius: number,
    private styles: Record<string, BallStyle>,
    private selfId: string | null,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 3x phones don't need 3x pixels
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer, this.ballGeometry, this.ringGeometry, this.shadowGeometry);

    this.buildWorld();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** Hand over the latest server snapshot. */
  pushSnapshot(balls: Record<string, SnowballBall>) {
    this.snapshots.push({ t: performance.now(), balls });
    if (this.snapshots.length > 10) this.snapshots.shift();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const id of [...this.visuals.keys()]) this.removeVisual(id);
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  // ---------- world ----------

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private buildWorld() {
    const sky = new Color('#cfe4fa');
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 45, 150); // melts the far ground into the sky

    // Soft sky light from above plus one "sun". No shadow maps: they're costly on phones, so balls get a cheap blob shadow instead.
    this.scene.add(new HemisphereLight(0xffffff, 0xb7cde8, 2.2));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-20, 40, 15);
    this.scene.add(sun);

    // The arena floor: ONE disc with a procedural snow texture (no image files needed).
    const texture = this.track(makeSnowTexture());
    texture.repeat.set(this.arenaRadius / 5, this.arenaRadius / 5);
    const floor = new Mesh(this.track(new CircleGeometry(this.arenaRadius, 64)), this.track(new MeshLambertMaterial({ map: texture })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Plain ground beyond the wall, so the arena doesn't float in the void.
    const outside = new Mesh(this.track(new CircleGeometry(this.arenaRadius * 8, 32)), this.track(new MeshLambertMaterial({ color: '#e3edf8' })));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.05;
    this.scene.add(outside);

    // A low wall at the boundary: a see-through cylinder plus a rim on top.
    const wallRadius = this.arenaRadius + 0.3;
    const wall = new Mesh(
      this.track(new CylinderGeometry(wallRadius, wallRadius, 1.4, 48, 1, true)),
      this.track(new MeshLambertMaterial({ color: '#a9c7e8', side: DoubleSide })),
    );
    wall.position.y = 0.7;
    this.scene.add(wall);
    const rim = new Mesh(this.track(new TorusGeometry(wallRadius, 0.3, 6, 48)), this.track(new MeshLambertMaterial({ color: '#ffffff' })));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.4;
    this.scene.add(rim);
  }

  private makeVisual(id: string): BallVisual {
    const style = this.styles[id] ?? { name: '?', color: '#ffffff' };
    // Default ball look: plain white. flatShading shows the facets that make it read as low poly.
    const material = this.track(new MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9, metalness: 0 }));
    const ball = new Mesh(this.ballGeometry, material);

    const ringMaterial = this.track(new MeshBasicMaterial({ color: style.color, side: DoubleSide, transparent: true, opacity: 0.95 }));
    const ring = new Mesh(this.ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;

    const shadowMaterial = this.track(new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }));
    const shadow = new Mesh(this.shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;

    const labelTexture = this.track(makeLabelTexture(style.name, style.color));
    const label = new Sprite(this.track(new SpriteMaterial({ map: labelTexture, transparent: true })));

    this.scene.add(ball, ring, shadow, label);
    return { ball, material, ring, shadow, label, last: null };
  }

  private removeVisual(id: string) {
    const v = this.visuals.get(id);
    if (!v) return;
    this.scene.remove(v.ball, v.ring, v.shadow, v.label);
    this.visuals.delete(id);
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

  /** Where every ball should be drawn at time `t`, blended from the surrounding snapshots. */
  private sample(t: number): Record<string, Pose> | null {
    const snaps = this.snapshots;
    if (snaps.length === 0) return null;
    const last = snaps[snaps.length - 1];

    if (t >= last.t) {
      // Newer than anything we have: coast on the last known velocity (briefly).
      const seconds = Math.min(t - last.t, MAX_EXTRAPOLATE_MS) / 1000;
      return mapBalls(last.balls, (b) => ({ ...b, x: b.x + b.vx * seconds, z: b.z + b.vz * seconds }));
    }
    if (t <= snaps[0].t) return mapBalls(snaps[0].balls, (b) => b);

    let i = 0;
    while (snaps[i + 1].t < t) i++;
    const [from, to] = [snaps[i], snaps[i + 1]];
    const alpha = (t - from.t) / (to.t - from.t);
    return mapBalls(to.balls, (b, id) => {
      const a = from.balls[id];
      if (!a) return b; // it just appeared
      return { ...b, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, radius: a.radius + (b.radius - a.radius) * alpha };
    });
  }

  private frame = (time: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;

    const poses = this.sample(time - INTERP_DELAY_MS);
    if (poses) {
      for (const id of [...this.visuals.keys()]) if (!(id in poses)) this.removeVisual(id); // a player left
      for (const [id, pose] of Object.entries(poses)) {
        const v = this.visuals.get(id) ?? this.addVisual(id);
        this.updateVisual(v, pose);
      }
    }
    this.updateCamera(dt, poses);
    this.renderer.render(this.scene, this.camera);
  };

  private addVisual(id: string): BallVisual {
    const v = this.makeVisual(id);
    this.visuals.set(id, v);
    return v;
  }

  private updateVisual(v: BallVisual, pose: Pose) {
    const r = pose.radius;
    v.ball.position.set(pose.x, r, pose.z); // resting on the ground
    v.ball.scale.setScalar(r);

    // Roll: turn the ball around the axis perpendicular to its movement, by (distance / radius).
    if (v.last) {
      const dx = pose.x - v.last.x;
      const dz = pose.z - v.last.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-5) v.ball.rotateOnWorldAxis(new Vector3(dz / distance, 0, -dx / distance), distance / r);
    }
    v.last = { x: pose.x, z: pose.z };

    v.ring.position.set(pose.x, 0.04, pose.z);
    v.ring.scale.setScalar(r);
    v.shadow.position.set(pose.x, 0.02, pose.z);
    v.shadow.scale.setScalar(r);
    v.label.position.set(pose.x, r * 2 + 1, pose.z);
    v.label.scale.set(5 + r, (5 + r) / 4, 1);

    // A just-hit ball flashes red for its short immunity window.
    v.material.emissive.set(pose.immune ? 0xff3b3b : 0x000000);
    v.material.emissiveIntensity = pose.immune ? 0.9 : 0;
  }

  /** Follow your own ball from a fixed compass direction, stepping back as it grows. Spectators see the whole arena. */
  private updateCamera(dt: number, poses: Record<string, Pose> | null) {
    const self = this.selfId && poses ? poses[this.selfId] : undefined;
    const k = 1 - Math.exp(-4 * dt); // frame-rate independent smoothing

    let height: number;
    let back: number;
    if (self) {
      this.focus.lerp(new Vector3(self.x, 0, self.z), k);
      this.cameraRadius += (self.radius - this.cameraRadius) * k;
      height = (6 + 3.2 * this.cameraRadius) * this.zoom;
      back = (8 + 4.2 * this.cameraRadius) * this.zoom;
    } else {
      this.focus.lerp(new Vector3(0, 0, 0), k);
      height = this.arenaRadius * 1.25 * this.zoom;
      back = this.arenaRadius * 0.75 * this.zoom;
    }
    this.camera.position.set(this.focus.x, height, this.focus.z + back);
    this.camera.lookAt(this.focus.x, self ? this.cameraRadius * 0.4 : 0, this.focus.z);
  }
}

// ---------- helpers ----------

function mapBalls(balls: Record<string, SnowballBall>, fn: (b: SnowballBall, id: string) => Pose): Record<string, Pose> {
  return Object.fromEntries(Object.entries(balls).map(([id, b]) => [id, fn(b, id)]));
}

/** A tileable snow-looking texture, drawn on a canvas at runtime: soft white with faint blue-grey speckles. */
function makeSnowTexture(): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f4f8ff';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = Math.random() < 0.7 ? 'rgba(178,200,230,0.28)' : 'rgba(255,255,255,0.9)';
    const s = 1 + Math.random() * 2.5;
    const x = Math.random() * size;
    const y = Math.random() * size;
    // Draw each speckle on the far edges too, so the texture tiles without a visible seam.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) g.fillRect(x + ox, y + oy, s, s);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A name tag as a canvas texture for a Sprite (a flat picture that always faces the camera). */
function makeLabelTexture(name: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(20,30,60,0.85)';
  g.strokeText(name, 256, 64, 480);
  g.fillStyle = color;
  g.fillText(name, 256, 64, 480);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

