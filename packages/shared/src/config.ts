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
/** The roulette step (only when the host picked the Random tile): after the countdown the carousel spins fast and eases out onto the chosen game over this long (GAME_RULES.md #13). */
export const ROULETTE_SPIN_SECONDS = 7; // the spin itself: fast, then easing out onto the game
export const ROULETTE_HOLD_SECONDS = 2; // then the chosen game stays in the middle this long, so everyone can see which one was picked
export const ROULETTE_SECONDS = ROULETTE_SPIN_SECONDS + ROULETTE_HOLD_SECONDS; // 9 in all
export const COUNTDOWN_SECONDS = 3; // the lobby countdown: once everyone is ready, a simple 3, 2, 1 in the lobby before the flash and loading page (GAME_RULES.md #10)

/** How long a Tap Race round lasts. */
export const TAP_RACE_SECONDS = 15;
export const TUG_SECONDS = 15; // Tug of War lasts as long as Tap Race

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

/** How long a Santa's Sack round lasts. */
export const SANTA_SECONDS = 60;
export const GOAT_SECONDS = 45; // Closing the Gap
export const FLAKE_SECONDS = 60; // Snowflake Match
export const SHELTER_SECONDS = 90; // Zoo Adoption
export const SHELTER_PAN_SECONDS = 7; // Zoo Adoption's opening: the camera pans along the adopters (the countdown follows it)
/** The color of a bag in Santa's Sack that nobody is winning (a leather brown that is NOT one of PLAYER_COLORS, so it is never mistaken for a player). */
export const SANTA_NEUTRAL_BAG_COLOR = '#8b6b45';

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
 * The START SCREEN: when a round is about to begin, the screen flashes (fades to a pale color over the countdown), and the flash fades away to show a
 * loading page with the game's picture and title. It is its own step ("starting") between the countdown (or the underdog announcement) and the round: the
 * round does NOT start until it is over. The flash takes START_FLASH_IN_MS to cover the screen and START_FLASH_OUT_MS to fade away again (so the page is fully
 * visible 2 s in); the page is then held until STARTING_MS (3.5 s in all), and on phones it fades away over the start of the game (a cross-fade, not a cut).
 */
/**
 * The IN-GAME START (every game; GAME_RULES.md #10). The round's own clock starts GAME_INTRO_SECONDS after the 'starting' step ends: for those seconds the scene is already shown.
 * EVERY game (including one with its own opening sequence) first gets GAME_INTRO_HOLD_SECONDS of BUFFER: the camera stays STATIC on the game's first view, with no countdown and nothing moving, so the players can take in the game. Then a big "3, 2, 1, GO!"
 * counts down (the last 3 seconds), and the camera pans and zooms onto the player's own view through it, arriving at GO. Nobody can act until GO. A game with its own opening
 * sequence (Fishing's cast) sets `introSeconds: 0` in games.ts: it gets the buffer, then its opening starts and its countdown is timed so that GO is the moment the player gets control.
 */
export const GAME_INTRO_HOLD_SECONDS = 2;
export const GAME_INTRO_COUNT_SECONDS = 3;
export const GAME_INTRO_SECONDS = GAME_INTRO_HOLD_SECONDS + GAME_INTRO_COUNT_SECONDS; // 5

export const START_FLASH_IN_MS = 600;
export const START_FLASH_OUT_MS = 1400;
export const STARTING_MS = 3500; // how long the 'starting' step lasts: 3.5 s

/**
 * Rooms are found in a LIST (not by a code). The host names the room (this name is used if they don't), and may add a password. Names and
 * passwords have length limits (the server also strips control and direction-changing characters from names), and the server holds at most
 * MAX_ROOMS rooms at a time.
 */
export const DEFAULT_ROOM_NAME = 'Game Room';
export const ROOM_NAME_MAX = 30;
export const ROOM_PASSWORD_MAX = 64;
export const MAX_ROOMS = 200;

/**
 * The kinds of fish in the ocean (Fishing) and what each is worth. A SCHOOL is a bunch of small, slower fish that swim together (1 point each);
 * REGULAR fish are the usual ones (3 points); a BIG fish is bigger than any regular one, swims 40% faster and is worth 5 points (a few in every game).
 */
export type FishKind = 'school' | 'regular' | 'big';
export const FISH_POINTS: Record<FishKind, number> = { school: 1, regular: 3, big: 5 };
export const FISH_KINDS: FishKind[] = ['school', 'regular', 'big']; // (the order of `kinds` counts in the view)

/** How long a player's seat is held after their connection drops (a page refresh, a bad signal) before they are counted as having left (GAME_RULES.md #15). */
export const RECONNECT_GRACE_SECONDS = 45;

/**
 * Tug of War's closing sequence (GAME_RULES.md #18), after the 15 seconds are up: the teams STRAIN (anticipation), the winners give one massive PULL, the losers FALL while the winners stand
 * and cheer. Then the usual winner moment (WINNER_SECONDS: the camera pans out and the winning team is named). All in seconds.
 */
export const TUG_STRAIN_SECONDS = 1.5;
export const TUG_PULL_SECONDS = 0.7;
export const TUG_FALL_SECONDS = 1.7;
export const TUG_CLOSING_SECONDS = TUG_STRAIN_SECONDS + TUG_PULL_SECONDS + TUG_FALL_SECONDS; // 3.9
