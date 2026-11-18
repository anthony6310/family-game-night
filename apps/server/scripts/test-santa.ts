/** Santa's Sack engine:  npm run test:santa -w @fgn/server */
import { createSantaSack, lobPlan, DEFAULT_SANTA as cfg } from '../src/games/santaSack';
import { BAG_MOUTH_HEIGHT, BAG_SCORE_DEPTH, BAG_TOP_EXTRA, PLAYER_COLORS, SANTA_NEUTRAL_BAG_COLOR, bagFrame, inOuterZone, inScoringZone, mouthCentre, type SantaSackView } from '@fgn/shared';

let failures = 0;
const check = (name: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const DT = 0.025;
const e = createSantaSack();
const view = (s: Parameters<typeof e.view>[0]) => e.view(s) as SantaSackView;
const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
const PHASE = cfg.phaseMs;

// ---- the bags: always 9, all close in size with a little variance ----
{
  let counts = true, inRange = true, varied = new Set<number>(), biggest = 0, smallest = 99;
  for (let g = 0; g < 300; g++) {
    for (const n of [2, 3, 5, 8]) {
      const bags = e.init(ids(n), 0).bags;
      if (bags.length !== 9) counts = false;
      for (const b of bags) { if (b.radius < cfg.bagRadiusMin - 1e-6 || b.radius > cfg.bagRadiusMax + 1e-6) inRange = false; varied.add(b.radius); biggest = Math.max(biggest, b.radius); smallest = Math.min(smallest, b.radius); }
    }
  }
  check('there are always 9 bags, whatever the number of players (2, 3, 5 or 8)', counts);
  check('every bag is between 2.07 and 2.7 (the old range 1.8 to 3.0, with the smallest 15% bigger and the biggest 10% smaller): all close in size, with some variance that uses the whole range', inRange && varied.size > 100 && biggest > cfg.bagRadiusMax - 0.05 && smallest < cfg.bagRadiusMin + 0.05 && Math.abs(cfg.bagRadiusMin - 1.8 * 1.15) < 1e-9 && Math.abs(cfg.bagRadiusMax - 3 * 0.9) < 1e-9);
  const v = view(e.init(ids(4), 0));
  check('nothing in the view gives a bag a different value (all worth the same: one bag)', v.bags.every((b) => !('points' in b) && !('size' in b)) && !('bagPoints' in cfg));
  const spacing = (2 * Math.PI * cfg.orbitRadius) / 9;
  check('9 bags, even 9 of the biggest possible, fit on the route without touching (even their round bellies)', spacing > 2 * cfg.bagRadiusMax * 1.35);
  const slots = e.init(ids(3), 0).bags.map((b) => b.slot);
  check('the bags are spaced evenly round the route', slots.every((sl, i) => { const next = slots[(i + 1) % 9]; return Math.abs(((next - sl + Math.PI * 20) % (Math.PI * 2)) - (Math.PI * 2) / 9) < 1e-6 || i === 8; }));
  check('the neutral bag color is not one of the player colors', !(PLAYER_COLORS as readonly string[]).includes(SANTA_NEUTRAL_BAG_COLOR));
}

// ---- the lids: all open, then a random 3 to 6 closed, then the others closed, then all open ----
{
  let ok = true, windows = true, firstCounts = new Set<number>(), nobodyAtTwoQuarters = true;
  for (let g = 0; g < 400; g++) {
    const st = e.init(ids(4), 1000);
    const closedAt = (t: number) => st.bags.filter((b) => t >= b.closeAt && t < b.openAt);
    for (const b of st.bags) if (!((b.closeAt === 1000 + PHASE && b.openAt === 1000 + 2 * PHASE) || (b.closeAt === 1000 + 2 * PHASE && b.openAt === 1000 + 3 * PHASE))) windows = false;
    const first = closedAt(1000 + PHASE + 1), second = closedAt(1000 + 2 * PHASE + 1);
    firstCounts.add(first.length);
    if (first.length < 3 || first.length > 6) ok = false;
    if (first.length + second.length !== 9 || first.some((b) => second.includes(b))) ok = false; // the second phase closes exactly the others
    if (closedAt(1000 + 100).length !== 0 || closedAt(1000 + 3 * PHASE + 100).length !== 0 || closedAt(1000 + 4 * PHASE - 1).length !== 0) nobodyAtTwoQuarters = false;
  }
  check('each bag has one closed window, a quarter of the round long (15 s), in the second or the third quarter', windows);
  check('in the second quarter a random 3 to 6 bags are closed; in the third the OTHER bags are closed (all 9 are closed exactly once)', ok && firstCounts.size > 1 && [...firstCounts].every((n) => n >= 3 && n <= 6));
  check('in the first and the last quarter every bag is open', nobodyAtTwoQuarters);
  const v = view(e.init(ids(2), 5000));
  check('the view says when each lid is on (closeAt / openAt on the server clock) and how long before closing a bag strobes (3 s)', v.warnMs === 3000 && v.bags.every((b) => b.lid.openAt - b.lid.closeAt === PHASE && b.lid.closeAt >= 5000 + PHASE) && v.bags.every((b) => b.leader === null && !('counts' in b)));
}

// ---- the aim: the cursor is in the air a little above the bags' mouths (15% above the average mouth height), not down at the floor ----
{
  const mean = (cfg.bagRadiusMin + cfg.bagRadiusMax) / 2;
  const mouthHeight = BAG_MOUTH_HEIGHT * mean * Math.cos(0.75);
  check('the aim point is about 15% above the height of a bag\'s mouth (so the arc and its cursor end up near the mouths, not at the floor)', Math.abs(cfg.aimHeight / mouthHeight - 1.15) < 0.03 && view(e.init(ids(2), 0)).lob.aimHeight === cfg.aimHeight);
}

// ---- the bag's hit zones: the scoring zone lies entirely inside the outer zone ----
{
  let inside = true, samples = 0, outerOnly = 0;
  for (const r of [2.07, 2.4, 2.7]) for (const [mx, mz] of [[7.5, 0], [-5, 5.5], [0, -7.5]] as const) {
    const f = bagFrame(mx, mz, r);
    for (let i = 0; i < 60000; i++) {
      const p = { x: mx + (Math.random() - 0.5) * 5 * r, y: Math.random() * 5 * r, z: mz + (Math.random() - 0.5) * 5 * r };
      if (inScoringZone(f, p)) { samples++; if (!inOuterZone(f, p)) inside = false; } else if (inOuterZone(f, p)) outerOnly++;
    }
  }
  check('the scoring zone never pokes out of the outer zone (checked with thousands of points, every bag size)', inside && samples > 500 && outerOnly > 500);
  const shutF = bagFrame(7.5, 0, 1.5), mc = mouthCentre(shutF);
  check('cinched shut, the middle of the old mouth is solid (the gathered tip), so a gift there bounces; open, it is the scoring zone, not solid', inOuterZone(shutF, mc, true) && inScoringZone(shutF, mc));
  const f = bagFrame(7.5, 0, 1.5), c = mouthCentre(f);
  check('the middle of a bag\'s mouth is over its spot on the route and the bag leans outward from the middle', Math.abs(c.x - 7.5) < 1e-6 && Math.abs(c.z) < 1e-6 && f.u.x > 0.5 && f.u.y > 0.5 && f.base.x < 7.5);
  check('the scoring zone goes about halfway down the sack and its top is no higher than the neck\'s', BAG_SCORE_DEPTH > 1 && BAG_SCORE_DEPTH < BAG_MOUTH_HEIGHT && BAG_TOP_EXTRA < 0.5);
}

// ---- stations: a circle round the bags, evenly spaced, as far across from each other as possible ----
{
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const st2 = e.init(ids(2), 0);
  check('two players are opposite each other: first at the far left, second at the far right', st2.stations.a.x < -20 && st2.stations.b.x > 20 && near(st2.stations.a.z, 0) && near(st2.stations.b.z, 0));
  const st4 = e.init(ids(4), 0);
  check('four players: left, top, right and bottom (two opposite pairs)', st4.stations.a.x < -20 && st4.stations.c.x > 20 && st4.stations.b.z < -20 && st4.stations.d.z > 20 && near(st4.stations.a.x, -st4.stations.c.x) && near(st4.stations.b.z, -st4.stations.d.z));
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const st = e.init(ids(n), 0);
    const list = Object.values(st.stations);
    const onCircle = list.every((s) => Math.abs(Math.hypot(s.x, s.z) - cfg.stationRadius) < 0.02);
    const gaps = list.map((s, i) => { const t = list[(i + 1) % n]; return Math.hypot(s.x - t.x, s.z - t.z); });
    const even = gaps.every((g) => Math.abs(g - gaps[0]) < 0.1);
    const apart = gaps.every((g) => g > 8);
    check(`${n} players: all on the circle, the same distance from the middle, evenly spaced and well apart`, onCircle && even && apart);
  }
  for (const n of [2, 4, 6, 8]) {
    const st = e.init(ids(n), 0), list = Object.values(st.stations);
    check(`${n} players: every elf has another exactly opposite (across the middle)`, list.every((s, i) => { const o = list[(i + n / 2) % n]; return near(s.x, -o.x) && near(s.z, -o.z); }));
  }
  check('every elf faces the middle, where the bags are', Object.values(e.init(ids(8), 0).stations).every((s) => { const len = Math.hypot(s.x, s.z); return near(Math.cos(s.facing) * len, -s.x) && near(Math.sin(s.facing) * len, -s.z); }));
  check('the first player is on the left and the stations fit in the clearing (well inside the trees)', e.init(ids(5), 0).stations.a.x < -20 && cfg.stationRadius + 8 < 40);
}

// helpers: bags frozen in place (orbit stopped) so throws can be aimed exactly
const still = (n = 4) => {
  const eng = createSantaSack({ orbitSpeedUnits: 0, minThrowGapMs: 0 });
  return { eng, st: eng.init(ids(n), 0) };
};
type Eng = ReturnType<typeof createSantaSack>;
type St = ReturnType<Eng['init']>;
const spot = (bag: { slot: number }, radius = cfg.orbitRadius) => ({ x: Math.cos(bag.slot) * radius, z: Math.sin(bag.slot) * radius });
const throwAt = (eng: Eng, st: St, id: string, x: number, z: number, t: number) => {
  const s = st.stations[id];
  const dist = Math.hypot(x - s.x, z - s.z);
  const power = clamp01((dist - cfg.rangeMin) / (cfg.rangeMax - cfg.rangeMin));
  return eng.reduce(st, id, { type: 'throw', x: x - s.x, z: z - s.z, power }, t);
};
/** The same state with one bag moved to a place on its route (an angle; the south, the bottom of the map, is PI / 2) and all the other bags moved to the far side, out of the way. Its lid is set to `closed` or open. */
const alone = (st: St, bagId: number, slot: number, lid: 'open' | 'closed'): St => ({
  ...st,
  bags: st.bags.map((b, i) => (b.id === bagId
    ? { ...b, slot, closeAt: lid === 'closed' ? 0 : 1e12, openAt: lid === 'closed' ? 1e12 : 2e12 }
    : { ...b, slot: slot + Math.PI + (i - 1) * 0.25, closeAt: 1e12, openAt: 2e12 })),
});
const SOUTH = Math.PI / 2;
const middle = (rs: { off: number; res: string }[]): number | undefined => { const ins = rs.filter((r) => r.res === 'in').map((r) => r.off); return ins.length ? ins[Math.floor(ins.length / 2)] : undefined; };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const settle = (eng: Eng, st: St, t0: number) => { let s = st, t = t0; for (let i = 0; i < 240 && s.flying.length > 0; i++) { t += 25; s = eng.tick!(s, DT, t); } return { st: s, t }; };
function sweep(eng: Eng, st: St, from: string, bagId: number, target: { x: number; z: number }, t0: number, lateral = 0) {
  const s = st.stations[from];
  const len = Math.hypot(target.x - s.x, target.z - s.z), dx = (target.x - s.x) / len, dz = (target.z - s.z) / len;
  const results: { off: number; res: 'in' | 'floor' | 'other'; bounces: number }[] = [];
  for (let off = -3; off <= 3.01; off += 0.25) {
    let tst = throwAt(eng, st, from, target.x + dx * off - dz * lateral, target.z + dz * off + dx * lateral, t0);
    let bounces = 0;
    for (let i = 0; i < 240 && tst.flying.length > 0; i++) { bounces = Math.max(bounces, ...tst.flying.map((f) => f.bounces)); tst = eng.tick!(tst, DT, t0 + (i + 1) * 25); }
    const l = tst.landed.find((x) => x.owner === from);
    results.push({ off, res: l ? (l.bag === bagId ? 'in' : l.bag === null ? 'floor' : 'other') : 'floor', bounces });
  }
  return results;
}

{
  // throwing: unlimited gifts, validation, the lob
  const { eng, st: s0 } = still();
  const sp = spot(s0.bags[0]);
  let st = throwAt(eng, s0, 'a', sp.x, sp.z, 100);
  check('a throw takes a gift straight from the pile (no grabbing, no limit) and puts it in the air', st.flying.length === 1);
  const f = st.flying[0];
  check('it leaves the hands at the hand height', Math.abs(f.p0.y - cfg.handHeight) < 1e-9 && f.t0 === 100);
  {
    const sa = s0.stations.a, d = Math.hypot(sp.x - sa.x, sp.z - sa.z), range = Math.min(cfg.rangeMax, Math.max(cfg.rangeMin, d));
    const g0 = -cfg.gravity, aim = cfg.aimHeight - cfg.handHeight;
    const direct = Math.max(cfg.flightMinMs, (range / cfg.throwSpeed) * 1000) / 1000;
    const directRise = Math.pow((aim + 0.5 * g0 * direct * direct) / direct, 2) / (2 * g0);
    const baseRise = directRise * 1.2;
    const baseTime = Math.sqrt(2 * g0 * baseRise) / g0 + Math.sqrt((2 * (baseRise - aim)) / g0);
    const lobRise = (f.v0.y * f.v0.y) / (2 * -f.g);
    check('the arc peaks 26% higher than a direct flight over the same distance would (the 1.8 peak, 30% lower)', Math.abs(cfg.lobFactor - 1.26) < 1e-9 && Math.abs(lobRise / directRise - 1.26) < 0.01);
    check('every throw has its own, stronger gravity (falling quicker than the old fixed gravity)', f.g < cfg.gravity && Math.abs(-f.g - lobPlan(cfg, range).g) < 0.01);
    let t = 0, found = false;
    for (let i = 0; i < 6000; i++) { t = i / 1000; const y = f.p0.y + f.v0.y * t + 0.5 * f.g * t * t; if (t > 0.2 && y <= cfg.aimHeight) { found = true; break; } }
    const px = f.p0.x + f.v0.x * t, pz = f.p0.z + f.v0.z * t;
    check('it passes through the aim point (over the aimed spot, at the aim height) on its way down', found && Math.hypot(px - sp.x, pz - sp.z) < 0.15);
    check('the flight takes 35% less time than the first lob did', found && Math.abs(t / baseTime - 0.65) < 0.01 && cfg.flightTimeScale === 0.65);
  }
  const fast = createSantaSack({ orbitSpeedUnits: 0 });
  let g = fast.init(['a', 'b'], 0);
  g = throwAt(fast, g, 'a', 0, 0, 1000); const again = throwAt(fast, g, 'a', 0, 0, 1010);
  check('only an inhuman double-fire (under 0.12 s) is ignored; a human can throw as fast as they like', again.flying.length === 1 && throwAt(fast, g, 'a', 0, 0, 1150).flying.length === 2);
  let h = still().st; const hh = still().eng;
  for (let i = 0; i < 40; i++) h = throwAt(hh, h, 'a', 0, 0, 100 + i * 10);
  check('there is no limit to the gifts: 40 throws in a row all leave the pile', h.flying.length === 40);
  check('junk throws are ignored', [{ x: NaN, z: 1, power: 0.5 }, { x: 0, z: 0, power: 0.5 }, { x: 1, z: 0, power: Infinity }, { x: 1, z: 0, power: 0.01 }].every((j) => eng.reduce(s0, 'a', { type: 'throw', ...j }, 100).flying.length === 0));
  check('a spectator (not a player) cannot throw, and nothing works before the start or after the end', eng.reduce(s0, 'zzz', { type: 'throw', x: 1, z: 0, power: 0.5 }, 100) === s0 && eng.reduce(eng.init(['a'], 5000), 'a', { type: 'throw', x: 1, z: 0, power: 0.5 }, 1000).flying.length === 0 && eng.reduce(s0, 'a', { type: 'throw', x: 1, z: 0, power: 0.5 }, s0.endsAt + 1).flying.length === 0);
  const far = throwAt(eng, s0, 'a', -29, 10, 100); // (a spot well outside the bags' route)
  const done = settle(eng, far, 100);
  check('a gift aimed at empty floor comes down on the floor (no bag), at the floor height', done.st.landed.some((l) => l.owner === 'a' && l.bag === null && Math.abs(l.y - cfg.floorY) < 1e-6));
}

{
  // an OPEN bag: some throws go in and score the bag's points for the thrower; some bounce off the sack; far from it they miss
  const { eng, st: base } = still();
  const bag = base.bags[0];
  const s0 = alone(base, bag.id, SOUTH, 'open');
  const mouth = spot({ slot: SOUTH });
  const res = sweep(eng, s0, 'd', bag.id, mouth, 1000);
  check('aimed over the mouth of an open bag, some throws go in (there IS a spot that scores)', res.filter((r) => r.res === 'in').length >= 3);
  const lat = sweep(eng, s0, 'd', bag.id, mouth, 1000, 3.5);
  check('aimed 3.5 to the side of the mouth they never go in', lat.every((r) => r.res !== 'in'));
  check('some throws hit the outside of the sack and bounce off (the gift keeps flying with a new direction), then fall to the floor', [...res, ...lat].some((r) => r.bounces > 0) && [...res, ...lat].filter((r) => r.bounces > 0 && r.res !== 'in').every((r) => r.res === 'floor'));
  const farOff = [-6, -5, 5, 6].map((off) => {
    const sa = s0.stations.d, ln = Math.hypot(mouth.x - sa.x, mouth.z - sa.z), dx = (mouth.x - sa.x) / ln, dz = (mouth.z - sa.z) / ln;
    return settle(eng, throwAt(eng, s0, 'd', mouth.x + dx * off, mouth.z + dz * off, 1000), 1000).st.landed.some((l) => l.owner === 'd' && l.bag === bag.id);
  });
  check('throws aimed 5 or more units short of or past the bag do not go in', farOff.every((x) => !x));
}

{
  // control: the player with the most gifts in a bag controls it; a tie or an empty bag is neutral; every bag is worth the same (one)
  const { eng, st: base } = still(4);
  const smallBag = base.bags[1];
  const s0 = alone(base, smallBag.id, SOUTH, 'open');
  const sp = spot({ slot: SOUTH });
  const offD = middle(sweep(eng, s0, 'd', smallBag.id, sp, 1000)), offA = middle(sweep(eng, s0, 'a', smallBag.id, sp, 1000));
  check('the bottom player and the left player each have a spot that scores in the bag', offD !== undefined && offA !== undefined);
  let st = s0, t = 1000;
  const put = (id: string, off: number | undefined) => {
    const s = st.stations[id], len = Math.hypot(sp.x - s.x, sp.z - s.z), dx = (sp.x - s.x) / len, dz = (sp.z - s.z) / len;
    const r = settle(eng, throwAt(eng, st, id, sp.x + dx * (off ?? 0), sp.z + dz * (off ?? 0), t), t); st = r.st; t = r.t + 10;
  };
  const bagNow = () => view(st).bags.find((b) => b.id === smallBag.id)!;
  const own = (id: string) => view(st).players[id].controlled;
  check('an empty bag is neutral (nobody controls it)', bagNow().leader === null && own('d') === 0);
  put('d', offD);
  check('the first gift in makes its thrower the leader: they control the bag (and it counts as one bag)', bagNow().leader === 'd' && own('d') === 1 && own('a') === 0);
  put('a', offA);
  check('a tie leaves the bag neutral again (nobody controls it)', bagNow().leader === null && own('d') === 0 && own('a') === 0);
  put('a', offA);
  check('the player with strictly the most gifts takes control', bagNow().leader === 'a' && own('a') === 1);
  put('d', offD); put('d', offD);
  check('and control changes hands when someone gets ahead', bagNow().leader === 'd' && own('d') === 1 && own('a') === 0);
  check('the bag is never used up or sent away: it is still there and still open', view(st).bags.length === 9 && view(st).bags.some((x) => x.id === smallBag.id) && st.landed.some((l) => l.bag === smallBag.id));
  // bigger bags are worth exactly the same (one bag), they are just bigger targets
  const largeBag = base.bags[2];
  const sl = alone(base, largeBag.id, SOUTH, 'open');
  const offL = middle(sweep(eng, sl, 'd', largeBag.id, sp, 1000));
  const sb = sl.stations.d, ln = Math.hypot(sp.x - sb.x, sp.z - sb.z), dxl = (sp.x - sb.x) / ln, dzl = (sp.z - sb.z) / ln;
  const rl = settle(eng, throwAt(eng, sl, 'd', sp.x + dxl * (offL ?? 0), sp.z + dzl * (offL ?? 0), 1000), 1000);
  check('a gift in any other bag (here a different size) also makes its thrower control exactly one bag (all bags are worth the same)', view(rl.st).players.d.controlled === 1);
}

{
  // a SHUT bag: the scoring zone is off and the gathered bag makes gifts bounce off; when it opens again gifts go in
  const { eng, st: base } = still(4);
  const bag = base.bags[0];
  const closed = alone(base, bag.id, SOUTH, 'closed');
  const open = alone(base, bag.id, SOUTH, 'open');
  const sp = spot({ slot: SOUTH });
  const goes = sweep(eng, open, 'd', bag.id, sp, 1000).filter((r) => r.res === 'in').map((r) => r.off);
  const sClosed = sweep(eng, closed, 'd', bag.id, sp, 1000);
  check('with the bag cinched shut, none of the throws that score into the open bag score (the scoring zone is off)', goes.length >= 3 && sClosed.every((r) => r.res !== 'in'));
  check('a shut bag is solid: throws that would have gone in never score, and most of them bounce off the belly or the gathered tip (the rest pass beside it)', (() => { const would = sClosed.filter((r) => goes.includes(r.off)); return would.every((r) => r.res === 'floor') && would.filter((r) => r.bounces > 0).length >= would.length * 0.6; })());
  const mid = goes[Math.floor(goes.length / 2)];
  const s = closed.stations.d, len = Math.hypot(sp.x - s.x, sp.z - s.z), dx = (sp.x - s.x) / len, dz = (sp.z - s.z) / len;
  const shot = (st: St, t: number) => settle(eng, throwAt(eng, st, 'd', sp.x + dx * mid, sp.z + dz * mid, t), t).st;
  const timed: St = { ...open, bags: open.bags.map((b) => (b.id === bag.id ? { ...b, closeAt: 0, openAt: 5000 } : b)) }; // (closed until 5 s, then open)
  const during = shot(timed, 1000);
  const after = shot(timed, 6000);
  check('a bag is shut until openAt: the same throw does nothing before it and counts after it', view(during).bags.find((x) => x.id === bag.id)!.leader === null && view(after).bags.find((x) => x.id === bag.id)!.leader === 'd');
  const lateClose: St = { ...open, bags: open.bags.map((b) => (b.id === bag.id ? { ...b, closeAt: 6000, openAt: 20000 } : b)) };
  check('and a bag that closes later takes gifts until it is cinched shut', view(shot(lateClose, 1000)).bags.find((x) => x.id === bag.id)!.leader === 'd' && view(shot(lateClose, 7000)).bags.find((x) => x.id === bag.id)!.leader === null);
}

{
  // the bags move: a predictable circle; aim ahead of the bag and it goes in, aim where it was long ago and it misses
  const eng = createSantaSack({ minThrowGapMs: 0 });
  const st0 = eng.init(ids(4), 1000);
  const v = view(st0);
  check('the route is a circle round the middle; bags keep moving at a steady speed (units per second as set)', Math.abs(v.orbit.speed * v.orbit.radius - cfg.orbitSpeedUnits) < 0.001);
  const bag0 = st0.bags[0];
  const bag = { ...bag0, slot: SOUTH - v.orbit.speed * ((2000 + 1000 - 1000) / 1000) }; // (it passes the bottom of its route about when a throw made at t0 arrives)
  const st = alone(st0, bag0.id, bag.slot, 'open');
  const posAt = (at: number) => { const a = bag.slot + v.orbit.speed * ((at - 1000) / 1000); return { x: Math.cos(a) * v.orbit.radius, z: Math.sin(a) * v.orbit.radius }; };
  const s = st.stations.d;
  const t0 = 2000;
  const flightFor = (target: { x: number; z: number }) => lobPlan(cfg, Math.min(cfg.rangeMax, Math.max(cfg.rangeMin, Math.hypot(target.x - s.x, target.z - s.z)))).flight * 1000;
  let flight = 1000;
  for (let i = 0; i < 20; i++) flight = flightFor(posAt(t0 + flight));
  const lead = posAt(t0 + flight);
  const tryAround = (centre: { x: number; z: number }, lo = -2.5, hi = 2.5) => {
    let scored = 0;
    const len = Math.hypot(centre.x - s.x, centre.z - s.z), dx = (centre.x - s.x) / len, dz = (centre.z - s.z) / len;
    for (let off = lo; off <= hi + 0.01; off += 0.25) {
      let t2 = throwAt(eng, st, 'd', centre.x + dx * off, centre.z + dz * off, t0);
      for (let i = 0; i < 240 && t2.flying.length > 0; i++) t2 = eng.tick!(t2, DT, t0 + (i + 1) * 25);
      if (t2.landed.some((l) => l.owner === 'd' && l.bag === bag0.id)) scored++;
    }
    return scored;
  };
  const ahead = tryAround(lead), here = tryAround(posAt(t0 - 2000), -1, 1);
  check('aimed ahead of the moving bag (where it will be) some throws go in; aimed where it was 2 seconds ago they all miss (it has moved on)', ahead >= 2 && here === 0);
}

{
  // the winner controls the most bags at the end; leaving; the view
  const eng = createSantaSack({ orbitSpeedUnits: 0, minThrowGapMs: 0 });
  const st = eng.init(['a', 'b', 'c', 'b'], 0);
  const withCounts = (lists: Record<string, number>[]): St => ({ ...st, bags: st.bags.map((b, i) => ({ ...b, counts: lists[i] ?? {} })) });
  const a4 = withCounts([{ a: 3 }, { a: 1, b: 1 }, { a: 2 }, { a: 5, b: 1 }, { b: 2 }, { b: 1 }, { b: 4, a: 1 }, {}, {}]); // a controls 3 bags (the first, third and fourth), b controls 3 (5th, 6th, 7th), one tied, two empty
  check('the score is how many bags you control at the end (ties and empty bags count for nobody)', eng.scores(a4).a === 3 && eng.scores(a4).b === 3 && eng.scores(a4).c === 0);
  check('a tie for the most bags is a draw', eng.getWinner(a4) === null);
  const win = withCounts([{ a: 3 }, { a: 1, b: 1 }, { a: 2 }, { a: 5, b: 1 }, { b: 2 }, { b: 1 }, { a: 1 }, {}, {}]);
  check('the player who controls the most bags wins', eng.getWinner(win) === 'a' && eng.scores(win).a === 4 && eng.scores(win).b === 2);
  check('nobody controls a bag: a draw', eng.getWinner(withCounts([])) === null);
  const gone = eng.removePlayer(win, 'a');
  check('a player who leaves is dropped, and their gifts leave the bags with them', !('a' in gone.stations) && view(gone).players.a === undefined && view(gone).bags.every((b) => b.leader !== 'a') && eng.scores(gone).b === 4);
  const v = view(e.init(['a', 'b'], 100));
  check('the view has what phones need: stations, route, the 9 bags with their lids and leaders, how many bags each player controls, how a throw flies (and no sleigh or room: it is a clearing)', v.gameId === 'santa-sack' && Object.keys(v.stations).length === 2 && v.orbit.radius === cfg.orbitRadius && v.bags.length === 9 && v.players.a.controlled === 0 && v.lob.aimHeight > 1 && !('sleigh' in v) && !('room' in v));
}

console.log(failures === 0 ? '\nAll Santa\'s Sack checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
