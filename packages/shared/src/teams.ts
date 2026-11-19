/**
 * TEAM games (GAME_RULES.md #17): a few games are played in two teams instead of everyone for themselves. There are only ever two teams, with fixed colors.
 * Everyone starts on a random team; if the host allows swapping, players can pick a side. The host can give either team a handicap (a head start in the game's own score).
 */
export const TEAM_IDS = ['yellow', 'purple'] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAM_COLORS: Record<TeamId, string> = { yellow: '#ffd23d', purple: '#8e44ad' };
export const TEAM_NAMES: Record<TeamId, string> = { yellow: 'Team Yellow', purple: 'Team Purple' };
export const HANDICAP_MAX = 999; // a handicap is a whole number from -999 to 999
export const isTeamId = (v: unknown): v is TeamId => v === 'yellow' || v === 'purple';
