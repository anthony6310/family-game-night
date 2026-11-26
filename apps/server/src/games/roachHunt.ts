import {
  BOTTLE_RADIUS, FOOD_EAT_RATE, FOOD_ROT_MS, FOOD_EAT_REACH, FOOD_KINDS, FOOD_POOL, FOOD_RADIUS, FOOD_RESPAWN_MS, POISON_DRAIN, POISON_RADIUS, ROACH_LIFE_DRAIN, ROACH_LIFE_MAX, ROACH_LIFE_POISONED_MAX, ROACH_LIFE_START, ROACH_RADIUS, SANDAL_RADIUS, SANDAL_SPEED, SMACK_HIT_ARREST_MS, SMACK_MISS_ARREST_MS, SMACK_RADIUS, SMACK_WINDUP_MS,
  canStandAt, foodCap, inPoison, makeLayout, moveRoach, placeFood, roachRoundSeconds, roachStart, smackSpot, stepMover,
  type Disc, type Layout, type RoachFoodView, type RoachHuntView, type RoachPlayerView,
} from '@fgn/shared';
import type { GameEngine, TeamContext } from './types';

export interface RoachConfig {
  /** A fixed round length (tests); leave it out for the real one, which grows with the number of roaches (`roachRoundSeconds`). */
  durationMs?: number;
  /** A fixed kitchen layout (tests); leave both out for a new random one each game. */
  layout?: Layout;
  seed?: number;
}
export const DEFAULT_ROACH_CONFIG: RoachConfig = {};

interface Body {
  role: 'roach' | 'sandal';
  x: number;
  z: number;
  sx: number; // the steer
  sz: number;
  facing: number;
  alive: boolean;
  diedAt: number | null;
  cause: 'squashed' | 'starved' | 'left' | null;
  life: number; // a roach's lifetime left, in seconds
  eating: boolean; // eating right now
  lifeMax: number; // the most it can have (lowered for good once it has stood in the spilled poison)
  smackAt: number | null; // the sandal: when the swing started
  impactAt: number | null; // ...and when it lands (null once it has)
  smackX: number;
  smackZ: number;
  readyAt: number; // the sandal: it is out of the player's hands until this time
  smackHit: boolean;
}
interface Food { id: number; kind: number; x: number; z: number; pool: number; eating: boolean; poisonedAt: number | null }
interface RoachState {
  startsAt: number;
  endsAt: number;
  sandalId: string;
  layout: Layout; // this game's kitchen
  poisonAt: number | null; // when the bottle of poison was smashed
  players: Record<string, Body>;
  foods: Food[]; // the pieces on the floor (a finished piece is taken off the list)
  respawns: number[]; // when each finished piece's replacement is due
  nextId: number;
  nextKind: number;
  total: number;
  clock: number;
}

const roachesAliveOf = (s: RoachState) => Object.values(s.players).filter((p) => p.role === 'roach' && p.alive).length;
const round = (n: number, places = 3) => { const f = 10 ** places; return Math.round(n * f) / f; };
const blank = (role: 'roach' | 'sandal', x: number, z: number, facing: number): Body => ({ role, x, z, sx: 0, sz: 0, facing, alive: true, diedAt: null, cause: null, life: role === 'roach' ? ROACH_LIFE_START : 0, eating: false, lifeMax: role === 'roach' ? ROACH_LIFE_MAX : 0, smackAt: null, impactAt: null, smackX: 0, smackZ: 0, readyAt: 0, smackHit: false });

/**
 * ROACH RUMBLE (GAME_RULES.md #26): a one-against-all team game. One player is the sandal (the purple team), everyone else a roach (the yellow team). Every roach has a LIFETIME: it runs down a second a second and at 0 the roach
 * starves and dies on the spot. Food is life. A roach eats while it sits still next to a piece (any movement stops it); a piece is a shared pool of 10 seconds of life, and every roach at it takes 2.5 seconds of life a second out of the
 * pool (life over the roach's limit, 25, is lost; 20 once it has stood in the spilled poison). There are never more pieces than living roaches + 1: a finished piece is replaced 2 seconds later (if there is room) at a random place, 40% of them next to a landmark (trash can, mop bucket, cooker).
 * The food and the junk on the floor are solid to roaches; the sandal hovers over everything. The sandal squashes with a smack that lands a split second after the tap, but then it is out of the player's hands for a while (longer if it
 * squashed a roach and is stuck in the guts). A smack only works over floor a roach could stand on (not over junk or the walls). The kitchen (islands, brooms, shoes, trash can, mop bucket) is laid out differently every game, and a bottle of poison stands next to one landmark: if the sandal smacks it, the landmark is doused: no food comes there, food caught in it goes off and is gone after 4 s, and a roach standing in it loses an extra 0.5 s of life a second. The round is 45 seconds + 7 per roach. If a roach is alive when time runs out the roaches win; if every roach is dead (squashed or starved) the sandal wins. No draws.
 */
export function createRoachHunt(options: Partial<RoachConfig> = {}): GameEngine<RoachState> {
  const cfg: RoachConfig = { ...DEFAULT_ROACH_CONFIG, ...options };
  const roachesAlive = roachesAliveOf;
  const discs = (s: RoachState): Disc[] => [...s.foods.map((f) => ({ x: f.x, z: f.z, r: FOOD_RADIUS })), ...(s.poisonAt === null ? [{ x: s.layout.poison.x, z: s.layout.poison.z, r: BOTTLE_RADIUS }] : [])]; // (food and the bottle, while it stands, are solid)
  const die = (p: Body, cause: 'squashed' | 'starved' | 'left', at: number) => { p.alive = false; p.cause = cause; p.diedAt = at; p.life = 0; p.sx = 0; p.sz = 0; };

  return {
    id: 'roach-hunt',

    init(playerIds, now, ctx?: TeamContext) {
      // The lone (purple) player is the sandal; if the room gave no teams (a test), the first player is.
      const sandalId = playerIds.find((id) => ctx?.teams[id] === 'purple') ?? playerIds[0];
      const roaches = playerIds.filter((id) => id !== sandalId);
      const players: Record<string, Body> = {};
      players[sandalId] = blank('sandal', 0, 0, 0);
      roaches.forEach((id, i) => { const [x, z] = roachStart(i, roaches.length); players[id] = blank('roach', x, z, Math.atan2(-x, -z)); });
      // One more piece of food than there are roaches, of the four kinds in turn.
      const seed = cfg.seed ?? Math.floor(Math.random() * 2 ** 31);
      const layout = cfg.layout ?? makeLayout(seed);
      const spots = placeFood(layout, foodCap(roaches.length));
      const first = Math.floor(Math.random() * FOOD_KINDS.length);
      const foods = spots.map((p, i): Food => ({ id: i, kind: (first + i) % FOOD_KINDS.length, x: p.x, z: p.z, pool: FOOD_POOL, eating: false, poisonedAt: null }));
      const durationMs = cfg.durationMs ?? roachRoundSeconds(roaches.length) * 1000;
      return { startsAt: now, endsAt: now + durationMs, sandalId, layout, poisonAt: null, players, foods, respawns: [], nextId: foods.length, nextKind: first + foods.length, total: roaches.length, clock: now };
    },

    reduce(state, playerId, action, now) {
      const p = state.players[playerId];
      if (!p || !p.alive || now < state.startsAt || now >= state.endsAt) return state;
      if (action.type === 'steer') {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.z)) return state; // never trust the payload
        const len = Math.hypot(action.x, action.z), k = len > 1 ? 1 / len : 1;
        p.sx = action.x * k; p.sz = action.z * k; // (kept even while the sandal is out of your hands: it walks on again when it is back)
        if (len > 0.05 && !(p.role === 'sandal' && now < p.readyAt)) p.facing = Math.atan2(p.sx, p.sz);
        return state;
      }
      if (action.type === 'smack' && p.role === 'sandal') {
        if (now < p.readyAt) return state; // still floating back up (or stuck)
        const [spotX, spotZ] = smackSpot(p.x, p.z, p.facing);
        if (!canStandAt(state.layout, spotX, spotZ)) return state; // the sandal can only attack over floor a roach could stand on: not over an island, a broom, a shoe, the trash can, the mop bucket or the walls (nothing happens, and it is not out of your hands)
        p.smackAt = now;
        p.impactAt = now + SMACK_WINDUP_MS;
        p.readyAt = now + SMACK_MISS_ARREST_MS;
        p.smackHit = false;
        [p.smackX, p.smackZ] = [spotX, spotZ]; // (where it will land is decided as it swings: you commit)
        return state;
      }
      return state;
    },

    tick(state, dt, now) {
      const step = Math.min(dt, 0.1);
      const solid = discs(state);
      for (const p of Object.values(state.players)) {
        if (!p.alive || now < state.startsAt || now >= state.endsAt) continue;
        if (p.role === 'roach') [p.x, p.z] = moveRoach(p.x, p.z, p.sx, p.sz, step, solid, state.layout);
        else if (now >= p.readyAt) [p.x, p.z] = stepMover(p.x, p.z, p.sx, p.sz, SANDAL_SPEED, step, SANDAL_RADIUS); // (hovering: over everything; but not while it is out of your hands)
      }
      // The swing lands: every roach within reach of the spot is squashed, at the moment it landed. If it got one, the sandal is stuck for longer.
      const sandal = state.players[state.sandalId];
      if (sandal && sandal.impactAt !== null && now >= sandal.impactAt) {
        const at = sandal.impactAt;
        sandal.impactAt = null;
        if (at < state.endsAt) {
          let killed = 0;
          for (const p of Object.values(state.players)) {
            if (p.role !== 'roach' || !p.alive) continue;
            if (Math.hypot(p.x - sandal.smackX, p.z - sandal.smackZ) <= SMACK_RADIUS + ROACH_RADIUS * 0.5) { die(p, 'squashed', at); killed++; }
          }
          // ...and a smack that lands on the bottle of poison breaks it: its landmark is doused (food stops coming there and roaches standing in it lose life faster). (It counts as a miss for the sandal, not a hit.)
          const { poison } = state.layout;
          if (state.poisonAt === null && Math.hypot(sandal.smackX - poison.x, sandal.smackZ - poison.z) <= SMACK_RADIUS + BOTTLE_RADIUS) state.poisonAt = at;
          if (killed > 0) { sandal.smackHit = true; sandal.readyAt = (sandal.smackAt ?? at) + SMACK_HIT_ARREST_MS; }
        }
      }
      if (now >= state.startsAt && now < state.endsAt) {
        const roaches = Object.values(state.players).filter((p) => p.role === 'roach' && p.alive);
        // Standing in the spilled poison lowers a roach's limit for good: from then on it can never have more than 20 seconds (anything over is lost at once).
        if (state.poisonAt !== null) for (const p of roaches) if (p.lifeMax > ROACH_LIFE_POISONED_MAX && inPoison(state.layout, p.x, p.z)) { p.lifeMax = ROACH_LIFE_POISONED_MAX; p.life = Math.min(p.life, p.lifeMax); }
        // Life runs down.
        for (const p of roaches) p.life -= (ROACH_LIFE_DRAIN + (state.poisonAt !== null && inPoison(state.layout, p.x, p.z) ? POISON_DRAIN : 0)) * step;
        // The spilled poison reaches the food lying in it: from then on it stinks, and 4 seconds later it has gone off and is gone (a replacement is due, as for a piece that is eaten).
        if (state.poisonAt !== null) {
          const { cx, cz } = state.layout.poison;
          for (const f of state.foods) if (f.poisonedAt === null && Math.hypot(f.x - cx, f.z - cz) <= POISON_RADIUS) f.poisonedAt = now;
          const rotten = state.foods.filter((f) => f.poisonedAt !== null && now - f.poisonedAt >= FOOD_ROT_MS);
          for (const f of rotten) { state.foods.splice(state.foods.indexOf(f), 1); state.respawns.push(now + FOOD_RESPAWN_MS); }
        }
        // Eating: a roach sitting still next to a piece (the nearest one, if two are in reach) is eating it. Every eater takes FOOD_EAT_RATE seconds of life a second from the piece's pool (if the pool runs short it is split evenly); life over the maximum is lost.
        for (const p of Object.values(state.players)) p.eating = false;
        const eaters = new Map<Food, Body[]>();
        for (const p of roaches) {
          if (Math.hypot(p.sx, p.sz) > 0.05) continue;
          let best: Food | null = null, bestD = Infinity;
          for (const f of state.foods) { const d = Math.hypot(p.x - f.x, p.z - f.z); if (d <= FOOD_RADIUS + ROACH_RADIUS + FOOD_EAT_REACH && d < bestD) { best = f; bestD = d; } }
          if (best) eaters.set(best, [...(eaters.get(best) ?? []), p]);
        }
        const finished: Food[] = [];
        for (const f of state.foods) {
          const list = eaters.get(f) ?? [];
          f.eating = list.length > 0;
          for (const p of list) p.eating = true;
          if (!list.length) continue;
          const each = Math.min(FOOD_EAT_RATE * step, f.pool / list.length);
          for (const p of list) p.life = Math.min(p.lifeMax, p.life + each);
          f.pool -= each * list.length;
          if (f.pool <= 1e-9) finished.push(f);
        }
        for (const f of finished) { state.foods.splice(state.foods.indexOf(f), 1); state.respawns.push(now + FOOD_RESPAWN_MS); }
        // The hungry die where they stand.
        for (const p of roaches) if (p.life <= 0) die(p, 'starved', now);
        // A finished piece is replaced after a while, if there is room for it (never more than the living roaches + 1; nothing is taken away if there is more).
        const due = state.respawns.filter((t) => t <= now);
        if (due.length) {
          state.respawns = state.respawns.filter((t) => t > now);
          for (const t of due) {
            void t;
            if (state.foods.length >= foodCap(roachesAliveOf(state))) continue;
            const [pt] = placeFood(state.layout, 1, Math.random, state.foods, Object.values(state.players).filter((p) => p.alive).map((p) => ({ x: p.x, z: p.z })), state.poisonAt !== null);
            state.foods.push({ id: state.nextId++, kind: state.nextKind++ % FOOD_KINDS.length, x: pt.x, z: pt.z, pool: FOOD_POOL, eating: false, poisonedAt: null });
          }
        }
      }
      state.clock = now;
      return state;
    },

    isOver: (state, now) => now >= state.endsAt || roachesAlive(state) === 0,

    getWinner: () => null, // (a team game: the room picks the winning team from the scores)

    scores(state) {
      // Roaches win if one is alive when the round ends: each survivor scores 1 and the sandal 0. If none is alive the sandal wins: it scores 1 and the roaches 0. (There is no draw.)
      const alive = roachesAlive(state);
      return Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.role === 'sandal' ? (alive === 0 ? 1 : 0) : p.alive ? 1 : 0]));
    },

    removePlayer(state, playerId) {
      const p = state.players[playerId];
      if (p && p.role === 'roach' && p.alive) die(p, 'left', state.clock); // (a roach that leaves is gone: it does not count as a survivor)
      return state;
    },

    view(state): RoachHuntView {
      const players: Record<string, RoachPlayerView> = {};
      for (const [id, p] of Object.entries(state.players)) {
        players[id] = { role: p.role, x: round(p.x), z: round(p.z), facing: round(p.facing), alive: p.alive, diedAt: p.diedAt, life: round(p.life, 2), lifeMax: p.lifeMax, eating: p.eating && p.alive, cause: p.cause, smackAt: p.smackAt, smackX: round(p.smackX), smackZ: round(p.smackZ), readyAt: p.readyAt, smackHit: p.smackHit };
      }
      const foods: RoachFoodView[] = state.foods.map((f) => ({ id: f.id, kind: f.kind, x: round(f.x), z: round(f.z), left: round(f.pool / FOOD_POOL), eating: f.eating, poisonedAt: f.poisonedAt }));
      return { gameId: 'roach-hunt', startsAt: state.startsAt, endsAt: state.endsAt, t: state.clock, sandalId: state.sandalId, players, alive: roachesAlive(state), total: state.total, foods, layoutSeed: state.layout.seed, poisonAt: state.poisonAt };
    },
  };
}
