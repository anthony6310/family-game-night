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
 * COLOUR follows the round too: yellow early on, through orange, to red; and in the very last second a rainbow. The game
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
  private readonly colour: Float32Array; // r, g, b (0..1): fixed for the spark's whole life
  // Per corner (4 corners per spark; what the GPU draws):
  private readonly cornerCentre: Float32Array;
  private readonly cornerVelocity: Float32Array;
  private readonly cornerColour: Float32Array;
  private readonly cornerSize: Float32Array; // half-length and half-width in world units, per corner
  private readonly cornerAlpha: Float32Array;
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private next = 0;

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.centre = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.colour = new Float32Array(capacity * 3);
    this.cornerCentre = new Float32Array(capacity * 12);
    this.cornerVelocity = new Float32Array(capacity * 12);
    this.cornerColour = new Float32Array(capacity * 12);
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
    dynamic('aColour', this.cornerColour, 3);
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
        attribute vec3 aColour;
        attribute vec2 aSize;   // half-length, half-width (world units)
        attribute float aAlpha;
        attribute vec2 aCorner; // (along, across), each -1..1
        varying vec3 vColour;
        varying float vAlpha;
        varying vec2 vCorner;
        void main() {
          vColour = aColour;
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
        varying vec3 vColour;
        varying float vAlpha;
        varying vec2 vCorner;
        void main() {
          // Along the streak: bright at the head (+1), fading to nothing at the tail (-1), with a rounded tip.
          float head = clamp((vCorner.x + 1.0) * 0.5, 0.0, 1.0);
          float tail = pow(head, 1.6);
          float tip = 1.0 - smoothstep(0.78, 1.0, vCorner.x);
          // Across it: a rounded tube, brightest down the middle.
          float tube = pow(max(0.0, 1.0 - abs(vCorner.y)), 1.3);
          float glow = tail * tip * tube;
          if (glow < 0.01) discard;
          vec3 colour = mix(vColour, vec3(1.0), tube * head * 0.35); // just a touch of white in the very middle of the head, so the colour stays rich
          gl_FragColor = vec4(colour * glow, vAlpha * glow);
        }`,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false; // sparks move around inside a bounding box we never update
    this.object = mesh;
  }

  /**
   * One press: a shower of sparks from the RING around the button (centred on (x, z), `ringRadius` out, at height y).
   * They fly straight outwards (and a little upwards). `intensity` 0 = a modest flurry; 1 = a big, fast spray.
   * `warmth` picks the colour: 0 = yellow, 0.5 = orange, 1 = red. `rainbow` overrides it: every spark gets a different
   * colour, running round the full colour wheel as the sparks fan out around the button. `frenzy` (the final second) more
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
      // Yellow (hue 58) -> orange (30) -> red (2), bright and fully saturated. A little hue jitter so a burst isn't one flat colour.
      const hue = rainbow ? (angle / (Math.PI * 2)) * 360 + rand(-12, 12) : mix(58, 2, w) + rand(-5, 5);
      const [r, g, bl] = hsl(hue, 1, rainbow ? 0.58 : 0.55);
      this.spawn(
        x + dx * ringRadius, y, z + dz * ringRadius,
        dx * outward, up, dz * outward,
        rand(0.1, 0.17) * mix(1, 1.6, k), // how thick the tube is
        (rand(0.35, 0.65) * mix(1, 1.5, k)) / TRAVEL_SPEED, // seconds of life
        r, g, bl,
      );
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, width: number, life: number, r: number, g: number, b: number) {
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
    this.colour.set([r, g, b], slot * 3);
    this.life[slot] = life;
    this.age[slot] = 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] === 0) continue;
      const age = (this.age[i] += dt);
      const v = i * 3;
      // Straight lines: the velocity never changes (no gravity, no drag).
      this.centre[v] += this.velocity[v] * dt;
      this.centre[v + 1] += this.velocity[v + 1] * dt;
      this.centre[v + 2] += this.velocity[v + 2] * dt;
      const dead = age >= this.life[i];
      const t = age / this.life[i]; // 0 -> 1 over its life

      // Streaks stretch with speed (a fast spark is a long streak, a slow one a short dash) and shrink as they fade.
      const speed = Math.hypot(this.velocity[v], this.velocity[v + 1], this.velocity[v + 2]) / TRAVEL_SPEED;
      const halfLength = dead ? 0 : Math.min(1.3, 0.25 + speed * 0.03) * (1 - 0.4 * t) * (0.6 + this.width[i] * 3);
      const halfWidth = dead ? 0 : this.width[i] * (1 - 0.5 * t);
      const alpha = dead ? 0 : Math.min(1, (1 - t) * 1.6);
      if (dead) this.life[i] = 0;

      for (let c = 0; c < 4; c++) {
        const corner = i * 4 + c;
        this.cornerCentre.set([this.centre[v], this.centre[v + 1], this.centre[v + 2]], corner * 3);
        this.cornerVelocity.set([this.velocity[v], this.velocity[v + 1], this.velocity[v + 2]], corner * 3);
        this.cornerColour.set([this.colour[v], this.colour[v + 1], this.colour[v + 2]], corner * 3);
        this.cornerSize[corner * 2] = halfLength;
        this.cornerSize[corner * 2 + 1] = halfWidth;
        this.cornerAlpha[corner] = alpha;
      }
    }
    for (const name of ['position', 'aVelocity', 'aColour', 'aSize', 'aAlpha']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
