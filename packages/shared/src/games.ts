import { MAX_PLAYERS, WINNER_FINISH_SECONDS } from './config';

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
  /** Word shown after each player's round score on the results screen (empty = just the number). */
  scoreLabel: string;
  /** How long this game's end-of-round sequence lasts, if not the usual FINISH_SECONDS. */
  finishSeconds?: number;
}

export const GAMES = [
  {
    id: 'tap-race',
    name: 'Tap Race',
    description: 'Tap as fast as you can. Most taps wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'taps',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'snowball',
    name: 'Snowball',
    description: 'Roll around and grow as big as you can. Every bump costs both balls size, the biggest ball hits twice as hard, and smaller balls get a speed boost to get away. Biggest ball wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: '',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'penguin-lasso',
    name: 'Penguin Lasso',
    description: 'Skate around the ice looking for animals. Your skate trail is your lasso: skate a closed loop around one to put it in your bag. The trail is short and fades as you go, so close your loops fast. Penguins are worth 1 point, tricky sliding seals 2, and a rare polar bear 5 (but it takes 3 of your 6 bag spaces and slows you down: by half with one bear, to a third with two). When your bag is full your trail disappears until you cash in. Skate back to your igloo to cash in: only cashed-in points count. Most points wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'penguins',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
] as const satisfies readonly GameInfo[];

/** Union of valid game ids, derived from the list above so the two can never drift. */
export type GameId = (typeof GAMES)[number]['id'];

export function getGame(id: string | null): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
