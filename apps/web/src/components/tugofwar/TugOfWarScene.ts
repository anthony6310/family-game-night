import {
  AmbientLight, BoxGeometry, BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, Sprite, Vector3, WebGLRenderer,
} from 'three';
import { TEAM_COLORS, type TeamId, type TugOfWarView, TUG_FALL_SECONDS, TUG_SECONDS, TUG_PULL_SECONDS, TUG_STRAIN_SECONDS } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { typewriterClick } from '../../audio/clickSounds';
import { giftMiss } from '../../audio/santaSounds';
import { createRoundClock } from '../../audio/roundClock';
import { SparkSystem } from '../taprace/sparks';
import { createNameTag, disposeNameTag } from '../labelTexture';

/** One player on the rope: their name, their own color (shown on the hat) and which team they pull for. */
export interface PullerStyle { id: string; name: string; color: string }

// ---------- the setting and the numbers (world units: a puller is about 2.1 tall) ----------
const SPACING = 1.45; // how far apart the pullers on a team stand along the rope
const FIRST_AT = 1.9; // the nearest puller of each team stands this far from the middle (before any pulling)
const MAX_SHIFT = 4.2; // how far the whole tug slides when one team is far ahead
const ROPE_Y = 1.3;
const SWEAT_LENGTH = 0.6; // how long each sweat dash is (40% shorter than the shared streak; the thickness is unchanged)
const SWEAT_PALETTE: [number, number, number][] = [[0.78, 0.95, 1], [0.5, 0.84, 0.94], [0.27, 0.7, 0.9], [1, 1, 1]]; // (the fishing splash's colors: water and foam)
const HIP_Y = 0.8;
const STRAIN = TUG_STRAIN_SECONDS, PULL = TUG_PULL_SECONDS, FALL = TUG_FALL_SECONDS;
const SKIN = '#f1c9a5';
const ROPE_RADIUS = 0.075; // (half of what it was)
const ROPE_TAIL = 0.9; // how far the rope reaches past each team's outermost hand
const ROPE_SEGMENTS = 110, ROPE_SIDES = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const easeOutBack = (t: number) => { const u = clamp(t, 0, 1), c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

interface Puller {
  id: string;
  team: TeamId;
  slot: number; // 0 = nearest the middle
  root: Group; // at the feet; turned so that its front (+x) faces the other team
  upper: Group; // everything above the hips: it leans
  armL: Group; armR: Group; legL: Group; legR: Group;
  hands: Mesh[]; // the two hands: the rope is drawn through them (see updateRope)
  fallNow: number; // 0..1, how far this puller has fallen
  baseX: number; // where this puller stands (along the rope) before anything moves them
  tag: Sprite;
  you: Mesh | null;
  taps: number; // the taps last seen (a rise = one pull)
  pulse: number; // 1 right after a tap, fading: the little heave of a pull
  phase: number; // so the pullers do not all move in step
  fallDelay: number; // when this one falls, in the fall stage (they go down one after another)
}

/**
 * Everything three.js for a Tug of War round (GAME_RULES.md #18), kept apart from React like the other scenes. A side view of a grassy field: two teams (yellow on the left, purple on the right)
 * in single file, holding one rope. The whole tug (rope and both teams) slides towards the team that is ahead, by how far ahead it is (taps plus head start), while the pullers lean back and
 * heave with every tap; the fixed lines on the ground show how far. The CLOSING SEQUENCE (after the 15 seconds): the teams STRAIN (a held, trembling anticipation with the camera creeping in),
 * the winners give one massive PULL, the losers are dragged off balance and FALL, and the winners stand with their arms raised, cheering. Then the camera pans out (the winner moment).
 */
export class TugOfWarScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(45, 1, 0.1, 400);
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private disposables: { dispose(): void }[] = [];

  private pullGroup = new Group(); // the rope and both teams: it slides
  private rope!: Mesh; // a twisted rope: a tube along a curve that is rebuilt every frame (see updateRope), so its ends can hang and flop
  private ropeGeometry!: BufferGeometry;
  /** Sweat: the fishing game's water droplets (the Tap Race spark streaks, solid and water-colored), flicked off a player at every tap, and more of it as the round goes on. */
  private sweat = new SparkSystem(1200, false);
  private progress = 0; // how far through the round we are, 0..1
  private ropeDt = 1 / 60;
  private ropeSim: { x: Float32Array; y: Float32Array; z: Float32Array; ox: Float32Array; oy: Float32Array; oz: Float32Array } | null = null; // the rope's points: parts nobody holds are simulated (gravity, a fixed length, the ground)
  private ropeHold = { left: 3, right: 3 }; // where the outermost hand on each side holds the rope (distance from the middle)
  private ropeSway = 0;
  private pullers: Puller[] = [];
  private ropeHalf = 6;

  private totals: Record<TeamId, number> = { yellow: 0, purple: 0 };
  private balance = 0; // how far ahead the yellow team (left) is, -1..1 (smoothed, as shown)
  private targetBalance = 0;
  private finish: { winner: TeamId | null; endsAt: number } | null = null;
  private winnerView = false;
  private viewT = 0; // 0 = the normal view, 1 = panned right out (the winner moment)
  private aspect = 1;
  private camFollow = 0;
  private clock = createRoundClock((sound, gain) => audio.playFlat(sound, gain));
  /** The start countdown's camera move, 0 (high and far) .. 1 (the normal view); set by the game screen from the server's clock. */
  introFactor: () => number = () => 1;

  constructor(private container: HTMLElement, private serverNow: () => number, styles: PullerStyle[], teams: Record<string, TeamId>, private selfId: string | null) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.disposables.push(this.renderer);
    this.scene.background = new Color('#a9d8f5');
    this.scene.fog = new Fog('#a9d8f5', 55, 150);
    this.buildWorld();
    this.buildTeams(styles, teams);
    this.sweat.floorAt = () => -1000; // (the droplets just fall and fade)
    this.pullGroup.add(this.sweat.object); // (inside the sliding group, so the droplets stay with the players)
    this.disposables.push(this.sweat);
    this.scene.add(this.pullGroup);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- what React tells the scene ----------

  /** The latest numbers from the server: each team's total (taps plus head start) moves the rope; a rise in a player's taps is one heave of theirs. */
  pushView(view: TugOfWarView) {
    this.totals = view.totals;
    const sum = view.totals.yellow + view.totals.purple;
    this.targetBalance = (view.totals.yellow - view.totals.purple) / (sum + 12); // (a head start alone already shows; the more taps there are, the more a lead means)
    for (const p of this.pullers) {
      const n = view.taps[p.id] ?? 0;
      if (n > p.taps) { p.pulse = 1; if (p.id === this.selfId) audio.playFlat(typewriterClick, 0.5, 1); else this.sweatOff(p, n - p.taps); } // (your own sweat came at the instant you tapped)
      p.taps = n;
    }
  }

  /** Your own tap, shown the instant you press (the server's count follows). */
  tapped() {
    const me = this.pullers.find((p) => p.id === this.selfId);
    if (me) { me.pulse = 1; this.sweatOff(me, 1); }
  }

  /** A flick of sweat off a puller's brow at a tap (`taps` taps at once make a bit more). It grows with the round: a few drops at first, a spray by the end. */
  private sweatOff(p: Puller, taps: number) {
    if (p.fallNow > 0.02) return;
    const front = p.team === 'yellow' ? 1 : -1; // (the face points to the other team)
    const k = this.progress;
    // A drop or two per tap at first, more as the round goes on (a fractional count is rounded up at random), thrown straight out from the head and bending only a little.
    const expected = (1 + 5 * k) * (1 + 0.25 * Math.min(3, taps - 1));
    const count = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    const x = p.root.position.x - front * 0.05, z = p.root.position.z + 0.3, size = 0.75, speed = 2.86, life: [number, number] = [0.22, 0.45]; // (the same size and speed all round: only the number of drops grows)
    // Sweat comes off the BACK only (the side away from the other team, as in the sketch): short dashes shoot back and out from behind the head and from the upper back, fanning from a little above straight back to a little below it.
    const back = front > 0 ? Math.PI : 0, arc: [number, number] = [back - 0.95, back + 0.95];
    this.sweat.radiate(x, 1.95, z, count, speed, SWEAT_PALETTE, size, life, 0.42, 0, 0, SWEAT_LENGTH, arc);
    const body = Math.floor(count * 0.7) + (Math.random() < (count * 0.7) % 1 ? 1 : 0);
    if (body > 0) this.sweat.radiate(x, Math.random() < 0.5 ? 1.5 : 1.15, z, body, speed, SWEAT_PALETTE, size, life, 0.4, 0, 0, SWEAT_LENGTH, arc);
  }

  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); this.progress = clamp(1 - secondsLeft / TUG_SECONDS, 0, 1); }

  /** The round is over: play the closing sequence from `endsAt` (the winning team, or null for a draw). */
  setFinish(winner: TeamId | null, endsAt: number) { this.finish = { winner, endsAt }; }

  /** The winner moment: pan the camera right out. */
  setWinnerView(on: boolean) { this.winnerView = on; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const p of this.pullers) disposeNameTag(p.tag);
    this.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry?.dispose?.(); });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.domElement.remove();
  }

  // ---------- the world ----------

  private track<T extends { dispose(): void }>(thing: T): T { this.disposables.push(thing); return thing; }
  private material(color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) { return this.track(new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra })); }

  private buildWorld() {
    this.scene.add(new HemisphereLight(0xdff3ff, 0x6f8f55, 1.5), new AmbientLight(0xffffff, 0.35));
    const sun = new DirectionalLight(0xfff3d6, 1.7);
    sun.position.set(-8, 16, 12);
    this.scene.add(sun);
    // The field: grass in mown stripes, with a dirt strip down the middle where the tug happens.
    const grass = this.track(makeGrassTexture());
    grass.repeat.set(12, 6);
    const ground = new Mesh(this.track(new PlaneGeometry(240, 120)), this.track(new MeshStandardMaterial({ map: grass, roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const dirt = new Mesh(this.track(new PlaneGeometry(60, 4.2)), this.material('#b08a5a'));
    dirt.rotation.x = -Math.PI / 2; dirt.position.set(0, 0.02, 0);
    this.scene.add(dirt);
    // The line on the ground: a white one in the middle (the rope's slide, and the teams', is judged against it).
    const line = (x: number, color: string, wide: number) => { const m = new Mesh(this.track(new PlaneGeometry(wide, 4.2)), this.track(new MeshBasicMaterial({ color }))); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, 0); this.scene.add(m); };
    line(0, '#ffffff', 0.22);
    // Far hills and a ring of pine trees, so the field is somewhere.
    const hillMaterial = this.material('#7fae66'), hillFar = this.material('#6e9a62');
    for (let i = 0; i < 9; i++) {
      const hill = new Mesh(this.track(new SphereGeometry(14 + (i % 3) * 5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), i % 2 ? hillMaterial : hillFar);
      hill.position.set(-80 + i * 20, 0, -55 - (i % 2) * 14); hill.scale.set(1.6, 0.8, 1);
      this.scene.add(hill);
    }
    const trunk = this.material('#5a3d26'), leaves = this.material('#2f6b3a');
    const trunkGeo = this.track(new CylinderGeometry(0.3, 0.4, 1.6, 7)), coneGeo = this.track(new ConeGeometry(1.7, 3.8, 8));
    for (let i = 0; i < 26; i++) {
      const x = -60 + i * 4.8 + ((i * 7) % 5), z = -22 - ((i * 3) % 7), s = 0.8 + ((i * 5) % 4) * 0.18;
      const tree = new Group();
      const t = new Mesh(trunkGeo, trunk); t.position.y = 0.8;
      const c = new Mesh(coneGeo, leaves); c.position.y = 3.2;
      tree.add(t, c); tree.position.set(x, 0, z); tree.scale.setScalar(s);
      this.scene.add(tree);
    }
  }

  private buildTeams(styles: PullerStyle[], teams: Record<string, TeamId>) {
    const byTeam: Record<TeamId, PullerStyle[]> = { yellow: [], purple: [] };
    for (const s of styles) { const t = teams[s.id]; if (t) byTeam[t].push(s); }
    const most = Math.max(1, byTeam.yellow.length, byTeam.purple.length);
    this.ropeHalf = FIRST_AT + (most - 1) * SPACING + 1.3;
    // The rope: a TWISTED rope (strands that spiral round it) that is held by the pullers and whose two ends hang down past the last puller and lie on the ground, like a real rope under gravity
    // (it is not simulated: the shape is worked out each frame, see updateRope).
    this.ropeHold = { left: FIRST_AT + (byTeam.yellow.length - 1) * SPACING - 0.7, right: FIRST_AT + (byTeam.purple.length - 1) * SPACING - 0.7 };
    const ropeMap = this.track(makeRopeTexture());
    const ropeLength = this.ropeHold.left + this.ropeHold.right + 2 * ROPE_TAIL;
    ropeMap.repeat.set(ropeLength / 0.45, 1); // (one turn of the strands every 0.45 units along the rope: the lay stays in proportion to the thinner rope)
    this.ropeGeometry = this.track(new BufferGeometry());
    const positions = new Float32Array((ROPE_SEGMENTS + 1) * (ROPE_SIDES + 1) * 3), uvs: number[] = [], index: number[] = [];
    for (let i = 0; i <= ROPE_SEGMENTS; i++) for (let j = 0; j <= ROPE_SIDES; j++) uvs.push(i / ROPE_SEGMENTS, j / ROPE_SIDES);
    for (let i = 0; i < ROPE_SEGMENTS; i++) for (let j = 0; j < ROPE_SIDES; j++) { const a = i * (ROPE_SIDES + 1) + j, b = a + ROPE_SIDES + 1; index.push(a, b, a + 1, b, b + 1, a + 1); }
    const posAttr = new Float32BufferAttribute(positions, 3); posAttr.setUsage(DynamicDrawUsage);
    this.ropeGeometry.setAttribute('position', posAttr);
    this.ropeGeometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(positions.length), 3));
    this.ropeGeometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.ropeGeometry.setIndex(index);
    this.rope = new Mesh(this.ropeGeometry, this.track(new MeshStandardMaterial({ map: ropeMap, roughness: 0.95, metalness: 0 })));
    this.rope.frustumCulled = false; // (its shape changes every frame)
    this.pullGroup.add(this.rope);
    for (const team of ['yellow', 'purple'] as TeamId[]) {
      byTeam[team].forEach((style, slot) => {
        const puller = this.makePuller(style, team, slot);
        this.pullGroup.add(puller.root);
        this.pullers.push(puller);
      });
    }
  }

  /** One puller: legs, a body in the team color, a head with a hat in the player's own color, and two arms out to the rope. */
  private makePuller(style: PullerStyle, team: TeamId, slot: number): Puller {
    const side = team === 'yellow' ? -1 : 1; // yellow stands on the left
    const root = new Group();
    root.position.set(side * (FIRST_AT + slot * SPACING), 0, 0); // (in single file, all on the line of the rope)
    root.rotation.y = side === -1 ? 0 : Math.PI; // (the front, +x, faces the other team)
    const teamMat = this.material(TEAM_COLORS[team]), dark = this.material('#2c2c3a'), skin = this.material(SKIN), hat = this.material(style.color);
    const leg = (z: number, rot: number) => { const g = new Group(); g.position.set(0, HIP_Y, z); g.rotation.z = rot; const m = new Mesh(this.track(new CylinderGeometry(0.13, 0.12, HIP_Y, 6)), dark); m.position.y = -HIP_Y / 2; const boot = new Mesh(this.track(new SphereGeometry(0.15, 6, 5)), hat); boot.scale.set(1.3, 0.7, 1); boot.position.set(0.05, -HIP_Y + 0.02, 0); g.add(m, boot); return g; }; // (boots in the player's colour)
    const legL = leg(-0.17, 0.35), legR = leg(0.17, -0.3); // (a braced stance: one foot forward, one back)
    const upper = new Group(); upper.position.set(0, HIP_Y, 0);
    // The body (torso, head, cap) leans away from the camera and sits a little behind the line of the hands, to leave room for the rope on the camera's side; the arms stay where the rope is.
    const away = team === 'yellow' ? -1 : 1; // (the purple team is turned round, so away from the camera is the other way in their own space)
    const body = new Group(); body.position.z = away * 0.2; body.rotation.x = away * 0.12;
    const torso = new Mesh(this.track(new CylinderGeometry(0.3, 0.34, 0.85, 8)), teamMat); torso.position.y = 0.45;
    const head = new Mesh(this.track(new SphereGeometry(0.28, 8, 6)), skin); head.position.y = 1.2;
    const belt = new Mesh(this.track(new CylinderGeometry(0.36, 0.36, 0.1, 8)), hat); belt.position.y = 0.08; // (a belt in the player's colour)
    const cap = new Mesh(this.track(new SphereGeometry(0.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)), hat); cap.position.y = 1.3;
    const brim = new Mesh(this.track(new CylinderGeometry(0.33, 0.33, 0.04, 10)), hat); brim.position.set(0.06, 1.3, 0);
    const eyeGeo = this.track(new SphereGeometry(0.045, 5, 5)), eyeMat = this.track(new MeshBasicMaterial({ color: '#1a1a2a' }));
    for (const z of [-0.1, 0.1]) { const e = new Mesh(eyeGeo, eyeMat); e.position.set(0.26, 1.22, z); body.add(e); }
    const hands: Mesh[] = [];
    // Each arm starts at its shoulder (out to the side of the body) and is turned IN so that the hand meets the rope, which runs along the middle in front of the body (`rotation.y`, see the frame loop).
    const arm = (z: number) => { const g = new Group(); g.position.set(0, 0.8, z); const m = new Mesh(this.track(new CylinderGeometry(0.1, 0.08, 0.72, 6)), teamMat); m.position.y = -0.36; const hand = new Mesh(this.track(new SphereGeometry(0.11, 6, 5)), skin); hand.position.y = -0.76; g.add(m, hand); hands.push(hand); return g; };
    const armL = arm(-0.34), armR = arm(0.34);
    body.add(torso, head, cap, brim, belt);
    // Joints, so nothing floats: a shoulder bar across to both arms, and a hip bar across to both legs.
    const shoulders = new Mesh(this.track(new CylinderGeometry(0.1, 0.1, 0.78, 8)), teamMat); shoulders.rotation.x = Math.PI / 2; shoulders.position.y = 0.8; upper.add(shoulders);
    const hips = new Mesh(this.track(new CylinderGeometry(0.14, 0.14, 0.54, 8)), dark); hips.rotation.x = Math.PI / 2; hips.position.y = HIP_Y; root.add(hips);
    upper.add(body, armL, armR);
    root.add(legL, legR, upper);
    // The name floats above, as in the other games; your own gets a little arrow too.
    const tag = createNameTag(style.name + (style.id === this.selfId ? ' (you)' : ''), TEAM_COLORS[team]);
    tag.scale.set(2.3, 0.575, 1); tag.position.set(0, 2.85 + (slot % 2) * 0.55, 0); // (every other name a little higher, so neighbours do not overlap)
    root.add(tag);
    let you: Mesh | null = null;
    if (style.id === this.selfId) {
      you = new Mesh(this.track(new ConeGeometry(0.2, 0.4, 4)), this.track(new MeshBasicMaterial({ color: '#ffffff' })));
      you.rotation.x = Math.PI; you.position.set(0, 2.5, 0);
      root.add(you);
    }
    return { id: style.id, team, slot, root, upper, armL, armR, legL, legR, hands, fallNow: 0, baseX: root.position.x, tag, you, taps: 0, pulse: 0, phase: Math.random() * 6, fallDelay: slot * 0.1 + Math.random() * 0.05 };
  }

  // ---------- per frame ----------

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.aspect = w / h;
    this.renderer.setSize(w, h);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Where the camera stands: far enough back to show the whole rope at its furthest slide on this screen's shape, nearer at the strain, and pulled right out for the winner moment. */
  private placeCamera(push: number, dt: number) {
    const halfW = this.ropeHalf + MAX_SHIFT + 2.2; // how much of the width must always be in view
    const fov = (this.camera.fov * Math.PI) / 180;
    const base = clamp(halfW / (Math.tan(fov / 2) * this.aspect), 13, 70);
    const intro = smooth(this.introFactor());
    this.viewT += ((this.winnerView ? 1 : 0) - this.viewT) * (1 - Math.exp(-2.4 * dt));
    const dist = base * lerp(1.55, 1, intro) * lerp(1, 1.5, smooth(this.viewT)) * (1 - 0.09 * push);
    const height = lerp(dist * 0.55, dist * 0.17, intro) * lerp(1, 1.35, smooth(this.viewT));
    this.camera.position.set(this.camFollow, 1.3 + height, dist);
    this.camera.lookAt(new Vector3(this.camFollow, 1.45 + this.viewT * 0.6, 0));
  }

  /**
   * Shapes the rope for this frame. Between the two outermost hands it is held at `hold` (hand height) with some slack (a gentle curve down in the middle that shrinks as `tension` goes up) and a ripple that
   * runs along it when people heave. Beyond each outermost hand the rope is NOT held: it falls away (a steeper and steeper drop, as if by gravity) to the ground and then lies there, curling a little and
   * swaying. The tube is rebuilt round that centre line (a ring of points at each step).
   */
  private updateRope(seconds: number, hold: number, tension: number, heave: number, anchors: Vector3[], w: number) {
    const held = anchors.length >= 2 && w > 0;
    const left = this.ropeHold.left, right = this.ropeHold.right; // (the rope keeps one length all the time)
    const N = ROPE_SEGMENTS, total = left + right + 2 * ROPE_TAIL, startX = -left - ROPE_TAIL, seg = total / N;
    const sag = 0.28 * (1 - tension) + 0.03;
    const pos = this.ropeGeometry.getAttribute('position') as Float32BufferAttribute, nor = this.ropeGeometry.getAttribute('normal') as Float32BufferAttribute;
    // Where the rope is held by the hands: straight lines between the hands, with a little slack between each pair (more when it is loose), and the height and depth of the hands themselves.
    const handLine = (x: number): [number, number] => {
      if (x <= anchors[0].x) return [anchors[0].y, anchors[0].z];
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1], c = anchors[i];
        if (x <= c.x) {
          const u = (x - a.x) / Math.max(1e-4, c.x - a.x), h = (c.x - a.x) / 2;
          const slack = sag * 0.5 * Math.min(1, h / 1.4) * (1 - Math.pow(2 * u - 1, 2));
          return [lerp(a.y, c.y, u) - slack, lerp(a.z, c.z, u)];
        }
      }
      const last = anchors[anchors.length - 1];
      return [last.y, last.z];
    };
    const GY = ROPE_RADIUS + 0.07; // (the rope lying on the grass)
    // The shape of the part the hands hold.
    const heldShape = (x: number): [number, number] => {
      const half = (left + right) / 2, middle = (right - left) / 2;
      const k = Math.max(0, 1 - Math.pow((x - middle) / half, 2));
      const free = hold - sag * k + Math.sin(x * 2.4 - seconds * 13) * 0.035 * heave * k;
      if (!held) return [free, 0];
      const [hy, hz] = handLine(x);
      return [lerp(free, hy + Math.sin(x * 2.4 - seconds * 13) * 0.03 * heave * k, w), hz * w];
    };
    let sim = this.ropeSim;
    if (!sim || sim.x.length !== N + 1) {
      const m = N + 1; sim = this.ropeSim = { x: new Float32Array(m), y: new Float32Array(m), z: new Float32Array(m), ox: new Float32Array(m), oy: new Float32Array(m), oz: new Float32Array(m) };
      for (let i = 0; i < m; i++) {
        const x = startX + seg * i, d = x < -left ? -left - x : x > right ? x - right : 0, u = Math.min(1, d / ROPE_TAIL);
        const [y, z] = d > 0 ? [Math.max(0.5, hold - 0.5 * u * u), 0] : heldShape(x);
        sim.x[i] = sim.ox[i] = x; sim.y[i] = sim.oy[i] = y; sim.z[i] = sim.oz[i] = z;
      }
    }
    // Which points are in a hand's grip right now: the ones between the outermost hands still holding (a loser who has let go no longer holds).
    const pinLo = held && w > 0.02 ? anchors[0].x : Infinity, pinHi = held && w > 0.02 ? anchors[anchors.length - 1].x : -Infinity;
    const pinned = (i: number) => { const x = startX + seg * i; return x >= pinLo && x <= pinHi; };
    const steps = 2, h = Math.min(0.05, this.ropeDt) / steps;
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i <= N; i++) { // (verlet: carry on moving the way it was, plus gravity, a little air drag)
        if (pinned(i)) { const x = startX + seg * i; const [y, z] = heldShape(x); sim.ox[i] = sim.x[i]; sim.oy[i] = sim.y[i]; sim.oz[i] = sim.z[i]; sim.x[i] = x; sim.y[i] = y; sim.z[i] = z; continue; }
        const vx = (sim.x[i] - sim.ox[i]) * 0.985, vy = (sim.y[i] - sim.oy[i]) * 0.985, vz = (sim.z[i] - sim.oz[i]) * 0.985;
        sim.ox[i] = sim.x[i]; sim.oy[i] = sim.y[i]; sim.oz[i] = sim.z[i];
        sim.x[i] += vx; sim.y[i] += vy - 9.8 * h * h; sim.z[i] += vz;
        if (sim.y[i] <= GY) { sim.y[i] = GY; sim.ox[i] = sim.x[i] - (sim.x[i] - sim.ox[i]) * 0.6; sim.oz[i] = sim.z[i] - (sim.z[i] - sim.oz[i]) * 0.6; } // (on the ground it scrubs along and stops)
      }
      for (let it = 0; it < 24; it++) { // keep every piece the same length (the rope does not stretch)
        for (let i = 0; i < N; i++) {
          const dx = sim.x[i + 1] - sim.x[i], dy = sim.y[i + 1] - sim.y[i], dz = sim.z[i + 1] - sim.z[i], len = Math.hypot(dx, dy, dz) || 1e-6, diff = (len - seg) / len;
          const pa = pinned(i), pb = pinned(i + 1);
          if (pa && pb) continue;
          const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
          sim.x[i] += dx * diff * wa; sim.y[i] += dy * diff * wa; sim.z[i] += dz * diff * wa;
          sim.x[i + 1] -= dx * diff * wb; sim.y[i + 1] -= dy * diff * wb; sim.z[i + 1] -= dz * diff * wb;
        }
        for (let i = 0; i <= N; i++) if (!pinned(i) && sim.y[i] < GY) sim.y[i] = GY;
      }
    }
    const p = new Vector3(), q = new Vector3(), t = new Vector3(), n = new Vector3(), b = new Vector3();
    for (let i = 0; i <= N; i++) {
      const i0 = Math.max(0, i - 2), i2 = Math.min(N, i + 2); // (the direction is taken over a few points, so the tube bends smoothly)
      p.set(sim.x[i], sim.y[i], sim.z[i]); q.set(sim.x[i2] - sim.x[i0], sim.y[i2] - sim.y[i0], sim.z[i2] - sim.z[i0]).normalize(); t.copy(q);
      n.set(t.y, -t.x, 0); if (n.lengthSq() < 1e-6) n.set(0, 1, 0); n.normalize();
      b.crossVectors(t, n).normalize();
      for (let j = 0; j <= ROPE_SIDES; j++) {
        const a = (j / ROPE_SIDES) * Math.PI * 2, cx = Math.cos(a), sx = Math.sin(a);
        const nx = n.x * cx + b.x * sx, ny = n.y * cx + b.y * sx, nz = n.z * cx + b.z * sx;
        const idx = i * (ROPE_SIDES + 1) + j;
        pos.setXYZ(idx, p.x + nx * ROPE_RADIUS, p.y + ny * ROPE_RADIUS, p.z + nz * ROPE_RADIUS);
        nor.setXYZ(idx, nx, ny, nz);
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }

  private frame = (time: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    if (this.disposed) return;
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const seconds = time / 1000;
    this.balance += (this.targetBalance - this.balance) * (1 - Math.exp(-4 * dt));
    const fin = this.finish;
    const t = fin ? (this.serverNow() - fin.endsAt) / 1000 : -1; // seconds since the round ended (the closing sequence), or -1 while it is on

    // The rope's slide: towards the team that is ahead (yellow is on the left, so a yellow lead moves it left). In the closing sequence the winners' massive pull adds to it.
    let shift = -this.balance * MAX_SHIFT;
    let ropeY = ROPE_Y, tremble = 0, push = 0, extra = 0; // (extra: the sideways slide of the massive pull)
    const winner = fin?.winner ?? null;
    const dir = winner === 'yellow' ? -1 : winner === 'purple' ? 1 : 0;
    if (fin && t >= 0) {
      const strain = smooth(t / STRAIN);
      push = strain * (winner ? 1 : 0.4);
      if (t < STRAIN) tremble = strain;
      if (winner && t >= STRAIN) { extra = dir * 5.5 * easeOutBack((t - STRAIN) / PULL); shift += extra; }
      if (t >= STRAIN + PULL) ropeY = lerp(ROPE_Y, 0.14, smooth((t - STRAIN - PULL) / 0.7)); // the rope is let go and drops
    }
    this.pullGroup.position.x = shift + (tremble > 0 ? Math.sin(seconds * 60) * 0.035 * tremble : 0);

    // The pullers.
    for (const p of this.pullers) {
      p.pulse = Math.max(0, p.pulse - dt * 5);
      const mine = p.team === 'yellow' ? this.balance : -this.balance; // how far ahead THIS team is, -1..1
      let lean = 0.16 + 0.34 * Math.max(0, mine) - 0.2 * Math.max(0, -mine) + 0.14 * p.pulse + 0.025 * Math.sin(seconds * 3 + p.phase);
      let arm = Math.PI / 2 - 0.45; // the arms reach out to the rope
      let jump = 0, fall = 0, flyX = 0, flyY = 0;
      if (fin && t >= 0) {
        const won = winner === p.team, lost = winner !== null && !won;
        if (winner === null) { // a draw: both teams strain and then just let go and stand, panting
          lean = t < STRAIN ? lerp(lean, 0.3, smooth(t / STRAIN)) : lerp(0.3, 0.02, smooth((t - STRAIN) / 0.8));
          arm = t < STRAIN + 0.6 ? arm : lerp(arm, 0.2, smooth((t - STRAIN - 0.6) / 0.6));
        } else if (t < STRAIN) { // anticipation: the winners dig in and lean right back, the losers hold on, trembling
          const k = smooth(t / STRAIN);
          lean = won ? lerp(lean, 0.62, k) : lerp(lean, 0.05, k);
          lean += Math.sin(seconds * 48 + p.phase) * 0.018 * k;
        } else if (t < STRAIN + PULL) { // THE PULL: the winners heave back hard, the losers are dragged forward off balance
          const u = easeOutBack((t - STRAIN) / PULL);
          lean = won ? lerp(0.62, 0.95, u) : lerp(0.05, -0.5, u);
        } else { // the aftermath
          const u = (t - STRAIN - PULL);
          if (won) { // standing tall, arms up, cheering and jumping
            const up = smooth(u / 0.5);
            lean = lerp(0.95, 0, up);
            arm = lerp(arm, Math.PI + 0.25, up);
            jump = up * Math.abs(Math.sin(seconds * 6 + p.phase)) * 0.3;
          }
        }
      }
      // THE LOSING TEAM IS YANKED OFF THEIR FEET: at the massive pull each loser is thrown, all together, in the direction they were pulled (towards the winners), flying low across the grass with
      // their bodies turning face down, and lands lying on the ground (their body rests ON the grass, not in it). The staggering is tiny so they go together.
      if (fin && t >= STRAIN && winner !== null && winner !== p.team) {
        const FLY = PULL + 0.65, uF = clamp((t - STRAIN - p.fallDelay * 0.15) / FLY, 0, 1);
        const flight = 1.35; // how far each is thrown (the same for all, so they keep their spacing; the body lying face down reaches about 1.6 further, so they land short of the winners)
        flyX = dir * flight * (1 - Math.pow(1 - uF, 2.2)); // fast at first, then skidding to a stop
        const lying = 0.42; // the height of the body's middle when it lies face down: it is about 0.34 thick, so it rests on the grass
        flyY = lying * smooth(Math.min(1, uF * 2.5)) + (0.9 + 0.3 * (p.slot % 2)) * 4 * uF * (1 - uF); // (a low arc: up and down again)
        fall = smooth(Math.min(1, uF * 1.7));
        lean = lerp(-0.5, -0.2, fall);
        arm = lerp(Math.PI / 2 - 0.45, Math.PI - 0.2, smooth(Math.min(1, uF * 2))); // arms flung up
      }
      p.upper.rotation.z = lean;
      p.armL.rotation.z = arm - lean * 0.5; p.armR.rotation.z = arm - lean * 0.5;
      // The rope runs on the camera's side of the line (+z), outside the bodies, so it is always seen. The arm on that side reaches straight out; the far arm reaches across to it.
      const across = arm < 2 ? 0.95 : 0; // (raised arms (cheering, falling) do not reach)
      const nearIsR = p.team === 'yellow'; // (the purple team is turned round, so their near arm is the other one)
      p.armL.rotation.y = nearIsR ? -across : 0; p.armR.rotation.y = nearIsR ? 0 : across;
      p.fallNow = fall;
      p.legL.rotation.z = 0.35 + 0.2 * lean; p.legR.rotation.z = -0.3 - 0.1 * lean;
      // Falling: the whole puller tips forward (towards the rope and the winners), pivoting at the feet, and lies face down.
      p.root.rotation.z = -fall * (Math.PI / 2 + 0.04);
      p.root.position.y = jump + flyY;
      p.root.position.x = p.baseX + flyX;
      p.root.position.z = ((p.slot % 2) - 0.5) * 0.9 * fall; // (they land alternately a little in front of and behind the line, so those lying down do not lie on top of each other)
      if (fall > 0 && fall < 1 && fall + dt * 3 >= 1 && t < STRAIN + PULL + FALL + 1) audio.playFlat(giftMiss, 0.4); // (a thump as they land)
      if (p.you) p.you.position.y = 2.5 + Math.sin(seconds * 4) * 0.1;
    }

    // The rope: held at hand height between the two outermost hands (a little slack, which tightens as the pulling gets harder and in the strain), the ends hanging down past them and lying on the ground.
    let heave = 0;
    for (const p of this.pullers) heave += p.pulse;
    heave = Math.min(1, heave / Math.max(2, this.pullers.length * 0.5));
    const tension = clamp(0.45 + 0.4 * Math.abs(this.balance) + 0.4 * heave + (fin && t >= 0 && t < STRAIN + PULL ? 0.6 : 0), 0, 1);
    // The rope is drawn through the pullers' hands (each puller's two hands, averaged) while it is held; once the winners let go (after the massive pull) it is no longer tied to them.
    this.pullGroup.updateMatrixWorld(true);
    const holdW = fin && t >= STRAIN + PULL ? 1 - smooth((t - STRAIN - PULL) / 0.3) : 1;
    const anchors: Vector3[] = [];
    if (holdW > 0) {
      const a = new Vector3(), b = new Vector3();
      for (const p of this.pullers) {
        if (p.fallNow > 0.02) continue;
        p.hands[0].getWorldPosition(a); p.hands[1].getWorldPosition(b);
        const nearZ = Math.max(a.z, b.z); a.z = nearZ; b.z = nearZ; // (the rope passes the near hand, on the camera's side)
        anchors.push(this.pullGroup.worldToLocal(a.clone().add(b).multiplyScalar(0.5))); // (a new point each time: worldToLocal changes the vector it is given)
      }
      anchors.sort((m, n) => m.x - n.x);
    }
    this.ropeDt = dt;
    this.sweat.update(dt);
    this.updateRope(seconds, ropeY, tension, heave, anchors, holdW);

    this.camFollow += (extra * 0.55 - this.camFollow) * (1 - Math.exp(-6 * dt)); // (the camera slides along a little with the massive pull, so the winners stay in view)
    this.placeCamera(push, dt);
    this.renderer.render(this.scene, this.camera);
  };
}

/** Mown stripes of grass: a tileable canvas. */
function makeGrassTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6aa84f'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#5f9a47'; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,40,0'},0.05)`; g.fillRect((i * 53) % 128, (i * 29) % 128, 2, 5); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The rope's surface: strands that SPIRAL round it. A tileable canvas: three strands, each a rounded light band with a dark groove between, slanting across the texture so that when it is wrapped
 * round the tube (and repeated along it) they twist like a laid rope, with a little fibre texture over them.
 */
function makeRopeTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const STRANDS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = ((STRANDS * y - x) / size) % 1, phase = f < 0 ? f + 1 : f; // 0..1 across a strand and its groove (slanted: it depends on both x and y, and tiles because it changes by whole numbers over the tile)
      const strand = 0.72; // the part of each period that is the strand (the rest is the groove)
      let shade: number;
      if (phase < strand) { const t = phase / strand; shade = 0.78 + 0.3 * Math.sin(Math.PI * t); } else shade = 0.42; // rounded highlight on the strand, a dark groove between
      const fibre = 0.9 + 0.1 * Math.sin((x * 7 + y * 3) * 0.9) * Math.sin(y * 1.7); // a little roughness
      const i = (y * size + x) * 4, k = shade * fibre;
      img.data[i] = Math.min(255, 222 * k); img.data[i + 1] = Math.min(255, 186 * k); img.data[i + 2] = Math.min(255, 126 * k); img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
