import {
  BufferAttribute, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog,
  HemisphereLight, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
  PerspectiveCamera, RepeatWrapping, RingGeometry, Scene, SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader,
  TorusGeometry, Vector3, WebGLRenderer,
  type Texture,
} from 'three';
import { audio } from '../../audio/spatialAudio';
import { collisionCrunch, rollCrunch } from '../../audio/snowSounds';
import { SpectatorRig } from '../../spectate/SpectatorRig';
import type { CameraMode } from '../../spectate/useSpectatorCamera';
import { FleckSystem, ShockRingSystem, StreakSystem } from './effects';
import { createTerrain, type SnowballBall, type Terrain, type TerrainFeature } from '@fgn/shared';

/** How a player's ball is labelled and marked. */
export interface BallStyle {
  name: string;
  color: string; // CSS colour of the ring under the ball and the name tag
  avatarUrl: string | null; // the player's profile picture, wrapped around the ball (null = plain white)
}

/** One ball's position at one moment (what we interpolate between). */
interface Pose {
  x: number;
  z: number;
  radius: number;
  vx: number;
  vz: number;
  immune: boolean;
  speedFactor: number; // 1 = base speed; above 1.2 a ball sheds wind streaks
  leader: boolean; // the single biggest ball: it wears the crown
}

/** What the effects remember about one ball between frames. */
interface BallFx {
  immune: boolean; // was it flashing last frame? (a hit = it just started)
  rollTimer: number; // seconds until the next rolling crunch
  windDebt: number; // fraction of a wind streak owed (streaks are made at a rate per second, not one per frame)
  hopAge: number; // seconds since this ball was knocked into a hop (>= HOP_SECONDS = not hopping)
}

/** How far the colour ring under each ball floats above the ground (along the slope). Too low and the bumpy ground pokes through it; too high and it distracts. */
const RING_LIFT = 0.084;

/**
 * The hop when two balls collide: each ball is thrown up HOP_HEIGHT units and lands again over HOP_SECONDS, in a smooth
 * arc. It is only drawn that way: the server's physics is flat, so this changes nothing about who hits whom.
 */
const HOP_HEIGHT = 1;
const HOP_SECONDS = 0.45;

/**
 * Screen shake on impact. A hit adds to `shake` (0..1); the camera is jiggled by SHAKE_FRACTION of its distance from
 * what it looks at, scaled by shake squared (so small hits barely register and big ones kick), and shake drains away
 * at SHAKE_DRAIN per second. Hits far from the camera count for less, like the sound (full within SHAKE_NEAR units,
 * none beyond SHAKE_FAR).
 */
const SHAKE_FRACTION = 0.035;
const SHAKE_DRAIN = 2.4;
const SHAKE_NEAR = 8;
const SHAKE_FAR = 40;

/** Wind starts above 120% of base speed; the amount grows from there up to the top speed. */
const WIND_START_FACTOR = 1.2;

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
  crown: Sprite; // floats above the biggest ball; hidden for everyone else
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
 * A profile picture is tiled over the whole ball: this many copies around the equator and this many
 * from pole to pole (2:1, because the ball's "map" is twice as wide as it is tall, so the pictures
 * stay roughly square). Tiling means every part of the ball is covered and no white shows through.
 */
const AVATAR_TILES_AROUND = 4;
const AVATAR_TILES_POLE_TO_POLE = 2;

const Z_AXIS = new Vector3(0, 0, 1);

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
  private disposed = false;
  private crownMaterial!: SpriteMaterial; // one gold crown picture shared by every ball's crown sprite
  private terrain: Terrain; // this round's hills and ditch (random each round, fixed during it)
  private textureLoader = new TextureLoader().setCrossOrigin('anonymous'); // profile pictures may live on another site (Supabase)

  // Shared by every ball (one geometry, many meshes).
  private ballGeometry = new IcosahedronGeometry(1, 1); // 80 triangles: clearly a ball, clearly low poly
  private ringGeometry = new RingGeometry(1.15, 1.4, 32);
  private shadowGeometry = new CircleGeometry(1.1, 24);

  // The camera is the shared, game-agnostic spectator rig: players always "follow" themselves, spectators choose.
  private rig!: SpectatorRig;
  private view: { mode: CameraMode; targetId: string | null };
  private pan: { current: { x: number; z: number } } = { current: { x: 0, z: 0 } }; // the free camera's input (a React ref)
  // Effects: snow flecks on collisions, wind streaks behind fast balls, and the crunch sounds that go with the movement.
  private flecks = new FleckSystem();
  private streaks = new StreakSystem();
  private rings = new ShockRingSystem();
  private fx = new Map<string, BallFx>();
  private shake = 0; // 0..1: how much the camera is shaking right now
  private readonly reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; // people who ask their device for less motion get no shake
  private maxSpeedFactor = 1.6; // the highest speedFactor a ball can reach (set from the server's speed range)
  private zoom = 1; // pulls the camera back on narrow (portrait) screens

  constructor(
    private container: HTMLElement,
    private arenaRadius: number,
    private terrainFeatures: TerrainFeature[],
    private styles: Record<string, BallStyle>,
    selfId: string | null,
  ) {
    this.view = { mode: 'follow', targetId: selfId };
    this.terrain = createTerrain(terrainFeatures);
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 3x phones don't need 3x pixels
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer, this.ballGeometry, this.ringGeometry, this.shadowGeometry);

    this.rig = new SpectatorRig(this.camera, arenaRadius);
    this.buildWorld();
    this.flecks.groundAt = (x, z) => this.terrain.height(x, z); // flecks land on the real ground, hills included
    this.scene.add(this.flecks.object, this.streaks.object, this.rings.object);
    this.disposables.push(this.flecks, this.streaks, this.rings);

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

  /** Spectators: which ball to follow, or the free camera. (Players never call this: they follow themselves.) */
  setCameraView(view: { mode: CameraMode; targetId: string | null }) {
    this.view = view;
  }

  /** The top speed multiplier a ball can reach (server's max speed / base speed): wind is at its fullest there. */
  setMaxSpeedFactor(factor: number) {
    this.maxSpeedFactor = Math.max(WIND_START_FACTOR + 0.01, factor);
  }

  /** The free camera's movement input: an object whose `current` is read every frame (a React ref). */
  setPanSource(pan: { current: { x: number; z: number } }) {
    this.pan = pan;
  }

  dispose() {
    this.disposed = true;
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
    this.scene.fog = new Fog(sky, 70, 220); // melts the far ground into the sky
    this.crownMaterial = this.track(new SpriteMaterial({ map: this.track(makeCrownTexture()), transparent: true }));

    // Soft sky light plus a fairly low "sun" from the west, so slopes facing it are bright and slopes facing
    // away are shaded: that's what makes snowy hills readable. No shadow maps (costly on phones); balls get a cheap blob shadow instead.
    this.scene.add(new HemisphereLight(0xffffff, 0xb7cde8, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.6);
    sun.position.set(-40, 26, 10);
    this.scene.add(sun);

    // The arena floor: ONE mesh with a procedural snow texture (no image files needed), lifted into
    // hills and a ditch by the SAME height function the server uses for the physics.
    const texture = this.track(makeSnowTexture());
    texture.repeat.set(this.arenaRadius / 5, this.arenaRadius / 5);
    const floor = new Mesh(this.track(this.buildGroundGeometry()), this.track(new MeshLambertMaterial({ map: texture, vertexColors: true })));
    this.scene.add(floor);

    // Plain ground beyond the wall, so the arena doesn't float in the void. It is a RING that starts at the
    // wall, never a full disc: a disc would also lie under the arena and cut across the ditch like a false floor.
    const outside = new Mesh(this.track(new RingGeometry(this.arenaRadius - 0.05, this.arenaRadius * 8, 64, 1)), this.track(new MeshLambertMaterial({ color: '#e3edf8' })));
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

  /** A disc made of rings of vertices, each lifted to the terrain height. Steep ground and ditches get a faint cool tint. */
  private buildGroundGeometry(): RingGeometry {
    // Lots of vertices so the hills are smooth: about one every 0.7 units, whatever the arena size (it grows with the player count).
    const geometry = new RingGeometry(0, this.arenaRadius, Math.ceil(this.arenaRadius * 2.8), Math.ceil(this.arenaRadius * 1.4));
    geometry.rotateX(-Math.PI / 2); // from standing up (XY) to lying flat (XZ)
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const deepest = Math.min(...this.terrainFeatures.map((f) => f.height), -1);
    for (let i = 0; i < positions.count; i++) {
      const height = this.terrain.height(positions.getX(i), positions.getZ(i));
      positions.setY(i, height);
      const g = this.terrain.gradient(positions.getX(i), positions.getZ(i));
      const steep = Math.min(1, Math.hypot(g.x, g.z) / 0.45); // 0 on level ground, 1 on the steepest slopes
      const ditch = Math.min(1, Math.max(0, height / deepest)); // 0 on flat ground and hills, up to 1 at the ditch bottom
      const cool = Math.min(1, steep * 0.7 + ditch * 0.6);
      colors.set([1 - 0.26 * cool, 1 - 0.15 * cool, 1 - 0.04 * cool], i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); // so the slopes catch the light
    return geometry;
  }

  private makeVisual(id: string): BallVisual {
    const style = this.styles[id] ?? { name: '?', color: '#ffffff' };
    // Default ball look: plain white. flatShading shows the facets that make it read as low poly.
    const material = this.track(new MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9, metalness: 0 }));
    const ball = new Mesh(this.ballGeometry, material);

    const ringMaterial = this.track(new MeshBasicMaterial({ color: style.color, side: DoubleSide, transparent: true, opacity: 0.95 }));
    const ring = new Mesh(this.ringGeometry, ringMaterial);

    const shadowMaterial = this.track(new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }));
    const shadow = new Mesh(this.shadowGeometry, shadowMaterial);

    const labelTexture = this.track(makeLabelTexture(style.name, style.color));
    const label = new Sprite(this.track(new SpriteMaterial({ map: labelTexture, transparent: true })));

    // A Sprite is a flat picture that always turns to face the camera (a "billboard"), which is exactly what a 2D crown needs.
    const crown = new Sprite(this.crownMaterial);
    crown.visible = false;

    this.scene.add(ball, ring, shadow, label, crown);
    if (style.avatarUrl) this.loadAvatar(style.avatarUrl, material);
    return { ball, material, ring, shadow, label, crown, last: null };
  }

  /**
   * Wraps the player's profile picture around their ball. The ball starts plain white and the picture
   * fades in when it has downloaded; if it fails to load, the ball just stays white.
   */
  private loadAvatar(url: string, material: MeshStandardMaterial) {
    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = texture.wrapT = RepeatWrapping; // repeat the picture instead of stretching it
        texture.repeat.set(AVATAR_TILES_AROUND, AVATAR_TILES_POLE_TO_POLE);
        texture.anisotropy = 4;
        this.disposables.push(texture);
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => {},
    );
  }

  private removeVisual(id: string) {
    const v = this.visuals.get(id);
    if (!v) return;
    this.scene.remove(v.ball, v.ring, v.shadow, v.label, v.crown);
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
    this.flecks.setViewport(height * this.renderer.getPixelRatio(), this.camera.fov);
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
    this.applyShake(dt, time);
    if (poses) this.updateEffects(dt, poses);
    this.flecks.update(dt);
    this.streaks.update(dt);
    this.rings.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private addVisual(id: string): BallVisual {
    const v = this.makeVisual(id);
    this.visuals.set(id, v);
    return v;
  }

  private updateVisual(v: BallVisual, pose: Pose) {
    const r = pose.radius;
    const ground = this.terrain.height(pose.x, pose.z);
    v.ball.position.set(pose.x, ground + r, pose.z); // resting on the ground, wherever the ground is
    v.ball.scale.setScalar(r);

    // Roll: turn the ball around the axis perpendicular to its movement, by (distance / radius).
    if (v.last) {
      const dx = pose.x - v.last.x;
      const dz = pose.z - v.last.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-5) v.ball.rotateOnWorldAxis(new Vector3(dz / distance, 0, -dx / distance), distance / r);
    }
    v.last = { x: pose.x, z: pose.z };

    // The ring and shadow lie ON the ground, tilted to match the slope so they don't sink into hills.
    const g = this.terrain.gradient(pose.x, pose.z);
    const normal = new Vector3(-g.x, 1, -g.z).normalize();
    v.ring.quaternion.setFromUnitVectors(Z_AXIS, normal);
    v.ring.position.set(pose.x, ground, pose.z).addScaledVector(normal, RING_LIFT);
    v.ring.scale.setScalar(r);
    v.shadow.quaternion.setFromUnitVectors(Z_AXIS, normal);
    v.shadow.position.set(pose.x, ground, pose.z).addScaledVector(normal, 0.04);
    v.shadow.scale.setScalar(r);
    // The crown floats just above the biggest ball, bobbing gently; its name tag makes room by moving up.
    const crownWidth = (1.8 + r * 0.9) * 0.5; // half the size it was; still grows with the ball so it stays in proportion
    const crownHeight = crownWidth * 0.75;
    v.crown.visible = pose.leader;
    if (pose.leader) {
      const bob = Math.sin(performance.now() / 280) * 0.12;
      v.crown.position.set(pose.x, ground + r * 2 + crownHeight / 2 + 0.2 + bob, pose.z);
      v.crown.scale.set(crownWidth, crownHeight, 1);
    }
    v.label.position.set(pose.x, ground + r * 2 + 1 + (pose.leader ? crownHeight + 0.3 : 0), pose.z);
    v.label.scale.set(5 + r, (5 + r) / 4, 1);

    // A just-hit ball flashes red for its short immunity window.
    v.material.emissive.set(pose.immune ? 0xff3b3b : 0x000000);
    v.material.emissiveIntensity = pose.immune ? 0.9 : 0;
  }

  /**
   * Particles and sound for this frame. Everything is derived from the snapshots (the server doesn't send "a hit
   * happened" events): a hit is a ball's flash starting, speed is its velocity, and "fast" is its speedFactor.
   */
  private updateEffects(dt: number, poses: Record<string, Pose>) {
    audio.setListener(this.rig.focusX, this.rig.focusZ); // you hear from where the camera is looking
    const hitPairs = new Set<string>(); // both balls of a collision flash together: react once per pair

    for (const [id, pose] of Object.entries(poses)) {
      const state = this.fx.get(id) ?? { immune: pose.immune, rollTimer: Math.random() * 0.2, windDebt: 0, hopAge: HOP_SECONDS };
      this.fx.set(id, state);
      const speed = Math.hypot(pose.vx, pose.vz);

      // --- a collision: the flash just started and another ball is touching this one ---
      if (pose.immune && !state.immune) {
        const other = this.touching(id, pose, poses);
        if (other && !hitPairs.has([id, other.id].sort().join('|'))) {
          hitPairs.add([id, other.id].sort().join('|'));
          this.collide(id, pose, other.id, other.pose);
        }
      }
      state.immune = pose.immune;

      // --- the hop: lift the ball (and what floats with it) along a smooth arc, for a moment after a collision ---
      state.hopAge += dt;
      if (state.hopAge < HOP_SECONDS) {
        const u = state.hopAge / HOP_SECONDS; // 0 -> 1
        const lift = HOP_HEIGHT * 4 * u * (1 - u); // a parabola: 0 at the start, HOP_HEIGHT at the top, 0 on landing
        const visual = this.visuals.get(id);
        if (visual) {
          visual.ball.position.y += lift;
          visual.label.position.y += lift;
          visual.crown.position.y += lift;
          visual.shadow.scale.multiplyScalar(1 - 0.3 * (lift / HOP_HEIGHT)); // the shadow stays on the ground and shrinks as the ball rises
        }
      }

      // --- rolling: a soft crunch every so often, quicker and louder the faster the ball goes ---
      if (speed > 1) {
        state.rollTimer -= dt;
        if (state.rollTimer <= 0) {
          const strength = Math.min(1, speed / 12);
          const heft = 0.75 + 0.25 * Math.min(1, pose.radius / 2); // bigger balls crunch a little louder
          audio.play(rollCrunch, pose.x, pose.z, (0.12 + 0.28 * strength) * heft, strength);
          state.rollTimer = (0.34 - 0.21 * strength) * (0.75 + Math.random() * 0.5);
        }
      }

      // --- wind: above 120% of base speed, streaks are left behind; the faster, the more of them ---
      if (pose.speedFactor > WIND_START_FACTOR && speed > 0.5) {
        const intensity = Math.min(1, (pose.speedFactor - WIND_START_FACTOR) / (this.maxSpeedFactor - WIND_START_FACTOR));
        state.windDebt += (10 + 50 * intensity) * dt; // ~10 a second just past 120%, ~60 at top speed
        const [dirX, dirZ] = [-pose.vx / speed, -pose.vz / speed]; // pointing back along where the ball came from
        while (state.windDebt >= 1) {
          state.windDebt -= 1;
          const side = (Math.random() * 2 - 1) * pose.radius * 0.95; // spread across the ball's width
          const x = pose.x + dirX * pose.radius * 0.9 - dirZ * side;
          const z = pose.z + dirZ * pose.radius * 0.9 + dirX * side;
          const y = this.terrain.height(x, z) + pose.radius * (0.2 + Math.random() * 1.6);
          this.streaks.emit(x, y, z, dirX, dirZ, speed * (0.07 + Math.random() * 0.05) * (0.8 + 0.5 * intensity));
        }
      } else state.windDebt = 0;
    }
    for (const id of [...this.fx.keys()]) if (!(id in poses)) this.fx.delete(id); // a player left
  }

  /** The ball (if any) that is touching `pose`: its centre is within the two radii plus a little slack. */
  private touching(id: string, pose: Pose, poses: Record<string, Pose>): { id: string; pose: Pose } | null {
    let best: { id: string; pose: Pose } | null = null;
    let bestGap = Infinity;
    for (const [otherId, other] of Object.entries(poses)) {
      if (otherId === id) continue;
      const gap = Math.hypot(other.x - pose.x, other.z - pose.z) - (pose.radius + other.radius);
      if (gap < 1.2 && gap < bestGap) { best = { id: otherId, pose: other }; bestGap = gap; }
    }
    return best;
  }

  /** Snow sprays from the point where two balls meet, with a loud crunch. */
  private collide(aId: string, a: Pose, bId: string, b: Pose) {
    // Both balls hop.
    for (const id of [aId, bId]) {
      const state = this.fx.get(id);
      if (state) state.hopAge = 0;
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz) || 1;
    const x = a.x + (dx / distance) * a.radius; // on a's surface, towards b: where they touch
    const z = a.z + (dz / distance) * a.radius;
    const y = this.terrain.height(x, z) + Math.min(a.radius, b.radius);
    const closing = Math.hypot(a.vx - b.vx, a.vz - b.vz); // how hard they met
    const power = Math.min(1.2, Math.max(0.35, closing / 14));
    const scale = Math.min(3, Math.max(0.6, (a.radius + b.radius) / 2));
    this.flecks.burst(x, y, z, dx / distance, dz / distance, power, scale);
    // The shockwave: an upright ring that spreads across the gap between the balls from the contact point (bigger for bigger balls and harder hits).
    // The screen shakes, more for a harder hit and less the farther it is from where the camera is looking.
    const away = Math.hypot(x - this.rig.focusX, z - this.rig.focusZ);
    const near = Math.min(1, Math.max(0, 1 - (away - SHAKE_NEAR) / (SHAKE_FAR - SHAKE_NEAR)));
    this.shake = Math.min(1, this.shake + 0.55 * Math.min(1, power) * near);
    this.rings.spawn(x, y, z, dx / distance, dz / distance, 0.448 * (3.5 + 2.5 * power * Math.sqrt(scale))); // 44.8% of the original size (made 20%, 20% then 30% smaller)
    audio.play(collisionCrunch, x, z, 0.85 + 0.15 * Math.min(1, power), Math.min(1, power));
  }

  /** Jiggle the camera a little while `shake` lasts. Runs after the camera has been placed for the frame, so it never accumulates. */
  private applyShake(dt: number, time: number) {
    this.shake = Math.max(0, this.shake - SHAKE_DRAIN * dt);
    if (this.shake === 0 || this.reduceMotion) return;
    const t = time / 1000;
    const distance = this.camera.position.distanceTo(new Vector3(this.rig.focusX, 0, this.rig.focusZ));
    const amount = distance * SHAKE_FRACTION * this.shake * this.shake;
    // Smooth, uneven wobble (a few sine waves that never line up) rather than random jumps every frame.
    this.camera.position.x += Math.sin(t * 47 + 1) * amount;
    this.camera.position.y += Math.sin(t * 61 + 2) * amount * 0.8;
    this.camera.position.z += Math.sin(t * 39 + 3) * amount * 0.5;
  }

  /** Follow a ball from a fixed compass direction (stepping back as it grows), or fly the free camera. See SpectatorRig. */
  private updateCamera(dt: number, poses: Record<string, Pose> | null) {
    const followed = this.view.targetId && poses ? poses[this.view.targetId] : undefined;
    const target = followed && { x: followed.x, y: this.terrain.height(followed.x, followed.z), z: followed.z, size: followed.radius }; // follows the ground up and down the hills
    this.rig.update(dt, this.view.mode, target, this.pan.current, this.zoom);
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

/** A flat gold crown: one solid colour, no outline, gradient or shading. Three points with round tips on a solid base. */
function makeCrownTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f5c211'; // goldish yellow

  // The body: left peak, valley, centre peak, valley, right peak, then down and across the flat bottom.
  g.beginPath();
  g.moveTo(24, 168);
  g.lineTo(24, 72);
  g.lineTo(82, 116);
  g.lineTo(128, 40);
  g.lineTo(174, 116);
  g.lineTo(232, 72);
  g.lineTo(232, 168);
  g.closePath();
  g.fill();

  // Round tips on the three peaks, in the same flat colour.
  for (const [x, y] of [[24, 66], [128, 34], [232, 66]]) {
    g.beginPath();
    g.arc(x, y, 15, 0, Math.PI * 2);
    g.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
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

