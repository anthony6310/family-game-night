import { useEffect } from 'react';
import type { GameId } from '@fgn/shared';
import { audio, type BedFn } from './spatialAudio';
import { themeLevel } from './mix';
import { ascentTheme } from './goatSounds';
import { stormTheme } from './pirateSounds';
import { strollTheme } from './zooSounds';
import {
  FISHING_THEME, FROG_CLIMB_THEME, PENGUIN_LASSO_THEME, ROACH_RUMBLE_THEME, SANTA_SACK_THEME, SNOWBALL_THEME, SNOWFLAKE_MATCH_THEME, TAP_RACE_THEME, TUG_OF_WAR_THEME, makeTheme,
} from './themeEngine';

/**
 * Every game's own theme music, and the one place that plays it. The lobby has its own background loop (music.ts); the moment a round starts
 * loading (the room's 'starting' step) the lobby loop rests and the selected game's theme takes over, until the round's finish sequence begins
 * (see `useGameTheme`, used by the room screen). A theme is a "bed" (it loops, bar by bar, until stopped: see `audio.startBed`).
 *
 * Broadside Battle, Closing the Gap and Zoo Adoption have hand-picked themes of their own (pirateSounds, goatSounds, zooSounds). The other
 * nine are made by the engine in themeEngine.ts from a `ThemeSpec`: they are first guesses, easy to change by editing a spec there.
 */

/** Every game's theme (the three picked by ear, and the nine guesses). */
export const GAME_THEMES: Record<GameId, BedFn> = {
  'pirate-broadside': stormTheme,
  'mountain-goat': ascentTheme,
  'adoption-day': strollTheme,
  'tap-race': makeTheme(TAP_RACE_THEME),
  'tug-of-war': makeTheme(TUG_OF_WAR_THEME),
  snowball: makeTheme(SNOWBALL_THEME),
  'penguin-lasso': makeTheme(PENGUIN_LASSO_THEME),
  fishing: makeTheme(FISHING_THEME),
  'santa-sack': makeTheme(SANTA_SACK_THEME),
  'snowflake-match': makeTheme(SNOWFLAKE_MATCH_THEME),
  'roach-hunt': makeTheme(ROACH_RUMBLE_THEME),
  'frog-climb': makeTheme(FROG_CLIMB_THEME),
};

/**
 * Plays the selected game's theme while `on` (and the app's own lobby music rests). The room screen calls this with the round's game and whether
 * the round is loading or running: so the music switches from the lobby to the game as soon as the round starts loading, and back at the finish.
 */
export function useGameTheme(gameId: GameId | null, on: boolean) {
  useEffect(() => {
    if (!on || !gameId) return;
    return audio.startBed(GAME_THEMES[gameId], 0.4 * themeLevel(gameId)); // (the mixer table's level for this game's theme)
  }, [gameId, on]);
}
