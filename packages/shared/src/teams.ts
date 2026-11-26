/**
 * TEAM games (GAME_RULES.md #17): a few games are played in two teams instead of everyone for themselves. There are only ever two teams, with fixed colors.
 * Everyone starts on a random team; if the host allows swapping, players can pick a side.
 */
export const TEAM_IDS = ['yellow', 'purple'] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAM_COLORS: Record<TeamId, string> = { yellow: '#ffd23d', purple: '#8e44ad' };
export const TEAM_NAMES: Record<TeamId, string> = { yellow: 'Team Yellow', purple: 'Team Purple' };
export const isTeamId = (v: unknown): v is TeamId => v === 'yellow' || v === 'purple';
/** What a team is called in a game (the game may name them, e.g. The Roaches / The Sandal), or the usual Team Yellow / Team Purple. */
export const teamNamesFor = (names: { yellow: string; purple: string } | undefined): Record<TeamId, string> => names ?? TEAM_NAMES;
