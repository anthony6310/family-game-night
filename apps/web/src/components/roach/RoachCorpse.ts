import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from 'three';

/**
 * How a roach that starved looks when it is dead: on its back with its legs curled up over its belly and its feelers drooping. The Zoo Adoption roach is one merged mesh of 27 identical sphere parts (15 for the body and
 * the feelers, then 12 leg segments: for each of three hips, left thigh, left shin, right thigh, right shin), so the curled-up pose is made as a MORPH TARGET of the very same geometry: the scene blends from the walking
 * shape to the curled shape smoothly (`morphTargetInfluences[0]` 0..1). The constants below are the ones the roach is built with in AnimalKit. If the model ever changes shape and no longer fits, `buildCorpseGeometry`
 * returns null and the scene just flips the roach over without the curl.
 */
const PARTS = 27;
const FIRST_LEG = 15;
const FEELERS = [8, 9, 10, 12, 13, 14];
const HIPS = [0.28, 0.02, -0.26];
const REACH = 0.42;
const KNEE = 0.14;
const FORE = 0.2;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function buildCorpseGeometry(base: BufferGeometry): BufferGeometry | null {
  const pos = base.getAttribute('position');
  if (!pos || pos.count % PARTS !== 0) return null;
  const per = pos.count / PARTS;
  const geometry = base.clone();
  const target = new Float32Array(pos.array as ArrayLike<number>);
  const v = new Vector3(), c = new Vector3(), mid = new Vector3();

  for (let j = 0; j < 12; j++) {
    const hip = Math.floor(j / 4), s = j % 4 < 2 ? -1 : 1, shin = j % 2 === 1;
    const z = HIPS[hip], sweep = hip === 0 ? FORE : hip === 1 ? 0.04 : -FORE;
    const root = new Vector3(s * 0.17, 0.2, z);
    const knee = new Vector3(s * (0.17 + REACH * 0.55), 0.2 + KNEE, z + sweep * 0.5);
    const foot = new Vector3(s * (0.17 + REACH), 0.02, z + sweep * 1.3);
    const knee2 = new Vector3(s * (0.17 + 0.16), 0.2 - 0.12, z + sweep * 0.2); // the thigh swings down and out...
    const foot2 = new Vector3(s * (0.17 + 0.03), -0.06, z + sweep * 0.8); // ...and the shin folds back in under the body (it ends up over the belly when the roach is on its back)
    const [A, B, A2, B2] = shin ? [knee, foot, knee2, foot2] : [root, knee, root, knee2];
    const from = (FIRST_LEG + j) * per;
    // check this part really is where we think it is (its middle is the middle of the limb)
    c.set(0, 0, 0);
    for (let k = 0; k < per; k++) c.add(v.fromArray(pos.array as ArrayLike<number> as number[], (from + k) * 3));
    c.multiplyScalar(1 / per);
    mid.copy(A).add(B).multiplyScalar(0.5);
    if (c.distanceTo(mid) > 0.05) return null;
    const u = B.clone().sub(A), len = u.length(); u.normalize();
    const u2 = B2.clone().sub(A2), len2 = u2.length(); u2.normalize();
    const q = new Quaternion().setFromUnitVectors(u, u2), mid2 = A2.clone().add(B2).multiplyScalar(0.5), ratio = len2 / len;
    for (let k = 0; k < per; k++) {
      const i = (from + k) * 3;
      v.fromArray(pos.array as ArrayLike<number> as number[], i).sub(mid);
      const along = v.dot(u);
      v.addScaledVector(u, along * (ratio - 1)).applyQuaternion(q).add(mid2);
      target[i] = v.x; target[i + 1] = v.y; target[i + 2] = v.z;
    }
  }
  // the feelers droop (lifted in the model, because the roach ends up upside down: they lie down along the floor) and fold in
  for (const part of FEELERS) {
    for (let k = 0; k < per; k++) {
      const i = (part * per + k) * 3;
      const f = clamp01((target[i + 2] - 0.55) / 0.85);
      target[i + 1] += 0.2 * f * f;
      target[i] *= 1 - 0.25 * f;
    }
  }
  geometry.morphAttributes.position = [new BufferAttribute(target, 3)];
  geometry.morphTargetsRelative = false;
  return geometry;
}

/**
 * The death by starvation, as a pose for the roach's body mesh, `since` milliseconds after it died:
 *   0 - 350      it staggers: wobbles from side to side, legs scrabbling
 *   350 - 900    it tips over onto its back (a small hop as it goes)
 *   900 - 1700   it lands, bounces once, and its legs curl up over its belly
 *   2300, 3500   a last weak twitch or two; then it lies still for the rest of the round
 * `side` (1 or -1) is which way it rolls; `scale` the roach's size. Returns what to set on the mesh.
 */
const ease = (k: number) => k * k * (3 - 2 * k);
export interface CorpsePose { x: number; y: number; roll: number; yaw: number; curl: number }
export function corpsePose(since: number, side: number, scale: number): CorpsePose {
  const cy = 0.2 * scale, halfW = 0.28 * scale, halfH = 0.11 * scale;
  let theta = 0, hop = 0, yaw = 0, curl = 0, wobble = 0;
  if (since < 350) {
    const k = since / 350;
    wobble = Math.sin(since * 0.045) * 0.28 * (1 - k * 0.3);
    yaw = Math.sin(since * 0.03 + 1) * 0.12 * (1 - k);
    curl = 0.12 * (1 + Math.sin(since * 0.06));
  } else if (since < 900) {
    const k = (since - 350) / 550;
    theta = Math.PI * ease(k);
    hop = 0.5 * Math.sin(Math.PI * k) * scale * 0.6;
    curl = 0.12 + 0.4 * ease(k);
    wobble = Math.sin(since * 0.05) * 0.12 * (1 - k);
  } else {
    theta = Math.PI;
    const k = clamp01((since - 900) / 800);
    curl = 0.52 + 0.48 * ease(k);
    hop = since < 1150 ? 0.18 * scale * 0.6 * Math.sin(((since - 900) / 250) * Math.PI) : 0; // (bounces once as it lands)
    for (const at of [2300, 3500]) {
      const u = since - at;
      if (u >= 0 && u < 420) { curl -= 0.2 * Math.sin((u / 420) * Math.PI) * (1 - (at - 2300) / 2400); wobble += Math.sin((u / 420) * Math.PI * 3) * 0.06; }
    }
  }
  const roll = theta * side + wobble;
  const th = theta * side;
  const lift = Math.max(0, Math.sqrt(halfW * halfW * Math.sin(th) ** 2 + halfH * halfH * Math.cos(th) ** 2) - cy * Math.cos(th));
  return { x: cy * Math.sin(th), y: lift + hop, roll, yaw, curl: clamp01(curl) };
}
