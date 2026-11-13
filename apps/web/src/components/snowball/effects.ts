import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshStandardMaterial, Points, ShaderMaterial, TorusGeometry,
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
    this.material = new ShaderMaterial({
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
          vec3 colour = mix(vec3(1.0), vec3(0.80, 0.87, 0.96), smoothstep(0.32, 0.5, d));
          gl_FragColor = vec4(colour, vAlpha * smoothstep(0.5, 0.43, d));
        }`,
    });
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
   * `power` (0..1+) is how hard the hit was, `scale` the size of the balls involved.
   */
  burst(x: number, y: number, z: number, axisX: number, axisZ: number, power: number, scale: number) {
    const count = Math.round(30 + power * 26); // many tiny flecks instead of a few big puffs
    const [sideX, sideZ] = [-axisZ, axisX];
    for (let i = 0; i < count; i++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 1); // out to the left or the right of the contact
      const along = rand(-0.4, 0.4); // a little forwards/backwards too, so it is a fan and not two jets
      const speed = rand(8, 22) * BURST_SPEED * (0.6 + power * 0.7) * Math.sqrt(scale); // a quick burst
      this.spawn(
        x, y + rand(0, 0.4), z,
        (sideX * side + axisX * along) * speed, rand(5, 11) * (0.6 + power * 0.5), (sideZ * side + axisZ * along) * speed,
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
      uniforms: { uColour: { value: new Color('#ffffff') } },
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
        uniform vec3 uColour;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColour, vAlpha); }`,
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

// ---------- shockwave: a ring that spreads out from where two balls hit ----------

/**
 * The ring's whole life in seconds: it spreads out the whole time (quickly at first, then in a slowing glide) while
 * fading in over the first moments and then fading out smoothly over most of the rest, so it dissolves instead of vanishing.
 */
const RING_LIFE = 0.4;
/**
 * How sharply the spreading slows down: 1 = steady speed, higher = faster start and a gentler glide at the end.
 * Its opening speed is about 0.75 * RING_SPREAD / RING_LIFE (fractions of the full radius per second): 6 now,
 * between the earlier 4.5 (a bit too slow) and 9 (a bit too fast).
 */
const RING_SPREAD = 3.2;
/** How flat the ring's band is: 1 = a fully round tube, smaller = a flatter, thinner band (measured along the ring's axis). */
const RING_FLATNESS = 0.4;
/** The ring's strongest opacity (0..1), reached just after it appears. Lower = more see-through. */
const RING_OPACITY = 0.5;

/**
 * One hit makes TWO rings, like a ripple: the big main ring, then a smaller, fainter one that sets off a moment later
 * and follows it outward. `size` scales the ring's final radius, `delay` is how long (seconds) after the hit it starts,
 * and `opacity` scales its strength.
 */
const RING_PARTS = [
  { size: 1, delay: 0, opacity: 1 }, // the main ring
  { size: 0.8, delay: 0.04, opacity: 0.75 }, // the ripple, close behind it (was 0.6 / 0.07: further apart)
] as const;
const RING_TOTAL_TIME = RING_LIFE + Math.max(...RING_PARTS.map((part) => part.delay));

/**
 * Translucent 3D rings (each a torus: a tube bent into a circle, squashed flat into a band) that stand upright at the
 * point where two balls meet, across the line between them, and spread out and fade, to make a hit feel bigger.
 * Because they are solid tubes rather than flat pictures, they have thickness and are visible from any direction, even
 * seen edge-on. They are built from three.js's own torus shape (no model file needed). A small fixed pool is reused,
 * so hits never allocate.
 */
export class ShockRingSystem {
  readonly object = new Group();
  // One slot per hit that can be on screen at once; each slot holds the rings (RING_PARTS) of that hit.
  private readonly slots: { parts: { mesh: Mesh; material: MeshStandardMaterial }[]; age: number; maxRadius: number; active: boolean }[] = [];
  // Radius 1 so scaling the mesh by R gives a ring of radius R; the tube is a thin 0.07 (it scales along with the ring).
  private geometry = new TorusGeometry(1, 0.07, 10, 56);
  private next = 0;

  constructor(capacity = 6) {
    for (let i = 0; i < capacity; i++) {
      const parts = RING_PARTS.map(() => {
        const material = new MeshStandardMaterial({
          color: '#ffffff',
          emissive: new Color('#8fb0d8'), // a faint cool glow so the shaded side of the tube doesn't go grey
          emissiveIntensity: 0.5,
          roughness: 0.55,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new Mesh(this.geometry, material);
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.object.add(mesh);
        return { mesh, material };
      });
      this.slots.push({ parts, age: 0, maxRadius: 1, active: false });
    }
  }

  /**
   * Start the rings centred on (x, y, z) (the contact point between the balls), spreading out to `maxRadius`.
   * `axisX/axisZ` is the (unit) direction from one ball to the other: the rings stand upright with that line through
   * their middle, i.e. they spread across the gap between the two balls. (Fixed in the world, not turned to the camera.)
   */
  spawn(x: number, y: number, z: number, axisX: number, axisZ: number, maxRadius: number) {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % this.slots.length; // recycle the oldest when many hits happen at once
    slot.active = true;
    slot.age = 0;
    slot.maxRadius = maxRadius;
    for (const { mesh } of slot.parts) {
      mesh.position.set(x, y, z);
      mesh.rotation.set(0, Math.atan2(axisX, axisZ), 0); // a torus starts with its hole along +z; turn it about the vertical to line up with the axis
      mesh.visible = false; // each ring appears when its own delay is over (see update)
    }
  }

  update(dt: number) {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= RING_TOTAL_TIME) {
        slot.active = false;
        for (const { mesh } of slot.parts) mesh.visible = false;
        continue;
      }
      slot.parts.forEach(({ mesh, material }, i) => {
        const part = RING_PARTS[i];
        const t = (slot.age - part.delay) / RING_LIFE; // this ring's own 0 -> 1 progress
        mesh.visible = t >= 0 && t < 1;
        if (!mesh.visible) return;
        // Spreads fast at first, then glides to a stop (ease-out). It starts part-way out (0.25) so it isn't buried inside the balls.
        const radius = slot.maxRadius * part.size * (0.25 + 0.75 * (1 - Math.pow(1 - t, RING_SPREAD)));
        // Flat, not round: the tube is squashed along the ring's axis into a thin band (RING_FLATNESS), and it thins
        // out further as it ages, which helps it look like it is dissolving.
        mesh.scale.set(radius, radius, radius * RING_FLATNESS * (1 - 0.6 * smoothstep(0.2, 1, t)));
        // A quick fade-in (no sudden pop-on), a short hold, then a long smooth fade to nothing. Never very opaque (RING_OPACITY).
        material.opacity = RING_OPACITY * part.opacity * smoothstep(0, 0.1, t) * (1 - smoothstep(0.2, 1, t));
      });
    }
  }

  dispose() {
    this.geometry.dispose();
    for (const slot of this.slots) for (const { material } of slot.parts) material.dispose();
  }
}
