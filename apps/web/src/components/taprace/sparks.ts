import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, ShaderMaterial, type Object3D,
} from 'three';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * How fast the sparks travel. The tuning below is for 1; it is 2 now, i.e. the whole flight takes half the time:
 * speeds double and lifetimes halve, so each spark covers the same distance in half the time.
 */
const TRAVEL_SPEED = 2;

/**
 * Sporadic bounces. Most sparks just fly out in a straight line and fade. But a random share of them (BOUNCE_CHANCE) are
 * "bouncers": after a short straight flight they start to fall under gravity, hit the floor, and bounce off it in a RANDOM
 * direction (and at a random speed), once or up to three times, then skid to a stop and fade. Every part of that is random per
 * spark (whether it bounces, when it starts to fall, how many bounces, how lively each one is, which way it goes), so no two
 * showers look the same.
 */
const BOUNCE_CHANCE = 0.25; // (0.4 before: a little less common)
const GRAVITY = 30; // world units per second squared, for bouncers once they start to fall
const SKID_DRAG = 4; // how quickly a spark that has stopped bouncing slides to a halt (per second)
const HALO = 2.2; // the glow around a spark's bright core: the drawn quad is this many times wider than the core

/** HSL (hue in degrees, saturation and lightness 0..1) to red, green, blue (each 0..1). */
function hsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = lightness - c / 2;
  return [r + m, g + m, b + m];
}

/**
 * Sparks for a button press: a pooled set of glowing STREAKS (one fixed pool, reused, so tapping never allocates and it is
 * a single draw call however many are alive). Each one is a flat, tube-like capsule: bright at its head and fading to
 * nothing along its tail, stretched along the way it is moving, and always turned to face the camera (a 2D picture, a
 * "billboard"). They shoot out from the ring around the button in straight lines (no gravity, no arc) and fade away. They are
 * drawn ADDITIVELY (light adds to what is behind it), which is what makes them look like they glow.
 *
 * `intensity` (0..1) decides how fierce a burst is: more sparks, flying faster and further, bigger and longer-lived. Their
 * COLOR follows the round too: yellow early on, through orange, to red; and in the very last second a rainbow. The game
 * raises both as the round goes on, so the last seconds throw the biggest, reddest (then rainbow) showers.
 */
export class SparkSystem {
  readonly object: Object3D;
  private readonly capacity: number;
  // Per spark (the simulation):
  private readonly centre: Float32Array; // x, y, z
  private readonly velocity: Float32Array; // x, y, z
  private readonly age: Float32Array;
  private readonly life: Float32Array; // 0 = free slot
  private readonly width: Float32Array; // how thick the tube is (world units)
  private readonly color: Float32Array; // r, g, b (0..1): fixed for the spark's whole life
  private readonly flightEnd: Float32Array; // bouncers: when (age, seconds) the straight flight ends and the fall begins; Infinity = never (a plain straight spark)
  private readonly bouncesLeft: Float32Array; // bouncers: how many more times it will bounce
  private readonly bounciness: Float32Array; // bouncers: how much of its downward speed it keeps when it hits the floor (random per spark)
  private readonly seed: Float32Array; // a random number per spark, to give each its own twinkle
  // Per corner (4 corners per spark; what the GPU draws):
  private readonly cornerCentre: Float32Array;
  private readonly cornerVelocity: Float32Array;
  private readonly cornerColor: Float32Array;
  private readonly cornerSize: Float32Array; // half-length and half-width in world units, per corner
  private readonly cornerAlpha: Float32Array;
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private next = 0;
  /** Height of the floor at (x, z): sparks bounce on it. The scene sets this (the raised base is higher than the floor around it). */
  floorAt: (x: number, z: number) => number = () => 0;

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.centre = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.flightEnd = new Float32Array(capacity);
    this.bouncesLeft = new Float32Array(capacity);
    this.bounciness = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.cornerCentre = new Float32Array(capacity * 12);
    this.cornerVelocity = new Float32Array(capacity * 12);
    this.cornerColor = new Float32Array(capacity * 12);
    this.cornerSize = new Float32Array(capacity * 8);
    this.cornerAlpha = new Float32Array(capacity * 4);

    // The four corners of every streak's quad: x runs along the streak (+1 = the head), y across it. Fixed forever.
    const corner = new Float32Array(capacity * 8);
    for (let i = 0; i < capacity; i++) corner.set([-1, -1, 1, -1, -1, 1, 1, 1], i * 8);
    const index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);

    const dynamic = (name: string, array: Float32Array, items: number) => {
      const attribute = new BufferAttribute(array, items);
      attribute.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    };
    dynamic('position', this.cornerCentre, 3);
    dynamic('aVelocity', this.cornerVelocity, 3);
    dynamic('aColor', this.cornerColor, 3);
    dynamic('aSize', this.cornerSize, 2);
    dynamic('aAlpha', this.cornerAlpha, 1);
    this.geometry.setAttribute('aCorner', new BufferAttribute(corner, 2));
    this.geometry.setIndex(new BufferAttribute(index, 1));

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `
        attribute vec3 aVelocity;
        attribute vec3 aColor;
        attribute vec2 aSize;   // half-length, half-width (world units)
        attribute float aAlpha;
        attribute vec2 aCorner; // (along, across), each -1..1
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vCorner;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vCorner = aCorner;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          // Which way is the spark moving ON SCREEN? Take its velocity into the camera's frame and drop the depth part.
          vec2 along = (modelViewMatrix * vec4(aVelocity, 0.0)).xy;
          along = length(along) > 1e-4 ? normalize(along) : vec2(0.0, 1.0);
          vec2 across = vec2(-along.y, along.x);
          // The streak is a flat quad lying in the screen plane, so it always faces the camera.
          view.xy += along * aCorner.x * aSize.x + across * aCorner.y * aSize.y;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vCorner;
        void main() {
          // A glowing COMET shape: a solid bright body that is narrow at the tail and fat and rounded at the head, with a soft halo of
          // glow around the head. Every term fades to nothing before the edge of the quad, so no box is ever visible.
          float along = vCorner.x;              // -1 at the tail ... +1 at the head
          float across = abs(vCorner.y);
          float headRound = sqrt(max(0.0, 1.0 - pow(max(0.0, (along - 0.62) / 0.38), 2.0))); // rounds off the very tip
          float bodyWidth = mix(0.16, 0.5, smoothstep(-1.0, 0.6, along)) * headRound;       // narrow tail, fat head
          float body = (1.0 - smoothstep(bodyWidth * 0.45, bodyWidth, across)) * smoothstep(-1.0, -0.15, along) * step(0.001, headRound);
          float haloDist = length(vec2((along - 0.35) * 0.75, across * 1.3));
          float halo = exp(-haloDist * haloDist * 6.0) * 0.6 * (1.0 - smoothstep(0.55, 1.0, along)) * (1.0 - smoothstep(0.6, 1.0, across));
          float glow = body + halo;
          if (glow < 0.01) discard;
          // The body keeps the round's color (yellow -> orange -> red, then rainbow); only the hottest middle of the head runs towards white.
          vec3 hot = mix(vColor, vec3(1.0, 0.96, 0.85), 0.35);
          float heat = smoothstep(0.1, 0.65, along) * (1.0 - smoothstep(0.0, 0.3, across));
          vec3 color = vColor * halo + mix(vColor, hot, heat) * body;
          // (No brightness multiplier on purpose: scaling all three channels clips the red first and drags orange and red towards yellow. The solid body is what makes it bright.)
          gl_FragColor = vec4(color, vAlpha * min(1.0, glow));
        }`,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false; // sparks move around inside a bounding box we never update
    this.object = mesh;
  }

  /**
   * One press: a shower of sparks from the RING around the button (centred on (x, z), `ringRadius` out, at height y).
   * They fly straight outwards (and a little upwards). `intensity` 0 = a modest flurry; 1 = a big, fast spray.
   * `warmth` picks the color: 0 = yellow, 0.5 = orange, 1 = red. `rainbow` overrides it: every spark gets a different
   * color, running round the full color wheel as the sparks fan out around the button. `frenzy` (the final second) more
   * than doubles the number of sparks.
   */
  burst(x: number, y: number, z: number, intensity: number, ringRadius: number, warmth: number, rainbow: boolean, frenzy: boolean) {
    const k = Math.min(1, Math.max(0, intensity));
    const w = Math.min(1, Math.max(0, warmth));
    const count = Math.round(mix(12, 60, k) * (frenzy ? 2.2 : 1));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const [dx, dz] = [Math.cos(angle), Math.sin(angle)]; // straight out from the middle of the button
      const outward = rand(0.35, 1) * mix(3.5, 8, k) * TRAVEL_SPEED;
      const up = outward * rand(0.2, 0.5); // a modest lift: they leave in a straight line that climbs gently away from the button
      // Yellow (hue 58) -> orange (30) -> red (2), bright and fully saturated. A little hue jitter so a burst isn't one flat color.
      const hue = rainbow ? (angle / (Math.PI * 2)) * 360 + rand(-12, 12) : mix(58, 2, w) + rand(-5, 5);
      const [r, g, bl] = hsl(hue, 1, rainbow ? 0.6 : 0.56); // a little brighter than before, still fully saturated
      const bouncer = Math.random() < BOUNCE_CHANCE;
      this.spawn(
        x + dx * ringRadius, y, z + dz * ringRadius,
        dx * outward, up, dz * outward,
        rand(0.06, 0.1) * mix(1, 1.6, k), // how thick the core is (half what it was)
        bouncer ? rand(0.9, 1.7) : (rand(0.35, 0.65) * mix(1, 1.5, k)) / TRAVEL_SPEED, // seconds of life (bouncers live longer: they have a fall and bounces to get through)
        r, g, bl,
        bouncer,
      );
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, width: number, life: number, r: number, g: number, b: number, bouncer: boolean) {
    // find a free slot, or recycle the oldest one if the pool is full
    let slot = -1;
    for (let tried = 0; tried < this.capacity; tried++) {
      const i = (this.next + tried) % this.capacity;
      if (this.life[i] === 0) { slot = i; break; }
    }
    if (slot === -1) slot = this.next;
    this.next = (slot + 1) % this.capacity;
    this.centre.set([x, y, z], slot * 3);
    this.velocity.set([vx, vy, vz], slot * 3);
    this.width[slot] = width;
    this.color.set([r, g, b], slot * 3);
    this.life[slot] = life;
    this.age[slot] = 0;
    this.seed[slot] = Math.random();
    // A bouncer flies straight for a random moment, then falls; it will bounce 1 to 3 times, each time keeping a random share of its speed.
    this.flightEnd[slot] = bouncer ? rand(0.05, 0.16) : Infinity;
    this.bouncesLeft[slot] = bouncer ? 1 + Math.floor(Math.random() * 3) : 0;
    this.bounciness[slot] = rand(0.3, 0.6);
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] === 0) continue;
      const age = (this.age[i] += dt);
      const v = i * 3;
      // Plain sparks fly in straight lines (no gravity, no drag). A bouncer does too, until its flight ends...
      if (age > this.flightEnd[i]) this.fall(i, dt);
      this.centre[v] += this.velocity[v] * dt;
      this.centre[v + 1] += this.velocity[v + 1] * dt;
      this.centre[v + 2] += this.velocity[v + 2] * dt;
      const dead = age >= this.life[i];
      const t = age / this.life[i]; // 0 -> 1 over its life

      // Streaks stretch with speed (a fast spark is a long streak, a slow one a short dash) and shrink as they fade.
      const speed = Math.hypot(this.velocity[v], this.velocity[v + 1], this.velocity[v + 2]) / TRAVEL_SPEED;
      const halfLength = dead ? 0 : Math.min(1.3, 0.25 + speed * 0.03) * (1 - 0.4 * t) * (0.6 + this.width[i] * 6) * 1.3; // (width counts double here, so halving the thickness doesn't also shorten the streak)
      const halfWidth = dead ? 0 : this.width[i] * (1 - 0.35 * t) * HALO; // (the quad is HALO times the core's width, so there is room for the glow)
      // Full brightness for the first half of its life, then it fades out; a quick random twinkle (like a real ember) throughout.
      const twinkle = 0.84 + 0.16 * Math.sin(age * 38 + this.seed[i] * 6.28);
      const alpha = dead ? 0 : Math.min(1, (1 - t) * 2) * twinkle;
      if (dead) this.life[i] = 0;

      for (let c = 0; c < 4; c++) {
        const corner = i * 4 + c;
        this.cornerCentre.set([this.centre[v], this.centre[v + 1], this.centre[v + 2]], corner * 3);
        this.cornerVelocity.set([this.velocity[v], this.velocity[v + 1], this.velocity[v + 2]], corner * 3);
        this.cornerColor.set([this.color[v], this.color[v + 1], this.color[v + 2]], corner * 3);
        this.cornerSize[corner * 2] = halfLength;
        this.cornerSize[corner * 2 + 1] = halfWidth;
        this.cornerAlpha[corner] = alpha;
      }
    }
    for (const name of ['position', 'aVelocity', 'aColor', 'aSize', 'aAlpha']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  /**
   * One step of a bouncer's fall: gravity pulls it down; when it reaches the floor it bounces. Each bounce sends it off in a
   * completely RANDOM direction on the floor, at a random fraction of its old speed, and throws it up again a little (a random
   * share of the speed it came down with). After its last bounce it just skids along the floor, slowing, until it fades.
   */
  private fall(i: number, dt: number) {
    const v = i * 3;
    const floor = this.floorAt(this.centre[v], this.centre[v + 2]) + 0.04;
    const onFloor = this.centre[v + 1] <= floor + 0.001;
    if (this.bouncesLeft[i] <= 0 && onFloor) {
      // Out of bounces: slide along the floor, slowing down.
      const drag = Math.exp(-SKID_DRAG * dt);
      this.velocity[v] *= drag;
      this.velocity[v + 2] *= drag;
      this.velocity[v + 1] = 0;
      this.centre[v + 1] = floor;
      return;
    }
    this.velocity[v + 1] -= GRAVITY * dt;
    if (this.centre[v + 1] + this.velocity[v + 1] * dt <= floor && this.velocity[v + 1] < 0) {
      // It hits the floor.
      this.centre[v + 1] = floor;
      if (this.bouncesLeft[i] <= 0) { this.velocity[v + 1] = 0; return; } // no bounces left: it lands and skids (no more hops, no new direction)
      this.velocity[v + 1] = -this.velocity[v + 1] * this.bounciness[i];
      const across = Math.hypot(this.velocity[v], this.velocity[v + 2]);
      const heading = Math.random() * Math.PI * 2; // any direction at all
      const speed = across * rand(0.25, 0.75) + rand(0.5, 2.5);
      this.velocity[v] = Math.cos(heading) * speed;
      this.velocity[v + 2] = Math.sin(heading) * speed;
      this.bouncesLeft[i] -= 1;
      if (this.velocity[v + 1] < 1.5) this.bouncesLeft[i] = 0; // too weak to bounce again: it will skid
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
