// Game-wide settings shared by client and server. Change them here only.

/** Maximum players allowed in one room. */
export const MAX_PLAYERS = 8;
/**
 * Players can switch to "watching" at any time between rounds. Watchers keep their points but don't use one of the
 * MAX_PLAYERS playing slots, so a room can hold this many extra people (and it bounds the room's broadcasts).
 */
export const MAX_SPECTATORS = 16;

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
export const WINNER_SECONDS = 3;
export const WINNER_FINISH_SECONDS = OWN_VIEW_SECONDS + WINNER_SECONDS;
// Tap Race's original names for the same thing (kept so older code and tests still read naturally).
export const TAP_RACE_OWN_BUTTON_SECONDS = OWN_VIEW_SECONDS;
export const TAP_RACE_WINNER_SECONDS = WINNER_SECONDS;
export const TAP_RACE_FINISH_SECONDS = WINNER_FINISH_SECONDS;

/** How long the round summary screen stays up before the room moves on by itself. */
export const RESULTS_SECONDS = 4;

/** How long a Snowball round lasts. */
export const SNOWBALL_SECONDS = 60;

/** How long a Penguin Lasso round lasts. */
export const PENGUIN_SECONDS = 60;
