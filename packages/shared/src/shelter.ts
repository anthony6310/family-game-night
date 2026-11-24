/**
 * Zoo Adoption: the numbers and little bits of geometry the server and the phones must agree on (the warehouse's size and pillars, how fast
 * everyone moves, how close you must be to pick an animal up). Units are world units; x is east, z is south, y is up. Everything faces +z at yaw 0.
 */

/** Every TYPE of animal in the shelter (the order matters: a "kind" is a type and a color option, see below). */
export const SPECIES = [
  { id: 'penguin', name: 'Penguin', radius: 0.7 },
  { id: 'seal', name: 'Seal', radius: 1.3 },
  { id: 'bear', name: 'Bear', radius: 2.0 },
  { id: 'fish', name: 'Fish', radius: 0.9 },
  { id: 'cat', name: 'Cat', radius: 0.7 },
  { id: 'dog', name: 'Dog', radius: 1.0 },
  { id: 'lion', name: 'Lion', radius: 1.8 },
  { id: 'tiger', name: 'Tiger', radius: 1.9 },
  { id: 'parrot', name: 'Parrot', radius: 0.5 },
  { id: 'seagull', name: 'Seagull', radius: 0.6 },
  { id: 'pelican', name: 'Pelican', radius: 0.9 },
  { id: 'roach', name: 'Cockroach', radius: 0.35 },
] as const;
export type SpeciesId = (typeof SPECIES)[number]['id'];
export const SPECIES_COUNT = SPECIES.length;
/** Every type comes in this many color options (the first is the original look). */
export const VARIANTS = 2;
/**
 * A KIND is one exact animal: a type in one of its color options. This is what an adopter asks for (the thought bubble shows the exact model, so a
 * tabby cat is not a black cat) and what the view sends for every animal: kind = type * VARIANTS + color option.
 */
export const KIND_COUNT = SPECIES_COUNT * VARIANTS;
export const kindOf = (species: number, variant: number) => species * VARIANTS + variant;
export const speciesOf = (kind: number) => Math.floor(kind / VARIANTS);
export const variantOf = (kind: number) => kind % VARIANTS;
export const kindRadius = (kind: number) => SPECIES[speciesOf(kind)]?.radius ?? 1;
export const kindName = (kind: number) => SPECIES[speciesOf(kind)]?.name ?? '?';

// ----- how everyone moves -----
export const SHELTER_PLAYER_SPEED = 10; // volunteers walk at this speed, in any direction, with no sliding
export const SHELTER_PLAYER_RADIUS = 0.8;
export const SHELTER_EYE_HEIGHT = 3.2; // the first-person camera's height
/** EVERY animal walks at this one speed, whatever it is (a lion is no faster than a roach). Resting animals stand still now and then. */
export const ANIMAL_SPEED = 3.5;
export const ANIMAL_WALK_MS: [number, number] = [1000, 2600]; // how long it walks in one direction before choosing again
export const ANIMAL_IDLE_MS: [number, number] = [600, 1600];
export const ANIMAL_IDLE_CHANCE = 0.25;
/** A wrong animal handed over bolts away from the adoptee at this speed for this long. */
export const ANIMAL_FLEE_SPEED = 6.5;
export const ANIMAL_FLEE_MS = 1300;

// ----- picking up and handing over -----
/** You can pick an animal up from this far away, plus its own radius (a lion is easier to reach than a roach). */
export const PICKUP_BASE = 2.6;
/** The server accepts a grab from a little farther than the phone allows, to forgive lag. */
export const PICKUP_SLACK = 1.8;
export const ACTION_THROTTLE_MS = 120;

// ----- the adoptees -----
export const ADOPTEE_COUNT = 6;
/** After a successful adoption the adoptee celebrates for this long, then walks off and a new one takes the place with a new request. */
export const ADOPTEE_LEAVE_MS = 2200;
/** How long a wrong animal's thought bubble shakes red. */
export const ADOPTEE_NOPE_MS = 900;

// ----- the warehouse -----
export interface ShelterDims {
  width: number; // east-west
  depth: number; // north-south (the adoption line is at the north end, -z)
}
const BASE_AREA = 3600;
const AREA_PER_PLAYER = 900;
/** The building grows with the number of players (never smaller than for 2): twice the players is not twice the floor, but the floor and the crowd grow together. */
export function shelterDims(players: number): ShelterDims {
  const area = BASE_AREA + AREA_PER_PLAYER * Math.max(2, players);
  const depth = Math.round(Math.sqrt(area / 1.6));
  return { width: Math.round(depth * 1.6), depth };
}
/** How many animals of EACH kind roam the building: the crowd keeps the same density whatever the size (about one animal per 70 square units). */
export function animalsPerKind(dims: ShelterDims): number {
  return Math.max(2, Math.round((dims.width * dims.depth) / 70 / KIND_COUNT));
}
/** Animals keep out of the strip in front of the adoption desk (the counter and the hand-over pads). */
export const ADOPTION_STRIP = 14;
/** Where adoptee `slot` stands (they are spread evenly along the north end, behind the counter, facing south). */
export function adopteePos(slot: number, dims: ShelterDims): { x: number; z: number } {
  const inner = dims.width - 16;
  return { x: -inner / 2 + (inner / (ADOPTEE_COUNT - 1)) * slot, z: -dims.depth / 2 + 4 };
}

// ----- the counter and the hand-over pads -----
/** The adopters stand behind a counter along the whole north end. Its front is this far from the north wall; nobody can walk past it. */
export const COUNTER_FRONT = 7.5;
export const COUNTER_DEPTH = 2.2;
export const COUNTER_HEIGHT = 2.4;
/** In front of each adopter is a marked pad on the floor, this deep (from the counter's front) and at most this wide: stand on it and the action button hands the animal over. */
export const PAD_DEPTH = 5;
export const PAD_MAX_WIDTH = 14;
export const PAD_GAP = 1.2;
export interface PadRect { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number }
/** The pad on the floor in front of adoptee `slot`. */
export function padRect(slot: number, dims: ShelterDims): PadRect {
  const spacing = (dims.width - 16) / (ADOPTEE_COUNT - 1);
  const half = Math.min(PAD_MAX_WIDTH, spacing - PAD_GAP) / 2;
  const cx = adopteePos(slot, dims).x;
  const z0 = -dims.depth / 2 + COUNTER_FRONT;
  return { x0: cx - half, x1: cx + half, z0, z1: z0 + PAD_DEPTH, cx, cz: z0 + PAD_DEPTH / 2 };
}
/** Which adoptee's pad a point is on, or null (anywhere else, an animal is put down instead of handed over). */
export function handoverSlot(x: number, z: number, dims: ShelterDims): number | null {
  for (let i = 0; i < ADOPTEE_COUNT; i++) {
    const p = padRect(i, dims);
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return i;
  }
  return null;
}
/** Where player `index` of `count` starts (in a row in front of the hand-over pads). */
export function shelterSpawn(index: number, count: number, dims: ShelterDims): { x: number; z: number } {
  const inner = dims.width * 0.7;
  return { x: count === 1 ? 0 : -inner / 2 + (inner / (count - 1)) * index, z: -dims.depth / 2 + COUNTER_FRONT + PAD_DEPTH + 3 };
}

export interface Circle { x: number; z: number; r: number }
export const PILLAR_RADIUS = 0.9;
export const PILLAR_SPACING = 26;
/** The roof's pillars (solid): a grid across the floor behind the adoption strip. */
export function pillars(dims: ShelterDims): Circle[] {
  const out: Circle[] = [];
  const cols = Math.max(3, Math.floor(dims.width / PILLAR_SPACING));
  for (let i = 0; i < cols; i++) {
    const x = (i - (cols - 1) / 2) * PILLAR_SPACING;
    for (let z = -dims.depth / 2 + 24; z <= dims.depth / 2 - 8; z += PILLAR_SPACING) out.push({ x, z, r: PILLAR_RADIUS });
  }
  return out;
}
/** Everything round and solid: the pillars (the counter is a wall along the north end, see resolveMove). */
export function obstacles(dims: ShelterDims): Circle[] {
  return pillars(dims);
}

/** Keep something of radius `r` inside the building, in front of the counter, and out of the solid things: returns where it ends up. */
export function resolveMove(x: number, z: number, r: number, dims: ShelterDims, solids: Circle[]): { x: number; z: number; hit: boolean } {
  let hit = false;
  const hx = dims.width / 2 - r - 0.5, hz = dims.depth / 2 - r - 0.5;
  if (Math.abs(x) > hx) { x = Math.sign(x) * hx; hit = true; }
  const top = -dims.depth / 2 + COUNTER_FRONT + r; // (the counter is a wall along the whole north end)
  if (z > hz) { z = hz; hit = true; }
  if (z < top) { z = top; hit = true; }
  for (const c of solids) {
    const dx = x - c.x, dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min) {
      const d = Math.sqrt(d2);
      if (d < 1e-6) x += min; else { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
      hit = true;
    }
  }
  return { x, z, hit };
}

/** The ground direction (x, z) a player faces at `yaw` (0 = facing south, +z), and their right-hand direction. */
export const facing = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const rightOf = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });

/** How far from the player an animal can be picked up. */
export const reachOf = (kind: number) => PICKUP_BASE + kindRadius(kind);

/**
 * The animal a player would pick up right now: the nearest one in reach that is roughly in front of them (the phone highlights this one; the
 * server only checks that the animal asked for is in reach). Returns its id, or null.
 */
export function pickTarget(px: number, pz: number, yaw: number, animals: { id: number; kind: number; x: number; z: number }[]): number | null {
  const f = facing(yaw);
  let best: number | null = null;
  let bestScore = Infinity;
  for (const a of animals) {
    const dx = a.x - px, dz = a.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > reachOf(a.kind)) continue;
    const dot = d > 1e-6 ? (dx * f.x + dz * f.z) / d : 1;
    if (d > 1.4 && dot < 0.25) continue; // behind you (or well off to the side): not what you are looking at
    const score = d - dot * 1.2;
    if (score < bestScore) { bestScore = score; best = a.id; }
  }
  return best;
}
