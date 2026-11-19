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

Games that have it so far: **Tap Race**, **Snowball**, **Penguin Lasso** and **Fishing**.

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

Games that have it so far: **Tap Race**, **Snowball**, **Penguin Lasso** and **Fishing** (all of them). The older generic "you won / you lost" overlay has been removed.

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

Games that have it so far: **Tap Race**, **Snowball**, **Penguin Lasso** and **Fishing** (all of them). Fishing is a flat side view with no free camera: a spectator picks whose lane to follow with the ‹ › buttons (`allowFree={false}`).

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

---

## 6. Player names are always readable (they live on a top layer)

**Rule.** A player's floating name in a 3D game is drawn on its **own top layer**: after everything else in the scene and ignoring depth, so **no 3D object can ever cut into it or hide part of it**. Not a big sack, a hill, a wall or another character.

**Why.** Names clipped into other models (the penguin sack, for example) and became unreadable. Names are the most important text on the board.

**How it is done.** One shared helper, `createNameTag(name, color)` in `apps/web/src/components/labelTexture.ts` (with `disposeNameTag` for cleanup), makes the name as a camera-facing sprite with depth testing off and a very high render order. Every game that floats a name above a character uses it: **Snowball**, **Penguin Lasso** and **Fishing** (Tap Race paints its names flat on the floor, so they can't be cut into). A game also lifts its name above anything tall that is attached to a character (Penguin Lasso raises it above a big sack).

**The one trade-off.** Because a name ignores depth, it can show through something that is in front of its owner (for example a Snowball name through a hill). We accept that: a readable name matters more.

**Adding it to a new game:** create the name with `createNameTag`, add it to the scene, position it above the character each frame and set its scale; call `disposeNameTag` when the scene is torn down.

---

## 7. Players have one color of their own, in every game

**Rule.** Each person in a room has **their own color**, chosen from **16** (`PLAYER_COLORS`), and nobody else in the room can have the same one at the same time. A game uses **that** color for the player everywhere it draws them (their ball, button or skater, their ring, trail and name tag, the scoreboard), so a player looks the same in every game and everyone is easy to tell apart. A game never picks colors itself.

- **Default:** a person who joins is given the first color nobody has yet, so they always have one.
- **Choosing:** in the lobby, under the game settings, a "Your color" picker shows the colors nobody else has (and the player's own, ringed). Changing it is only allowed in the lobby or during the countdown, never under a round that is running. A color is freed when its player leaves.
- **Everyone sees everyone's color:** a small dot next to each name in the player list.

**How it is done.** The server keeps the colors (`setColor` in `apps/server/src/rooms.ts`) and sends them in the room state as `colors` (player id to color). The game screens get a `colors` prop from the lobby page and give it to their scene. The picker is `apps/web/src/components/ColorPicker.tsx`.

**Adding it to a new game's screen:** take the `colors` prop and use `colors[player.id]` (with `FALLBACK_COLOR` from `playerColors.ts` if one is somehow missing) wherever the game needs a color for a player.

---

## 8. Every game starts with a screen flash and a loading page, as its own step (nothing to add per game)

**The rule.** Before a round, the screen flashes: it fades to a pale flash over the countdown (or the underdog announcement), becomes a loading page showing the game's picture and title, and the flash fades away (0.6 s in, 1.4 s out). The page is held until 3.5 seconds after the step began, **then the round starts and the page fades out over the first moments of the game** (a cross-fade, never a cut). No game ever starts under the flash.

**How it is done.**
- The server runs it as its own phase, **`'starting'`**, between the countdown (or `'underdog'`) and `'playing'`. It lasts `STARTING_MS` (3.5 s, in `packages/shared/src/config.ts`, next to the `START_FLASH_*` timings). The game state is only created when the step ends, so the game's own clock (`startsAt`) starts then. A player leaving during it can call the round off, like during the underdog announcement. (Tests that shorten the countdown get no flash step unless they pass `startingMs`; `STARTING_MS=0` in the dev server's environment turns it off.)
- On the phones, one reusable hook, `useScreenFlash` in `apps/web/src/components/screenFlash.ts`, is used once, in `LobbyPage`: when the room enters `'starting'` it keeps showing the old screen while the flash fades in, then switches to the loading page (`StartingScreen`, with the picture from `GAME_IMAGES`). When the round begins, the same page is laid over the game and fades away. Because it sits above every game screen, **a new game gets all of this for free** (give it a picture in `GAME_IMAGES`).
- The game's code is downloaded as soon as the host picks it, so it is ready before the round begins.
- This is separate from any flash a game does inside its own scene (Fishing flashes when it cuts from the pier to the water and from the water to the dock): those have their own timings and are not affected.

---

## 9. Every game has a tile picture made from the models only (no UI)

**The rule.** The picture on a game's tile (`apps/web/public/games/<game-id>.png`, 720 x 450) is a screenshot of the game's **3D models only**: no HUD, timer, scoreboard, names, buttons, joysticks or hints, and no player names on anything. (Penguin Lasso's picture had a player's name in it and was retouched to remove it.) Fishing's picture is a hook in the water with a random assortment of school and regular fish, and never a big fish.

**How it is done.** Make a short-lived preview page that builds only the game's scene (no React screen around it) in a fixed pose, screenshot that, then delete the preview. Register the file in `GAME_IMAGES` in `apps/web/src/pages/LobbyPage.tsx`.

---

## 10. Every game opens with a start countdown, and GO! is the moment the player gets control

**The rule.** There are two countdowns, in this order:

1. **The lobby countdown.** Once **every player is ready**, a simple big **3, 2, 1** counts down in the lobby (`COUNTDOWN_SECONDS`, 3 s; shown by `Countdown.tsx`). A change that un-readies someone cancels it. Then the flash and loading page (rule 8) follow, plus the underdog announcement if there is one.
2. **The in-game start**, after the loading page: the scene is shown and nobody can act until GO. The round's own clock starts at GO.
- **Every game gets a 2 second buffer first, with no exceptions** (`GAME_INTRO_HOLD_SECONDS`): for the **first 2 seconds the camera stays completely static on the game's first view, nothing moves and no countdown shows**, so the players can take in the game. This applies to **games with their own opening sequence too**: their sequence does not begin until the buffer is over.
- **Standard games** (Tap Race, Snowball, Penguin Lasso, Santa's Sack): after the buffer the camera is hanging over all the players, and a big **3, 2, 1, GO!** counts down for 3 seconds (`GAME_INTRO_COUNT_SECONDS`) while **the camera pans and zooms into the player's own view, arriving at GO**. The in-game start takes `GAME_INTRO_SECONDS` (5 s) in all.
- **A game with its own opening sequence** (Fishing's cast from the pier) sets `introSeconds: 0` in `packages/shared/src/games.ts`: it gets the buffer (the pier view stays still for 2 seconds), then its sequence starts and the countdown is timed so that **GO! is the moment the player gets control** (Fishing: when the hooks start rising, `ascentStartsAt`; the 3, 2, 1 shows over the last 3 seconds of the cast). Its own scene must hold its first picture until the round's clock starts (Fishing's `castClock` never goes below 0).
- **No game gives the player any control before GO, in the buffer or the 3, 2, 1** (a game with its own opening: before its own GO). The server ignores early actions; the phones also **hide the controls and ignore taps, steering and throws until the round's clock has started** (`useStarted` in `apps/web/src/components/useStarted.ts`, used by every game screen; and `LobbyPage` drops any action sent before `startsAt`), so nothing reacts or makes a sound early. A new game screen must use it.
- The numbers use the same look and sounds as the end-of-round countdown: big bold text that pops in and fades, **each number bigger than the last**, the same tick / tock that gets louder each second, and the whistle at GO. They are timed from the server's clock, so every phone shows GO together.

**How it is done.**
- **Server** (`rooms.ts`, `startRound`): the scene is shown at once (phase `'playing'`), but the engine is created with `startsAt` = now + the buffer + the game's countdown part (`introSeconds`, or `GAME_INTRO_COUNT_SECONDS`), so all of its clocks start then. Until then `gameAction` ignores actions and the tick loop does not run (no engine needs to know about the intro). Tests that shorten the countdown get no intro unless they pass `introMs`. Test: `npm run test:intro -w @fgn/server`.
- **Phones:** one component, `StartCountdown` (`apps/web/src/components/StartCountdown.tsx`), takes `goAt` and the server clock and is placed at the top of each game screen. For the camera, `introProgress(startsAt, now)` (same file) gives 0..1; each 3D scene has an `introFactor` that its screen sets from it, and the shared `SpectatorRig` (`update(..., intro)`) glides from the overview to the player's view. Spectators get the same intro.

**Adding it to a new game:** with a normal start, you get the clock and the input lock for free; put `<StartCountdown goAt={game.startsAt} serverNow={serverNow} />` in the screen, and if the scene uses `SpectatorRig`, set `scene.introFactor` the way the other screens do. With an opening sequence of its own, set `introSeconds: 0` (you still get the 2 second buffer, so make the scene hold its first picture until `startsAt`) and pass the moment control starts as `goAt`.

---

## 11. Every game has an opening sequence and a closing sequence (the bare minimum is the standard pair; a game may do more)

**The rule.** No game jumps straight into play or straight out of it. Every game has both:

- **An opening sequence.** The bare minimum, which every standard game already has (Tap Race, Snowball, Penguin Lasso), is rule 10's pair: the camera **shows the whole game** (static for the 2 second buffer, with no countdown yet), then **pans and zooms to the player's own angle** while the 3, 2, 1 counts down, and the round **starts at GO**.
- **A closing sequence.** The bare minimum, which every game already has, is rule 2's pair: the round freezes on the player's own view, then the camera **pans to the winner** (for everyone) and a banner says **who won**.

A game is free to have bigger sequences than the minimum (Fishing: the pier view and the cast to open; the hooks breaking the surface, a spin over the dock and the piles to close). It must never have less.

**A bigger sequence means the timing changes, and the game must say so.**
- **A longer or different opening:** it still starts **after the 2 second buffer**, and the start countdown must be **adjusted so that GO! lands at the moment the player gets control**, which is not necessarily when the scene appears. Set `introSeconds` in `packages/shared/src/games.ts` (0 when the opening plays inside the round, as Fishing's cast does) and give the game screen's `<StartCountdown goAt={...}>` the moment control starts (see rule 10). The 3, 2, 1 is always the last 3 seconds before that moment, and the camera must already be on the player by GO.
- **A longer or different closing:** set `finishSeconds` for the game in `games.ts` to the whole length of its sequence (the usual hold on the player's own view plus the winner moment, plus anything the game adds before it, such as Fishing's `FISHING_BREACH_SECONDS`). The winner pan and banner still come last, and the results screen only follows after it. `npm run test:finish-length -w @fgn/server` checks every game's finish length, so update it when a game's length changes.

**Checklist for a new game.** (1) Opening: scene shown, camera overview then pan to the player, countdown ending in GO at the moment of control, input ignored before GO. (2) Closing: input stops, the camera pans to the winner, the banner names them. (3) If either is longer than the standard, `introSeconds` / `finishSeconds` and the countdown's `goAt` are changed to match, and this is written in the game's entry here or in the code comment beside them.

---

## 12. Santa's Sack: what is special about it (the camera, fairness, the heap in each bag)

Santa's Sack follows rules 2, 3, 10 and 11 in the standard way, with these particulars:

- **Layout.** The elves stand in a **circle** round the bags (`stationSpots` in `santaSack.ts`), **evenly spaced** and as far across from each other as possible: with an even number of players every elf has another exactly **opposite** (2 players are left and right, 4 add top and bottom, 6, 8...), and with an odd number they are still evenly spaced. The first player is on the left, the others follow clockwise. Everyone is the same distance from the middle. The bags float on their circular route in the middle of the clearing.
- **Camera.** Every player's camera sits **high behind their own elf**, at a steep angle, looking past the pile of gifts round the elf at the bags in the distance. A single overhead view of the whole room did not work on phones. The opening starts high over the whole room (2 seconds) and settles in behind the player's elf by GO (rule 10); the winner moment glides to the winner's elf (rule 2); spectators pick whose elf to watch from, like in Fishing (rule 3).
- **The bags' look.** Each bag is a round-bellied sack with a narrow neck and a rolled lip round its open mouth, and it **leans outward, away from the middle of the circle it travels on, with its mouth facing that way. This is on purpose: it does not turn towards the players**, so some mouths are seen from the front and some from the side. Wherever the mouth is drawn is where the server judges a throw (the bag is placed so its mouth is over its route).
- **The throw.** Pull back like a slingshot and let go. On screen "up" is the way the elf faces, so pulling down throws forward and pulling sideways throws the opposite way. The scene turns the pull into a direction on the floor (`toWorld`), and the server never sees the camera. The aim is drawn as the **arc the gift would fly** (the same sum the server uses, `lobPlan` in `packages/shared/src/santaThrow.ts`): a thick see-through **candy cane** tube (diagonal red and white stripes) from the elf's hands up and over with an arrowhead, thicker the harder you pull, ending in a ring cursor in the air at the height of the bags' mouths **plus 15%** (`aimHeight`, 4.6), turned to face the incoming gift. It does not reach the floor: the gift is launched to pass through that point and then falls into the mouth.
- **How a gift is judged (3D, on the server).** Gifts move by gravity, simulated in fixed 10 ms steps so the result never depends on how often the server ticks. A throw is a **lob**: its arc peaks 80% higher than a direct flight over the same distance, and the flight takes 35% less time than the first lob did. To be both high and quick, **each throw has its own gravity** (worked out in `lobPlan` in `santaSack.ts` and sent to phones with the throw). Each bag has two zones, shared between server and phones in `packages/shared/src/santaBag.ts` (the phones draw them in the temporary debug view): a **scoring zone**, a cylinder along the bag's tilted axis from just above the mouth down about halfway into the sack (a gift whose middle is in it has gone in), and an **outer zone**, a cylinder for the neck plus a ball for the belly. A gift that touches the outer zone without being in the scoring zone **bounces off the sack** and keeps flying (up to 3 bounces), then falls to the floor as a miss. **The scoring zone must always lie entirely inside the outer zone** (it never pokes out): a test checks this with thousands of random points for every bag size.
- **Fairness.** Everything that could favor one seat is the same for everyone: the elves stand the same distance from the middle, and every elf has the **same endless pile of gifts** (there is no limit; they may throw as fast as a human can, and the pile around the elf is a mix of Christmas wrapping while thrown gifts are in the player's color). The bags' positions are a function of the server's clock, so every phone sees them in the same place and a throw is judged exactly.
- **Control and scoring.** There are always **9 bags** that stay on their route all round, all **close in size** (a random mouth radius from 2.07 to 2.7: `bagRadiusMin` / `bagRadiusMax`; a bigger bag is just a bigger target). A gift that goes into an **open** bag counts for whoever threw it; the player with **strictly the most gifts in a bag controls it** (a tie, or an empty bag, is neutral, a leather brown that is never a player color) and the bag takes their color and glows in it. **Every bag is worth the same: the winner is the player who controls the most bags when the round ends**, and the score shown is that number of bags (a tie for the most is a draw). **A bag holds at most 5 gifts** (`bagCapacity`). Phones are sent the gifts in each bag (`gifts`, oldest first, each with its thrower) and draw them as a **heap in the bag's mouth, each gift in its thrower's color** (3 in a bottom layer, 2 above; a new one pops in just after the thrown gift drops in; the heap hides when the bag is cinched shut). When a 6th gift goes into a full bag, **a random gift of another color (never the thrower's own) is pushed out** to make room: it appears in the view's `kicked` list and the phones draw it **tumbling out of the mouth and falling** with the bag's own sideways speed and only a gentle push outward, never flying away, and touching nothing (it is a picture, not physics). If a full bag holds only the thrower's own gifts, nothing can be pushed out and the new gift does not count.
- **Open and shut.** The round is four equal phases of 15 seconds: **all bags open; then a random 3 to 6 of them cinched shut; then those open and the others shut; then all open again**. A bag **strobes for the 3 seconds before it shuts** (faster and brighter, amber turning red), then the **whole bag is cinched like a drawstring bag**: its body is morphed from the open shape to a pear shape gathered at the top (both shapes are profiles with the same number of points, `BAG_OPEN` / `BAG_SHUT` in the scene, so it animates smoothly), the lip closes up, and a **red and white striped ribbon** that hung loose round the neck (with two tails down the body) pulls tight and ties in a **bow on the side of the neck** (a figure-eight of two loops, set 0.25 bag radii out from the neck and tilted 45° from flat, flopping only a very little; the loose tails are 20% wider, striped across their width, and stay draped down the body; the lip stays as a small gathered frill above the ribbon). It loosens again when the bag opens. A shut bag has its **scoring zone switched off** and only its belly and the gathered tip to bounce gifts off (`outerZoneNormal(..., shut)` in `santaBag.ts`). Where each bag is and when it is shut are worked out from the server's clock (`lid.closeAt` / `lid.openAt` in the view), so every phone agrees.
- **The setting.** A snowy forest clearing: snow underfoot, a ring of snowy pines, drifts and rocks, and falling snow (there is no room, walls or sleigh).

---

## 13. The game picker: the host's tiles with a Random tile, everyone else's looping carousel, and the Random roulette

**The rule.** Only the host picks the game.
- **The host** sees the games as tiles in columns, as always, with one extra tile, **Random, always first** whatever order the games are in. Picking Random chooses **nothing yet**: it just means "let chance decide" (`settings.random`, with `gameId` null).
- **Everyone else** sees no grid. They see a **carousel of the same tiles** (Random first, then the games), resting on **Random** until the host picks. The carousel is a **loop**: going from the last tile to the first is one step forward, not a long rewind. When the host picks a game, the loop **slides quickly, with a small snap, the short way round** to that game's tile (centered and bright; the tiles beside it dimmer and smaller). Under it, the game's name and description. Reduced-motion is respected where CSS drives motion; the carousel itself is script-driven. If Random is chosen it says the game will be chosen once everyone is ready.
- A new pick resets everyone's Ready, as before. Players can ready up once a game **or Random** is picked.

**The roulette (Random only).** With Random chosen the flow is: **players ready up, the usual 3, 2, 1 lobby countdown runs, and when it ends the server picks the game** (one that can be played with this many players) and the room enters its own step, phase **`'roulette'`** (`ROULETTE_SECONDS`, 9 s: a 7 second spin, then a **2 second hold** with the chosen game sitting in the middle, so everyone can see which one was picked), shown to **everyone, the host included**. The host's options disappear: the screen is just the wheel (`RouletteScreen`): the same loop of the games, **spinning fast at first and easing out, slower and slower, until the last tile creeps into the middle and stops on the chosen game** (4 whole laps, an ease-out of the fourth power, so there is a little suspense at the end), with a pointer over the middle tile, a tick each time a tile goes by, then the game's name and description, which stay up for the 2 second hold. Where the wheel is comes from the server's clock (`roulette.startsAt` / `endsAt`), so every phone agrees and a late arrival joins mid-spin. When it ends the round carries on as usual: the underdog announcement if there is one, then the flash and loading page (rule 8), then the in-game start (rule 10). Settings cannot be changed during it, and a player leaving can call it off like any step before the round. After the round the lobby is back with **Random still chosen and no game picked**: the next round rolls again.

**How it is done.** `RoomSettings` has `gameId` and `random`; `RoomState` has `roulette` ({ gameId, startsAt, endsAt }) (`packages/shared/src/events.ts`). The host sends `gameId: 'random'` (`RANDOM_GAME`) in `room:settings`; `finishCountdown` in `apps/server/src/rooms.ts` does the pick and enters the phase, `finishRoulette` ends it (a timer in `sockets.ts`). Tests that shorten the countdown get no roulette unless they pass `rouletteMs`. On the phones, `GameCarousel`, `RouletteWheel` and `RouletteScreen` are in `apps/web/src/components/GameCarousel.tsx`, built on one script-driven loop (`LoopTrack`). The Random tile's picture is `RandomArt` (a big question mark in the same bold pink look as the in-game start countdown, on the plain tile background). Test: `npm run test:random -w @fgn/server`.

---

## 14. Tap Race: its setting is an industrial lab

Tap Race happens in a **mechanical, industrial lab**, not a purple room: a dark teal-steel void (`LAB_BACKGROUND`, with fog) around a **steel-plate floor** (a canvas texture of panels, seams and rivets), a ring of **yellow and black warning stripes** and a **glowing teal line** (it breathes) round the board, and **machinery round the edge**: steel tanks with orange bands, control cabinets with glowing screens, posts with **amber warning lamps** (a few pulse and light the floor) and two big pipes running right round on top. The buttons' bases are steel too. It is all in `buildLab` in `apps/web/src/components/taprace/TapRaceScene.ts`; nothing in it moves except the lamps and the line, so it costs little. The game's tile picture (`tap-race.png`) is a close shot of two buttons in the lab (models only: no names, no sparks).

---

## 15. Refreshing the page (or losing signal) never kicks a player out

**The rule.** A dropped connection is not leaving. When a player's connection drops (a page refresh, closing and reopening the tab, a bad signal), **their seat is held for 45 seconds** (`RECONNECT_GRACE_SECONDS` in `packages/shared/src/config.ts`) and everyone else sees "reconnecting…" next to their name. If they are back in time they are put straight back where they were (the lobby, the roulette, the game itself) with their seat, color, ready-up (see below), bets and score. If not, they leave exactly as if they had pressed Leave. Pressing **Leave** is still immediate.

- **Guests work too.** A guest's identity is `guest_<uuid>` **signed by the server** (`signGuestId` / `verifyGuestToken` in `apps/server/src/auth.ts`, secret `GUEST_TOKEN_SECRET`, or a random one per server start). The server sends it on connecting (`guest:token`); the browser keeps it (`localStorage` `fgn.guestToken`) and sends it back in the handshake, so a refreshed page is the same guest. It cannot be forged. Accounts already have a stable id. (Clearing the browser's storage, or a server restart without `GUEST_TOKEN_SECRET`, makes a guest new; that is accepted.)
- **Mid-round:** the player's character stays in the game and stands still (their steering and sprint are let go, so nobody keeps skating on the last input); the round carries on for everyone else.
- **Lobby and countdown:** a player who drops is no longer ready, so a countdown they were holding up is cancelled. They ready up again when back.
- **The host** stays host while reconnecting; if they do not come back the next player is made host, as for any host who leaves.
- **Two tabs / the refresh racing the old connection:** a new connection for the same player **takes over**: the old one is told (`session:replaced`), closed, and never counts as leaving.

**How it is done.** Server: `setOffline`, `rejoin` and `isOffline` in `rooms.ts`; `sockets.ts` marks a player offline on disconnect, starts a grace timer (cancelled when they send `room:rejoin`), and removes them with the normal leave when it runs out; `RoomState.offlineIds` tells phones who is reconnecting. Phones: `RoomContext` keeps the guest token, and **on every connection while it holds a seat (and once right after a page load) sends `room:rejoin`**; the lobby page shows "Getting you back into the room…" while that is being answered (`restoring`) instead of sending the player away. Test: `npm run test:reconnect -w @fgn/server`. Other socket tests that close a connection to mean "leave" pass `reconnectGraceMs: 0`.

---

## 16. Fishing: the catch box is over the fish's head, and scales with the fish

A hook catches a fish when the hook is **inside the fish's catch box**: a rectangle over its **head**, drawn like this (the owner's sketch): it reaches **from 65% of the fish's length back from the nose up to the tip of its lips** (the box's front edge is exactly the nose, the way the fish is swimming), and is **22.1% of its length above and below its middle** (a little taller than the body). (The sketch's box was 46% / 4% past the nose / 17%; it was made 30% bigger both ways, and then its front edge was moved back to the lips.) It is the same shape for school and regular fish; the **big fish's box is 40% narrower** (it reaches back only 39% of its length from the nose, still ending exactly at its lips, and is just as tall) (`bigCatchBackFrac`). Every box **scales with its fish's length**, so a bigger fish is easier to catch. When two hooks are inside one fish's box, the one closest to the middle of the box catches it. The numbers are `catchBackFrac`, `catchFrontFrac` and `catchHalfHeightFrac` in `apps/server/src/games/fishing.ts` (the server decides catches; phones do not draw the box). The player-lifted hook (rule on lifting) is measured the same way, in depth.

---

## 17. Team games (the infrastructure; Tug of War is the first)

A few games are **team games** (`teams: true` in `packages/shared/src/games.ts`). Not every game becomes one; the others are unchanged. There are only ever **two teams, Team Yellow and Team Purple** (`packages/shared/src/teams.ts`, fixed colors).

- **Before the ready step the lobby shows a Team panel** (`TeamPanel.tsx`) whenever the picked game is a team game: the two teams with who is on each. **Everyone starts on a random team** (shared out evenly: a newcomer goes to the smaller team; uneven teams are fine). The **host** can allow or forbid **team swapping**; while allowed, any player can **join the other team**, which drops everyone's Ready (the teams changed). The **host sets a handicap for each team**: a whole number (may be negative) that is a **head start in the game's own score**, added to that team's total (`settings.handicap`). Changing a handicap does **not** drop Ready (everyone sees the numbers). A team game cannot start until **each team has at least one player**; spectators are not on teams.
- **Winning:** a team's total is the sum of its players' scores plus its handicap; the higher total wins (equal = a draw). **Every member of the winning team gets one victory point** (and one database record each: `Outcome.rounds`). There is **no underdog** in a team game.
- **Betting is on a team**, not a player (a spectator picks Team Yellow or Team Purple; the stake and payout rules are the usual ones).
- **The Random tile never picks a team game** (they need the team step first). Team games are picked by hand.
- **In the game** everyone is drawn in their **team's color**. **The winner moment pans the camera right out** and the banner names the winning team, its members and the winning bettors; the results screen shows both totals.
- **Leaving and reconnecting:** a dropped player keeps their team (rule 15). If a team has **nobody left** during the round, the round is called off.

**How it is done.** `RoomState.teams` (player id to team), `settings.teamSwap`, `settings.handicap`; `setTeam` / `setHandicap` and `endTeamRound` in `apps/server/src/rooms.ts`; the engines stay player-based (the room adds the scores up per team), so a team game's engine only reports per-player scores. A game that needs the team inside its rules gets `teams` and the handicap as the third argument of `engine.init` (Tug of War uses them to show each team's total). Test: `npm run test:teams -w @fgn/server`.

**Not done yet (on purpose):** per-game handicap handling beyond a plain score head start (Tug of War: the head start is extra taps for that team).

---

## 18. Tug of War (the first team game)

**The idea.** Two teams, yellow (left) and purple (right), pull one rope by **tapping**: every tap is a pull for your team. The round lasts **15 seconds** (`TUG_SECONDS`, like Tap Race). A team's total is its players' taps plus its **handicap, which here is simply that many extra taps** (set by the host in the team step: rule 17). The higher total wins; every member of the winning team gets a victory point; equal = a draw.

**What you see (three.js, `apps/web/src/components/tugofwar/TugOfWarScene.ts`).** A side view of a grassy field with a dirt strip. **A model for every player** on the rope (legs, a body in the team color, a head, a hat in the player's own color, arms out to the rope, a name tag; yours has an arrow). **The rope and both teams slide as one towards the team that is ahead** (how far ahead = the difference in totals, so a head start shows at once), with the red cloth on the rope crossing the fixed lines on the ground; the pullers **lean back and heave with every tap** (the winning side leans back more, the losing side forward). Phones show the totals and a bar of who is ahead.

**The closing sequence** (after the 15 seconds; `TUG_STRAIN_SECONDS` + `TUG_PULL_SECONDS` + `TUG_FALL_SECONDS` = 3.9 s, timed from the server's `endsAt`, then the usual 4 second winner moment, so `finishSeconds` = 3.9 + 4): the same kind of **anticipation as Fishing's closing**: first the teams **STRAIN** (1.5 s): everything holds, the rope trembles, the winners dig in and lean right back, the losers hold on, the camera creeps in; then **the massive PULL** (0.7 s): the winners heave with an overshoot, the whole tug is yanked their way and the camera slides along; then **the FALL** (1.7 s): the rope is let go, the losing team is dragged off balance and **falls forward onto the grass, one after another**, while the winning team **stands tall with their arms raised, cheering and jumping**. A draw has the strain and then both teams just let go and stand. Then the camera **pans right out** and the banner names the winning team (rule 17).

**How it is done.** Engine: `apps/server/src/games/tugOfWar.ts` (counts each player's taps, 40 ms apart at most, shows team totals; the room decides the winning team). Screen: `TugOfWarScreen.tsx`. Test: `npm run test:tug -w @fgn/server`. **Not done yet:** the tile picture (`/games/tug-of-war.png`), sounds beyond the tap click and a thump on landing, a cheer for the winners.

