// Broadside Battle engine rules (no sockets). Run: npx tsx scripts/test-pirate.ts
import {
  AIM_PITCH_MAX, AIM_YAW_MAX, BALL_SPEED_H, SEA_DRIFT, SHIP_LANE, RELOAD_MS, WICK_MS, WHALE_TUNING, breachEvents, durationOf, launchOf, localToWorld, makeWhaleSchedule, shipPose, shotPoint, simulateShot,
  whalePointWorld, whalePose, whaleVisitAt, worldToLocal,
  type PirateBroadsideView, type TeamId, type V3,
} from '@fgn/shared';
import { createPirateBroadside } from '../src/games/pirateBroadside';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const T0 = 1_000_000;
const eng = createPirateBroadside({ durationMs: 60_000, whale: null }); // (the rules below are tested without the whale; the whale has its own checks at the end)
type S = ReturnType<typeof eng.init>;
const teams = { a: 'yellow', b: 'purple', c: 'yellow', d: 'purple', e: 'yellow' } as Record<string, TeamId>;
const ctx = { teams };
const fresh = (ids = ['a', 'b'], c = ctx): S => eng.init(ids, T0, c);
function run(s: S, from: number, ms: number, step = 25): number {
  let t = from;
  for (let i = 0; i < ms / step; i++) { t += step; eng.tick!(s, step / 1000, t); }
  return t;
}
const view = (s: S) => eng.view(s) as PirateBroadsideView;

// ----- the ships rock, within limits, and the pull and flight times are as designed -----
let maxRoll = 0, maxPitch = 0, minHeave = 9, maxHeave = -9;
for (let t = 0; t < 120; t += 0.05) for (const team of ['yellow', 'purple'] as const) { const p = shipPose(team, t); maxRoll = Math.max(maxRoll, Math.abs(p.roll)); maxPitch = Math.max(maxPitch, Math.abs(p.pitch)); minHeave = Math.min(minHeave, p.heave); maxHeave = Math.max(maxHeave, p.heave); }
check('the ships roll a few degrees and pitch less, and heave on the swell', maxRoll > 0.05 && maxRoll < 0.11 && maxPitch > 0.03 && maxPitch < 0.07 && maxHeave - minHeave > 0.5);
check('the two ships do not rock in step', Math.abs(shipPose('yellow', 3).roll - shipPose('purple', 3).roll) > 0.01);
const p0 = localToWorld('yellow', shipPose('yellow', 4), [3, 2, 1]);
const back = worldToLocal('yellow', shipPose('yellow', 4), p0);
check('a point turned into the world and back is where it began', Math.hypot(back[0] - 3, back[1] - 2, back[2] - 1) < 1e-9);
const straight = launchOf('yellow', 0, 1, shipPose('yellow', 0), 0, 0.4);
const bent = shotPoint(straight, 2)[0] - (straight.p0[0] + straight.v0[0] * 2);
check('a shot is pulled towards the STERN as it flies, so it has to be led', Math.abs(bent - 0.5 * SEA_DRIFT * 4) < 1e-9 && bent < -1);
check('every shot has the same speed across the water, whatever the angle', [0.1, 0.3, 0.5, 0.7].every((pitch) => { const l = launchOf('yellow', 0, 1, shipPose('yellow', 3), 0.1, pitch); return Math.abs(Math.hypot(l.v0[0], l.v0[2]) - BALL_SPEED_H) < 1e-9; }));
const reach = (pitch: number) => { const l = launchOf('yellow', 0, 1, shipPose('yellow', 0), 0, pitch); const r = simulateShot(l, 0, 'purple'); const e = shotPoint(l, r.tau); return { tau: r.tau, dist: Math.hypot(e[0] - l.p0[0], e[2] - l.p0[2]) }; };
check('...so a ball takes longer only because it goes further (time is about the distance over the speed, at any angle)', [0.2, 0.35, 0.5, 0.65].every((pitch) => { const r = reach(pitch); return Math.abs(r.dist / r.tau - BALL_SPEED_H) < 3; }));
let minLane = 99, maxLane = 0; const crossings: number[] = [];
let above = shipPose('yellow', 0).lane > SHIP_LANE;
for (let t = 0; t < 400; t += 0.1) { const l = shipPose('yellow', t).lane; minLane = Math.min(minLane, l); maxLane = Math.max(maxLane, l); if ((l > SHIP_LANE) !== above) { above = !above; crossings.push(t); } }
check('the ships swing closer and further apart, a gap of about 20 to 54 (never touching)', minLane > 12 && minLane < 17 && maxLane > 29 && maxLane < 34);
const swings = crossings.length > 3 ? (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1) * 2 : 0;
check('...about every 30 seconds, give or take (and not on a fixed pattern)', swings > 18 && swings < 42);
const flight = (pitch: number) => simulateShot(launchOf('yellow', 0, 1, shipPose('yellow', 0), 0, pitch), 0, 'purple').tau;
check('a shot at the usual angles takes about 1 to 3 seconds to land', flight(0.3) > 0.9 && flight(0.4) > 1.2 && flight(0.4) < 2.4 && flight(0.7) < 3.6);

// ----- teams and crews -----
let s = fresh(['a', 'b', 'c', 'd', 'e']);
check('players are on the teams the room set, in slots along their own ship', view(s).players.a.team === 'yellow' && view(s).players.c.slot === 1 && view(s).players.e.slot === 2 && view(s).players.b.slot === 0 && view(s).crew.yellow === 3 && view(s).crew.purple === 2);
check('without a team context the players alternate between the ships', Object.values(view(eng.init(['x', 'y', 'z'], T0)).players).map((p) => p.team).join() === 'yellow,purple,yellow');

// ----- the cannon: fire, 1 second of wick, boom, 2 seconds, again -----
s = fresh();
eng.reduce(s, 'a', { type: 'fire' }, T0 - 500);
check('no firing before the start', view(s).players.a.wickAt === null);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 1000);
let v = view(s).players.a;
check('fire lights the wick now and sets the boom for 1 second later and the next shot 2 seconds after that', v.wickAt === T0 + 1000 && v.launchAt === T0 + 1000 + WICK_MS && v.readyAt === T0 + 1000 + WICK_MS + RELOAD_MS);
let t = run(s, T0 + 1000, WICK_MS - 100);
check('nothing flies while the wick burns', view(s).shots.length === 0 && view(s).players.a.wickAt !== null);
eng.reduce(s, 'a', { type: 'fire' }, t);
check('pressing fire while the wick burns changes nothing', view(s).players.a.launchAt === T0 + 1000 + WICK_MS);
t = run(s, t, 200);
check('BOOM: the ball launches at exactly the moment the wick ran out', view(s).shots.length === 1 && view(s).shots[0].launchAt === T0 + 1000 + WICK_MS && view(s).players.a.wickAt === null);
eng.reduce(s, 'a', { type: 'fire' }, t);
check('it cannot fire again during the 2 second wait', view(s).players.a.wickAt === null);
t = run(s, t, RELOAD_MS - 300);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 1000 + WICK_MS + RELOAD_MS - 20);
check('...not even a moment before it is ready', view(s).players.a.wickAt === null);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 1000 + WICK_MS + RELOAD_MS + 10);
check('...but 2 seconds after the boom it can fire again', view(s).players.a.wickAt === T0 + 1000 + WICK_MS + RELOAD_MS + 10);
check('the other cannon is not held up by it', (() => { eng.reduce(s, 'b', { type: 'fire' }, T0 + 5000); return view(s).players.b.wickAt === T0 + 5000; })());

// ----- aiming never stops, even while the wick burns -----
s = fresh();
eng.reduce(s, 'a', { type: 'aim', yaw: 0.1, pitch: 0.3 }, T0 + 100);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 200);
eng.reduce(s, 'a', { type: 'aim', yaw: -0.2, pitch: 0.55 }, T0 + 700);
check('aiming while the wick burns works', view(s).players.a.yaw === -0.2 && view(s).players.a.pitch === 0.55);
run(s, T0 + 200, 1100);
const shot = view(s).shots[0];
const expected = launchOf('yellow', 0, 1, shipPose('yellow', (T0 + 1200 - T0) / 1000), -0.2, 0.55);
check('the shot goes where the cannon pointed at the moment of the boom (the aim made during the burn)', !!shot && Math.hypot(shot.v0[0] - expected.v0[0], shot.v0[1] - expected.v0[1], shot.v0[2] - expected.v0[2]) < 0.01);
eng.reduce(s, 'a', { type: 'aim', yaw: 9, pitch: -9 }, T0 + 2000);
check('the aim is held inside the cannon\'s arc', view(s).players.a.yaw === AIM_YAW_MAX && view(s).players.a.pitch < 0.1);
eng.reduce(s, 'a', { type: 'aim', yaw: 0, pitch: 99 }, T0 + 2100);
check('...up to its highest angle', view(s).players.a.pitch === AIM_PITCH_MAX);
eng.reduce(s, 'a', { type: 'aim', yaw: NaN, pitch: 0.2 }, T0 + 2200);
check('a bad aim value is ignored', view(s).players.a.pitch === AIM_PITCH_MAX);
eng.reduce(s, 'zzz', { type: 'fire' }, T0 + 2300);
check('actions from a non-player are ignored', Object.keys(view(s).players).length === 2);

// ----- the result does not depend on how often the server ticks -----
const slow = fresh(), quick = fresh();
for (const e of [slow, quick]) { eng.reduce(e, 'a', { type: 'aim', yaw: 0.05, pitch: 0.4 }, T0 + 50); eng.reduce(e, 'a', { type: 'fire' }, T0 + 123); }
run(slow, T0 + 123, 3000, 100); run(quick, T0 + 123, 3000, 10);
check('the same shot at 10 and at 100 ticks a second', JSON.stringify(view(slow).shots[0]) === JSON.stringify(view(quick).shots[0]) && !!view(slow).shots[0]);

// ----- hits: they score for the team when the ball arrives, wherever they land -----
/** An aim that hits the enemy ship when fired by cannon `a` at time `fireMs`, found by trying them. */
function findHit(fireMs: number): { yaw: number; pitch: number } | null {
  for (let yaw = -0.5; yaw <= 0.5; yaw += 0.04) for (let pitch = 0.2; pitch <= 0.7; pitch += 0.02) {
    const seconds = (fireMs - T0) / 1000;
    if (simulateShot(launchOf('yellow', 0, 1, shipPose('yellow', seconds), yaw, pitch), seconds, 'purple').hit) return { yaw, pitch };
  }
  return null;
}
const fireAt = T0 + 2000 + WICK_MS;
const aimHit = findHit(fireAt);
check('some aims hit the enemy ship', aimHit !== null);
let tries = 0, hits = 0;
for (let yaw = -0.5; yaw <= 0.5; yaw += 0.05) for (let pitch = 0.1; pitch <= 0.7; pitch += 0.04) { tries++; const sec = 5; if (simulateShot(launchOf('yellow', 0, 1, shipPose('yellow', sec), yaw, pitch), sec, 'purple').hit) hits++; }
check('...but not all of them (the rocking, the pull and the range matter): between 5% and 60% of a spread of aims hit', hits / tries > 0.05 && hits / tries < 0.6);
s = fresh(['a', 'b'], { teams: { a: 'yellow', b: 'purple' } });
eng.reduce(s, 'a', { type: 'aim', yaw: aimHit!.yaw, pitch: aimHit!.pitch }, T0 + 100);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 2000);
t = run(s, T0 + 2000, WICK_MS + 50);
const flying = view(s).shots[0];
check('the ball is in the air and has not scored yet', !!flying && flying.hit && view(s).players.a.hits === 0 && view(s).totals.yellow === 0);
t = run(s, t, Math.floor((flying.endAt - t - 30) / 25) * 25);
check('...it has still not scored just before it lands', view(s).players.a.hits === 0);
t = run(s, t, 100);
check('...it scores the moment it lands: one point for the team ', view(s).players.a.hits === 1 && view(s).totals.yellow === 1 && view(s).totals.purple === 0 && eng.scores(s).a === 1);
check('a hit on a ship is a hit wherever it lands (the view says where, in the ship\'s own frame)', !!flying.hitLocal && Math.abs(flying.hitLocal[0]) < 19);
// a miss scores nothing
s = fresh();
eng.reduce(s, 'a', { type: 'aim', yaw: 0, pitch: 0.05 }, T0 + 100);
eng.reduce(s, 'a', { type: 'fire' }, T0 + 2000);
run(s, T0 + 2000, 6000);
check('a miss lands in the sea and scores nothing', view(s).players.a.hits === 0 && view(s).totals.yellow === 0);
// the round's end
s = fresh(['a', 'b']);
const lateFire = T0 + 60_000 - 500;
eng.reduce(s, 'a', { type: 'aim', yaw: 0, pitch: 0.4 }, T0 + 100);
eng.reduce(s, 'a', { type: 'fire' }, lateFire);
run(s, lateFire, 2000);
check('a cannon whose wick runs out after the clock has ended never fires', view(s).shots.length === 0 && eng.isOver(s, T0 + 60_000));
eng.reduce(s, 'b', { type: 'fire' }, T0 + 60_001);
check('no firing after the end', view(s).players.b.wickAt === null);
check('there is no single winner (the room picks the winning team); the scores are each player\'s hits', eng.getWinner(s) === null && eng.scores(s).a === 0);
eng.removePlayer(s, 'a');
check('a player who leaves goes quiet but the ship keeps its crew slots', view(s).players.a === undefined && view(s).crew.yellow === 1);


// ---- the whale: three visits in a fixed order at random times, and the leap blocks cannonballs
{
  const T = WHALE_TUNING;
  let ok = true, minGap = 99;
  for (let i = 0; i < 2000; i++) {
    const w = makeWhaleSchedule();
    const inWin = w.peek >= 15 && w.peek <= 30 && w.blow >= 35 && w.blow <= 55 && w.breach >= 65 && w.breach <= 75;
    const gap1 = w.blow - (w.peek + durationOf('peek', T)), gap2 = w.breach - (w.blow + durationOf('blow', T));
    minGap = Math.min(minGap, gap1, gap2);
    if (!inWin || w.peek >= w.blow || w.blow >= w.breach || w.breach + durationOf('breach', T) > 90) ok = false;
  }
  check('the whale comes three times in order, each inside its window (15-30s, 35-55s, 65-75s), never back to back, and is done before the round ends', ok && minGap >= 3 - 1e-9);
  const draws = new Set(Array.from({ length: 50 }, () => makeWhaleSchedule().peek));
  check('every game draws different times', draws.size > 30);
  const eng2 = createPirateBroadside({ durationMs: 90_000 });
  const v2 = eng2.view(eng2.init(['a', 'b'], 0, { teams: { a: 'yellow', b: 'purple' } })) as PirateBroadsideView;
  check('the view tells the phones when the visits start', !!v2.whale && v2.whale.peek >= 15 && v2.whale.breach <= 75);
  const none = createPirateBroadside({ durationMs: 90_000, whale: null });
  check('a round can have no whale', (none.view(none.init(['a'], 0)) as PirateBroadsideView).whale === null);
  check('the right visit is on at the right time', whaleVisitAt({ peek: 20, blow: 40, breach: 70 }, 22)?.kind === 'peek' && whaleVisitAt({ peek: 20, blow: 40, breach: 70 }, 45)?.kind === 'blow' && whaleVisitAt({ peek: 20, blow: 40, breach: 70 }, 75)?.kind === 'breach' && whaleVisitAt({ peek: 20, blow: 40, breach: 70 }, 33) === null);

  // a ball aimed through the middle of the whale at the top of its leap
  const ev = breachEvents(T), start = 70, apexT = ev.apexAt;
  const centre = whalePointWorld(whalePose('breach', apexT, T), [0, 0, 0]);
  const tauHit = 1.0;
  const v0: V3 = [0, 0, 22];
  const off = shotPoint({ p0: [0, 0, 0], v0 } as never, tauHit);
  const launch = { p0: [centre[0] - off[0], centre[1] - off[1], centre[2] - off[2]] as V3, v0 };
  const through = simulateShot(launch as never, start + apexT - tauHit, 'purple', start);
  check('a ball flying into the leaping whale is stopped by it: it is blocked, it does not hit the ship, and it is gone about when it reaches the whale', !!through.blocked && !through.hit && !through.splash && Math.abs(through.tau - tauHit) < 0.6);
  const same = simulateShot(launch as never, start + apexT - tauHit, 'purple', null);
  check('the same ball with no whale is not blocked', same.blocked === null);
  const before = simulateShot(launch as never, start - 20, 'purple', start);
  check('...nor when the whale is not there yet (it blocks only while it is out of the water)', before.blocked === null);
  const wide = simulateShot({ ...launch, p0: [launch.p0[0] + 40, launch.p0[1], launch.p0[2]] } as never, start + apexT - tauHit, 'purple', start);
  check('a ball far from the whale (past its nose) flies on', wide.blocked === null);
}

console.log(failed === 0 ? '\nAll Broadside Battle engine checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
