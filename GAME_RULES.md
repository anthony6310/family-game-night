# Game rules (ongoing)

Rules that apply to **every** game in Family Fun Game, now and in the future. When you add a game, check this list.
This file is kept up to date as we go; the blueprint (`BLUEPRINT.md`) is the original milestone plan and is left as it is.

To add a rule: give it the next number, say what it is, say why, and name the code that carries it out.

---

## 1. Every timed game ends its countdown the same way

**Rule.** Any game with a round clock uses the same countdown, with no per-game variations:

- For each of the **last 5 seconds** there is a clock **tick** (alternating tick / tock), starting at the moment the on-screen timer shows that number (5, 4, 3, 2, 1).
- The ticks get **louder each second**: about 30% of full volume at 5 seconds left, rising to full volume at the last second.
- When time reaches zero, a **whistle** blows.
- It is heard at the **same volume by everyone**, spectators included (it belongs to the whole round, not to a place on the board).
- It follows the player's **sound on/off** setting like every other sound.
- It only reacts to changes it actually sees happen: joining a round late, or looking at one that has already ended, makes no noise.

**Why.** Players learn it once and it means "the round is about to end" in every game.

**How it is done.** One shared piece of code, `apps/web/src/audio/roundClock.ts` (`createRoundClock`). It has no options on purpose, so no game can end differently. The sounds themselves (`clockTick`, `clockTock`, `whistle`) are in `apps/web/src/audio/gameSounds.ts`, made live by the browser's audio engine (no sound files).

**Adding it to a new game's scene:**

1. Make a clock in the scene: `createRoundClock((sound, gain) => audio.play(sound, listenerX, listenerZ, gain, 1))`, playing at the listener so the volume is the same everywhere.
2. From the game screen, call `clock.update(secondsLeft)` whenever the timer updates (the screens already re-render about 10 times a second).

Games that have it so far: **Tap Race**, **Snowball** and **Penguin Lasso**.

---

## 2. Every round ends with the winner moment (the camera pans to the winner)

**Rule.** When a round ends, the game does not jump straight to a result. Every game that uses this ending does the same two steps, in the same order, with the same timing:

1. **Your own view, no result (1.5 s).** Input stops, and each player keeps looking at their own view (their own button, their own skater). Nobody is told who won yet.
2. **The winner (2 s).** The camera glides to the **winner** for **everyone** (players and spectators alike), and a banner reads **"The winner is [name]"**. On a draw it reads **"It's a draw!"** and the camera pulls back to the middle.

Then the normal results screen follows. Together the two steps are the game's finish sequence, **3.5 s**.

**Why.** It builds a little suspense, and it means every game ends in a way players already know.

**How it is done.**

- The timings are shared settings in `packages/shared/src/config.ts`: `OWN_VIEW_SECONDS` (1.5), `WINNER_SECONDS` (2) and `WINNER_FINISH_SECONDS` (their sum).
- The game's entry in `packages/shared/src/games.ts` sets `finishSeconds: WINNER_FINISH_SECONDS`, which makes the server wait that long before the results screen.
- On screen, one shared piece of code, `apps/web/src/components/WinnerMoment.tsx`, does the rest: `isWinnerMoment(...)` says when step 2 has started and `<WinnerBanner>` draws the banner.

**Adding it to a new game's screen:**

1. Take the `result` and `finishEndsAt` props (LobbyPage passes them in).
2. `const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow)`.
3. While `winnerMoment` is true, point the scene's camera at `result.winnerId` for everyone, and render `<WinnerBanner result={result} />`.
4. In `LobbyPage`, skip the generic `FinishOverlay` for that game.

Games that have it so far: **Tap Race** and **Penguin Lasso**.

**Not yet:** **Snowball** still ends with the older you-won / you-lost message (`FinishOverlay`). It should be moved over to this rule.
