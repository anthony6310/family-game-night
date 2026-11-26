import type { TerrainFeature } from './terrain';
import type { SantaLobParams } from './santaThrow';
import type { GameId } from './games';
import type { CreatureKind, FishKind } from './config';

/**
 * The Socket.io contract between phones and server. Both sides import these types, so
 * renaming an event or changing a payload becomes a compile error instead of a runtime bug.
 */

/** Someone in a room. Guests have `isGuest: true` and a temporary id. */
export interface Player {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

/** Host-controlled session settings. */
import type { TeamId } from './teams';

export interface RoomSettings {
  gameId: GameId | null; // null until the host picks a game
  /** True when the host picked the Random tile: the game is only chosen once everyone is ready and the countdown ends (the roulette); `gameId` is null until then (and again after the round). */
  random: boolean;
  /** Team games: may players choose their team? (The host turns it on or off; off = the random teams are locked.) */
  teamSwap: boolean;
}
/** What the host sends to pick the game: a game's id, or 'random' to have the server pick one. */
export const RANDOM_GAME = 'random';

/**
 * 'lobby'     choosing settings and readying up
 * 'countdown' everyone is ready; the game starts at `countdownEndsAt`
 * 'playing'   a round is running
 * 'finish'    the round just ended: the result is decided, input is stopped and a "you won / you lost" message
 *             plays over the frozen game for a few seconds
 * 'results'   the round summary screen (moves on by itself after a few seconds)
 * 'roulette'  (only when the host chose the Random tile) the countdown is over and everyone, the host included, watches the game being picked: the carousel spins and slows onto it
 * 'teams'     (only when the Random tile landed on a TEAM game) the round pauses so the players can manage the teams; the host starts it (no Ready step)
 * 'underdog'  (only when there is an underdog) the countdown is over and everyone is shown the underdog for a few seconds
 *             before the round starts
 * 'starting'  the flash step (like a loading screen): the screen flashes and fades to a plain page, and the round begins almost at the end of the
 *             flash (see START_FLASH_* in config.ts). Nobody can play yet.
 * 'session-over' the host ended the session (or the room emptied): the player with the most wins is crowned
 */
export type RoomPhase = 'lobby' | 'countdown' | 'roulette' | 'teams' | 'underdog' | 'starting' | 'playing' | 'finish' | 'results' | 'session-over';

/**
 * What a phone may send during a round. The server decides what it actually means.
 * `steer` is a direction on the ground in world axes (x = east, z = south), each -1..1.
 * The server clamps its length to 1, so sending a bigger vector gains nothing.
 */
export type GameAction =
  | { type: 'tap' }
  | { type: 'steer'; x: number; z: number }
  | { type: 'sprint'; on: boolean }
  | { type: 'smack' } // Roach Rumble: the sandal swings
  | { type: 'pick'; flake: number; at: number } // Snowflake Match: tapped falling flake number `flake`, at `at` on the phone's idea of the server clock
  | { type: 'aim'; yaw: number; pitch: number } // Broadside Battle: where this player's cannon points (the ship's own frame); it keeps working while the wick burns
  | { type: 'fire' } // Broadside Battle: light the wick (the cannon fires 1 second later)
  | { type: 'look'; yaw: number } // Zoo Adoption: which way the volunteer faces (0 = south, +z), so others and spectators see it
  | { type: 'grab'; target: number } // Zoo Adoption: pick up animal number `target` (it must be within reach)
  | { type: 'give' } // Zoo Adoption: hand the animal you carry to the adoptee in front of you, or put it down if nobody is in reach
  | { type: 'jump'; at: number } // Mountain Goats: a tap, made at `at` on the phone's idea of the server clock
  | { type: 'throw'; x: number; z: number; power: number }; // Santa's Sack: throw a gift from your pile in the direction (x, z) on the floor, with `power` 0..1 (how far)

/** Tap Race, as phones see it. */
export interface TapRaceView {
  gameId: 'tap-race';
  startsAt: number; // server clock (epoch ms)
  endsAt: number;
  taps: Record<string, number>; // playerId -> taps counted by the SERVER
}

/** Tug of War, as phones see it: the taps of every player, who is on which team, each team's head start, and each team's total (taps plus head start). */
export interface TugOfWarView {
  gameId: 'tug-of-war';
  startsAt: number;
  endsAt: number;
  taps: Record<string, number>; // playerId -> taps counted by the SERVER
  teams: Record<string, TeamId>; // who pulls for which team
  totals: Record<TeamId, number>; // each team's taps: this is what the rope shows
}

/** The kinds of pick-up that can lie in the arena. Only fish so far; more can be added here later. */
export type ItemKind = 'fish';

/** A pick-up lying on the ground, as phones see it. A ball that rolls over it collects it. */
export interface SnowballItem {
  id: number; // unique within the round, so phones can tell which one was collected
  kind: ItemKind;
  x: number; // where it lies (or WILL lie, if it is still being thrown)
  z: number;
  /**
   * Present only while the item is still in the air: a fish that came off a ball when it hit something. It was thrown
   * from (fromX, fromZ), lands at (x, z) in `secondsLeft` more seconds (out of `totalSeconds` for the whole flight),
   * and cannot be collected until it lands. Phones animate the flight; the server decides the landing spot.
   */
  thrown?: { fromX: number; fromZ: number; secondsLeft: number; totalSeconds: number };
}

/** One snowball, as phones see it. Positions are on the ground plane (x east, z south), y is up. */
export interface SnowballBall {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  immune: boolean; // briefly true after being hit (drawn as a flash)
  /** Current top-speed multiplier, everything included: 1 = normal, below 1 = climbing, above 1 = descending and/or sprinting. */
  speedFactor: number;
  /** The part of `speedFactor` that comes from the ground alone (a little slower uphill, a little faster downhill). */
  hillFactor: number;
  /** The size points the most recent hit took off this ball (0 if it has not been hit yet): phones scale the impact's snow by how hard the hit was. */
  hitDamage: number;
  /** Stamina left, from 0 (empty) to 1 (full). Sprinting uses it up; it refills when you stop sprinting. */
  stamina: number;
  /** True while the ball is sprinting (+50% speed), which uses stamina up. */
  sprinting: boolean;
  /** True for 2 s after this (smaller) ball hit a bigger one: its stamina refills straight away (no waiting) while this lasts. */
  escape: boolean;
  /** True for the single biggest ball: its hits do double damage. */
  leader: boolean;
  /** Fish stuck to this ball (0 up to the carry limit). Each one adds extra damage to the next hit, and all are used up by it. */
  fish: number;
}

/** Snowball, as phones see it. Streamed ~20 times a second while the round runs. */
export interface SnowballView {
  gameId: 'snowball';
  startsAt: number;
  endsAt: number;
  arenaRadius: number;
  /** The speeds effects are drawn against (world units per second): normal, and the fastest possible (downhill AND sprinting). */
  speedRange: { base: number; max: number };
  /** You can only START a sprint with at least this much stamina (a fraction, 0..1). The stamina bar marks it. */
  staminaStart: number;
  /** This round's hills and ditch. They are picked at random for each round and never move during it. */
  terrain: TerrainFeature[];
  /** Pick-ups lying in the arena right now (they appear at the start and in waves later; a collected one is gone). */
  items: SnowballItem[];
  balls: Record<string, SnowballBall>; // playerId -> ball (players outside a tie-breaker have none)
}

/** One skater in Penguin Lasso, as phones see it. Positions are on the ice (x east, z south). */
export interface SkaterView {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** The skate trail, oldest point first (it ends at the skater). It is the lasso: it is limited in length, so the old end keeps vanishing. */
  trail: [number, number][];
  /** Points worth of animals in the skater's bag (a penguin is 1, a seal 2, a polar bear 5): caught, but NOT points yet. Skating home to the igloo cashes them in. */
  carried: number;
  /**
   * How many SPACES the bag's contents use up (of `bagCapacity`): a penguin or a seal takes 1 (a seal takes the same room as a penguin,
   * though it is worth more), a polar bear takes 3. The sack's size follows this.
   */
  carriedSpace: number;
  /** What is in the bag, in the order it was caught (the display of the bag's contents). */
  bag: CreatureKind[];
  /** The most valuable kind of animal in the bag (it is the head shown poking out of the sack), or null when the bag is empty. */
  topCarried: CreatureKind | null;
  /**
   * True when the bag is FULL (its contents use all `bagCapacity` spaces): the skater lays no trail and so can't catch anything more
   * until they cash in at the igloo.
   */
  bagFull: boolean;
  /** True while the bag holds at least one polar bear. Each bear slows the skater (see `bearSpeedFactors`) until they cash in; a bear takes 3 spaces but does not stop other catches. */
  carryingBear: boolean;
  banked: number; // points cashed in at the igloo so far this round: the score
}

/** An animal on the ice (a penguin, a seal or a polar bear). One that was just caught stays in the list for a moment (with `caughtBy`) so phones can show it being collected. */
export interface PenguinView {
  id: number;
  kind: CreatureKind;
  x: number;
  z: number;
  /** Which way it is facing (radians, 0 = east, counter-clockwise seen from above is z-down so +angle turns towards south). */
  heading: number;
  /** True while it is moving (walking, or for a seal sliding) so phones can animate it; false while it stands still. */
  walking: boolean;
  caughtBy?: string; // set for ~1.2 s after a catch (it goes into that skater's bag)
}

/** A loop that was just closed (kept ~0.8 s) so phones can flash the area it enclosed. */
export interface LoopView {
  id: number;
  playerId: string;
  points: [number, number][]; // the corners of the enclosed area
  /** How many animals were inside this loop but did NOT fit in the bag (phones flash and shake the bag display for the skater who made it). */
  skipped: number;
}

/** Penguin Lasso, as phones see it. Streamed ~20 times a second while the round runs. */
export interface PenguinLassoView {
  gameId: 'penguin-lasso';
  startsAt: number;
  endsAt: number;
  arenaRadius: number;
  /** The most trail a skater can have out at once, in world units (phones fade the trail along this length). */
  trailMax: number;
  /** How many animals a bag holds before it is full (the sack grows in steps up to this). */
  bagCapacity: number;
  /** Each player's igloo (their home base). Skating within `cashRadius` of your own igloo cashes in your bag. */
  /** Where each igloo is, and how much it has grown: 1 = its starting size, bigger with every point its owner has cashed in. */
  igloos: Record<string, { x: number; z: number; scale: number }>;
  iglooRadius: number; // an igloo's size at scale 1 (solid: skaters can't skate through it). Multiply by its `scale`.
  cashRadius: number;
  skaters: Record<string, SkaterView>;
  penguins: PenguinView[];
  loops: LoopView[];
}

/** A fish in the ocean (Fishing). `y` is its depth below the surface (0 = the surface). Its mouth is at the front: x + dir x (size / 2). */
export interface FishView {
  id: number;
  x: number;
  y: number;
  dir: 1 | -1; // which way it swims along the width (1 = right); fish swim the same way all round, and come back in from the other side
  speed: number; // units per second (phones move it on between snapshots)
  size: number; // its length
  kind: FishKind; // a school fish, a regular fish or a big fish
  variant: number; // which of the colorful looks a REGULAR fish has (0..5)
  caughtBy?: string; // set for ~1.2 s after a catch, so phones can show it being reeled in
}

/** Fishing, as phones see it. Only the fish near the hooks are listed. */
export interface FishingView {
  gameId: 'fishing';
  startsAt: number; // the round begins: the cast sequence plays
  ascentStartsAt: number; // the hooks are at the bottom and start to rise (input counts from here)
  endsAt: number; // the hooks reach the surface
  depth: number; // how deep the ocean is
  endDepth: number; // the finish line: the hooks rise from `depth` to this depth ("0 m", a little under the surface). When they reach it the round is over.
  hookDepth: number; // how deep the hooks are right now (all of them, always the same)
  ascentSpeed: number; // how fast they rise (units per second), so phones can carry on between snapshots
  laneWidth: number;
  lanes: string[]; // each player's lane, left to right (a player who left keeps an empty lane)
  /** Where each hook is along the width, how many fish it has caught, how many POINTS they are worth (the score), and how many of each kind (in FISH_KINDS order: school, regular, big). */
  hooks: Record<string, { x: number; lift: number; fish: number; points: number; kinds: [number, number, number] }>;
  /** The mines near the hooks: whose lane each hangs in, where it is now (drifting ones move), and whether it has just gone off (for the explosion). */
  mines: { id: number; owner: string; x: number; y: number; hit: boolean }[];
  fish: FishView[];
}

/**
 * A bag on its circular route. Where it is at any moment is worked out from `slot`, the route's `radius` and `speed` and the server's clock, so phones never need to be told its position.
 * The player who has put the most gifts into a bag CONTROLS it (a tie, or an empty bag, leaves it neutral). How many gifts are in it is never sent: only who controls it.
 * Every bag is open for the first quarter of the round, then cinched shut for one quarter OR the next (some of the bags in each), then open again for the last quarter: `lid` says when this one is shut.
 */
export interface SantaBagView {
  id: number;
  /** The radius of the bag's open mouth: a gift that goes into its scoring zone adds to its thrower's gifts in this bag. Every bag is the size of the biggest one plus or minus 25% (a bigger bag is a bigger target, and worth the same). */
  radius: number;
  /** Its place on the route when the round starts (radians; the route turns at `orbit.speed` radians a second). */
  slot: number;
  /** The player who controls the bag right now (the most gifts in it), or null when it is empty or tied (neutral). The bag takes this player's color. */
  leader: string | null;
  /** The gifts in the bag, oldest first, at most 5: the phones draw them as a heap in the mouth, each in its thrower's color. */
  gifts: SantaBagGiftView[];
  /** While the server clock is between `closeAt` and `openAt` the bag is cinched shut: nothing can go in it and gifts bounce off it. It strobes for `warnMs` before `closeAt`. */
  lid: { closeAt: number; openAt: number };
}
/**
 * A gift in the air. It moves by plain gravity: at `t` (server clock, milliseconds) it is at p0 + v0 * dt + g * dt^2 / 2, with dt in seconds since `t0` (`g` is negative: down; every throw has its own, so a snappy lob can be both high and quick). When it bounces off a bag the server sends a new
 * (p0, v0, t0) from the bounce and `bounces` goes up. `kind` is its shape (0..5) and `owner` gives it its color.
 */
export interface SantaFlyingView { id: number; owner: string; kind: number; x0: number; y0: number; z0: number; vx: number; vy: number; vz: number; g: number; t0: number; bounces: number }
/** A gift pushed out of a full bag to make room: drawn tumbling out of the bag's mouth and falling (a picture only; nothing is simulated). */
export interface SantaKickedView { id: number; owner: string; kind: number; bag: number; at: number }
/** One gift sitting in a bag: its thrower (the heap shows it in their color) and its shape. */
export interface SantaBagGiftView { owner: string; kind: number }
/** A gift that has just come down, at (x, y, z): into the bag `bag` (it went into its scoring zone and scored) or (null) onto the floor. Shown for a moment. */
export interface SantaLandedView { id: number; owner: string; kind: number; x: number; y: number; z: number; bag: number | null; at: number }

/** Santa's Sack, as phones see it. Streamed ~20 times a second while the round runs. */
export interface SantaSackView {
  gameId: 'santa-sack';
  startsAt: number;
  endsAt: number;
  /** Each player's station: where the elf stands and the way it faces (radians: the direction (cos, sin) in x east / z south, towards the bags). */
  stations: Record<string, { x: number; z: number; facing: number }>;
  /** The route the bags follow, round the middle of the room (0, 0): its radius and how fast it turns (radians per second). */
  orbit: { radius: number; speed: number };
  bags: SantaBagView[];
  /** How long before a bag closes it strobes as a warning (milliseconds). */
  warnMs: number;
  /** A throw is aimed at a point `rangeMin` away at power 0 and `rangeMax` away at power 1 (world units), `lob.aimHeight` up in the air (a little above a bag's mouth): the gift passes through that point on its way down. */
  rangeMin: number;
  rangeMax: number;
  /** How a throw flies (see lobPlan): phones use it to draw the arc a pull would make, and the ring at its end, `lob.aimHeight` up (a little above the bags' mouths). */
  lob: SantaLobParams;
  /** A drag shorter than this (as a power, 0..1) is not a throw. */
  throwMinPower: number;
  /** How many bags each player controls right now (the player with the most bags at the end wins). Their gifts never run out. */
  players: Record<string, { controlled: number }>;
  flying: SantaFlyingView[];
  landed: SantaLandedView[];
  kicked: SantaKickedView[];
}

/** What phones are told about a running round: one shape per game, told apart by `gameId`. */
/** What happened on a player's last tap in Closing the Gap: where the indicator was (`len`), whether that landed, and when (the phone's tap time, which the server accepted). */
export interface GoatJumpView { ok: boolean; len: number; at: number; since: number; birdU: number | null } // `since` = ms since the marker started when the tap was made; `birdU` = how far along its leap the goat hit the bird (null: it did not)
export interface GoatPlayerView {
  jumps: number; // ledges reached so far (= the platform the goat stands on)
  armedAt: number; // the indicator starts sweeping at this server time (after a leap, or after the fall)
  last: GoatJumpView | null;
}
/** Mountain Goats, as phones see it. Every goat faces the same platforms (made from `seed`); what changes is each player's progress. */
export interface MountainGoatView {
  gameId: 'mountain-goat';
  startsAt: number;
  endsAt: number;
  seed: number;
  players: Record<string, GoatPlayerView>;
}

/** One falling snowflake in Snowflake Match: its design, when its current fall began and the lane it began in (its place on the screen is worked out from these and the clock: see flakePose). */
export interface FlakeView { design: number; born: number; lane: number }
export interface FlakePlayerView { points: number; hand: number[]; flakes: FlakeView[] } // the designs in the player's hand, and the player's own falling field (everyone starts with the same one; a flake you match falls again in YOUR field only)
/** Snowflake Match, as phones see it. Every player has their own falling field (the same at the start), their own hand and their own points. */
export interface SnowflakeMatchView {
  gameId: 'snowflake-match';
  startsAt: number;
  endsAt: number;
  seed: number;
  players: Record<string, FlakePlayerView>;
}

/** One animal in the shelter: [id, kind (type and color option, see KIND_COUNT in shelter.ts), x, z, heading, mode (0 standing, 1 walking, 2 running off)]. Heading is the direction it moves in: (cos, sin) on (x, z). */
export type AnimalRow = [number, number, number, number, number, number];
/** A volunteer in Zoo Adoption. Others and spectators see them through x, z and which way they face. */
export interface ShelterPlayerView {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  carry: { id: number; kind: number } | null;
  adoptions: number;
}
/** One person waiting at the adoption desk (slot = their place in the list, left to right). A new person gets a new `id`. */
export interface AdopteeView {
  id: number;
  kind: number; // the exact animal in their thought bubble
  doneAt: number | null; // server time they got their animal (they celebrate, then are replaced)
  nopeAt: number | null; // server time they were handed the wrong animal (the bubble shakes red)
}
/** Zoo Adoption, as phones see it. Streamed ~20 times a second while the round runs. */
export interface AdoptionDayView {
  gameId: 'adoption-day';
  startsAt: number;
  endsAt: number;
  t: number; // the server clock when this view was made (phones use it to carry the motion forward)
  width: number;
  depth: number;
  players: Record<string, ShelterPlayerView>;
  adoptees: AdopteeView[];
  animals: AnimalRow[]; // the ones loose in the building (a carried animal is in its carrier's entry instead)
}

/** One cannonball in flight (or just landed): where it left and how fast, when it will end, and how. Phones fly it with `shotPoint`; nothing is streamed while it flies. */
export interface PirateShotView {
  id: number;
  owner: string;
  team: TeamId;
  launchAt: number; // server clock (epoch ms)
  endAt: number; // when it lands in the sea or hits the enemy ship
  p0: [number, number, number];
  v0: [number, number, number];
  hit: boolean;
  hitLocal: [number, number, number] | null; // in the enemy ship's own frame
  splash: [number, number, number] | null;
  blocked: [number, number, number] | null; // struck the leaping whale here (the ball is gone and scores nothing)
}
/** One cannon (one player) in Broadside Battle. */
export interface PiratePlayerView {
  team: TeamId;
  slot: number; // their place along their ship's rail (0 = nearest the stern)
  yaw: number;
  pitch: number;
  wickAt: number | null; // server time the wick was lit (it burns WICK_MS), or null
  launchAt: number | null; // server time it will fire (wickAt + WICK_MS)
  readyAt: number; // server time it can be fired again
  hits: number;
}
/** Broadside Battle, as phones see it. */
export interface PirateBroadsideView {
  gameId: 'pirate-broadside';
  startsAt: number;
  endsAt: number;
  t: number; // the server clock when this view was made
  teams: Record<string, TeamId>;
  totals: Record<TeamId, number>; // each team's hits
  crew: Record<TeamId, number>; // how many cannons each ship has
  players: Record<string, PiratePlayerView>;
  shots: PirateShotView[]; // the recent ones
  whale: { peek: number; blow: number; breach: number } | null; // when the whale's three visits start, in seconds since startsAt (null: no whale this round)
}

/** One character in Roach Rumble: a roach, or the sandal player. */
export interface RoachPlayerView {
  role: 'roach' | 'sandal';
  x: number;
  z: number;
  facing: number; // the way it faces (0 = towards +z, turning towards +x)
  alive: boolean;
  diedAt: number | null; // server clock (epoch ms) a roach died
  life: number; // a roach's lifetime left, in seconds (0 once it is dead)
  lifeMax: number; // the most life it can have now: ROACH_LIFE_MAX, or ROACH_LIFE_POISONED_MAX once it has been in the spilled poison (0 for the sandal)
  cause: 'squashed' | 'starved' | 'left' | null; // how a dead roach died (a starved one curls up where it fell; a squashed one is a splat; one that left is just gone)
  /** The sandal only: server time the swing started (it lands SMACK_WINDUP_MS later), and the spot it landed or will land. */
  smackAt: number | null;
  smackX: number;
  smackZ: number;
  readyAt: number; // the sandal only: when it is back in your hands (it is out of your control, floating back up, until then)
  eating: boolean; // a roach only: it is sitting still next to a piece of food and eating it right now
  smackHit: boolean; // the sandal only: the last smack squashed a roach (so it is stuck in the guts for longer)
}
/** A piece of food on the floor. */
export interface RoachFoodView {
  id: number;
  kind: number; // an index into FOOD_KINDS
  x: number;
  z: number;
  left: number; // 0..1 how much of its pool of life is left (a piece that is finished is taken off the list)
  poisonedAt: number | null; // server time the spilled poison reached it: it stinks purple and is gone a few seconds later (FOOD_ROT_MS)
  eating: boolean; // a roach is eating it right now
}
/** The Roach Rumble round: who is where, who is alive (and how much lifetime each roach has left), and the food on the floor. */
export interface RoachHuntView {
  gameId: 'roach-hunt';
  startsAt: number;
  endsAt: number;
  t: number; // the server clock when this view was made
  sandalId: string;
  players: Record<string, RoachPlayerView>;
  alive: number; // roaches still alive
  total: number; // roaches at the start
  foods: RoachFoodView[];
  /** The kitchen is different every game: the phones make the same layout (`makeLayout`) from this number. */
  layoutSeed: number;
  /** Server time the sandal smashed the bottle of poison and doused its landmark (null: the bottle is still standing). */
  poisonAt: number | null;
}

export type GameView = RoachHuntView | PirateBroadsideView | AdoptionDayView | SnowflakeMatchView | MountainGoatView | TapRaceView | SnowballView | PenguinLassoView | FishingView | SantaSackView | TugOfWarView;

/** A spectator's bet on one player to win a round. With no stake it is a free bet worth 1 victory point if it wins. With a stake, the spectator puts up victory points of their own and wins (or loses) exactly that many. */
export interface Bet {
  targetId: string; // the player they think will win (in a TEAM game: the team, 'yellow' or 'purple')
  stake: number; // victory points of their own put up (0 = the free bet that wins 1 point and can't lose any). Never more than they have.
}

/** How one bet turned out. `delta` is the change to the bettor's victory points: for a win +1 (free bet) or +stake (a staked bet), for a loss -stake (a draw counts as a loss), 0 if the bet was void (the player left, or the round was called off). */
export interface BetResult {
  bettorId: string;
  targetId: string;
  stake: number;
  delta: number;
}

/**
 * The underdog of a round: the one player nobody bet on while every other player had a bet (only with 3+ players). If they win
 * the round, or are among the players tied for first in a draw, they win it and also collect `bonus` (1 point per person who bet
 * against them) on top of the usual 1 point. The bonus is not taken from anybody.
 */
export interface Underdog {
  playerId: string;
  bonus: number;
}

/** Outcome of a finished round. `winnerId` is null when nobody won (a draw that doesn't include an underdog). */
export interface RoundResult {
  winnerId: string | null;
  winner: Player | null; // snapshot, so the screen still works if the winner leaves
  scores: Record<string, number>; // playerId -> that round's score (taps)
  /**
   * PRIVATE: only your own bet's result is ever sent to you (nobody sees who bet on whom). Empty if you didn't bet.
   */
  bets: BetResult[];
  /** Team games only (otherwise null): which team won (null = a draw), each team's total, and who was on each team. Every member of the winning team won (`winnerId` / `winner` stay null). */
  team: { winner: TeamId | null; totals: Record<TeamId, number>; members: Record<TeamId, string[]>; names: Record<TeamId, string> } | null;
  /** PUBLIC: the spectators whose bets won, and how much each won. (It only says they backed the winner, never anything else.) */
  winningBettors: { bettorId: string; delta: number }[];
  /** Set when the underdog won this round: they collected `bonus` too. `byDraw` = they won because they were among the players tied for first. */
  underdog: (Underdog & { byDraw: boolean }) | null;
}

/** Everything a phone needs to draw the lobby. The server sends a fresh copy on every change. */
export interface RoomState {
  code: string;
  name: string; // what the room is called in the list
  hasPassword: boolean; // (the password itself never leaves the server)
  hostId: string;
  /** Everyone in the room, in join order: those playing AND those watching (see `watchingIds`). */
  players: Player[];
  /**
   * Members who are not in this round. They keep their points and still count when the session winner is decided, but they
   * don't ready up and aren't in the round. Every spectator is in here, and so is someone with a seat who joined mid-round
   * (until that round is over: then they play). Nobody can switch from watching to playing on their own.
   */
  watchingIds: string[];
  /** Each member's color (from PLAYER_COLORS), by player id: their color in every game. Everyone has a different one. */
  colors: Record<string, string>;
  /**
   * Members with NO SEAT, in line order: they only watch, and they are the only people who can bet. A room has MAX_PLAYERS seats; whoever
   * joins with no seat free is added to the back of this line, and so is anyone who gives up their seat. A seat is never taken on your own:
   * when one opens up (someone leaves or gives theirs up) the FIRST in this line gets it automatically.
   */
  spectatorOnlyIds: string[];
  /**
   * YOUR bet for the coming (or running) round, if you have one, keyed by your id. Bets are private: the server only ever sends
   * you your own, nobody can see who anyone else bet on. You bet in the ready step; the stake is locked when the countdown ends.
   */
  bets: Record<string, Bet>;
  /** The underdog of the round that is about to start / running, or null. Shown to everyone during the 'underdog' phase. */
  underdog: Underdog | null;
  /** Server clock when the 'underdog' announcement ends and the round starts, or null. */
  underdogEndsAt: number | null;
  /** Players whose connection dropped (a refresh, a bad signal): their seat is held for a grace period, and they come back by reconnecting. */
  offlineIds: string[];
  /** The team step: when the host pressed Start, the server time the start countdown ends (null = not counting; the host can cancel). */
  teamCountdownEndsAt: number | null;
  /** The roulette (only when the host picked Random): the game the server chose, and when the spin starts and ends (server clock). Everyone's carousel lands on `gameId` at `endsAt`. */
  roulette: { gameId: GameId; startsAt: number; endsAt: number } | null;
  /** Server clock when the 'starting' (flash) step ends and the round begins, or null. */
  startingEndsAt: number | null;
  settings: RoomSettings;
  /** Every member's team (team games use it; everyone always has one, picked at random when they joined). */
  teams: Record<string, TeamId>;
  readyIds: string[]; // ids of players who tapped Ready
  phase: RoomPhase;
  /** Server clock (epoch ms) when the countdown hits zero, or null. */
  countdownEndsAt: number | null;
  /**
   * Rounds won so far this session, by player id (players with none are absent). Includes people who have since
   * left: the server keeps their wins so they can still be named the winner.
   */
  scores: Record<string, number>;
  game: GameView | null; // while phase is 'playing' or 'finish' (frozen during the finish sequence)
  result: RoundResult | null; // while phase is 'finish' or 'results'
  /** Decided rounds played this session. Draws are replayed and don't count. */
  roundsPlayed: number;
  /** Set once the session is over (a snapshot of who won). */
  sessionWinner: Player | null;
  /** Server clock when the finish sequence (you won / you lost) ends and the summary appears, or null. */
  finishEndsAt: number | null;
  /** Server clock when the results screen moves on, or null. */
  resultsEndsAt: number | null;
  /** Server clock when this message was built. Phones compare it to their own clock to stay in sync. */
  serverTime: number;
}

export type RoomError =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'COLOR_TAKEN' // someone else already has that color
  | 'INVALID_COLOR' // not one of PLAYER_COLORS
  | 'NO_SEAT' // a spectator tried to switch to playing (seats are only filled from the line when one opens up)
  | 'NOT_A_SPECTATOR' // only spectators can bet
  | 'INVALID_BET' // not a playing player, or more victory points than the bettor has
  | 'ALREADY_IN_ROOM'
  | 'GAME_IN_PROGRESS'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'INVALID_SETTING'
  | 'WRONG_PASSWORD' // the room has a password and it was missing or wrong
  | 'TOO_MANY_ATTEMPTS' // too many wrong passwords (or requests) in a short time: wait a little
  | 'TOO_MANY_ROOMS' // the server is full of rooms, or you are making them too fast
  | 'WRONG_PHASE'
  | 'NO_GAME_SELECTED'
  | 'TEAMS_LOCKED' // the host has turned team swapping off
  | 'NOT_A_TEAM_GAME'
  | 'TEAMS_NOT_FILLED'; // the team step: each team needs a player before the host can start

/** Reply shape for events that expect an answer (Socket.io "acknowledgements"). */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

/** One room in the list of joinable rooms. Only public things: never the password, only whether there is one. */
export interface RoomListing {
  code: string; // the room's id (what `room:join` needs; players never type it)
  name: string;
  hasPassword: boolean;
  hostName: string;
  members: number; // everyone in it: players and spectators
  capacity: number; // MAX_PLAYERS + MAX_SPECTATORS
  full: boolean;
  gameName: string | null;
  phase: RoomPhase;
}

/** What a host can set when making a room. */
export interface CreateRoomOptions {
  name?: string; // default: DEFAULT_ROOM_NAME
  password?: string; // default: none
}

/** What someone sends to join a room: its id, the password if it has one, and whether they only want to watch. */
export interface JoinRequest {
  code: string;
  password?: string;
  /** Join as a spectator even if a seat is free (only possible when joining: seats never change by choice afterwards, except by giving yours up). */
  asSpectator?: boolean;
}

export interface JoinResult {
  playerId: string; // which entry in `room.players` is "me"
  room: RoomState;
}

/** Sent in the connection handshake: an account's access token OR a guest's chosen name. */
export interface HandshakeAuth {
  token?: string;
  guestName?: string;
  /** A guest's signed identity token (given by the server on a first visit, kept by the browser, sent back on every connection): it is what lets a refreshed page be recognised as the same guest. */
  guestToken?: string;
}

export interface ClientToServerEvents {
  /** Make a room (options are optional: `room:create` with just an ack makes a "Game Room" with no password). */
  'room:create': (optionsOrAck: CreateRoomOptions | ((res: Ack<JoinResult>) => void), ack?: (res: Ack<JoinResult>) => void) => void;
  /** Join a room from the list: its id (a plain string works too, for a room with no password), and the password if it has one. */
  'room:join': (target: string | JoinRequest, ack: (res: Ack<JoinResult>) => void) => void;
  /** The list of rooms anyone can try to join. */
  'rooms:list': (ack: (res: Ack<RoomListing[]>) => void) => void;
  /** Switch between playing (false) and watching (true). Lobby/countdown only. Your points are kept either way. */
  'player:watching': (watching: boolean, ack?: (res: Ack<null>) => void) => void;
  'room:leave': () => void;
  /** The team step (the Random tile landed on a team game), host only: the teams are set, start the round. */
  'room:start-teams': (ack?: (res: Ack<null>) => void) => void;
  /** The team step, host only: cancel the start countdown. */
  'room:cancel-start': (ack?: (res: Ack<null>) => void) => void;
  /** Team games: pick my team (only while the host allows swapping). It resets everyone's Ready. */
  'player:team': (team: TeamId, ack?: (res: Ack<null>) => void) => void;
  /** After a refresh or a dropped connection: put me back in the room I was in (the server kept my seat for a short grace period). Fails with NOT_IN_ROOM if there is none. */
  'room:rejoin': (ack: (res: Ack<JoinResult>) => void) => void;
  /** Host only, in the lobby: end the session. The player with the most wins is crowned and saved. */
  'session:end': (ack?: (res: Ack<null>) => void) => void;
  /** Host only, in the lobby: pick the game (cancels a countdown and clears every Ready), rename the room, or set (a string) or remove (null) its password. */
  'room:settings': (settings: { gameId?: GameId | typeof RANDOM_GAME; teamSwap?: boolean; name?: string; password?: string | null }, ack?: (res: Ack<null>) => void) => void;
  /** Pick your color (one of PLAYER_COLORS that nobody else has). Lobby/countdown only. It is your color in every game. */
  'player:color': (color: string, ack?: (res: Ack<null>) => void) => void;
  'player:ready': (ready: boolean, ack?: (res: Ack<null>) => void) => void;
  /**
   * Spectators only, lobby/countdown: bet on a player to win the round (`targetId`, or null to take the bet back), putting up
   * `stake` victory points of your own (0..your points). With no stake: win +1, and you can't lose anything. With a stake: win that many points, lose that many.
   * Changing a bet drops your Ready, so you ready up again with the bet you want.
   */
  'player:bet': (targetId: string | null, stake: number, ack?: (res: Ack<null>) => void) => void;
  /** Fire-and-forget (no ack) because taps are frequent. */
  'game:action': (action: GameAction) => void;
  /** Host only, lobby or session-over: wipe the scores and start a fresh session in the same room. */
  'room:reset': (ack?: (res: Ack<null>) => void) => void;
  /** Host only, lobby or session-over: close the room and send everyone out (a still-open session is ended and saved first). */
  'room:close': (ack?: (res: Ack<null>) => void) => void;
  /** Host only; ends the round early, or skips the results screen. */
  'room:return-to-lobby': (ack?: (res: Ack<null>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  /** A guest's signed identity token, for the browser to keep (see HandshakeAuth.guestToken). */
  'guest:token': (token: string) => void;
  /** Another connection for the same player took over (a second tab, or the refreshed page): this one is being closed and must not reconnect. */
  'session:replaced': () => void;
  /** The host closed the room: everyone has been removed from it. */
  'room:closed': () => void;
  /**
   * A live snapshot of a continuous game (e.g. Snowball), sent many times a second as "volatile"
   * (a phone on a bad connection just skips the ones it can't take). Carries the server clock too.
   */
  'game:view': (view: GameView, serverTime: number) => void;
}
