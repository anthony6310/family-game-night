// Game-wide settings shared by client and server. Change them here only.

/**
 * How many "seats" a room has: only the FIRST this-many people to join (in join order) may play. Each of them can switch
 * between playing and watching whenever they like between rounds. Everyone who joins after that is spectator-only, until
 * one of the first people leaves and the earliest spectator-only member gets that seat.
 */
export const MAX_PLAYERS = 8;
/** Extra spectator-only people a room can hold beyond the seats (this bounds the room's broadcasts). */
export const MAX_SPECTATORS = 8; // (so a room holds at most MAX_PLAYERS + MAX_SPECTATORS = 16 people)

/** Display-name length limit (used by the UI and mirrored by a DB check constraint). */
export const DISPLAY_NAME_MAX = 20;

/** Avatar upload rules (mirrored by the Storage bucket settings). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Invite codes: 4 characters, skipping look-alikes (no 0/O or 1/I) so they're easy to read out loud. */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Seconds of countdown once everyone is ready. */
export const COUNTDOWN_SECONDS = 3;

/** How long a Tap Race round lasts. */
export const TAP_RACE_SECONDS = 15;

/**
 * How long the "you won / you lost" sequence lasts when a round ends: input is stopped and a message plays over the
 * frozen game, before the round summary screen appears.
 */
export const FINISH_SECONDS = 3;

/**
 * The shared "winner moment" ending (an ongoing rule, see GAME_RULES.md #2): when a round ends, each player first keeps
 * looking at their own view for OWN_VIEW_SECONDS (no result yet), then the camera pans to the winner and a banner names
 * them for WINNER_SECONDS. The two together are that game's finish sequence.
 */
export const OWN_VIEW_SECONDS = 1.5;
export const WINNER_SECONDS = 4;
export const WINNER_FINISH_SECONDS = OWN_VIEW_SECONDS + WINNER_SECONDS;
// Tap Race's original names for the same thing (kept so older code and tests still read naturally).
export const TAP_RACE_OWN_BUTTON_SECONDS = OWN_VIEW_SECONDS;
export const TAP_RACE_WINNER_SECONDS = WINNER_SECONDS;
export const TAP_RACE_FINISH_SECONDS = WINNER_FINISH_SECONDS;

/** How long the round summary screen stays up before the room moves on by itself. */
export const RESULTS_SECONDS = 4;

/** How long a Snowball round lasts. */
export const SNOWBALL_SECONDS = 60;

/** The smallest stake a spectator can put up on a bet (points of their own). A bet with no stake is a free bet; anything staked is at least this. */
export const MIN_STAKE = 2;

/**
 * The underdog rule (see GAME_RULES.md): it only applies to rounds with at least this many players, and only when exactly
 * one of them has no bets on them while every other player has at least one. The announcement is shown for UNDERDOG_SECONDS.
 */
export const UNDERDOG_MIN_PLAYERS = 3;
export const UNDERDOG_SECONDS = 5;

/** How long a Penguin Lasso round lasts. */
export const PENGUIN_SECONDS = 60;

/** The animals on the ice in Penguin Lasso, and how many victory points each is worth once it is cashed in at the igloo. */
export type CreatureKind = 'penguin' | 'seal' | 'bear';
export const CREATURE_POINTS: Record<CreatureKind, number> = { penguin: 1, seal: 2, bear: 5 };

/**
 * How much room each animal takes up in the bag (the bag holds `bagCapacity` spaces). A seal takes the same room as a penguin even
 * though it is worth more; a polar bear is big and takes three spaces.
 */
export const CREATURE_SPACE: Record<CreatureKind, number> = { penguin: 1, seal: 1, bear: 3 };

/**
 * The colors a player can pick (16: one for everyone a room can hold). Each player in a room has their OWN color from this list, nobody
 * else can have the same one at the same time, and it is the color they have in every game, so players are easy to tell apart.
 * The first eight are the original game colors. A player who joins is given the first color in the list that nobody has yet.
 */
export const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#facc15', '#84cc16', '#06b6d4', '#6366f1', '#d946ef', '#92400e', '#64748b', '#be123c',
] as const;

/** Fishing: how long the hooks rise (the round's clock), and the longest the opening cast sequence may take (it plays before the rise starts). */
export const FISHING_SECONDS = 60;
export const FISHING_CAST_SECONDS = 7.5;
/** Fishing's closing shot: after the hooks reach the surface the camera pans up to show them (and the fish on them) coming out of the water. It plays before the overhead shot of the piles, so it makes the round's finish sequence this much longer. */
export const FISHING_BREACH_SECONDS = 4.4;

/**
 * The START FLASH: when a round is about to begin, the screen flashes (fades to a pale color over the countdown, then fades away). It is its own step
 * ("starting") between the countdown (or the underdog announcement) and the round, like a loading screen: the round does NOT start until the flash is
 * almost over. The flash takes START_FLASH_IN_MS to cover the screen and START_FLASH_OUT_MS to fade away again; the round starts START_FLASH_OVERLAP_MS
 * before the flash has finished fading, so the flash reaches just a little way into the game.
 */
export const START_FLASH_IN_MS = 600;
export const START_FLASH_OUT_MS = 1400;
export const START_FLASH_OVERLAP_MS = 300;
export const STARTING_MS = START_FLASH_IN_MS + START_FLASH_OUT_MS - START_FLASH_OVERLAP_MS; // how long the 'starting' step lasts: 1.7 s
