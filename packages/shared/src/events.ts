import type { TerrainFeature } from './terrain';
import type { GameId } from './games';
import type { CreatureKind } from './config';

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
export interface RoomSettings {
  gameId: GameId | null; // null until the host picks a game
}

/**
 * 'lobby'     choosing settings and readying up
 * 'countdown' everyone is ready; the game starts at `countdownEndsAt`
 * 'playing'   a round is running
 * 'finish'    the round just ended: the result is decided, input is stopped and a "you won / you lost" message
 *             plays over the frozen game for a few seconds
 * 'results'   the round summary screen (moves on by itself after a few seconds)
 * 'underdog'  (only when there is an underdog) the countdown is over and everyone is shown the underdog for a few seconds
 *             before the round starts
 * 'session-over' the host ended the session (or the room emptied): the player with the most wins is crowned
 */
export type RoomPhase = 'lobby' | 'countdown' | 'underdog' | 'playing' | 'finish' | 'results' | 'session-over';

/**
 * What a phone may send during a round. The server decides what it actually means.
 * `steer` is a direction on the ground in world axes (x = east, z = south), each -1..1.
 * The server clamps its length to 1, so sending a bigger vector gains nothing.
 */
export type GameAction = { type: 'tap' } | { type: 'steer'; x: number; z: number } | { type: 'sprint'; on: boolean };

/** Tap Race, as phones see it. */
export interface TapRaceView {
  gameId: 'tap-race';
  startsAt: number; // server clock (epoch ms)
  endsAt: number;
  taps: Record<string, number>; // playerId -> taps counted by the SERVER
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
  variant: number; // which of the colorful looks it has (0..5)
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
  hooks: Record<string, { x: number; fish: number }>; // where each hook is along the width, and how many fish it has caught
  fish: FishView[];
}

/** What phones are told about a running round: one shape per game, told apart by `gameId`. */
export type GameView = TapRaceView | SnowballView | PenguinLassoView | FishingView;

/** A spectator's bet on one player to win a round. With no stake it is a free bet worth 1 victory point if it wins. With a stake, the spectator puts up victory points of their own and wins (or loses) exactly that many. */
export interface Bet {
  targetId: string; // the player they think will win
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
  /** PUBLIC: the spectators whose bets won, and how much each won. (It only says they backed the winner, never anything else.) */
  winningBettors: { bettorId: string; delta: number }[];
  /** Set when the underdog won this round: they collected `bonus` too. `byDraw` = they won because they were among the players tied for first. */
  underdog: (Underdog & { byDraw: boolean }) | null;
}

/** Everything a phone needs to draw the lobby. The server sends a fresh copy on every change. */
export interface RoomState {
  code: string;
  hostId: string;
  /** Everyone in the room, in join order: those playing AND those watching (see `watchingIds`). */
  players: Player[];
  /**
   * Members who are watching instead of playing. They keep their points and still count when the session winner is
   * decided, but they don't ready up, don't take one of the MAX_PLAYERS playing slots and aren't in the round.
   * Anyone who joins mid-round, or into a full room, starts out watching.
   */
  watchingIds: string[];
  /** Each member's color (from PLAYER_COLORS), by player id: their color in every game. Everyone has a different one. */
  colors: Record<string, string>;
  /**
   * Members who can ONLY watch: only the first MAX_PLAYERS people to join a room (in join order) may play, so anyone beyond
   * that is spectator-only and has no Play option. When one of those first people leaves, the earliest of these gets a seat.
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
  settings: RoomSettings;
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
  | 'NO_SEAT' // a spectator-only member tried to switch to playing
  | 'NOT_A_SPECTATOR' // only spectators can bet
  | 'INVALID_BET' // not a playing player, or more victory points than the bettor has
  | 'ALREADY_IN_ROOM'
  | 'GAME_IN_PROGRESS'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'INVALID_SETTING'
  | 'WRONG_PHASE'
  | 'NO_GAME_SELECTED';

/** Reply shape for events that expect an answer (Socket.io "acknowledgements"). */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

export interface JoinResult {
  playerId: string; // which entry in `room.players` is "me"
  room: RoomState;
}

/** Sent in the connection handshake: an account's access token OR a guest's chosen name. */
export interface HandshakeAuth {
  token?: string;
  guestName?: string;
}

export interface ClientToServerEvents {
  'room:create': (ack: (res: Ack<JoinResult>) => void) => void;
  'room:join': (code: string, ack: (res: Ack<JoinResult>) => void) => void;
  /** Switch between playing (false) and watching (true). Lobby/countdown only. Your points are kept either way. */
  'player:watching': (watching: boolean, ack?: (res: Ack<null>) => void) => void;
  'room:leave': () => void;
  /** Host only, in the lobby: end the session. The player with the most wins is crowned and saved. */
  'session:end': (ack?: (res: Ack<null>) => void) => void;
  /** Host only: pick the game. Changing it cancels a countdown and clears every Ready. */
  'room:settings': (settings: { gameId?: GameId }, ack?: (res: Ack<null>) => void) => void;
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
  /** The host closed the room: everyone has been removed from it. */
  'room:closed': () => void;
  /**
   * A live snapshot of a continuous game (e.g. Snowball), sent many times a second as "volatile"
   * (a phone on a bad connection just skips the ones it can't take). Carries the server clock too.
   */
  'game:view': (view: GameView, serverTime: number) => void;
}
