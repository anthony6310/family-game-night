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
