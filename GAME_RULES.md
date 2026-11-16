# Game rules (ongoing)

Rules that apply to **every** game in Family Fun Game, now and in the future. When you add a game, check this list.
This file is kept up to date as we go; the blueprint (`BLUEPRINT.md`) is the original milestone plan and is left as it is.

To add a rule: give it the next number, say what it is, say why, and name the code that carries it out.

---

## 1. Every timed game ends its countdown the same way

**Rule.** Any game with a round clock uses the same countdown, with no per-game variations:

- For each of the **last 5 seconds** there is a clock **tick** (alternating tick / tock), starting at the moment the on-screen timer shows that number (5, 4, 3, 2, 1).
- The ticks get **louder each second**: about 50% of full volume at 5 seconds left, rising to full volume at the last second.
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

## 2. Every round ends with the winner moment sequence (the camera pans to the winner)

**Rule.** When a round ends, the game does not jump straight to a result. **Every game** does the same two steps, in the same order, with the same timing, and the same sounds:

1. **Your own view, no result (1.5 s).** Input stops, and each player keeps looking at their own view (their own button, their own ball, their own skater). Nobody is told who won yet.
2. **The winner (4 s).** The camera glides to the **winner** for **everyone** (players and spectators alike), and a banner reads **"The winner is [name] +1"** over a 40%-dark see-through layer, so it is easy to read while the game still shows behind it. On a draw it reads **"It's a draw!"** and the camera pulls back to the middle.

**Winning bettors and the underdog.** If spectators bet on the winner (see rule 3), the heading becomes **"The winners are"** and the winning bettors are listed under the winner in a smaller font, each with what they won (1 for a free bet, or the points they put up), e.g. "Cam +5". With no winning bettors (for instance a game with no spectators) it stays **"The winner is"**. If the **underdog** won (see rule 5), a line under the winner's name says so and shows their bonus. The more points a number is, the **bigger** it is drawn, the same idea as Tap Race's count growing with every tap (`vpScale` in `WinnerMoment.tsx`). Nobody's bets are ever shown, only who won and how much. A draw with no winner shows no bettors.

Then the normal results screen follows. Together the two steps are the game's finish sequence, **5.5 s**.

**The sound.** The same in every game:

- A **drumroll** starts the instant the round freezes. It begins quiet and slow and keeps getting louder and quicker.
- As the camera reaches the winner it **crescendos** and lands on a **victory fanfare**: a cymbal crash and a deep boom, a quick rising brass call (C, E, G), a big held C major chord, and a shimmer of bells climbing over the top. It is bright, major-key and rising, so it sounds like winning.
- On a **draw** there is no fanfare: the drumroll resolves into a soft, friendly two-note chime.
- Everyone hears it at the **same volume** (it belongs to the whole round, not to a place on the board). It follows the **sound on/off** setting, and it only plays when you actually see the round end (arriving during the sequence is silent).

**Why.** It builds a little suspense, and every game ends in a way players already know.

**How it is done.**

- The timings are shared settings in `packages/shared/src/config.ts`: `OWN_VIEW_SECONDS` (1.5), `WINNER_SECONDS` (4) and `WINNER_FINISH_SECONDS` (their sum).
- The game's entry in `packages/shared/src/games.ts` sets `finishSeconds: WINNER_FINISH_SECONDS`, which makes the server wait that long before the results screen.
- On screen, one shared piece of code, `apps/web/src/components/WinnerMoment.tsx`, does the rest: `isWinnerMoment(...)` says when step 2 has started, `<WinnerBanner>` draws the banner (give it `result` and the `players` list, for the bettors' names), and `useWinnerSounds(...)` plays the drumroll and fanfare.
- The sounds themselves (`drumrollFor`, `victoryFanfare`, `drawChime`) are in `apps/web/src/audio/gameSounds.ts`, made live by the browser's audio engine (no sound files). They are scheduled ahead on the audio clock when the round freezes, so the fanfare lands right as the banner appears.

**Adding it to a new game's screen:**

1. Take the `result` and `finishEndsAt` props (LobbyPage passes them in).
2. `const winnerMoment = isWinnerMoment(frozen, result, finishEndsAt, serverNow)` and call `useWinnerSounds(frozen, result, finishEndsAt, serverNow)`.
3. While `winnerMoment` is true, point the scene's camera at `result.winnerId` for everyone, and render `<WinnerBanner result={result} players={players} />`.
4. Set `finishSeconds: WINNER_FINISH_SECONDS` on the game in `games.ts`.

Games that have it so far: **Tap Race**, **Snowball** and **Penguin Lasso** (all of them). The older generic "you won / you lost" overlay has been removed.

---

## 3. Every game supports spectators

**Rule.** Anyone in the room can be a spectator (someone who chose **Watch**, joined mid-round or into a full room, or whose game has no slot for them), so **every game must work for people who are not playing**. They don't take a player slot, they keep their points, and they can still win the session. A game is not finished until a spectator can watch it properly.

Games are almost always made with three.js, so spectating is the same everywhere:

- **Free camera.** A spectator can fly a camera over the whole board. It is **higher and zoomed out further** than any player's camera, so they can see everyone at once. They move it with the same controls as steering (joystick or WASD / arrow keys).
- **Follow a player.** A spectator can pick any player and see **that player's view**: the same camera that player has. They can switch between players whenever they like.
- **Local only.** Which camera a spectator uses is their own choice. The server is never told.
- **No controls for the game itself.** A spectator never steers, taps or otherwise acts in the round. The server ignores actions from anyone who isn't playing.
- **The shared finish still applies.** Spectators see the winner moment (rule 2) like everyone else, with the camera on the winner.

**Why.** Rooms hold more people than a game has slots, people join late, and watching a friend play is part of the fun.

**How it is done.** One game-agnostic piece, in `apps/web/src/spectate/`, so a new game gets all of this almost for free:

- `useSpectatorCamera` keeps the spectator's choice (follow which player, or free) and the free camera's movement input.
- `SpectatorControls` is the on-screen picker (previous / next player, free camera, and the joystick for moving it).
- `SpectatorRig` is the camera itself. A game gives it a `PerspectiveCamera`, the arena size (how far the free camera may roam) and, if the game wants its own "follow" view, a `followView`. It then handles following, the free camera and the smooth glide between them.

**Adding it to a new game's screen:**

1. Work out whether the viewer is a player (their id is in the game's view) or a spectator.
2. `const camera = useSpectatorCamera(subjects, !isPlayer)`, where `subjects` is the list of players who can be followed.
3. Give the scene `camera.pan` (`setPanSource`) and, for spectators, the chosen mode and player (`setCameraView`).
4. In the scene, drive a `SpectatorRig` each frame. Players always follow themselves.
5. Show `<SpectatorControls camera={camera} />` to spectators, and hide the game's own controls from them.
6. Make sure the game's server code ignores actions from non-players.

Games that have it so far: **Tap Race**, **Snowball** and **Penguin Lasso** (all of them).

**Seats and betting (part of the room, not of any one game).** Spectating is the same in every game, so these room rules apply to all of them too:

- Only the **first 8 people to join** a room have a seat: they can play, or watch, as they choose each round. Anyone who joins after that is **spectator-only** (no Play option), up to **8** of them, so a room holds at most **16** people. If one of the first 8 leaves, the earliest spectator-only person gets that seat.
- **Spectators bet.** In the ready step a spectator may pick one playing player to win the round and, if they like, put up victory points of their own (never more than they have). A **free bet** (nothing put up) wins **+1 point** if their player wins and can't lose anything. A **staked bet** must put up **at least 2 points** (a stake is 0 or 2+, `MIN_STAKE`), and wins **exactly the points put up** if their player wins, and **loses exactly those points** if not. There is no extra 1-point bonus on top of a stake. A **draw counts as a loss** for every bet (nobody they backed won), so a staked bet loses its stake: that is just part of the risk. The only **void** bets (nothing changes) are bets on a player who **left the round**, and every bet in a round that was **called off**.
- **Bets are private.** Nobody sees who anyone bet on: the server sends each person only their own bet and their own bet's result. After a round, only the winning bettors and what they won are shown (on the winner banner).
- **Everyone readies up**, spectators included, before a round starts.
- A game doesn't have to do anything for this: the server settles bets from the round's winner and each player's round score (`engine.scores`). It only has to report a winner (or none) like every other game.

---

## 4. Draws

**Rule.** A **draw** is a round where nobody wins outright (for instance two players tie for the most). In a draw:

- **Nobody wins and nobody gets a point.** The banner reads **"It's a draw!"**.
- **It still counts as a round played.** There is **no forced replay**: the room goes back to the lobby like after any round, and the players can simply pick the same game and ready up again if they want another go.
- **Every bet is lost** (a draw counts as a loss for the players that were bet on). See rule 3.
- **The one exception is the underdog** (rule 5): if there is an underdog and they are **among the players tied for first**, they win the round.

**Why.** Draws shouldn't trap the room in a replay loop, and they shouldn't be a free pass for bettors.

**How it is done.** A game reports its winner (or none) and each player's round score. The server treats players with the top score as "tied" (even if that score is zero) when it needs to know whether the underdog is in the tie. See `endRound` in `apps/server/src/rooms.ts`.

---

## 5. The underdog

**Rule.** In rounds with **3 or more players**, when **exactly one player has no bets on them and every other player has at least one bet**, that player is the **underdog**. Any bet counts, free ones too. Otherwise there is no underdog, and none of this happens.

- **The announcement.** After the countdown there is a **5 second** full-screen announcement shown to **everyone** in the room (players and spectators): the underdog's name and what they win if they win. A **siren** sounds and a red glow pulses gently (no strobing, and none at all for people who ask for less motion). It shows only the underdog and the payout, never who bet on whom. If there is no underdog this step is skipped. Nothing can be changed during it, and the round starts when it ends.
- **The prize.** If the underdog wins, they get **+1 for the win plus 1 point for every person who bet** (all of those bets are, by definition, against them). Spectators who didn't bet don't count. The bonus is **not taken from the bettors**: their points are independent of it. It is fixed when the announcement starts, so people leaving afterwards don't change it.
- **Winning by a draw.** If the round is a draw and the underdog is **among the players tied for first**, they win it and get the same prize (the announcement says so). A draw that doesn't include them is just a draw.
- **If the underdog leaves** before the round ends, there is no underdog bonus. If the round is called off, nothing is paid.
- **We don't guard against everyone going idle** to let the underdog win: if it happens, it happens.

**Why.** It rewards the player nobody backed, makes a fun moment before the round, and keeps bets and payouts private until the result.

**How it is done.** The server decides at the end of the countdown (`findUnderdog` in `apps/server/src/rooms.ts`), holds the room in the `underdog` phase for `UNDERDOG_SECONDS`, then starts the round. The screen is `apps/web/src/components/UnderdogReveal.tsx` and the siren is in `gameSounds.ts`. A game doesn't have to do anything for this.
