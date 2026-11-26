// Zoo Adoption engine rules (no sockets). Run: npx tsx scripts/test-shelter.ts
import {
  type AdoptionDayView, ADOPTEE_COUNT, ADOPTEE_LEAVE_MS, ADOPTION_STRIP, ANIMAL_SPEED, COUNTER_FRONT, KIND_COUNT, PAD_DEPTH, SPECIES_COUNT, VARIANTS, adopteePos, animalsPerKind, handoverSlot, kindOf, kindRadius, padRect, speciesOf, obstacles, pickTarget, reachOf, resolveMove, shelterDims,
} from '@fgn/shared';
import { DEFAULT_ADOPTION_CONFIG, createAdoptionDay } from '../src/games/adoptionDay';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

let seed = 7;
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const eng = createAdoptionDay({ durationMs: 60_000, random });
const T0 = 1_000_000;
type S = ReturnType<typeof eng.init>;

/** Run the simulation for `ms` in 25 ms steps. */
function run(s: S, from: number, ms: number): number {
  let t = from;
  for (let i = 0; i < ms / 25; i++) { t += 25; eng.tick!(s, 0.025, t); }
  return t;
}
const grab = (s: S, who: string, id: number, now: number) => eng.reduce(s, who, { type: 'grab', target: id }, now);
const give = (s: S, who: string, now: number) => eng.reduce(s, who, { type: 'give' }, now);

// ----- scaling with the number of players -----
const d2 = shelterDims(2), d8 = shelterDims(8);
check('the building is bigger for more players', d8.width * d8.depth > d2.width * d2.depth);
check('a room of 1 is the same as 2 (never smaller than the base)', shelterDims(1).width === d2.width);
check('the crowd has the same density in a bigger building', Math.abs(animalsPerKind(d8) * KIND_COUNT / (d8.width * d8.depth) - animalsPerKind(d2) * KIND_COUNT / (d2.width * d2.depth)) < 0.004);
check('the six adoptees fit inside the building, spaced apart', ADOPTEE_COUNT === 6 && adopteePos(0, d2).x > -d2.width / 2 && adopteePos(5, d2).x < d2.width / 2 && adopteePos(1, d2).x - adopteePos(0, d2).x > 4);
check('every adoptee has a hand-over pad in front of the counter, and the pads do not touch', Array.from({ length: ADOPTEE_COUNT }, (_, i) => padRect(i, d8)).every((p, i, all) => p.z0 === -d8.depth / 2 + COUNTER_FRONT && p.z1 - p.z0 === PAD_DEPTH && (i === 0 || all[i - 1].x1 < p.x0)));

// ----- the start -----
let s = eng.init(['a', 'b', 'c'], T0);
const dims = shelterDims(3);
check('every kind of animal is in the crowd, the same number of each', Array.from({ length: KIND_COUNT }, (_, k) => s.animals.filter((a) => a.kind === k).length).every((n) => n === animalsPerKind(dims)));
check('eight adoptees each want a different TYPE of animal (the color is part of the request too)', s.adoptees.length === ADOPTEE_COUNT && new Set(s.adoptees.map((a) => speciesOf(a.kind))).size === ADOPTEE_COUNT);
check('every type comes in more than one color in the crowd', Array.from({ length: SPECIES_COUNT }, (_, sp) => new Set(s.animals.filter((a) => speciesOf(a.kind) === sp).map((a) => a.kind)).size).every((n) => n === VARIANTS));
check('every request has a matching animal loose in the building', s.adoptees.every((ad) => s.animals.some((a) => a.kind === ad.kind)));
const solids = obstacles(dims);
check('no animal starts inside a solid or the adoption strip', s.animals.every((a) => a.z >= -dims.depth / 2 + ADOPTION_STRIP && solids.every((c) => Math.hypot(a.x - c.x, a.z - c.z) > c.r)));
check('players start in a row just south of the hand-over pads, not inside anything', Object.values(s.players).every((p) => p.z > -dims.depth / 2 + COUNTER_FRONT + PAD_DEPTH && p.z < -dims.depth / 2 + COUNTER_FRONT + PAD_DEPTH + 6 && solids.every((c) => Math.hypot(p.x - c.x, p.z - c.z) > c.r)));

// ----- walking -----
eng.reduce(s, 'a', { type: 'steer', x: 0, z: 1 }, T0 - 500);
const z0 = s.players.a.z;
run(s, T0 - 400, 400);
check('no moving before the start', s.players.a.z === z0);
eng.reduce(s, 'a', { type: 'steer', x: 0, z: 1 }, T0 + 10);
const t1 = run(s, T0, 1000);
check('a volunteer walks at a steady speed', Math.abs((s.players.a.z - z0) - 10) < 0.6);
eng.reduce(s, 'a', { type: 'steer', x: 0, z: 5 }, t1); // (a bigger vector gains nothing)
const zb = s.players.a.z; run(s, t1, 1000);
check('a bigger steer vector is clamped', Math.abs(s.players.a.z - zb) < 10.6);
eng.reduce(s, 'a', { type: 'steer', x: 1, z: 0 }, t1 + 1000);
run(s, t1 + 1000, 20_000);
check('walls stop a volunteer', Math.abs(s.players.a.x) <= dims.width / 2);
eng.reduce(s, 'a', { type: 'steer', x: 0, z: 0 }, T0 + 30_000);

// ----- every animal walks at the same speed -----
s = eng.init(['a', 'b'], T0);
let t = T0;
let maxStep = 0;
for (let i = 0; i < 400; i++) {
  const before = new Map(s.animals.map((a) => [a.id, [a.x, a.z] as const]));
  t += 25; eng.tick!(s, 0.025, t);
  for (const a of s.animals) { const b = before.get(a.id)!; maxStep = Math.max(maxStep, Math.hypot(a.x - b[0], a.z - b[1])); }
}
check('no animal ever moves faster than the common speed', maxStep <= ANIMAL_SPEED * 0.025 + 1e-6);
check('animals stay inside the building and out of the strip', s.animals.every((a) => Math.abs(a.x) <= dims.width / 2 && a.z >= -d2.depth / 2 + ADOPTION_STRIP - 1 && a.z <= d2.depth / 2));
check('animals do wander', s.animals.filter((a) => a.walking).length > s.animals.length * 0.3);

// ----- picking up -----
s = eng.init(['a', 'b'], T0);
const animal = s.animals.find((x) => x.kind === 8)!; // a cat
animal.walking = false; animal.changeAt = T0 + 1e9;
const pa = s.players.a;
const near = (r: number) => { animal.x = pa.x; animal.z = pa.z + r; };
near(reachOf(8) + 6);
grab(s, 'a', animal.id, T0 + 100);
check('too far away: no pickup', pa.carrying === null);
near(reachOf(8) - 0.5);
grab(s, 'b', animal.id, T0 + 150);
check('too far from THAT player: no pickup', s.players.b.carrying === null);
grab(s, 'a', animal.id, T0 + 300);
check('in reach: picked up', pa.carrying === animal.id && animal.carriedBy === 'a');
const other = s.animals.find((x) => x.id !== animal.id)!;
grab(s, 'a', other.id, T0 + 500);
check('only one animal at a time', pa.carrying === animal.id);
grab(s, 'b', animal.id, T0 + 500);
check('a carried animal cannot be taken', s.players.b.carrying === null);
const t2 = run(s, T0 + 600, 500);
check('a carried animal rides with its carrier', Math.hypot(animal.x - pa.x, animal.z - pa.z) < 0.01);
const v = eng.view(s) as AdoptionDayView;
check('the view hides a carried animal and shows it in its carrier\'s entry', !v.animals.some((r) => r[0] === animal.id) && v.players.a.carry?.id === animal.id && v.players.a.carry?.kind === 8);
grab(s, 'a', 999999, t2 + 200);
check('a bogus animal id is ignored', pa.carrying === animal.id);

// ----- putting it down away from the adoptees -----
pa.x = 0; pa.z = 0; pa.yaw = 0;
give(s, 'a', t2 + 600);
check('away from the adoptees, give puts the animal down in front of you', pa.carrying === null && animal.carriedBy === null && animal.z > 0.5);

// ----- a right hand-over -----
s = eng.init(['a', 'b'], T0);
const want = s.adoptees[3];
const pet = s.animals.find((x) => x.kind === want.kind)!;
const before = s.animals.filter((x) => x.kind === want.kind).length;
const spot = padRect(3, s.dims);
s.players.a.x = spot.cx; s.players.a.z = spot.cz;
pet.x = s.players.a.x; pet.z = s.players.a.z + 1; pet.walking = false; pet.changeAt = T0 + 1e9;
grab(s, 'a', pet.id, T0 + 100);
give(s, 'a', T0 + 300);
check('the right animal scores a point', s.players.a.adoptions === 1 && s.players.a.carrying === null && eng.scores(s).a === 1);
check('the adoptee is happy and the animal is gone from the crowd', s.adoptees[3].doneAt !== null && !s.animals.some((x) => x.id === pet.id));
check('a new animal of the same kind turns up (the crowd stays the same size)', s.animals.filter((x) => x.kind === want.kind).length === before);
const oldId = s.adoptees[3].id;
give(s, 'b', T0 + 320);
run(s, T0 + 400, ADOPTEE_LEAVE_MS - 600);
check('the happy adoptee is still there while celebrating', s.adoptees[3].id === oldId);
run(s, T0 + 400 + ADOPTEE_LEAVE_MS - 600, 800);
check('then replaced by a new person with a new, different request', s.adoptees[3].id !== oldId && s.adoptees[3].doneAt === null && new Set(s.adoptees.map((a) => speciesOf(a.kind))).size === ADOPTEE_COUNT);

// ----- a hand-over to the wrong adoptee -----
s = eng.init(['a', 'b'], T0);
const wrongKind = Array.from({ length: KIND_COUNT }, (_, i) => i).find((i) => !s.adoptees.some((a) => speciesOf(a.kind) === speciesOf(i)))!;
const wrongPet = s.animals.find((x) => x.kind === wrongKind)!;
const sp = adopteePos(5, s.dims);
const pad5 = padRect(5, s.dims);
s.players.a.x = pad5.cx; s.players.a.z = pad5.cz; s.players.a.yaw = 0;
wrongPet.x = s.players.a.x; wrongPet.z = s.players.a.z + 1; wrongPet.walking = false; wrongPet.changeAt = T0 + 1e9;
grab(s, 'a', wrongPet.id, T0 + 100);
give(s, 'a', T0 + 300);
check('the wrong animal: no point, the nearest adoptee shakes red, you are empty-handed', s.players.a.adoptions === 0 && s.adoptees[5].nopeAt === T0 + 300 && s.players.a.carrying === null && wrongPet.carriedBy === null);
check('the wrong animal runs off, away from the adoptee', wrongPet.walking && wrongPet.fleeUntil > T0 + 300 && (eng.view(s) as AdoptionDayView).animals.find((r) => r[0] === wrongPet.id)![5] === 2);
const dBefore = Math.hypot(wrongPet.x - sp.x, wrongPet.z - sp.z);
run(s, T0 + 300, 800);
check('...and it really moves away', Math.hypot(wrongPet.x - sp.x, wrongPet.z - sp.z) > dBefore + 2);
check('the adoptee is NOT replaced for a wrong animal', s.adoptees[5].replaceAt === null);

// ----- the colour is part of the request: the right TYPE in the wrong color is wrong -----
s = eng.init(['a', 'b'], T0);
const wantK = s.adoptees[2].kind;
const otherColour = kindOf(speciesOf(wantK), 1 - (wantK % VARIANTS));
const dye = s.animals.find((x) => x.kind === otherColour)!;
const pad2 = padRect(2, s.dims);
s.players.a.x = pad2.cx; s.players.a.z = pad2.cz; s.players.a.yaw = 0;
dye.x = s.players.a.x; dye.z = s.players.a.z + 1; dye.walking = false; dye.changeAt = T0 + 1e9;
grab(s, 'a', dye.id, T0 + 100); give(s, 'a', T0 + 300);
check('the right type in the wrong color is rejected', s.players.a.adoptions === 0 && s.adoptees[2].nopeAt === T0 + 300);

// ----- the pads and the counter -----
s = eng.init(['a', 'b'], T0);
const padA = padRect(1, s.dims), padB = padRect(2, s.dims);
check('a point on a pad belongs to that adoptee; anywhere else belongs to nobody', handoverSlot(padA.cx, padA.cz, s.dims) === 1 && handoverSlot(padB.cx, padB.cz, s.dims) === 2 && handoverSlot(padA.cx, padA.z1 + 1, s.dims) === null && handoverSlot((padA.x1 + padB.x0) / 2, padA.cz, s.dims) === null);
const walled = resolveMove(0, -s.dims.depth / 2 + 3, 0.8, s.dims, s.solids);
check('the counter is a wall: nobody can walk behind it', walled.z >= -s.dims.depth / 2 + COUNTER_FRONT + 0.8 - 1e-9);
// the right animal, but standing beside the pad: it is only put down
const besides = s.animals.find((x) => x.kind === s.adoptees[1].kind)!;
s.players.a.x = padA.cx; s.players.a.z = padA.z1 + 2; s.players.a.yaw = 0;
besides.x = s.players.a.x; besides.z = s.players.a.z + 1; besides.walking = false; besides.changeAt = T0 + 1e9;
grab(s, 'a', besides.id, T0 + 100); give(s, 'a', T0 + 300);
check('the right animal but off the pad: no adoption, it is just put down', s.players.a.adoptions === 0 && besides.carriedBy === null && s.adoptees[1].doneAt === null && s.adoptees[1].nopeAt === null);
// a pad whose adoptee is already leaving takes nothing
const leaving = s.adoptees[1];
leaving.doneAt = T0; leaving.replaceAt = T0 + 5000;
s.players.a.x = padA.cx; s.players.a.z = padA.cz;
besides.x = s.players.a.x; besides.z = s.players.a.z + 1;
grab(s, 'a', besides.id, T0 + 500); give(s, 'a', T0 + 700);
check('an adoptee who is already leaving takes nothing more (the animal is put down)', s.players.a.adoptions === 0 && besides.carriedBy === null);

// ----- animals keep out of each other's way (but not perfectly) -----
/** The share of animals standing on top of another animal at a random moment, averaged over a round's worth of time, a few rounds and a few room sizes. */
function overlapShare(avoidTurn: number, players: string[], seeds: number[]): number {
  let total = 0, samples = 0;
  for (const seedValue of seeds) {
    let r = seedValue;
    const rng = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
    const e = createAdoptionDay({ durationMs: 600_000, random: rng, avoidTurn });
    const st = e.init(players, T0);
    let now = T0;
    for (let i = 0; i < 1600; i++) { // 80 seconds in 50 ms steps
      now += 50; e.tick!(st, 0.05, now);
      if (i < 200 || i % 10 !== 0) continue; // (let the crowd settle for 10 s, then look every half second)
      const list = st.animals.filter((a) => !a.carriedBy);
      let touching = 0;
      for (const a of list) if (list.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < (kindRadius(a.kind) + kindRadius(b.kind)) * 0.9)) touching++;
      total += touching / list.length; samples++;
    }
  }
  return total / samples;
}
const sizes = [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']];
const withAvoid = sizes.map((p) => overlapShare(DEFAULT_ADOPTION_CONFIG.avoidTurn, p, [11, 22, 33]));
const without = sizes.map((p) => overlapShare(0, p, [11, 22, 33]));
console.log(`     overlap share, with avoidance (2/4/8 players): ${withAvoid.map((n) => (n * 100).toFixed(1) + '%').join('  ')}   without: ${without.map((n) => (n * 100).toFixed(1) + '%').join('  ')}`);
check('animals avoid each other: about 15% of them overlap another at a random moment (10% to 20%) in every room size', withAvoid.every((n) => n >= 0.10 && n <= 0.20));
check('...which is clearly less than without avoidance', withAvoid.every((n, i) => n < without[i] * 0.8));

// ----- the view, spectators and the end -----
s = eng.init(['a', 'b', 'c'], T0);
eng.reduce(s, 'a', { type: 'look', yaw: 1.25 }, T0 + 50);
const vw = eng.view(s) as AdoptionDayView;
check('the view shows where a volunteer faces', Math.abs(vw.players.a.yaw - 1.25) < 0.001);
const copy = vw.animals;
eng.tick!(s, 0.025, T0 + 100);
check('the view does not alias the state', copy === vw.animals && vw.animals.length === s.animals.length);
eng.reduce(s, 'a', { type: 'look', yaw: NaN }, T0 + 60);
check('a bad look value is ignored', Math.abs(s.players.a.yaw - 1.25) < 0.001);
grab(s, 'zzz', 1, T0 + 200);
check('actions from a non-player are ignored', Object.keys(s.players).length === 3);

// leaving drops what you carry
s = eng.init(['a', 'b'], T0);
const held = s.animals[0]; held.x = s.players.a.x; held.z = s.players.a.z + 1;
grab(s, 'a', held.id, T0 + 100);
check('(setup) carrying', s.players.a.carrying === held.id);
eng.removePlayer(s, 'a');
check('a player who leaves puts down the animal they carried', held.carriedBy === null && s.players.a === undefined);

s = eng.init(['a', 'b'], T0);
check('no adoptions: a draw', eng.getWinner(s) === null && !eng.isOver(s, T0 + 1000) && eng.isOver(s, T0 + 60_000));
s.players.a.adoptions = 2; s.players.b.adoptions = 2;
check('a tie is a draw', eng.getWinner(s) === null);
s.players.a.adoptions = 3;
check('the most adoptions wins', eng.getWinner(s) === 'a' && eng.scores(s).a === 3);
const late = eng.init(['a'], T0);
late.animals[0].x = late.players.a.x; late.animals[0].z = late.players.a.z + 1;
grab(late, 'a', late.animals[0].id, T0 + 70_000);
check('no pickups after the end', late.players.a.carrying === null);

// pickTarget (what the phone highlights)
const list = [{ id: 1, kind: 8, x: 0, z: 2 }, { id: 2, kind: 8, x: 0, z: -2 }, { id: 3, kind: 8, x: 30, z: 0 }];
check('the highlight prefers what is in front of you', pickTarget(0, 0, 0, list) === 1 && pickTarget(0, 0, Math.PI, list) === 2);
check('nothing out of reach is highlighted', pickTarget(0, 0, Math.PI / 2, [list[2]]) === null);
check('a bigger animal can be reached from farther away', reachOf(kindOf(6, 0)) > reachOf(kindOf(11, 0)));

console.log(failed === 0 ? '\nAll Zoo Adoption engine checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
