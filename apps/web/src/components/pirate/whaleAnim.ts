import { Vector3 } from 'three';
import { whalePointWorld, type WhalePose } from '@fgn/shared';

/** The whale's animation lives in the shared package (the server needs it for the schedule and the blocking); this re-exports it for the pictures. */
export {
  WHALE_TUNING as DEFAULT_TUNING, WHALE_LENGTH, breachEvents, durationOf, lerp, shakeAt, whalePose,
  type BreachEvents, type WhaleKind, type WhalePose, type WhaleTuning,
} from '@fgn/shared';

/** Where a point of the whale's body (local: +z nose, +y up) is in the world. */
export function whaleToWorld(p: WhalePose, local: Vector3, out = new Vector3()): Vector3 {
  const w = whalePointWorld(p, [local.x, local.y, local.z]);
  return out.set(w[0], w[1], w[2]);
}
