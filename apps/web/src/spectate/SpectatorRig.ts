import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

/** What a game tells the rig about the player being followed: where they are (x, z, and the ground height y) and how big they are. */
export interface FollowTarget {
  x: number;
  y: number;
  z: number;
  size: number;
}

/**
 * The camera behind every 3D spectator view, with no knowledge of any specific game. A game owns a
 * PerspectiveCamera and each frame calls `update()` with the player being followed: the camera shows the same view that player has (by default a chase view that steps back
 * as their `size` grows). There is no free camera. Switching players glides: position, height and distance are all smoothed. A new 3D game only has to
 * create a rig and pass `arenaRadius` (the size of its arena: it sets the overview used before the round starts and when there is nobody to follow).
 */
/** How a game wants its "follow" camera placed: how high above the followed thing, and how far back (south) of it, for a given size. */
export type FollowView = (size: number) => { height: number; back: number };

/** Snowball's chase view: it steps back as the ball grows. It is the default. */
const CHASE_VIEW: FollowView = (size) => ({ height: 6 + 3.2 * size, back: 8 + 4.2 * size });

export class SpectatorRig {
  private focus = new Vector3(); // the point on the ground the camera looks at (smoothed)
  private height = 20;
  private back = 20;
  private size = 1;

  /** `followView` lets a game choose how its follow camera sits (Tap Race looks almost straight down at the button); the default is the Snowball chase view. */
  constructor(private camera: PerspectiveCamera, private arenaRadius: number, private followView: FollowView = CHASE_VIEW) {}

  /** The ground point the camera is looking at right now: also where a spectator's "ears" are (see audio). */
  get focusX() { return this.focus.x; }
  get focusZ() { return this.focus.z; }

  /**
   * `intro` (0..1) is the start countdown's camera move: 0 = hanging over the whole arena (everyone in view), 1 = the normal view. Between, the camera glides from the
   * overview into the player's view along an eased path (it is placed exactly, not smoothed, so it follows the countdown's clock).
   */
  update(dt: number, target: FollowTarget | undefined, zoom: number, intro = 1) {
    const k = 1 - Math.exp(-4 * dt); // frame-rate independent smoothing
    let wantFocus: Vector3;
    let wantHeight: number;
    let wantBack: number;
    let wantSize = 0;

    if (target) {
      wantFocus = new Vector3(target.x, target.y, target.z);
      wantSize = target.size;
      const view = this.followView(target.size); // the same view a player gets
      wantHeight = view.height * zoom;
      wantBack = view.back * zoom;
    } else {
      wantFocus = new Vector3(0, 0, 0); // nobody to follow: look at the middle of the arena
      wantHeight = this.arenaRadius * 1.25 * zoom;
      wantBack = this.arenaRadius * 0.75 * zoom;
    }
    if (intro < 1) {
      // The start countdown: from the overview (the middle of the arena, high above) to where the player's view wants to be.
      const t = intro;
      this.focus.set(wantFocus.x * t, wantFocus.y * t, wantFocus.z * t);
      this.height = this.arenaRadius * 1.25 * zoom + (wantHeight - this.arenaRadius * 1.25 * zoom) * t;
      this.back = this.arenaRadius * 0.75 * zoom + (wantBack - this.arenaRadius * 0.75 * zoom) * t;
      this.size = wantSize * t;
    } else {
      this.focus.lerp(wantFocus, k);
      this.height += (wantHeight - this.height) * k;
      this.back += (wantBack - this.back) * k;
      this.size += (wantSize - this.size) * k;
    }
    this.camera.position.set(this.focus.x, this.focus.y + this.height, this.focus.z + this.back);
    this.camera.lookAt(this.focus.x, this.focus.y + MathUtils.clamp(this.size, 0, 10) * 0.4, this.focus.z);
  }
}
