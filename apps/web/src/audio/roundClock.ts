import { clockTick, clockTock, whistle } from './gameSounds';
import type { SoundFn } from './snowSounds';

/** The clock ticks once for each of the last CLOCK_SECONDS seconds, getting louder every second. */
const CLOCK_SECONDS = 5;

/**
 * THE countdown for every timed game (an ongoing rule: see GAME_RULES.md). Give it the seconds left whenever they change;
 * it ticks as each of the last 5 seconds begins (the same moment the on-screen timer shows that number), alternating
 * tick / tock, louder every second (50% at 5 seconds left up to full at the last second), and blows the whistle when time
 * runs out. There are deliberately no options: every game's countdown ends the same way. It only reacts to changes it SEES
 * happen: joining late, or looking at a round that has already ended, makes no noise. `play` is how a sound is actually
 * heard (the game decides where it plays from).
 */
export function createRoundClock(play: (sound: SoundFn, gain: number) => void) {
  let shownSecond: number | null = null; // the whole second the clock showed last time
  return {
    update(secondsLeft: number) {
      const shown = Math.ceil(Math.max(0, secondsLeft));
      if (shownSecond !== null && shown !== shownSecond) {
        if (shown >= 1 && shown <= CLOCK_SECONDS) {
          const loudness = 0.5 + 0.5 * ((CLOCK_SECONDS - shown) / (CLOCK_SECONDS - 1)) ** 1.2;
          play(shown % 2 === 1 ? clockTick : clockTock, loudness);
        } else if (shown === 0 && shownSecond > 0) {
          play(whistle, 0.9);
        }
      }
      shownSecond = shown;
    },
  };
}
