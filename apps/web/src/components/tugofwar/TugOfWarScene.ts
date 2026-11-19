import {
  AmbientLight, BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, Sprite, TorusGeometry, Vector3, WebGLRenderer,
} from 'three';
import { TEAM_COLORS, type TeamId, type TugOfWarView, TUG_FALL_SECONDS, TUG_PULL_SECONDS, TUG_STRAIN_SECONDS } from '@fgn/shared';
import { audio } from '../../audio/spatialAudio';
import { typewriterClick } from '../../audio/clickSounds';
import { giftMiss } from '../../audio/santaSounds';
import { createRoundClock } from '../../audio/roundClock';
import { createNameTag, disposeNameTag } from '../labelTexture';

/** One player on the rope: their name, their own color (shown on the hat) and which team they pull for. */
export interface PullerStyle { id: string; name: string; color: string }

// ---------- the setting and the numbers (world units: a puller is about 2.1 tall) ----------
const SPACING = 1.45; // how far apart the pullers on a team stand along the rope
const FIRST_AT = 1.9; // the nearest puller of each team stands this far from the middle (before any pulling)
const MAX_SHIFT = 4.2; // how far the whole tug slides when one team is far ahead
const ROPE_Y = 1.3;
const HIP_Y = 0.8;
const STRAIN = TUG_STRAIN_SECONDS, PULL = TUG_PULL_SECONDS, FALL = TUG_FALL_SECONDS;
const SKIN = '#f1c9a5';

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
  private rope!: Mesh;
  private marker!: Mesh; // the red cloth in the middle of the rope
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
      if (n > p.taps) { p.pulse = 1; if (p.id === this.selfId) audio.playFlat(typewriterClick, 0.5, 1); }
      p.taps = n;
    }
  }

  /** Your own tap, shown the instant you press (the server's count follows). */
  tapped() {
    const me = this.pullers.find((p) => p.id === this.selfId);
    if (me) me.pulse = 1;
  }

  setSecondsLeft(secondsLeft: number) { this.clock.update(secondsLeft); }

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
    // The lines on the ground: a white one in the middle, and a line each way where a team has won the tug: the rope's cloth crossing it shows how far it has gone.
    const line = (x: number, color: string, wide: number) => { const m = new Mesh(this.track(new PlaneGeometry(wide, 4.2)), this.track(new MeshBasicMaterial({ color }))); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, 0); this.scene.add(m); };
    line(0, '#ffffff', 0.22);
    line(-MAX_SHIFT, TEAM_COLORS.yellow, 0.16);
    line(MAX_SHIFT, TEAM_COLORS.purple, 0.16);
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
    // The rope: one long cylinder, a lighter twist over it, and a red cloth tied in the middle.
    const ropeMaterial = this.material('#c9a66b', { flatShading: false });
    this.rope = new Mesh(this.track(new CylinderGeometry(0.095, 0.095, this.ropeHalf * 2, 10)), ropeMaterial);
    this.rope.rotation.z = Math.PI / 2;
    this.rope.position.y = ROPE_Y;
    this.marker = new Mesh(this.track(new BoxGeometry(0.28, 0.6, 0.1)), this.material('#e53935'));
    this.marker.position.set(0, ROPE_Y - 0.35, 0);
    this.pullGroup.add(this.rope, this.marker);
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
    root.position.set(side * (FIRST_AT + slot * SPACING), 0, ((slot % 2) - 0.5) * 0.35); // (alternate a little in and out so they do not hide each other)
    root.rotation.y = side === -1 ? 0 : Math.PI; // (the front, +x, faces the other team)
    const teamMat = this.material(TEAM_COLORS[team]), dark = this.material('#2c2c3a'), skin = this.material(SKIN), hat = this.material(style.color);
    const leg = (z: number, rot: number) => { const g = new Group(); g.position.set(0, HIP_Y, z); g.rotation.z = rot; const m = new Mesh(this.track(new CylinderGeometry(0.13, 0.12, HIP_Y, 8)), dark); m.position.y = -HIP_Y / 2; g.add(m); return g; };
    const legL = leg(-0.17, 0.35), legR = leg(0.17, -0.3); // (a braced stance: one foot forward, one back)
    const upper = new Group(); upper.position.set(0, HIP_Y, 0);
    const torso = new Mesh(this.track(new CylinderGeometry(0.3, 0.34, 0.85, 10)), teamMat); torso.position.y = 0.45;
    const head = new Mesh(this.track(new SphereGeometry(0.27, 12, 10)), skin); head.position.y = 1.2;
    const cap = new Mesh(this.track(new SphereGeometry(0.29, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), hat); cap.position.y = 1.25;
    const brim = new Mesh(this.track(new TorusGeometry(0.28, 0.04, 6, 16)), hat); brim.rotation.x = Math.PI / 2; brim.position.y = 1.24;
    const eyeGeo = this.track(new SphereGeometry(0.045, 6, 6)), eyeMat = this.track(new MeshBasicMaterial({ color: '#1a1a2a' }));
    for (const z of [-0.1, 0.1]) { const e = new Mesh(eyeGeo, eyeMat); e.position.set(0.25, 1.22, z); upper.add(e); }
    const arm = (z: number) => { const g = new Group(); g.position.set(0, 0.8, z); const m = new Mesh(this.track(new CylinderGeometry(0.09, 0.08, 0.72, 8)), teamMat); m.position.y = -0.36; const hand = new Mesh(this.track(new SphereGeometry(0.1, 8, 6)), skin); hand.position.y = -0.74; g.add(m, hand); return g; };
    const armL = arm(-0.36), armR = arm(0.36);
    upper.add(torso, head, cap, brim, armL, armR);
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
    return { id: style.id, team, slot, root, upper, armL, armR, legL, legR, tag, you, taps: 0, pulse: 0, phase: Math.random() * 6, fallDelay: slot * 0.1 + Math.random() * 0.05 };
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
    this.rope.position.y = ropeY;
    this.marker.position.y = ropeY - 0.35;

    // The pullers.
    for (const p of this.pullers) {
      p.pulse = Math.max(0, p.pulse - dt * 5);
      const mine = p.team === 'yellow' ? this.balance : -this.balance; // how far ahead THIS team is, -1..1
      let lean = 0.16 + 0.34 * Math.max(0, mine) - 0.2 * Math.max(0, -mine) + 0.14 * p.pulse + 0.025 * Math.sin(seconds * 3 + p.phase);
      let arm = Math.PI / 2 - 0.45; // the arms reach out to the rope
      let jump = 0, fall = 0;
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
          } else if (lost) { // falling forward onto the grass, one after another, arms flung up
            const f = smooth((u - p.fallDelay) / (FALL * 0.55));
            fall = f;
            lean = lerp(-0.5, -0.3, f);
            arm = lerp(arm, Math.PI - 0.2, f);
          }
        }
      }
      p.upper.rotation.z = lean;
      p.armL.rotation.z = arm - lean * 0.5; p.armR.rotation.z = arm - lean * 0.5;
      p.legL.rotation.z = 0.35 + 0.2 * lean; p.legR.rotation.z = -0.3 - 0.1 * lean;
      // Falling: the whole puller tips forward (towards the rope and the winners), pivoting at the feet, and lies face down.
      p.root.rotation.z = -fall * (Math.PI / 2 + 0.04);
      p.root.position.y = jump + (fall > 0 ? 0.28 * fall : 0);
      if (fall > 0 && fall < 1 && fall + dt * 3 >= 1 && t < STRAIN + PULL + FALL + 1) audio.playFlat(giftMiss, 0.4); // (a thump as they land)
      if (p.you) p.you.position.y = 2.5 + Math.sin(seconds * 4) * 0.1;
    }

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
