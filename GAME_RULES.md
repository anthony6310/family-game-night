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

Games that have it so far: **Tap Race** and **Snowball**.
