import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, Points, ShaderMaterial,
  type Object3D,
} from 'three';

/**
 * Particle effects for the Snowball scene. Each system is a POOL: one fixed set of particles created up front and
 * reused (a dead particle is simply recycled for the next one), so effects never allocate while the game runs.
 * Each system is a single draw call no matter how many particles are alive.
 */

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** 0 below `from`, 1 above `to`, and a smooth S-shaped blend in between (no sudden starts or stops). */
function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Flecks. The SIDEWAYS burst is fast: BURST_SPEED = 3 means the spray flies out three times as quickly as the base tuning
 * (speed and sideways air drag both double, so it reaches the same distance in half the time). The up-and-down part
 * (the rise and the fall) keeps the base pace: gravity below, and a plain upward speed. Then each fleck rests on the
 * ground for REST_MIN..REST_MAX seconds and fades over FADE seconds.
 */
const BURST_SPEED = 3;
const FLECK_GRAVITY = 20;
const REST_MIN = 0.5;
const REST_MAX = 1.1;
const FADE = 0.35;
const FLIGHT_LIMIT = 5; // safety: a fleck that somehow never lands is removed after this long

// ---------- flecks: a spray of tiny white snow ----------

/**
 * The snow-dot look shared by the particle systems (the impact flecks and the swirl): soft round white dots, sized in world units (smaller
 * when far away), with a very thin pale-blue edge so they still show against white snow.
 */
function makeDotMaterial(): ShaderMaterial {
return new ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    transparent: true,
    depthWrite: false, // soft particles must not punch holes in each other
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = aSize * uScale / -view.z; // world size -> pixels, smaller when farther away
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // white through almost the whole dot, with only a very thin pale-blue edge: without any edge, white on white snow vanishes
        vec3 color = mix(vec3(1.0), vec3(0.80, 0.87, 0.96), smoothstep(0.32, 0.5, d));
        gl_FragColor = vec4(color, vAlpha * smoothstep(0.5, 0.43, d));
      }`,
  });
}

/**
 * Lots of tiny round white dots (about snowflake-sized next to a ball). Used for the spray when snowballs collide.
 * Each fleck is thrown out in an arc, falls to the ground, rests there for a moment and then fades away.
 */
export class FleckSystem {
  readonly object: Object3D;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly size: Float32Array; // drawn size (world units)
  private readonly alpha: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array; // 0 = this slot is free
  private readonly baseSize: Float32Array;
  private readonly landed: Uint8Array; // 1 once the fleck has hit the ground (then it only rests and fades)
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private next = 0; // where to look for the next free slot
  /** Height of the ground at (x, z): flecks land on the real terrain, hills included. Set by the scene. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor(capacity = 400) {
    this.capacity = capacity;
    this.position = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.landed = new Uint8Array(capacity);
    for (const [name, array, items] of [['position', this.position, 3], ['aSize', this.size, 1], ['aAlpha', this.alpha, 1]] as const) {
      const attribute = new BufferAttribute(array, items);
      attribute.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    }
    this.material = makeDotMaterial();
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false; // particles move around inside a bounding box we never update
    this.object = points;
  }

  /** Tell the shader how many pixels one world unit is at distance 1 (depends on the screen height and the camera's field of view). */
  setViewport(heightPx: number, fovDegrees: number) {
    this.material.uniforms.uScale.value = (heightPx * 0.5) / Math.tan((fovDegrees * Math.PI) / 360);
  }

  /**
   * A spray of flecks from the point where two balls touch. `axisX/axisZ` is the (unit) direction from one ball to the
   * other: the snow squirts out SIDEWAYS from that line (and up), because straight along it is inside the balls.
   * `power` (0..1+) is how hard the hit was, `scale` the size of the balls involved. `drama` (1 = the normal burst) scales how much
   * snow there is (the number of flecks) and how fast it flies out; a weak hit uses less than 1 and a strong one more. How fast the
   * flecks FALL does not change with it (gravity is fixed), only how far and how fast they are thrown.
   */
  burst(x: number, y: number, z: number, axisX: number, axisZ: number, power: number, scale: number, drama = 1) {
    const count = Math.max(6, Math.round((30 + power * 26) * drama)); // many tiny flecks instead of a few big puffs
    const [sideX, sideZ] = [-axisZ, axisX];
    for (let i = 0; i < count; i++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 1); // out to the left or the right of the contact
      const along = rand(-0.4, 0.4); // a little forwards/backwards too, so it is a fan and not two jets
      const speed = rand(8, 22) * BURST_SPEED * (0.6 + power * 0.7) * Math.sqrt(scale) * drama; // a quick burst
      this.spawn(
        x, y + rand(0, 0.4), z,
        (sideX * side + axisX * along) * speed, rand(5, 11) * (0.6 + power * 0.5) * Math.sqrt(drama), (sideZ * side + axisZ * along) * speed, // (the lift scales more gently than the sideways speed)
        rand(0.2, 0.4) * (0.7 + scale * 0.3), // snowflake-sized
      );
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) {
    // find a free slot, or recycle the oldest one if the pool is full
    let slot = -1;
    for (let tried = 0; tried < this.capacity; tried++) {
      const i = (this.next + tried) % this.capacity;
      if (this.life[i] === 0) { slot = i; break; }
    }
    if (slot === -1) slot = this.next;
    this.next = (slot + 1) % this.capacity;
    this.position.set([x, y, z], slot * 3);
    this.velocity.set([vx, vy, vz], slot * 3);
    this.baseSize[slot] = size;
    this.landed[slot] = 0;
    this.life[slot] = FLIGHT_LIMIT; // until it lands, it lives "as long as it takes"; landing sets the real end (see update)
    this.age[slot] = 0;
  }

  update(dt: number) {
    const drag = Math.exp(-3.4 * BURST_SPEED * dt); // the spray slows quickly sideways (flying fast, but not far)
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] === 0) continue;
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.life[i] = 0;
        this.size[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      const v = i * 3;
      if (!this.landed[i]) {
        // In the air: a ballistic arc. Gravity pulls it down at the base pace while the (fast) sideways speed bleeds off.
        this.velocity[v] *= drag;
        this.velocity[v + 1] -= FLECK_GRAVITY * dt;
        this.velocity[v + 2] *= drag;
        this.position[v] += this.velocity[v] * dt;
        this.position[v + 1] += this.velocity[v + 1] * dt;
        this.position[v + 2] += this.velocity[v + 2] * dt;
        const ground = this.groundAt(this.position[v], this.position[v + 2]) + 0.04;
        if (this.position[v + 1] <= ground && this.velocity[v + 1] < 0) {
          // Touched down: stop, rest on the snow for a moment, then fade.
          this.position[v + 1] = ground;
          this.landed[i] = 1;
          this.life[i] = age + rand(REST_MIN, REST_MAX) + FADE;
        }
      }
      // Fade (and shrink a touch) only over the last FADE seconds, so a fleck is fully white until it is nearly gone.
      const fade = Math.min(1, (this.life[i] - age) / FADE);
      this.alpha[i] = 0.95 * fade;
      this.size[i] = this.baseSize[i] * (0.65 + 0.35 * fade);
    }
    for (const name of ['position', 'aSize', 'aAlpha']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------- streaks: wind rushing past a fast ball ----------

/**
 * Thin tapered streaks that are left hanging in the air behind a fast ball and fade away. Each streak is a flat
 * ribbon (4 corners): bright at the head, fading to nothing at the tail, stretched along the direction of travel.
 */
export class StreakSystem {
  readonly object: Object3D;
  private readonly capacity: number;
  private readonly head: Float32Array; // x,y,z where the streak starts (the end nearest the ball when it was made)
  private readonly direction: Float32Array; // unit vector pointing back along the path (x,z)
  private readonly length: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly position: Float32Array; // 4 corners per streak, rewritten every frame
  private readonly alpha: Float32Array;
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private next = 0;
  private readonly width = 0.09;

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.head = new Float32Array(capacity * 3);
    this.direction = new Float32Array(capacity * 2);
    this.length = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.position = new Float32Array(capacity * 12);
    this.alpha = new Float32Array(capacity * 4);
    const positionAttribute = new BufferAttribute(this.position, 3);
    const alphaAttribute = new BufferAttribute(this.alpha, 1);
    positionAttribute.setUsage(DynamicDrawUsage);
    alphaAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('aAlpha', alphaAttribute);
    // two triangles per ribbon: corners 0,1 are the head (left/right), 2,3 the tail
    const index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color('#ffffff') } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide, // a flat ribbon seen from either face (its winding depends on which way the ball is travelling)
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor, vAlpha); }`,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.object = mesh;
  }

  /** Leave one streak at (x, y, z), stretched back along (dirX, dirZ) (a unit vector: where the ball came from). */
  emit(x: number, y: number, z: number, dirX: number, dirZ: number, length: number) {
    let slot = -1;
    for (let tried = 0; tried < this.capacity; tried++) {
      const i = (this.next + tried) % this.capacity;
      if (this.life[i] === 0) { slot = i; break; }
    }
    if (slot === -1) slot = this.next;
    this.next = (slot + 1) % this.capacity;
    this.head.set([x, y, z], slot * 3);
    this.direction.set([dirX, dirZ], slot * 2);
    this.length[slot] = length;
    this.life[slot] = rand(0.28, 0.45);
    this.age[slot] = 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const base = i * 12;
      if (this.life[i] === 0) continue;
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.life[i] = 0;
        this.position.fill(0, base, base + 12); // collapse to nothing
        this.alpha.fill(0, i * 4, i * 4 + 4);
        continue;
      }
      const t = age / this.life[i];
      const [hx, hy, hz] = [this.head[i * 3], this.head[i * 3 + 1], this.head[i * 3 + 2]];
      const [dx, dz] = [this.direction[i * 2], this.direction[i * 2 + 1]];
      const long = this.length[i] * (1 - 0.5 * t); // shrinks as it fades
      // the ribbon is flat: its width points sideways from the direction of travel
      const [wx, wz] = [-dz * this.width, dx * this.width];
      const drift = t * 0.6; // the wind carries it a little further back
      const [sx, sz] = [hx + dx * drift, hz + dz * drift];
      this.position.set([
        sx + wx, hy, sz + wz,
        sx - wx, hy, sz - wz,
        sx + dx * long + wx, hy, sz + dz * long + wz,
        sx + dx * long - wx, hy, sz + dz * long - wz,
      ], base);
      const a = 0.85 * (1 - t);
      this.alpha.set([a, a, 0, 0], i * 4); // bright at the head, nothing at the tail
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
