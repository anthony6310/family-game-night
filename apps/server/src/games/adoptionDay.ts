import {
  ACTION_THROTTLE_MS, ADOPTEE_COUNT, ADOPTEE_LEAVE_MS, ADOPTION_STRIP, ANIMAL_FLEE_MS, ANIMAL_FLEE_SPEED, ANIMAL_IDLE_CHANCE, ANIMAL_IDLE_MS, ANIMAL_SPEED, ANIMAL_WALK_MS,
  PICKUP_SLACK, SHELTER_PLAYER_RADIUS, SHELTER_PLAYER_SPEED, SHELTER_SECONDS, KIND_COUNT, kindRadius, speciesOf,
  adopteePos, animalsPerKind, facing, handoverSlot, obstacles, reachOf, resolveMove, shelterDims, shelterSpawn,
  type AdopteeView, type AdoptionDayView, type AnimalRow, type Circle, type ShelterDims, type ShelterPlayerView,
} from '@fgn/shared';
import type { GameEngine } from './types';

export interface AdoptionDayConfig {
  durationMs: number;
  random: () => number; // Math.random normally; tests pass a seeded one
  /**
   * How hard a walking animal turns (radians a second) to steer round another animal it is heading for. Animals only ever TURN, never speed up or slow down
   * (they all walk at one speed), so it never stops overlaps completely. Tuned so about 12 to 14% of animals overlap another at any moment (about 20% with 0, which
   * turns it off: tests use that for comparison; the roomy-direction choice and the move-off-an-animal-you-stand-on rule do most of the work).
   */
  avoidTurn: number;
}
export const DEFAULT_ADOPTION_CONFIG: AdoptionDayConfig = { durationMs: SHELTER_SECONDS * 1000, random: Math.random, avoidTurn: 0.2 };
/** How far ahead (beyond the two animals' sizes) a walking animal looks for another one, and how much room it tries to leave. */
const AVOID_LOOK = 3.2;
const AVOID_MARGIN = 0.5;
const GRID_CELL = 8; // (bigger than the two biggest animals' sizes plus the look-ahead, so the animals that matter are in the 3 x 3 cells round one)

interface Volunteer {
  x: number; z: number;
  steerX: number; steerZ: number;
  yaw: number;
  carrying: number | null; // the id of the animal in their arms
  adoptions: number;
  lastActAt: number;
}
interface Animal {
  id: number; kind: number; x: number; z: number; heading: number;
  walking: boolean; changeAt: number; // when it next decides what to do
  fleeUntil: number; // running off until this time (0 = not)
  carriedBy: string | null;
}
interface Adoptee {
  id: number; kind: number;
  doneAt: number | null; nopeAt: number | null;
  replaceAt: number | null; // when a happy adoptee is swapped for a new one
}

interface ShelterState {
  startsAt: number; endsAt: number;
  dims: ShelterDims;
  solids: Circle[];
  players: Record<string, Volunteer>;
  animals: Animal[];
  adoptees: Adoptee[];
  nextId: number;
  clock: number;
}

const round = (n: number, places = 2) => { const f = 10 ** places; return Math.round(n * f) / f; };

/**
 * Zoo Adoption: six people behind the adoption counter each want one kind of animal; volunteers search the building (a crowd of every kind of animal, all
 * walking at the same speed), pick up a matching one and carry it back. First to hand over a match scores the point and that adopter is replaced.
 * The building and crowd grow with the number of players. A tie for the most adoptions is a draw.
 */
export function createAdoptionDay(options: Partial<AdoptionDayConfig> = {}): GameEngine<ShelterState> {
  const cfg: AdoptionDayConfig = { ...DEFAULT_ADOPTION_CONFIG, ...options };
  const rand = (lo: number, hi: number) => lo + cfg.random() * (hi - lo);

  /** A spot for an animal: inside the building, out of the adoption strip and the solids, and away from `avoid` by at least `clear`. */
  function freeSpot(dims: ShelterDims, solids: Circle[], avoid: { x: number; z: number }[], clear: number, r: number): { x: number; z: number } {
    let best = { x: 0, z: 0 };
    let bestClear = -1;
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(-dims.width / 2 + 3, dims.width / 2 - 3);
      const z = rand(-dims.depth / 2 + ADOPTION_STRIP, dims.depth / 2 - 3);
      if (solids.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r + 0.5)) continue;
      const away = avoid.length === 0 ? Infinity : Math.min(...avoid.map((a) => Math.hypot(a.x - x, a.z - z)));
      if (away >= clear) return { x, z };
      if (away > bestClear) { best = { x, z }; bestClear = away; }
    }
    return best;
  }

  function newAnimal(id: number, kind: number, state: Pick<ShelterState, 'dims' | 'solids' | 'players'>, others: Animal[], now: number): Animal {
    const near = [...Object.values(state.players), ...others.filter((a) => !a.carriedBy)];
    const spot = freeSpot(state.dims, state.solids, near, 14, kindRadius(kind));
    return { id, kind, ...spot, heading: cfg.random() * Math.PI * 2, walking: false, changeAt: now + rand(0, 1) * 1000, fleeUntil: 0, carriedBy: null };
  }

  /**
   * A new request: any exact animal (a type in a color option), but of a TYPE nobody else at the desk is asking for right now, so the six bubbles are
   * always six different animals (there are more types than adopters, so one always exists).
   */
  function chooseRequest(adoptees: Adoptee[]): number {
    const takenTypes = new Set(adoptees.map((a) => speciesOf(a.kind)));
    const free = Array.from({ length: KIND_COUNT }, (_, i) => i).filter((i) => !takenTypes.has(speciesOf(i)));
    return free[Math.floor(cfg.random() * free.length)];
  }

  /** Put the animal a volunteer is carrying down in front of them. */
  function putDown(state: ShelterState, v: Volunteer, a: Animal, now: number, headingAway?: number) {
    const f = facing(v.yaw);
    const spot = resolveMove(v.x + f.x * 1.8, v.z + f.z * 1.8, kindRadius(a.kind), state.dims, state.solids);
    a.x = spot.x; a.z = spot.z; a.carriedBy = null;
    if (headingAway !== undefined) { a.heading = headingAway; a.walking = true; a.fleeUntil = now + ANIMAL_FLEE_MS; a.changeAt = a.fleeUntil; }
    else { a.walking = false; a.changeAt = now + 400; }
    v.carrying = null;
  }

  return {
    id: 'adoption-day',

    init(playerIds, now) {
      const dims = shelterDims(playerIds.length);
      const solids = obstacles(dims);
      const players: Record<string, Volunteer> = {};
      playerIds.forEach((id, i) => {
        const s = shelterSpawn(i, playerIds.length, dims);
        players[id] = { x: s.x, z: s.z, steerX: 0, steerZ: 0, yaw: 0, carrying: null, adoptions: 0, lastActAt: 0 };
      });
      const animals: Animal[] = [];
      let nextId = 1;
      const per = animalsPerKind(dims);
      for (let kind = 0; kind < KIND_COUNT; kind++) for (let n = 0; n < per; n++) animals.push(newAnimal(nextId++, kind, { dims, solids, players }, animals, now));
      const adoptees: Adoptee[] = [];
      for (let i = 0; i < ADOPTEE_COUNT; i++) adoptees.push({ id: nextId++, kind: chooseRequest(adoptees), doneAt: null, nopeAt: null, replaceAt: null });
      return { startsAt: now, endsAt: now + cfg.durationMs, dims, solids, players, animals, adoptees, nextId, clock: now };
    },

    reduce(state, playerId, action, now) {
      const v = state.players[playerId];
      if (!v || now < state.startsAt || now >= state.endsAt) return state;
      if (action.type === 'steer') {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.z)) return state;
        const length = Math.hypot(action.x, action.z);
        const scale = length > 1 ? 1 / length : 1;
        v.steerX = action.x * scale; v.steerZ = action.z * scale;
        return state;
      }
      if (action.type === 'look') {
        if (Number.isFinite(action.yaw)) v.yaw = action.yaw % (Math.PI * 2);
        return state;
      }
      if (action.type !== 'grab' && action.type !== 'give') return state;
      if (now - v.lastActAt < ACTION_THROTTLE_MS) return state; // (blunts auto-clickers)
      v.lastActAt = now;

      if (action.type === 'grab') {
        if (v.carrying !== null || !Number.isInteger(action.target)) return state;
        const a = state.animals.find((x) => x.id === action.target);
        if (!a || a.carriedBy) return state;
        if (Math.hypot(a.x - v.x, a.z - v.z) > reachOf(a.kind) + PICKUP_SLACK) return state; // too far away
        a.carriedBy = playerId; a.walking = false; a.fleeUntil = 0;
        v.carrying = a.id;
        return state;
      }

      // give: hand the animal to the adoptee whose pad you stand on, or put it down (anywhere else, or on the pad of an adoptee who is already leaving).
      if (v.carrying === null) return state;
      const a = state.animals.find((x) => x.id === v.carrying);
      if (!a) { v.carrying = null; return state; }
      const slot = handoverSlot(v.x, v.z, state.dims);
      const target = slot === null ? null : state.adoptees[slot];
      if (slot === null || !target || target.replaceAt !== null) { putDown(state, v, a, now); return state; }
      if (target.kind === a.kind) {
        // Adopted: the animal goes home with the adoptee (a new one of its kind turns up in the crowd), the point is scored, and the adoptee is replaced a moment later.
        state.animals = state.animals.filter((x) => x.id !== a.id);
        v.carrying = null;
        v.adoptions++;
        target.doneAt = now; target.nopeAt = null; target.replaceAt = now + ADOPTEE_LEAVE_MS;
        state.animals.push(newAnimal(state.nextId++, a.kind, state, state.animals, now));
        return state;
      }
      // The wrong animal: that adoptee's bubble shakes red, and the animal is dropped and runs off, away from them.
      const at = adopteePos(slot, state.dims);
      target.nopeAt = now;
      putDown(state, v, a, now, Math.atan2(v.z - at.z, v.x - at.x));
      return state;
    },

    tick(state, dt, now) {
      // ----- volunteers walk (no sliding: they go where they steer, and are stopped by the walls and solids) -----
      for (const [, v] of Object.entries(state.players)) {
        if (now < state.startsAt || now >= state.endsAt) { v.steerX = 0; v.steerZ = 0; }
        const to = resolveMove(v.x + v.steerX * SHELTER_PLAYER_SPEED * dt, v.z + v.steerZ * SHELTER_PLAYER_SPEED * dt, SHELTER_PLAYER_RADIUS, state.dims, state.solids);
        v.x = to.x; v.z = to.z;
      }
      // ----- the animals: everyone wanders at the same speed; a carried animal rides along -----
      const hx = state.dims.width / 2 - 2;
      const zTop = -state.dims.depth / 2 + ADOPTION_STRIP, zBottom = state.dims.depth / 2 - 2;
      // (a grid of who is where, so each animal only looks at the few round it)
      const grid = new Map<number, Animal[]>();
      const cellKey = (cx: number, cz: number) => cx * 4096 + cz;
      for (const a of state.animals) {
        if (a.carriedBy) continue;
        const k = cellKey(Math.floor(a.x / GRID_CELL), Math.floor(a.z / GRID_CELL));
        const cell = grid.get(k);
        if (cell) cell.push(a); else grid.set(k, [a]);
      }
      const around = (a: Animal): Animal[] => {
        const out: Animal[] = [];
        const cx = Math.floor(a.x / GRID_CELL), cz = Math.floor(a.z / GRID_CELL);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get(cellKey(cx + i, cz + j)) ?? []) if (b !== a) out.push(b);
        return out;
      };
      /** How far this animal could walk on heading `h` before meeting another animal (capped): used to pick a roomy direction. */
      const clearance = (a: Animal, h: number, near: Animal[]): number => {
        const fx = Math.cos(h), fz = Math.sin(h);
        let best = 9;
        for (const b of near) {
          const dx = b.x - a.x, dz = b.z - a.z, rs = kindRadius(a.kind) + kindRadius(b.kind);
          const ahead = dx * fx + dz * fz;
          if (ahead <= 0 || Math.abs(-dx * fz + dz * fx) > rs + AVOID_MARGIN) continue;
          best = Math.min(best, ahead - rs);
        }
        return best;
      };
      for (const a of state.animals) {
        if (a.carriedBy) {
          const v = state.players[a.carriedBy];
          if (v) { a.x = v.x; a.z = v.z; }
          continue;
        }
        const fleeing = now < a.fleeUntil;
        const ra = kindRadius(a.kind);
        const near = cfg.avoidTurn > 0 && !fleeing ? around(a) : [];
        if (!fleeing && now >= a.changeAt) {
          if (cfg.random() < ANIMAL_IDLE_CHANCE) { a.walking = false; a.changeAt = now + rand(ANIMAL_IDLE_MS[0], ANIMAL_IDLE_MS[1]); }
          else {
            // Walk off in a new direction: the roomiest of a few tries (a random one if nobody is near).
            let best = a.heading + rand(-1.4, 1.4), bestClear = near.length ? clearance(a, best, near) : 0;
            for (let t = 0; t < 3 && near.length > 0; t++) {
              const h = a.heading + rand(-1.4, 1.4), c = clearance(a, h, near);
              if (c > bestClear) { best = h; bestClear = c; }
            }
            a.walking = true; a.heading = best; a.changeAt = now + rand(ANIMAL_WALK_MS[0], ANIMAL_WALK_MS[1]);
          }
          a.fleeUntil = 0;
        }
        if (near.length > 0) {
          if (a.walking) {
            // Heading for another animal? Turn away from it (a little more the closer it is). Only the direction changes, never the speed.
            const fx = Math.cos(a.heading), fz = Math.sin(a.heading);
            let steer = 0;
            for (const b of near) {
              const dx = b.x - a.x, dz = b.z - a.z, rs = ra + kindRadius(b.kind);
              const d = Math.hypot(dx, dz);
              if (d > rs + AVOID_LOOK || d < 1e-6) continue;
              const ahead = dx * fx + dz * fz;
              if (ahead < -rs * 0.3) continue; // (already past it)
              const side = -dx * fz + dz * fx;
              if (Math.abs(side) > rs + AVOID_MARGIN) continue; // (it is off to one side: no problem)
              const away = side === 0 ? (a.id % 2 === 0 ? 1 : -1) : side > 0 ? -1 : 1;
              steer += away * (0.4 + 1 - d / (rs + AVOID_LOOK));
            }
            if (steer !== 0) a.heading += Math.max(-1.6, Math.min(1.6, steer)) * cfg.avoidTurn * dt;
          } else {
            // Standing on top of another animal: move off, away from it.
            for (const b of near) {
              if (Math.hypot(b.x - a.x, b.z - a.z) < (ra + kindRadius(b.kind)) * 0.85) {
                a.walking = true; a.heading = Math.atan2(a.z - b.z, a.x - b.x) + rand(-0.4, 0.4); a.changeAt = now + rand(1000, 1800);
                break;
              }
            }
          }
        }
        if (a.walking) {
          const speed = fleeing ? ANIMAL_FLEE_SPEED : ANIMAL_SPEED;
          a.x += Math.cos(a.heading) * speed * dt;
          a.z += Math.sin(a.heading) * speed * dt;
        }
        // Solid things (the pillars; the counter): walk round them.
        const moved = resolveMove(a.x, a.z, ra, state.dims, state.solids);
        if (moved.hit) { a.x = moved.x; a.z = moved.z; if (!fleeing) a.heading += Math.PI / 2; }
        // Near a wall or the adoption strip: turn back towards the middle of the floor (an animal put down in the strip simply walks out of it).
        const aimTo = (h: number) => Math.atan2(Math.sin(h - a.heading), Math.cos(h - a.heading));
        if (!fleeing && a.z < zTop + 1) a.heading += Math.max(-1, Math.min(1, aimTo(Math.PI / 2))) * Math.min(1, 8 * dt) * 1.5;
        if (Math.abs(a.x) > hx - 1 || a.z > zBottom - 1) {
          if (!fleeing) a.heading += Math.max(-1, Math.min(1, aimTo(Math.atan2(-a.z, -a.x)))) * Math.min(1, 6 * dt) * 1.5;
          a.x = Math.max(-hx, Math.min(hx, a.x));
          a.z = Math.min(zBottom, a.z);
        }
      }
      // ----- adoptees: a happy one is replaced by a new person with a new request -----
      for (const ad of state.adoptees) {
        if (ad.replaceAt !== null && now >= ad.replaceAt) {
          const others = state.adoptees.filter((o) => o !== ad);
          ad.id = state.nextId++; ad.kind = chooseRequest(others); ad.doneAt = null; ad.nopeAt = null; ad.replaceAt = null;
        }
      }
      state.clock = now;
      return state;
    },

    isOver: (state, now) => now >= state.endsAt,

    getWinner(state) {
      const entries = Object.entries(state.players);
      const best = Math.max(0, ...entries.map(([, v]) => v.adoptions));
      const leaders = entries.filter(([, v]) => v.adoptions === best);
      return best > 0 && leaders.length === 1 ? leaders[0][0] : null; // nobody adopted anything, or a tie: draw
    },

    scores: (state) => Object.fromEntries(Object.entries(state.players).map(([id, v]) => [id, v.adoptions])),

    removePlayer(state, playerId) {
      const v = state.players[playerId];
      if (v?.carrying != null) {
        const a = state.animals.find((x) => x.id === v.carrying);
        if (a) putDown(state, v, a, state.clock);
      }
      delete state.players[playerId];
      return state;
    },

    view(state): AdoptionDayView {
      const players: Record<string, ShelterPlayerView> = {};
      for (const [id, v] of Object.entries(state.players)) {
        const carried = v.carrying === null ? null : state.animals.find((a) => a.id === v.carrying);
        players[id] = {
          x: round(v.x), z: round(v.z), vx: round(v.steerX * SHELTER_PLAYER_SPEED), vz: round(v.steerZ * SHELTER_PLAYER_SPEED), yaw: round(v.yaw, 3),
          carry: carried ? { id: carried.id, kind: carried.kind } : null, adoptions: v.adoptions,
        };
      }
      const animals: AnimalRow[] = state.animals.filter((a) => !a.carriedBy)
        .map((a): AnimalRow => [a.id, a.kind, round(a.x), round(a.z), round(a.heading), modeOf(a)]);
      const adoptees: AdopteeView[] = state.adoptees.map((ad) => ({ id: ad.id, kind: ad.kind, doneAt: ad.doneAt, nopeAt: ad.nopeAt }));
      return { gameId: 'adoption-day', startsAt: state.startsAt, endsAt: state.endsAt, t: state.clock, width: state.dims.width, depth: state.dims.depth, players, adoptees, animals };

      /** 0 standing, 1 walking, 2 running off. */
      function modeOf(a: Animal): number { return a.walking ? (state.clock < a.fleeUntil ? 2 : 1) : 0; }
    },
  };
}
