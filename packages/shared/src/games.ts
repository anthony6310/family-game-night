import { FISHING_BREACH_SECONDS, MAX_PLAYERS, WINNER_FINISH_SECONDS } from './config';

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
  /** How long the in-game start countdown lasts before the round's clock starts, if not the usual GAME_INTRO_SECONDS (0 = the game has its own opening and times its own countdown). */
  introSeconds?: number;
}

// The games, in ALPHABETICAL order by name (this is the order the picker shows them in; keep it that way when adding one).
export const GAMES = [
  {
    id: 'fishing',
    name: 'Fishing',
    description: 'Everyone casts a line off the pier and your hook sinks to the bottom of the ocean. Then all the hooks are reeled up at the same speed for one minute. Slide your hook left and right (inside your own lane), and up a little, to line it up with a fish\'s mouth and hook it. The fish swim across every lane, so you are all fishing the same ocean. When the hooks break the surface your catch is piled up on the dock, and the biggest pile wins! Fish in a school are worth 1 point each, regular fish 3, and a big fish 5. Watch out for the mines in your lane: if your hook touches one it shakes off 10% of your points in fish!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'points', // (a small fish in a school is 1, a regular fish 3, a rare big fish 5)
    introSeconds: 0, // (the cast is its own opening: the countdown is timed to end when the hooks get control)
    finishSeconds: WINNER_FINISH_SECONDS + FISHING_BREACH_SECONDS, // the hooks breaking the surface, then the piles (own view), then the winner
  },
  {
    id: 'penguin-lasso',
    name: 'Penguin Lasso',
    description: 'Skate around the ice looking for animals. Your skate trail is your lasso: skate a closed loop around one to put it in your bag. The trail is short and fades as you go, so close your loops fast. Penguins are worth 1 point, tricky sliding seals 2, and a rare polar bear 5 (but it takes 3 of your 6 bag spaces and slows you down: by half with one bear, to a third with two). When your bag is full your trail disappears until you cash in. Skate back to your igloo to cash in: only cashed-in points count. Most points wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'points', // (animals of different values are cashed in: penguins, seals and bears)
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'santa-sack',
    name: "Santa's Sack",
    description: "Santa's elves are out in a snowy forest clearing and his gift bags are empty! You are one of the elves, with an endless pile of gifts. Nine big bags float round in a circle in front of you: pull back like a slingshot and let go to lob a gift into one (the harder you pull, the farther it flies, and the bags keep moving, so aim ahead!). The elf with the most gifts in a bag controls it, and the bag turns that elf's color. Every bag is worth the same: control the most bags at the end to win! But the bags don't stay open: after 15 seconds some of them are cinched shut (watch for the bags that flash, they are about to close, and a closed bag bounces gifts away), then the others close, and for the last 15 seconds they are all open again.",
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'gifts',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'snowball',
    name: 'Snowball',
    description: 'Roll around and grow as big as you can. Every bump costs both balls size, the biggest ball hits twice as hard, and a smaller ball that hits a bigger one refills its stamina instantly. Hills slow you a little uphill and speed you up downhill, and you can hold sprint to go 50% faster until your stamina runs out (and a hit made while sprinting does 5 extra damage). Biggest ball wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: '',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'tap-race',
    name: 'Tap Race',
    description: 'Tap as fast as you can. Most taps wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'taps',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
] as const satisfies readonly GameInfo[];

/** Union of valid game ids, derived from the list above so the two can never drift. */
export type GameId = (typeof GAMES)[number]['id'];

export function getGame(id: string | null): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
