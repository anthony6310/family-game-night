/**
 * The SHAPE of a bag in Santa's Sack, as the physics sees it (the server judges every gift with these, and the phones draw the same volumes in the debug view).
 * A bag is a sack that leans OUTWARD from the middle of its circular route, so its mouth faces away from the middle. Its axis runs from its base up through the middle of its mouth.
 * All sizes are in "mouths": multiply by the bag's mouth radius `r`.
 * A bag is OPEN or CINCHED SHUT (like a drawstring bag pulled tight): shut, its scoring zone is off and its neck is only a narrow gathered tip, so gifts bounce off the belly and the tip.
 *
 *   SCORING zone (the blue one): a cylinder along the axis, from just above the mouth down about halfway into the sack. A gift whose middle is in it has gone in.
 *   OUTER zone (the green one): what a gift physically bounces off. A cylinder for the neck round the mouth, and a round ball for the belly of the sack.
 *   The scoring zone is built to lie entirely INSIDE the outer zone (it never peeks out of it): its top is level with the top of the neck, and it is narrower than the neck.
 */
export const BAG_TILT = 0.75; // how far a bag leans out from upright (radians)
export const BAG_MOUTH_HEIGHT = 2.3; // the middle of its mouth is this high up the axis
export const BAG_SCORE_RADIUS = 0.85;
export const BAG_SCORE_DEPTH = 1.3; // the scoring cylinder reaches this far down the axis from the mouth
export const BAG_NECK_RADIUS = 1.1;
export const BAG_NECK_DEPTH = 0.7; // the neck cylinder reaches this far down from the mouth
export const BAG_TOP_EXTRA = 0.2; // both cylinders reach this far above the mouth (the same for both, so the scoring one never pokes out)
export const BAG_BELLY_CENTER = 0.95; // the ball for the belly is centered this far up the axis...
export const BAG_BELLY_RADIUS = 1.35; // ...and is this big
export const BAG_SHUT_NECK_RADIUS = 0.4; // cinched shut, the neck is gathered into a tip this wide...
export const BAG_SHUT_TOP_EXTRA = 0.55; // ...and the gathered tip reaches this far above where the mouth was

export interface Point3 { x: number; y: number; z: number }

/** Where one bag is in space at one moment: its mouth radius, where its base is, and which way its axis points (a unit vector, up and outward). */
export interface BagFrame { r: number; base: Point3; u: Point3 }

/** The frame of a bag whose mouth is over the floor spot (mouthX, mouthZ) (the spot on its route); it leans away from the middle of the route, (0, 0). */
export function bagFrame(mouthX: number, mouthZ: number, r: number): BagFrame {
  const len = Math.hypot(mouthX, mouthZ) || 1;
  const ox = mouthX / len, oz = mouthZ / len;
  const sin = Math.sin(BAG_TILT), cos = Math.cos(BAG_TILT);
  const lean = r * BAG_MOUTH_HEIGHT * sin;
  return { r, base: { x: mouthX - ox * lean, y: 0, z: mouthZ - oz * lean }, u: { x: sin * ox, y: cos, z: sin * oz } };
}

/** The middle of a bag's mouth in space. */
export function mouthCentre(f: BagFrame): Point3 {
  const s = f.r * BAG_MOUTH_HEIGHT;
  return { x: f.base.x + f.u.x * s, y: f.base.y + f.u.y * s, z: f.base.z + f.u.z * s };
}

/** A point in the bag's own terms: how far up the axis it is (s) and how far from the axis (rho, with the sideways vector). */
export function toAxis(f: BagFrame, p: Point3) {
  const dx = p.x - f.base.x, dy = p.y - f.base.y, dz = p.z - f.base.z;
  const s = dx * f.u.x + dy * f.u.y + dz * f.u.z;
  const rx = dx - f.u.x * s, ry = dy - f.u.y * s, rz = dz - f.u.z * s;
  return { s, rho: Math.hypot(rx, ry, rz), radial: { x: rx, y: ry, z: rz } };
}

export function inScoringZone(f: BagFrame, p: Point3): boolean {
  const { s, rho } = toAxis(f, p);
  const mouth = BAG_MOUTH_HEIGHT * f.r;
  return rho <= BAG_SCORE_RADIUS * f.r && s >= mouth - BAG_SCORE_DEPTH * f.r && s <= mouth + BAG_TOP_EXTRA * f.r;
}

/** If a point is inside the outer zone: the way to push it back out (a unit vector); otherwise null. (The scoring zone is checked first by the caller.) */
export function outerZoneNormal(f: BagFrame, p: Point3, shut = false): Point3 | null {
  const { s, rho, radial } = toAxis(f, p);
  const mouth = BAG_MOUTH_HEIGHT * f.r;
  const neckRadius = shut ? BAG_SHUT_NECK_RADIUS : BAG_NECK_RADIUS, neckTop = shut ? BAG_SHUT_TOP_EXTRA : BAG_TOP_EXTRA;
  if (rho <= neckRadius * f.r && s >= mouth - BAG_NECK_DEPTH * f.r && s <= mouth + neckTop * f.r) { // the neck (cinched shut: a narrow tip)
    const rl = rho || 1;
    if (shut || rho > 0.97 * f.r || s < mouth) return { x: radial.x / rl, y: radial.y / rl, z: radial.z / rl }; // the side of the neck (or the rim): pushed sideways
    return { ...f.u }; // the top: pushed up the axis
  }
  const cx = f.base.x + f.u.x * BAG_BELLY_CENTER * f.r, cy = f.base.y + f.u.y * BAG_BELLY_CENTER * f.r, cz = f.base.z + f.u.z * BAG_BELLY_CENTER * f.r;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d = Math.hypot(dx, dy, dz);
  if (d <= BAG_BELLY_RADIUS * f.r) { const k = d || 1; return { x: dx / k, y: dy / k, z: dz / k }; } // the belly
  return null;
}

export function inOuterZone(f: BagFrame, p: Point3, shut = false): boolean { return outerZoneNormal(f, p, shut) !== null; }
