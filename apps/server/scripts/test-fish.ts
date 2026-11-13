/**
 * Fish pick-ups in the Snowball engine, tested as pure functions (no server, no clocks):
 *   npm run test:fish -w @fgn/server
 * Fish are scattered at the start, more drop half way through (one more per extra player, per wave), a ball collects up to 6 by touching them, and each
 * adds a flat +5 to the damage of its next hit that lands (all of them used up by it).
 */
import type { Terrain } from '@fgn/shared';
import { createSnowball, DEFAULT_SNOWBALL_CONFIG, type SnowballState } from '../src/games/snowball';
import { mulberry32, spawnPoints } from '../src/games/terrain';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const cfg = DEFAULT_SNOWBALL_CONFIG;
const FLAT: Terrain = { height: () => 0, gradient: () => ({ x: 0, z: 0 }) };
const DT = 0.025;
type Ball = SnowballState['balls'][string];
const radius = (b: Ball) => Math.sqrt(b.snow);
const place = (s: SnowballState, id: string, patch: Partial<Ball>): SnowballState => ({ ...s, balls: { ...s.balls, [id]: { ...s.balls[id], ...patch } } });
const fresh = (seed: number, players = ['a', 'b'], overrides = {}) => {
  const engine = createSnowball({ terrain: FLAT, growthPerUnit: 0, random: mulberry32(seed), durationMs: 10_000, ...overrides });
  return { engine, state: engine.init(players, 1000) };
};
const tick = (e: ReturnType<typeof fresh>['engine'], s: SnowballState, now: number) => e.tick!(s, DT, now);

// ---------- the scatter at the start ----------
{
  const { state } = fresh(1);
  check('start: exactly 3 fish are lying in the arena', state.items.length === 3 && state.items.every((i) => i.kind === 'fish'));
  check('start: the fish have different ids', new Set(state.items.map((i) => i.id)).size === 3);
  check('start: every fish is inside the arena, clear of the wall', state.items.every((i) => Math.hypot(i.x, i.z) <= state.arenaRadius - cfg.itemEdgeMargin + 1e-9));
  const spawns = spawnPoints(2, state.arenaRadius);
  check('start: no fish lies on top of a starting position', state.items.every((i) => spawns.every((p) => Math.hypot(p.x - i.x, p.z - i.z) >= cfg.itemClearance - 1e-9)));
  let gap = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) gap = Math.min(gap, Math.hypot(state.items[i].x - state.items[j].x, state.items[i].z - state.items[j].z));
  check('start: the fish are spread out (not bunched together)', gap >= cfg.itemSpacing - 1e-9);
  check('start: nobody is carrying any', Object.values(state.balls).every((b) => b.fish === 0));
  check('start: it is random: a different seed gives a different layout', JSON.stringify(fresh(2).state.items) !== JSON.stringify(state.items));
  check('start: but the same seed gives the same layout', JSON.stringify(fresh(1).state.items) === JSON.stringify(state.items));
  check('start: the view tells phones about the fish and each ball\'s count', e0(state));
  function e0(s: SnowballState) {
    const v = fresh(1).engine.view(s);
    return v.gameId === 'snowball' && v.items.length === 3 && Object.values(v.balls).every((b) => b.fish === 0);
  }
  // more players: one more fish per extra player in every wave
  const big = fresh(3, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).state;
  check('8 players: 3 + 6 extra players = 9 fish at the start, all inside the (larger) arena', big.items.length === 9 && big.items.every((i) => Math.hypot(i.x, i.z) <= big.arenaRadius - cfg.itemEdgeMargin + 1e-9));
  check('3 players: 4 fish at the start', fresh(3, ['a', 'b', 'c']).state.items.length === 4);
  check('4 players: 5 fish at the start', fresh(3, ['a', 'b', 'c', 'd']).state.items.length === 5);
  check('1 player: no fewer than the base 3 (there are no negative extra players)', fresh(3, ['a']).state.items.length === 3);
  check('the config says 6 fish per ball', cfg.fishCapacity === 6);
}

// ---------- collecting ----------
{
  let { engine, state } = fresh(4);
  const target = state.items[0];
  // put ball a right on the first fish, and keep ball b well away
  state = place(state, 'a', { x: target.x, z: target.z });
  state = place(state, 'b', { x: -state.arenaRadius * 0.7, z: 0 });
  state = tick(engine, state, 1100);
  check('collect: rolling over a fish picks it up', state.balls.a.fish === 1);
  check('collect: the fish is gone from the ground', state.items.length === 2 && !state.items.some((i) => i.id === target.id));
  check('collect: the other ball got nothing', state.balls.b.fish === 0);
  // touching counts: just inside (radius + itemRadius) picks up, just outside does not
  const other = state.items[0];
  let s2 = place(state, 'a', { x: other.x + radius(state.balls.a) + cfg.itemRadius + 0.05, z: other.z });
  s2 = tick(engine, s2, 1125);
  check('collect: a ball that is not quite touching a fish leaves it', s2.items.length === 2 && s2.balls.a.fish === 1);
  let s3 = place(state, 'a', { x: other.x + radius(state.balls.a) + cfg.itemRadius - 0.1, z: other.z });
  s3 = tick(engine, s3, 1125);
  check('collect: one that is touching it takes it', s3.items.length === 1 && s3.balls.a.fish === 2);
}
{
  let { engine, state } = fresh(5);
  const target = state.items[0];
  state = place(state, 'a', { x: target.x, z: target.z, fish: cfg.fishCapacity });
  state = place(state, 'b', { x: -state.arenaRadius * 0.7, z: 0 });
  state = tick(engine, state, 1100);
  check('limit: a ball already carrying 6 does not take a 7th', state.balls.a.fish === cfg.fishCapacity);
  check('limit: ...and the fish stays on the ground for someone else', state.items.some((i) => i.id === target.id));
}
{
  // a ball can fill up to 6 one after another, and the 7th is left alone
  let { engine, state } = fresh(18, ['a', 'b'], { itemWaves: [{ at: 0, count: 8, perExtraPlayer: 0, kind: 'fish' }], itemSpacing: 1, itemClearance: 1 });
  state = place(state, 'b', { x: -state.arenaRadius * 0.7, z: 0 });
  for (const item of [...state.items]) {
    state = place(state, 'a', { x: item.x, z: item.z, vx: 0, vz: 0 });
    state = tick(engine, state, 1100);
  }
  check('capacity: rolling over 8 fish in turn leaves the ball carrying exactly 6', state.balls.a.fish === 6);
  check('capacity: ...and the other 2 are still on the ground', state.items.length === 2);
}
{
  // two balls reach one fish in the same tick: the closer one gets it
  let { engine, state } = fresh(6);
  const target = state.items[0];
  state = { ...state, items: [target] };
  state = place(state, 'a', { x: target.x + 1.2, z: target.z });
  state = place(state, 'b', { x: target.x - 0.5, z: target.z });
  state = tick(engine, state, 1100);
  check('contest: when two balls touch one fish at once, the closer one gets it', state.balls.b.fish === 1 && state.balls.a.fish === 0 && state.items.length === 0);
}

// ---------- fish and damage ----------
/** Two balls pressed into each other and closing fast, ready to collide on the next tick. */
function headOn(seed: number, fishA: number, fishB: number, extra: Partial<Ball> = {}) {
  let { engine, state } = fresh(seed);
  state = { ...state, items: [] };
  state = place(state, 'a', { x: -0.95, z: 0, vx: 5, vz: 0, fish: fishA, ...extra });
  state = place(state, 'b', { x: 0.95, z: 0, vx: -5, vz: 0, fish: fishB });
  return { engine, state };
}
const lost = (before: SnowballState, after: SnowballState, id: string) => Math.round((radius(before.balls[id]) - radius(after.balls[id])) * 100 * 1e6) / 1e6;
{
  const { engine, state } = headOn(7, 0, 0);
  const after = tick(engine, state, 2000);
  check('damage: without fish a hit takes the usual 5 from each ball', near(lost(state, after, 'a'), 5, 1e-4) && near(lost(state, after, 'b'), 5, 1e-4));
}
{
  const { engine, state } = headOn(8, 1, 0);
  const after = tick(engine, state, 2000);
  check('damage: one fish adds +5 to that ball\'s hit (the victim loses 10)', near(lost(state, after, 'b'), 10, 1e-4));
  check('damage: ...and the carrier\'s own loss is unchanged (5)', near(lost(state, after, 'a'), 5, 1e-4));
  check('damage: the fish is used up by the hit', after.balls.a.fish === 0);
}
{
  const { engine, state } = headOn(9, 3, 0);
  const after = tick(engine, state, 2000);
  check('damage: 3 fish add +15 (the victim loses 5 + 15 = 20)', near(lost(state, after, 'b'), 20, 1e-4));
  check('damage: all three are used on that one hit', after.balls.a.fish === 0);
}
{
  const { engine, state } = headOn(36, 6, 0);
  const after = tick(engine, state, 2000);
  check('damage: 6 fish add +30 (the victim loses 5 + 30 = 35)', near(lost(state, after, 'b'), 35, 1e-4) && after.balls.a.fish === 0);
  check('thrown: all 6 come back as items, spaced apart', after.items.length === 6 && after.items.every((i) => i.thrown));
}
{
  const { engine, state } = headOn(10, 2, 3);
  const after = tick(engine, state, 2000);
  check('damage: both balls carrying fish both get the bonus (a: 5+10, b: 5+15)', near(lost(state, after, 'b'), 15, 1e-4) && near(lost(state, after, 'a'), 20, 1e-4));
  check('damage: both are used up', after.balls.a.fish === 0 && after.balls.b.fish === 0);
}
{
  // the leader's bigger hit stacks with fish
  const { engine, state } = headOn(11, 2, 0, { snow: 1.5 ** 2 });
  const s = place(state, 'a', { x: -1.2, z: 0 }); // (a is bigger now, so they overlap a bit more)
  const after = tick(engine, s, 2000);
  check('damage: the leader\'s hit (10) and its 2 fish (+10) add up to 20', near(lost(s, after, 'b'), 20, 1e-4));
}
{
  // a victim that is still immune from an earlier hit is spared, and then the fish is NOT used up
  const { engine, state } = headOn(12, 2, 0);
  const s = place(state, 'b', { immuneUntil: 5000, immune: true });
  const after = tick(engine, s, 2000);
  check('immune: an immune victim takes no damage', near(lost(s, after, 'b'), 0, 1e-9));
  check('immune: ...and the fish is kept for a hit that does land', after.balls.a.fish === 2);
}
{
  // a collision too gentle to count as a hit does not use the fish either
  const { engine, state } = headOn(13, 3, 0, { vx: 0.2 });
  const s = place(state, 'b', { vx: -0.2 });
  const after = tick(engine, s, 2000);
  check('gentle touch: no damage, and the fish stay on', near(lost(s, after, 'b'), 0, 1e-9) && after.balls.a.fish === 3);
}
{
  // a ball never shrinks below its minimum, but the fish is still spent on the hit
  const { engine, state } = headOn(14, 3, 0);
  const s = place(state, 'b', { snow: 0.55 ** 2, x: 0.45 }); // (smaller, so move it in to keep the balls overlapping)
  const after = tick(engine, s, 2000);
  check('minimum size: the victim stops at the minimum radius', near(radius(after.balls.b), cfg.minRadius, 1e-9));
  check('minimum size: the fish are still used up', after.balls.a.fish === 0);
}

// ---------- fish come back as pick-ups ----------
{
  const { engine, state } = headOn(30, 3, 0);
  const after = tick(engine, state, 2000);
  const thrown = after.items;
  check('thrown: the 3 used fish come back as 3 items', thrown.length === 3 && thrown.every((i) => i.kind === 'fish' && i.thrown));
  check('thrown: the carrier has none left', after.balls.a.fish === 0);
  const from = after.balls.a;
  const dists = thrown.map((i) => Math.hypot(i.x - from.x, i.z - from.z));
  check('thrown: each lands well away from the hit (between the scatter min and max)', dists.every((d) => d >= cfg.fishScatterMin - 1.5 && d <= cfg.fishScatterMax + 1.5));
  check('thrown: each lands inside the playable area, clear of the wall', thrown.every((i) => Math.hypot(i.x, i.z) <= after.arenaRadius - cfg.itemEdgeMargin + 1e-9));
  let gap = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) gap = Math.min(gap, Math.hypot(thrown[i].x - thrown[j].x, thrown[i].z - thrown[j].z));
  check('thrown: they are scattered apart from each other', gap >= cfg.fishDropSpacing - 1e-9);
  check('thrown: they have new ids', new Set(thrown.map((i) => i.id)).size === 3);
  const v = engine.view(after);
  check('thrown: the view tells phones where each came from and how long it has left', v.gameId === 'snowball' && v.items.every((i) =>
    i.thrown && near(i.thrown.totalSeconds, cfg.fishFlightSeconds) && i.thrown.secondsLeft > cfg.fishFlightSeconds - 0.01 && i.thrown.secondsLeft <= cfg.fishFlightSeconds));

  // not collectable in the air: put the other ball right on one of them
  const target = thrown[0];
  let air = place(after, 'b', { x: target.x, z: target.z, vx: 0, vz: 0 });
  air = tick(engine, air, 2000 + 100);
  check('in the air: a ball sitting on a thrown fish cannot take it yet', air.balls.b.fish === 0 && air.items.some((i) => i.id === target.id));
  const during = engine.view(air);
  check('in the air: its remaining flight time counts down', during.gameId === 'snowball' && (during.items.find((i) => i.id === target.id)?.thrown?.secondsLeft ?? 9) < cfg.fishFlightSeconds - 0.05);
  // after landing: collectable, and the view stops calling it thrown
  let landed = place(air, 'b', { x: target.x, z: target.z, vx: 0, vz: 0 });
  landed = tick(engine, landed, 2000 + cfg.fishFlightSeconds * 1000 + 50);
  check('landed: once it has landed it can be picked up again', landed.balls.b.fish === 1 && !landed.items.some((i) => i.id === target.id));
  const landedView = engine.view(place(air, 'b', { x: -state.arenaRadius * 0.7, z: 0 }) && tick(engine, place(air, 'b', { x: -state.arenaRadius * 0.7, z: 0 }), 2000 + cfg.fishFlightSeconds * 1000 + 50));
  check('landed: after landing the view no longer marks it as thrown', landedView.gameId === 'snowball' && landedView.items.every((i) => !i.thrown));
  // conservation: fish on balls + fish on the ground never changes through a hit
  check('conserved: 3 fish in, 3 fish out (none lost or invented by the hit)', state.balls.a.fish + state.balls.b.fish + state.items.length === after.balls.a.fish + after.balls.b.fish + after.items.length);
}
{
  // both balls carrying fish: both sets are thrown
  const { engine, state } = headOn(31, 2, 3);
  const after = tick(engine, state, 2000);
  check('thrown: when both carry fish, all 5 come back as items', after.items.length === 5 && after.balls.a.fish === 0 && after.balls.b.fish === 0);
}
{
  // a victim who was immune: the fish are kept (nothing thrown)
  const { engine, state } = headOn(32, 2, 0);
  const s = place(state, 'b', { immuneUntil: 5000, immune: true });
  const after = tick(engine, s, 2000);
  check('no hit, no throw: fish kept when the hit does not land', after.items.length === 0 && after.balls.a.fish === 2);
}
{
  // a hit right by the wall still lands everything inside the playable area
  let { engine, state } = headOn(33, 3, 0);
  const edge = state.arenaRadius - 3;
  state = place(place(state, 'a', { x: edge - 0.95, z: 0 }), 'b', { x: edge + 0.95 - 0.2, z: 0 });
  const after = tick(engine, state, 2000);
  check('wall: fish thrown from a hit near the wall still land inside the arena', after.items.length === 3 && after.items.every((i) => Math.hypot(i.x, i.z) <= after.arenaRadius - cfg.itemEdgeMargin + 1e-9));
}
{
  // ...and a different random layout each time, but the same one for the same seed
  const a1 = tick(headOn(34, 3, 0).engine, headOn(34, 3, 0).state, 2000).items.map((i) => [i.x, i.z]);
  const a2 = tick(headOn(34, 3, 0).engine, headOn(34, 3, 0).state, 2000).items.map((i) => [i.x, i.z]);
  const b1 = tick(headOn(35, 3, 0).engine, headOn(35, 3, 0).state, 2000).items.map((i) => [i.x, i.z]);
  check('thrown: the landing spots are random, and repeatable with the same seed', JSON.stringify(a1) === JSON.stringify(a2) && JSON.stringify(a1) !== JSON.stringify(b1));
}

// ---------- the wave half way through ----------
{
  let { engine, state } = fresh(15);
  const start = 1000;
  const at = (fraction: number) => start + fraction * 10_000;
  // keep the balls out of the way so nothing is collected
  state = place(place(state, 'a', { x: -state.arenaRadius * 0.7 }), 'b', { x: state.arenaRadius * 0.7 });
  let s = tick(engine, state, at(0.49));
  check('wave: just before half way there are still only the first 3', s.items.length === 3 && s.wavesDone === 1);
  s = tick(engine, s, at(0.5));
  check('wave: at half way, 3 more drop (6 in all)', s.items.length === 6 && s.wavesDone === 2);
  check('wave: the new ones have new ids', new Set(s.items.map((i) => i.id)).size === 6);
  const ids = s.items.map((i) => i.id).join();
  s = tick(engine, s, at(0.75));
  s = tick(engine, s, at(0.99));
  check('wave: no further drops after that', s.items.length === 6 && s.items.map((i) => i.id).join() === ids);
  check('wave: the new fish are inside the arena and clear of the balls', s.items.slice(3).every((i) =>
    Math.hypot(i.x, i.z) <= s.arenaRadius - cfg.itemEdgeMargin + 1e-9
    && Object.values(s.balls).every((b) => Math.hypot(b.x - i.x, b.z - i.z) >= cfg.itemClearance - 1e-9)));
}
{
  // the half-way wave also grows with the player count
  for (const [players, perWave] of [[2, 3], [3, 4], [5, 6], [8, 9]] as const) {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].slice(0, players);
    const { engine, state } = fresh(19, ids);
    let s = state;
    for (const id of ids) s = place(s, id, { x: s.arenaRadius * 0.9, z: s.arenaRadius * 0.9 }); // park every ball in a far corner (clear of any pick-up, and outside the wall check)
    s = tick(engine, s, 1000 + 0.5 * 10_000);
    check(`waves: ${players} players get ${perWave} fish at the start and ${perWave} more half way (${perWave * 2} in all)`, state.items.length === perWave && s.items.length === perWave * 2);
  }
}
{
  // fish that were collected before half way still leave the second wave at 3 new ones
  let { engine, state } = fresh(16);
  const target = state.items[0];
  state = place(place(state, 'a', { x: target.x, z: target.z }), 'b', { x: -state.arenaRadius * 0.7, z: 0 });
  let s = tick(engine, state, 1100);
  s = place(place(s, 'a', { x: s.arenaRadius * 0.7, z: 0 }), 'b', { x: -s.arenaRadius * 0.7, z: 0 });
  s = tick(engine, s, 1000 + 0.5 * 10_000);
  check('wave: after one was collected, the wave still brings 3 more (2 + 3 = 5 on the ground)', s.items.length === 5);
}
{
  // other item sets work through the same schedule (the door is open for more kinds / waves later)
  const { engine, state } = fresh(17, ['a', 'b'], { itemWaves: [{ at: 0, count: 5, perExtraPlayer: 0, kind: 'fish' }, { at: 0.25, count: 1, perExtraPlayer: 0, kind: 'fish' }, { at: 0.75, count: 2, perExtraPlayer: 0, kind: 'fish' }] });
  let s = state;
  check('schedule: a different schedule starts with its own first wave', s.items.length === 5);
  s = place(place(s, 'a', { x: -s.arenaRadius * 0.7 }), 'b', { x: s.arenaRadius * 0.7 });
  s = tick(engine, s, 1000 + 0.3 * 10_000);
  s = tick(engine, s, 1000 + 0.8 * 10_000);
  check('schedule: ...and each later wave arrives on time (5 + 1 + 2 = 8)', s.items.length === 8);
}

console.log(failures === 0 ? '\nAll fish checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
