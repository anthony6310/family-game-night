import type { TeamId } from './teams';

/**
 * Broadside Battle: the maths the server and the phones must agree on. Two pirate ships sail side by side and face the same way (+x, the bow); the yellow ship is on
 * the north side (z negative) and the purple one on the south (z positive). The ships never really move: they sit in place and ROCK (roll, pitch, a little yaw and heave), all as
 * pure functions of the round's clock, so the server can work out a whole cannon shot, including whether it hits the rocking enemy ship, at the moment of launch, and every phone draws the
 * same ships at the same moment. A cannonball flies at a fixed speed across the water with gravity and a constant drift towards the stern (so shots must be led). Units are world units; y is up.
 */

import { WHALE_TUNING, breachEvents, whaleBlocks } from './whale';
export type V3 = [number, number, number];

// ----- the ships -----
export const SHIP_LANE = 22; // the usual distance of each ship's middle from the line between them (z = -lane for yellow, +lane for purple); the ships drift closer and further apart (see `shipPose`)
export const SHIP_HALF_LENGTH = 17;
export const SHIP_HALF_BEAM = 4.6;
export const SHIP_KEEL_Y = -2.2; // the bottom of the hull, below the waterline (y = 0)
export const DECK_Y = 3.5;
export const RAIL_Y = 4.5; // the top of the low rail along the deck's edge

/** +1 for the ship whose guns fire towards +z (yellow, the north ship), -1 for the one that fires towards -z (purple). */
export const sideOf = (team: TeamId): 1 | -1 => (team === 'yellow' ? 1 : -1);
export const enemyOf = (team: TeamId): TeamId => (team === 'yellow' ? 'purple' : 'yellow');
export const shipBase = (team: TeamId, lane: number): V3 => [0, 0, -sideOf(team) * lane];

export interface ShipPose {
  roll: number; // leaning towards one side (about the x axis), radians
  pitch: number; // bow up and down (about the z axis)
  yaw: number; // a little swing of the bow (about the y axis)
  heave: number; // the whole ship rising and falling on the swell
  lane: number; // how far the ship's middle is from the line between the two ships right now: the ships veer closer and further apart, a slow swing about every 30 seconds
}
const TAU = Math.PI * 2;
/** Each ship rocks a little differently (different phases), a mix of slow and quicker swells so it never repeats exactly. `t` is seconds on the round's clock. */
export function shipPose(team: TeamId, t: number): ShipPose {
  const o = team === 'yellow' ? 0 : 2.3;
  return {
    roll: 0.068 * Math.sin((TAU * t) / 6.9 + o) + 0.028 * Math.sin((TAU * t) / 3.9 + 1.1 + o * 0.7),
    pitch: 0.045 * Math.sin((TAU * t) / 5.3 + 0.6 + o * 1.3) + 0.02 * Math.sin((TAU * t) / 2.9 + o),
    yaw: 0.03 * Math.sin((TAU * t) / 9.4 + 2.0 + o),
    heave: 0.42 * Math.sin((TAU * t) / 4.6 + o * 0.9) + 0.18 * Math.sin((TAU * t) / 2.7 + 0.4),
    // Both ships swing apart and together together (about every 30 seconds, never exactly the same), and each also wanders a little on its own: the gap between them goes from about 20 to about 54.
    lane: SHIP_LANE + 1 + 7 * Math.sin((TAU * t) / 33) + 2.2 * Math.sin((TAU * t) / 19 + 1.3) + 1.2 * Math.sin((TAU * t) / (team === 'yellow' ? 11.3 : 13.1) + o),
  };
}

/** Turn a vector by the ship's tilt (roll first, then pitch, then yaw: the same as a three.js Euler 'YZX'). */
export function rotateByPose(p: ShipPose, v: V3): V3 {
  let [x, y, z] = v;
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  [y, z] = [y * cr - z * sr, y * sr + z * cr];
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  [x, y] = [x * cp - y * sp, x * sp + y * cp];
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return [x, y, z];
}
/** The opposite turn. */
export function unrotateByPose(p: ShipPose, v: V3): V3 {
  let [x, y, z] = v;
  const cy = Math.cos(-p.yaw), sy = Math.sin(-p.yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cp = Math.cos(-p.pitch), sp = Math.sin(-p.pitch);
  [x, y] = [x * cp - y * sp, x * sp + y * cp];
  const cr = Math.cos(-p.roll), sr = Math.sin(-p.roll);
  [y, z] = [y * cr - z * sr, y * sr + z * cr];
  return [x, y, z];
}
/** A point on a ship (in the ship's own frame: origin at its middle on the waterline, +x the bow) to the world. */
export function localToWorld(team: TeamId, pose: ShipPose, p: V3): V3 {
  const r = rotateByPose(pose, p);
  const b = shipBase(team, pose.lane);
  return [r[0] + b[0], r[1] + b[1] + pose.heave, r[2] + b[2]];
}
export function worldToLocal(team: TeamId, pose: ShipPose, p: V3): V3 {
  const b = shipBase(team, pose.lane);
  return unrotateByPose(pose, [p[0] - b[0], p[1] - b[1] - pose.heave, p[2] - b[2]]);
}

// ----- the cannons and aiming -----
export const BARREL_LENGTH = 2.4;
export const PIVOT_HEIGHT = 1.65; // the barrel pivots this far above the deck: its underside (barrel radius about 0.5) is then just above the rail (1 above the deck), so the barrel rests on the rail
/** Where player `slot` of `count` on their team stands, side by side along the rail (the ship's own frame). */
export function stationLocal(team: TeamId, slot: number, count: number): V3 {
  // The three masts stand at x = -9, 0 and 9, so the cannons stand BETWEEN them (never at a mast): 4.5 apart, centred on the middle (an odd crew is shifted half a step to one side, off the middle mast).
  const spacing = count <= 5 ? 4.5 : 3.8;
  const shift = count % 2 === 1 ? 2.25 : 0;
  const x = Math.max(-10.5, (slot - (count - 1) / 2) * spacing + shift);
  return [x, DECK_Y, sideOf(team) * 2.2]; // (inboard: the muzzle, 2.4 further out, reaches the hull's side but not past it)
}
export const AIM_YAW_MAX = 0.55; // either way from straight out of the side, towards the bow (+) or the stern (-)
export const AIM_PITCH_MIN = 0.02;
export const AIM_PITCH_MAX = 0.7;
export const AIM_YAW_RATE = 0.6; // radians a second at full stick
export const AIM_PITCH_RATE = 0.45;
export const AIM_START: { yaw: number; pitch: number } = { yaw: 0, pitch: 0.4 };
export const clampAim = (a: { yaw: number; pitch: number }) => ({
  yaw: Math.max(-AIM_YAW_MAX, Math.min(AIM_YAW_MAX, a.yaw)),
  pitch: Math.max(AIM_PITCH_MIN, Math.min(AIM_PITCH_MAX, a.pitch)),
});
/** Move the aim by a stick (x right/bow-wards, y up) for `dt` seconds: the same on the phone (at once) and wherever else it is needed. */
export function stepAim(a: { yaw: number; pitch: number }, stick: { x: number; y: number }, dt: number) {
  return clampAim({ yaw: a.yaw + stick.x * AIM_YAW_RATE * dt, pitch: a.pitch + stick.y * AIM_PITCH_RATE * dt });
}
/** Which way the barrel points, in the ship's own frame. Yaw turns towards the bow, pitch lifts it. */
export function aimDir(team: TeamId, yaw: number, pitch: number): V3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), sideOf(team) * Math.cos(yaw) * Math.cos(pitch)];
}
export function pivotLocal(team: TeamId, slot: number, count: number): V3 {
  const s = stationLocal(team, slot, count);
  return [s[0], s[1] + PIVOT_HEIGHT, s[2]];
}

// ----- the cannon's timing -----
export const WICK_MS = 1000; // press fire: the wick burns this long, then BOOM
export const RELOAD_MS = 2000; // and the cannon can be fired again this long after the shot

// ----- the shot -----
/**
 * EVERY ball travels at the same speed across the water (`BALL_SPEED_H`, its horizontal speed), whatever the angle of the barrel: the angle only decides how high the arc goes, so the ONLY thing that makes a
 * shot take longer is the distance it has to travel (about 1.5 seconds for a ball that crosses the usual gap, up to about 3 for the longest).
 */
export const BALL_SPEED_H = 22;
export const GRAVITY = 12;
/**
 * The ships are sailing towards the bow, so a ball fired straight at the other ship lands behind where the ship has got to: a steady drift towards the STERN (an acceleration on top of gravity)
 * pulls every ball astern as it flies, so shots must be led: aim ahead, towards the bow.
 */
export const SEA_DRIFT = -3.51; // (-2.6 at first, then 35% stronger)
export const BALL_RADIUS = 0.5;
export const SHOT_MAX_SECONDS = 7;

export interface ShotLaunch { p0: V3; v0: V3 }
/** Where the ball is `tau` seconds after launch. */
export function shotPoint(l: ShotLaunch, tau: number): V3 {
  return [l.p0[0] + l.v0[0] * tau + 0.5 * SEA_DRIFT * tau * tau, l.p0[1] + l.v0[1] * tau - 0.5 * GRAVITY * tau * tau, l.p0[2] + l.v0[2] * tau];
}
/** The ball leaves the muzzle of the cannon (in this aim, with the ship in this pose at this moment) in the direction the barrel points in the world. */
export function launchOf(team: TeamId, slot: number, count: number, pose: ShipPose, yaw: number, pitch: number): ShotLaunch {
  const d = aimDir(team, yaw, pitch);
  const pivot = pivotLocal(team, slot, count);
  const muzzle: V3 = [pivot[0] + d[0] * BARREL_LENGTH, pivot[1] + d[1] * BARREL_LENGTH, pivot[2] + d[2] * BARREL_LENGTH];
  const w = rotateByPose(pose, d);
  const k = BALL_SPEED_H / Math.max(0.2, Math.hypot(w[0], w[2])); // (the horizontal speed is always the same; the height of the arc follows the angle)
  return { p0: localToWorld(team, pose, muzzle), v0: [w[0] * k, w[1] * k, w[2] * k] };
}

/** The parts of a ship a ball can hit, as boxes in the ship's own frame (the hull, and a tall thin box for each mast and its sail). Every hit scores the same wherever it lands. */
export const HIT_BOXES: { min: V3; max: V3 }[] = [
  { min: [-SHIP_HALF_LENGTH, SHIP_KEEL_Y, -SHIP_HALF_BEAM], max: [SHIP_HALF_LENGTH, RAIL_Y, SHIP_HALF_BEAM] },
  ...[-9, 0, 9].map((x) => ({ min: [x - 1, 5.8, -4.2] as V3, max: [x + 1.2, 15, 4.2] as V3 })),
];
function inBoxes(p: V3, margin: number): boolean {
  return HIT_BOXES.some((b) => p[0] > b.min[0] - margin && p[0] < b.max[0] + margin && p[1] > b.min[1] - margin && p[1] < b.max[1] + margin && p[2] > b.min[2] - margin && p[2] < b.max[2] + margin);
}

export interface ShotResult {
  tau: number; // seconds after launch that the ball lands in the sea or hits the enemy ship
  hit: boolean;
  /** Where it hit, in the enemy ship's own frame (so the burst can stay on the rocking ship), or null for a miss. */
  hitLocal: V3 | null;
  /** Where it splashed (a miss): a point on the sea. */
  splash: V3 | null;
  /** Where it struck the leaping whale (it blocks shots: the ball is gone, nothing scores), or null. */
  blocked: V3 | null;
}
/**
 * Fly a shot to its end. The enemy ship's pose at every moment is known in advance (it is a function of the clock), so the whole flight, and whether it hits, can be decided at launch.
 * `launchSeconds` is the launch time on the round's clock (seconds since startsAt).
 */
export function simulateShot(l: ShotLaunch, launchSeconds: number, enemy: TeamId, breachStart: number | null = null): ShotResult {
  const step = 1 / 60;
  const whaleEvents = breachStart === null ? undefined : breachEvents(WHALE_TUNING);
  let prev = l.p0;
  for (let tau = step; tau <= SHOT_MAX_SECONDS; tau += step) {
    const p = shotPoint(l, tau);
    if (p[1] < 0.15) { // into the sea
      const k = (prev[1] - 0.15) / Math.max(1e-6, prev[1] - p[1]);
      return { tau, hit: false, hitLocal: null, blocked: null, splash: [prev[0] + (p[0] - prev[0]) * k, 0, prev[2] + (p[2] - prev[2]) * k] };
    }
    if (whaleBlocks(p, launchSeconds + tau, breachStart, BALL_RADIUS, WHALE_TUNING, whaleEvents)) return { tau, hit: false, hitLocal: null, splash: null, blocked: p };
    const local = worldToLocal(enemy, shipPose(enemy, launchSeconds + tau), p);
    if (inBoxes(local, BALL_RADIUS)) return { tau, hit: true, hitLocal: local, splash: null, blocked: null };
    prev = p;
  }
  return { tau: SHOT_MAX_SECONDS, hit: false, hitLocal: null, splash: [prev[0], 0, prev[2]], blocked: null };
}
