import { MAX_PLAYERS } from './config';

/**
 * Static info about each game, used by the lobby menu and by the server's start rules.
 * To add a game later: add an entry here (the engine itself arrives in MVP 4).
 */
export interface GameInfo {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Unit shown next to each player's round score on the results screen. */
  scoreLabel: string;
}

export const GAMES = [
  {
    id: 'tap-race',
    name: 'Tap Race',
    description: 'Tap as fast as you can. Most taps wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'taps',
  },
  {
    id: 'snowball',
    name: 'Snowball',
    description: 'Roll around and grow as big as you can. Every bump costs both balls size, the biggest ball hits twice as hard, and smaller balls get a speed boost to get away. Biggest ball wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'cm',
  },
] as const satisfies readonly GameInfo[];

/** Union of valid game ids, derived from the list above so the two can never drift. */
export type GameId = (typeof GAMES)[number]['id'];

export function getGame(id: string | null): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
