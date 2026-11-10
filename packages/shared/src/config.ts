// Game-wide settings shared by client and server. Change them here only.

/** Session lengths the host can choose from. Keep every value odd. */
export const ROUND_OPTIONS = [3, 5, 7] as const;

/** Maximum players allowed in one room. */
export const MAX_PLAYERS = 8;

/** Display-name length limit (used by the UI and mirrored by a DB check constraint). */
export const DISPLAY_NAME_MAX = 20;

/** Avatar upload rules (mirrored by the Storage bucket settings). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Invite codes: 4 characters, skipping look-alikes (no 0/O or 1/I) so they're easy to read out loud. */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Seconds of countdown once everyone is ready. */
export const COUNTDOWN_SECONDS = 5;

/** How long a Tap Race round lasts. */
export const TAP_RACE_SECONDS = 10;

/** How long round results stay on screen before the room moves on by itself. */
export const RESULTS_SECONDS = 6;
