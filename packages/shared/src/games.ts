import { FISHING_BREACH_SECONDS, GAME_INTRO_COUNT_SECONDS, MAX_PLAYERS, SHELTER_PAN_SECONDS, TUG_CLOSING_SECONDS, WINNER_FINISH_SECONDS, WINNER_SECONDS } from './config';

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
  /** How long the in-game 3, 2, 1 lasts after the static buffer (GAME_INTRO_HOLD_SECONDS, which every game gets), if not the usual GAME_INTRO_COUNT_SECONDS (0 = the game has its own opening and times its own countdown inside it). */
  introSeconds?: number;
  /** A TEAM game (GAME_RULES.md #17): played as two teams, with the team picker and handicaps in the lobby, bets on a team, no underdog, and a win for every member of the winning team. The Random tile never picks one. */
  teams?: boolean;
}

// The games, in ALPHABETICAL order by name (this is the order the picker shows them in; keep it that way when adding one).
export const GAMES = [
  {
    id: 'mountain-goat',
    name: 'Closing the Gap',
    description: 'You are a mountain goat crossing big gaps on a mountain. A marker stretches out and shrinks back from your goat: tap at the exact moment it reaches the next ledge and your goat leaps across and lands. Miss, and it tumbles into the gap and has to climb back. Every ledge you reach is a point, but the ledges keep getting smaller, and later on a bird flies back and forth over the gap: if your goat meets it in the air they both tumble, so time your leap to slip past it. Most points wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'ledges',
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
  {
    id: 'fishing',
    name: 'Fishing',
    description: 'Everyone casts a line off the pier and your hook sinks to the bottom of the ocean. Then all the hooks are reeled up at the same speed for one minute. Slide your hook left and right (inside your own lane), and up a little, to line it up with a fish\'s mouth and hook it. The fish swim across every lane, so you are all fishing the same ocean. When the hooks break the surface your catch is piled up on the dock, and the biggest pile wins! Fish in a school are worth 1 point each, regular fish 3, and a big fish 5. Watch out for the mines in your lane: if your hook touches one it shakes off 10% of your points in fish!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'points', // (a small fish in a school is 1, a regular fish 3, a rare big fish 5)
    introSeconds: 0, // (the cast is its own opening: after the 2 second buffer, the countdown is timed to end when the hooks get control)
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
    description: "Santa's elves are out in a snowy forest clearing and his gift bags are empty! You are one of the elves, with an endless pile of gifts. Nine big bags float round in a circle in front of you: pull back like a slingshot and let go to lob a gift into one (the harder you pull, the farther it flies, and the bags keep moving, so aim ahead!). A bag holds at most 5 gifts, shown as a heap in its mouth in each elf's color; when it is full, a new gift pushes out a random gift of another color. The elf with the most gifts in a bag controls it, and the bag turns that elf's color. Every bag is worth the same: control the most bags at the end to win! But the bags don't stay open: after 15 seconds some of them are cinched shut (watch for the bags that flash, they are about to close, and a closed bag bounces gifts away), then the others close, and for the last 15 seconds they are all open again.",
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'bags',
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
    id: 'snowflake-match',
    name: 'Snowflake Match',
    description: 'Snowflakes drift down in front of you, and your gloved hand holds one snowflake. Tap a falling snowflake that matches the one in your hand to score a point, and your hand pops it and shows the next one. But tap a wrong one and you lose a point! Everyone sees the same falling snowflakes, and when one drifts off the bottom it comes back at the top somewhere new. Most points after 60 seconds wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'matches',
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
  {
    id: 'tug-of-war',
    name: 'Tug of War',
    description: 'Two teams, yellow and purple, pull on a rope. Tap as fast as you can: every tap you make pulls your team. The more taps your team has over the other, the more the rope slides your way. After 15 seconds the team with the most taps wins: they give one massive pull and the other team falls over! Everyone on the winning team gets a victory point. (The host can give a team a head start in taps.)',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'taps',
    teams: true,
    finishSeconds: TUG_CLOSING_SECONDS + WINNER_SECONDS, // the strain, the massive pull and the fall (its own closing sequence), then the winner moment
  },
  {
    id: 'adoption-day',
    name: 'Zoo Adoption',
    description: 'You are a volunteer at a huge animal shelter with no walls and every kind of animal wandering loose. Six people stand behind the adoption counter, and each has a thought bubble showing the exact animal they want. Walk around in first person, find a matching animal in the crowd (it lights up when you are close), pick it up, and carry it back to the counter. Stand on the marked pad in front of the adopter and press the button to hand it over: the right animal scores a point and the adopter is replaced by a new one, and the wrong one runs off. Everyone is racing for the same six requests. Most adoptions wins!',
    minPlayers: 2,
    maxPlayers: MAX_PLAYERS,
    scoreLabel: 'adoptions',
    introSeconds: SHELTER_PAN_SECONDS + GAME_INTRO_COUNT_SECONDS, // (the opening pans along the adopters for SHELTER_PAN_SECONDS, then the usual 3, 2, 1 pans into the player's view)
    finishSeconds: WINNER_FINISH_SECONDS, // own view, then the winner
  },
] as const satisfies readonly GameInfo[];

/** Union of valid game ids, derived from the list above so the two can never drift. */
export type GameId = (typeof GAMES)[number]['id'];

export function getGame(id: string | null): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
