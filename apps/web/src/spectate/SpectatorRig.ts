import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode } from './useSpectatorCamera';

/** What a game tells the rig about the player being followed: where they are (x, z, and the ground height y) and how big they are. */
export interface FollowTarget {
  x: number;
  y: number;
  z: number;
  size: number;
}

/**
 * The camera behind every 3D spectator view, with no knowledge of any specific game. A game owns a
 * PerspectiveCamera and each frame calls `update()` with what the spectator chose:
 *   follow: the same chase view the followed player has (it steps back as their `size` grows)
 *   free:   a steeper, higher camera the spectator pans around with `pan` (a direction, -1..1 on x east / z south)
 * Switching modes or players glides: position, height and distance are all smoothed. A new 3D game only has to
 * create a rig and pass `arenaRadius` (how far the free camera may roam); it gets the same spectating for free.
 */
export class SpectatorRig {
  private focus = new Vector3(); // the point on the ground the camera looks at (smoothed)
  private free = new Vector3(); // where the free camera WANTS to look (moved by the pan input)
  private height = 20;
  private back = 20;
  private size = 1;
  private mode: CameraMode = 'follow';

  constructor(private camera: PerspectiveCamera, private arenaRadius: number) {}

  update(dt: number, mode: CameraMode, target: FollowTarget | undefined, pan: { x: number; z: number }, zoom: number) {
    const k = 1 - Math.exp(-4 * dt); // frame-rate independent smoothing
    let wantFocus: Vector3;
    let wantHeight: number;
    let wantBack: number;
    let wantSize = 0;

    if (mode === 'free') {
      // Start from wherever the camera was looking, so entering free mode doesn't jump.
      if (this.mode !== 'free') this.free.copy(this.focus);
      const speed = this.arenaRadius * 0.7; // crossing the arena takes ~1.5 s at full stick
      this.free.x += pan.x * speed * dt;
      this.free.z += pan.z * speed * dt;
      const reach = Math.hypot(this.free.x, this.free.z);
      if (reach > this.arenaRadius) this.free.multiplyScalar(this.arenaRadius / reach); // stay over the arena
      wantFocus = this.free;
      wantHeight = this.arenaRadius * 0.95 * zoom; // high and steep (about 70 degrees down) to read the whole fight
      wantBack = this.arenaRadius * 0.35 * zoom;
    } else if (target) {
      wantFocus = new Vector3(target.x, target.y, target.z);
      wantSize = target.size;
      wantHeight = (6 + 3.2 * target.size) * zoom; // the same chase view a player gets
      wantBack = (8 + 4.2 * target.size) * zoom;
    } else {
      wantFocus = new Vector3(0, 0, 0); // nobody to follow: look at the middle of the arena
      wantHeight = this.arenaRadius * 1.25 * zoom;
      wantBack = this.arenaRadius * 0.75 * zoom;
    }
    this.mode = mode;

    this.focus.lerp(wantFocus, k);
    this.height += (wantHeight - this.height) * k;
    this.back += (wantBack - this.back) * k;
    this.size += (wantSize - this.size) * k;
    this.camera.position.set(this.focus.x, this.focus.y + this.height, this.focus.z + this.back);
    this.camera.lookAt(this.focus.x, this.focus.y + MathUtils.clamp(this.size, 0, 10) * 0.4, this.focus.z);
  }
}
