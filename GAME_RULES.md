# Game rules (ongoing)

**Making a new game? Read `NEW_GAME_GUIDE.md` first** (the go-to file for how games are built here), then use this list.

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

Spectating is the same everywhere and as simple as it can be: **a spectator follows a player.**

- **Follow a player (the only view).** A spectator picks any player and sees **that player's view**: the same camera that player has. They can switch between players whenever they like (‹ › buttons, or left / right keys).
- **There is NO free camera, and a new game does NOT need to build one.** (There used to be one that flew over the whole board; it was removed to keep spectating simple. Do not add one.) If a game is a flat or 2D view, "follow" is just showing that player's lane or goat; if everyone shares one view, spectators just watch it.
- **Local only.** Which player a spectator follows is their own choice. The server is never told.
- **No controls for the game itself.** A spectator never steers, taps or otherwise acts in the round. The server ignores actions from anyone who isn't playing.
- **The shared finish still applies.** Spectators see the winner moment (rule 2) like everyone else, with the camera on the winner.

**Why.** Rooms hold more people than a game has slots, people join late, and watching a friend play is part of the fun.

**How it is done.** One game-agnostic piece, in `apps/web/src/spectate/`, so a new game gets all of this almost for free:

- `useSpectatorCamera(subjects, enabled)` keeps which player the spectator follows (`targetId`, with `next` / `prev` / `select`), and the left / right keys.
- `SpectatorControls` is the on-screen picker (the ‹ › buttons and who is being watched).
- `SpectatorRig` (optional, for 3D games with a chase-style camera) is the camera itself. A game gives it a `PerspectiveCamera`, the arena size (for the overview used before the round starts, and when there is nobody to follow) and, if the game wants its own "follow" view, a `followView`. It then follows the player smoothly. Games with their own camera (Santa's Sack, Fishing, Closing the Gap, any first-person game) skip the rig and just show the followed player's view themselves.

**Adding it to a new game's screen:**

1. Work out whether the viewer is a player (their id is in the game's view) or a spectator.
2. `const camera = useSpectatorCamera(subjects, !isPlayer)`, where `subjects` is the list of players who can be followed.
3. Give the scene the followed player for spectators (`camera.targetId`; players always see their own view), and for the winner moment, the winner.
4. Show `<SpectatorControls camera={camera} />` to spectators, and hide the game's own controls from them.
5. Make sure the game's server code ignores actions from non-players.

Games that follow a player: Tap Race, Snowball, Penguin Lasso, Fishing, Santa's Sack and Closing the Gap. **Tug of War** has one shared view for everyone, so a spectator simply watches that view (nothing to follow). None of them has a free camera.

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

**How it is done.** `RoomSettings` has `gameId` and `random`; `RoomState` has `roulette` ({ gameId, startsAt, endsAt }) (`packages/shared/src/events.ts`). The host sends `gameId: 'random'` (`RANDOM_GAME`) in `room:settings`; `finishCountdown` in `apps/server/src/rooms.ts` does the pick and enters the phase, `finishRoulette` ends it (a timer in `sockets.ts`). Tests that shorten the countdown get no roulette unless they pass `rouletteMs`. On the phones, `GameCarousel`, `RouletteWheel` and `RouletteScreen` are in `apps/web/src/components/GameCarousel.tsx`, built on one script-driven loop (`LoopTrack`). The Random tile's picture is `RandomArt` (a big question mark in the same bold pink look as the in-game start countdown, in blue with diagonal monochrome-blue stripes, the blue that goes with the pink). A new room starts with **Random already selected** (`settings.random` is true until the host picks a game). Test: `npm run test:random -w @fgn/server`.

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

- **Before the ready step the lobby shows a Team panel** (`TeamPanel.tsx`) whenever the picked game is a team game: the two teams with who is on each. **Everyone starts on a random team** (shared out evenly: a newcomer goes to the smaller team; uneven teams are fine). Team swapping is **OFF by default** (the random teams start locked); the **host** can turn it on, and the choice is **remembered for the whole session** (it is part of the room's settings, kept between rounds and after a session reset). While on, any player can **join the other team**, which drops everyone's Ready (the teams changed). The **host sets a handicap for each team**: a whole number (may be negative, **typed into a text box or nudged with the - and + buttons**) that is a **head start in the game's own score**, added to that team's total (`settings.handicap`). Changing a handicap does **not** drop Ready (everyone sees the numbers). A team game cannot start until **each team has at least one player**; spectators are not on teams.
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

**What you see (three.js, `apps/web/src/components/tugofwar/TugOfWarScene.ts`).** A side view of a grassy field with a dirt strip. **A model for every player** on the rope (legs, a body in the team color, a head, a hat in the player's own color, arms out to the rope, a name tag; yours has an arrow). **The rope is a real-looking rope**: a slim, TWISTED rope (strands that spiral round it, from a tileable canvas texture) that is **drawn through the pullers' actual hands** (each puller stands exactly on the line of the rope and both arms turn in to meet it, so the rope follows their hands as they lean, heave and move) between the two outermost hands, with a little slack (it tightens when the pulling gets harder and in the strain, and a ripple runs along it with every heave), while **its two ends are not held: they hang down past the last puller, falling faster and faster as if by gravity, then lie on the ground curling and swaying a little**. It is not a physics simulation: the shape is worked out each frame (`updateRope`), and when the rope is let go at the end of the closing sequence the whole rope drops and lies on the ground. **The rope and both teams slide as one towards the team that is ahead** (how far ahead = the difference in totals, so a head start shows at once), against the single white line on the ground (there is no cloth on the rope and no team lines); the pullers **lean back and heave with every tap** (the winning side leans back more, the losing side forward). Phones show the totals and a bar of who is ahead.

**Sweat.** Every tap flicks **sweat** off the **back** of that puller (the side away from the other team): short dashes in the fishing game's water colors (the shared streak particles from `taprace/sparks.ts`, solid and water-colored), shooting straight back and out from behind the head and the upper back, fanning from a little above straight back to a little below, and bending only slightly. Every drop is the same size and speed all round and fades out after 0.2 to 0.45 seconds, long before it could fall to the waist; **only the number per tap grows through the round** (about 1 at the start, about 6 at the end; `progress` is how much of the 15 seconds has passed). You see your own the instant you tap; others' when their taps arrive. A puller who has been thrown makes none.

**The closing sequence** (after the 15 seconds; `TUG_STRAIN_SECONDS` + `TUG_PULL_SECONDS` + `TUG_FALL_SECONDS` = 3.9 s, timed from the server's `endsAt`, then the usual 4 second winner moment, so `finishSeconds` = 3.9 + 4): the same kind of **anticipation as Fishing's closing**: first the teams **STRAIN** (1.5 s): everything holds, the rope trembles, the winners dig in and lean right back, the losers hold on, the camera creeps in; then **the massive PULL** (0.7 s): the winners heave with an overshoot, the whole tug is yanked their way and the camera slides along; then **the FALL** (1.7 s): the rope is let go, and at the pull **the losing team is thrown, all together, in the direction they were pulled**: each flies low across the grass in a short arc, turning face down, and **lands lying ON the ground (their bodies rest on the grass, never in it; they land alternately a little in front of and behind the line so nobody lies on anybody)**; the rope itself is never lower than lying on the grass, so it does not clip into the floor; meanwhile the winning team **stands tall with their arms raised, cheering and jumping**. A draw has the strain and then both teams just let go and stand. Then the camera **pans right out** and the banner names the winning team (rule 17).

**How it is done.** Engine: `apps/server/src/games/tugOfWar.ts` (counts each player's taps, 40 ms apart at most, shows team totals; the room decides the winning team). Screen: `TugOfWarScreen.tsx`. Test: `npm run test:tug -w @fgn/server`. **Not done yet:** the tile picture (`/games/tug-of-war.png`), sounds beyond the tap click and a thump on landing, a cheer for the winners.

---

## 19. The lobby is a HUB: one job (get everyone to Ready), with menus that slide up for everything else

**The rule.** The lobby screen (`apps/web/src/components/lobby/LobbyHub.tsx`) shows only what getting to Ready needs; everything else lives in a **sheet** (`Sheet.tsx`: a panel that slides up over the lobby with a title and a close button; tap the dark area or press Escape to close; a centered card on a wide screen), so a menu opens without leaving the room. **Anything that belongs to the host only is not shown to anyone else** (a non-host never sees the Game menu, the team swap switch, the handicap steppers or the room settings).

**On the main screen, top to bottom:**
- **The room** (name, a lock icon if it has a password, "Round N · players · watching") and a **settings icon** that opens the Room menu.
- **The players strip** (`PlayersStrip.tsx`): everyone as an avatar with a ring in their color (their **team's** color in a team game), a tick when ready, a crown icon for the host, dimmed when watching, "..." while reconnecting. Tapping it opens Scores.
- **The game** (`GameHero.tsx`): the picked game, big. The **host** sees it as a button that opens the Game menu; **everyone else** sees the looping carousel. Under it a **one-line summary** (the first sentence of its description) and a **How to play** toggle for the full text.
- **Chips:** a **Team** chip (only in a team game, for players; it opens the Teams menu) and a **Ready** chip (the state of your Ready). There is no chip for the game: the status line says when none is picked.
- **The status line** (why the round has not started yet), any error, the countdown.
- **A spectator's bet**, right above the Ready button, **only while you are watching** (`BetPanel`; on a team game the bet is on a team).
- The big **Ready** button.
- **The bottom bar**: **Game** (the host only), **Team** (team games, players only), **Me**, **Scores**. Text only.

**The menus (sheets):**
- **Game** (host only): the picker with the Random tile, team games marked with a "Teams" tag. Picking closes the sheet.
- **Teams**: the team panel (rule 17). Everyone can join a team while swapping is allowed; only the host sees the swap switch and the handicap steppers (everyone sees the handicaps).
- **Me**: your color, and Play or Watch.
- **Scores**: the full player list with wins, ready ticks and who is reconnecting.
- **Room** (the settings icon): for the **host** the room's name and password, End session and Close room; for **everyone** Leave room.

**Not changed:** the steps after Ready (countdown, roulette, underdog, loading page, game, results) work as before; the sheets only organise the lobby. A change that resets Ready (the game, your team) still does so; **a toast that says why is a later step**. If the roulette lands on a team game, the team step (rule 21) follows it.

---

## 20. No emojis, anywhere in the UI

**The rule.** The UI never uses emojis (not in buttons, labels, banners, headings or text). They look different on every device and clash with the games' look. Use **words**, or a small **inline icon** (`apps/web/src/components/Icon.tsx`: trophy, crown, lock, fish, bag, bolt, eye, alert, sliders, check: simple shapes drawn in the text color, as tall as the text). Plain typographic marks like the multiplication sign for a close button are fine. This applies to every screen and every new feature.

---

## 21. The team step (the Random tile landing on a team game)

**The rule.** Team games chosen directly have their teams set in the lobby, before Ready (rule 17). When the **Random tile lands on a team game** (normally it never does: it is allowed only in tests, via `forceRandom`), the teams were never managed, so the round **pauses in its own step** right after the roulette's hold: phase **`'teams'`**.
- It is **the same team UI as the lobby** (`TeamPanel`: the two teams, "Join Team ..." while swapping is allowed, and for the host the swap switch and the handicap steppers), on its own screen (`apps/web/src/components/lobby/TeamStep.tsx`).
- **There is no Ready step.** It waits for **the host to press "Start the game"** (disabled until each team has a player; `startFromTeams` on the server). Start begins the **same short countdown as a normal game** (`COUNTDOWN_SECONDS`, `teamCountdownEndsAt`); **the host can Cancel it**, and **any change to the teams, handicaps, swap switch or bets cancels it too**. When it ends the round carries on (`finishTeamCountdown`). The host may also go back to the lobby. Nothing else about the round is decided here: after Start it carries on as normal (the flash and loading page, the in-game start).
- **Spectators bet on a team** in this step (bets placed before the game was known were on players and are cleared when the step begins).
- **Settings:** only team swapping can change (by the host); the game, the room's name and password cannot.
- **Leaving:** a player who joins now is a spectator; if a team ends up with nobody, the round is called off back to the lobby, like any step before the round.
- Nothing times out: the step waits for the host.


---

## 22. The Shooting Gallery (first draft)

**The idea.** An individual game (2 to 8 players). A carnival shooting gallery seen in **first person**: every player looks through their own eyes (from their own place in a line, a little high so the near turntable shows without its fruit piling up) and the only bow on screen is **their own**, bottom right, an arrow nocked. There are **no player models**: others are seen only through their arrows and ropes, in their own colors. The picture to hold in your head is a **pin board**: an arrow that hits a fruit **pins it** to the surface behind it, and players must **pull hard on their ropes to work the pin loose** and take the fruit. Most points wins. The round is **90 seconds** (`GALLERY_SECONDS`) but does **not** end while anyone is hooked (overtime). Spectators get a fixed overview camera (no bow).

**The set** (`packages/shared/src/gallery.ts`, shared by server and phones; a fruit's place is a pure function of its track, slot and the time). Fruit sit in fixed **slots** and **never spawn or despawn on the tracks**. The tracks:
- **top carousel** and **center carousel**: belts of fruit. The front run is in front of the wall (top: left to right, fruit hanging off ropes from the roof beam; center: right to left); at each end the belt turns and **goes through a cutout in the wall**, runs back **hidden behind the wall**, and comes out of the cutout at the other end. The wall is **solid everywhere except those four cutouts** (`WALL_HOLES`), which have gold frames and a dark space behind them;
- **left / right launchers**: striped boxes at the sides. A fruit shoots up out of the box's muzzle, hangs in the air, drops straight back in, waits hidden, and fires again (the two take turns). **A launcher box rejects any arrow that touches it**;
- **turntable**: a spinning table close to the players with 8 places; its fruit ride round it for good (counter-clockwise from above).
Fruit never overlap (belt slots are spaced, a launcher has one fruit, the table's places are fixed). Fruit behind the wall cannot be hit.

**Fruit and points** (`FRUITS`): watermelon **1** (big), apple **2**, banana **2** (medium), grapes **5**, blueberries **5** (tiny).

**Full gallery, refilled every 15 seconds.** Every slot is full at the start (`ALL_SLOTS`: the most fruit there can be, whatever the number of players). A caught fruit's slot stays **empty until the next refill**, which comes every 15 seconds (`REFILL_SECONDS`) and fills every empty slot with a new random fruit (it grows in). Nothing else spawns, and nothing refills after the clock has run out.

**Aiming: point and click, but you hold.** **Hold the screen** to aim: a **crosshair in your own color** floats a little above your finger (so the finger does not hide it) and moves with it; **let go to fire** at the crosshair. A touch let go too soon (under 150 ms) cancels, so a stray tap never shoots. Only you see your crosshair. Your bow draws its string and turns towards the crosshair while you hold. While you are hooked on a fruit the screen is for reeling instead (every touch is a tap).

**The arrow.** It starts at the player's **eye** and flies in a **straight line** through the crosshair (so it passes through exactly what you pointed at, whatever its depth), for **1.5 seconds** (`ARROW_MS`): aim ahead of moving fruit. (It is drawn leaving the bow and joins that line a moment later.) The **server follows it in small steps** against where every fruit is at that moment. **It pins the first fruit it actually touches and goes no further: it cannot pierce a second fruit.** An arrow that touches a launcher box, the ground, or reaches the wall without touching a fruit is a **miss**: it ends there and is **inert for good**, so it can never pin a fruit that passes by later. A miss is recovered automatically (reeled back along its rope) and the player can shoot again **0.5 seconds** after it stopped (`RELOAD_MS`). One arrow in the air per player; none while hooked. The aim can reach well below the wall (about -7) because the turntable is close and the eye is high.

**Pinned fruit and the pull.** A pinned fruit **stays exactly where it was hit** on the gallery: nothing moves it towards anyone, and **it is not scored until a player has made the taps**. Each hooker's arrow is drawn **through the fruit and stuck in the surface behind it** (the wall, or the turntable top), with the rope tied to its tail; the fruit shudders harder and the arrow works loose from the surface as the taps pile up. When the taps are done the fruit is **pulled free of its pin** and flies off the board to the player who got it, and the score pops up where it hung. Taps: **15** (`REEL_TAPS`) alone (40 ms apart at most).

**No lag at the pin.** The server's work is tiny (about 7 microseconds a tick with 8 players firing), so the delay players could feel at the moment of contact was only in getting the answer to the phone. Three things keep it short: the server sends the view **at once, and reliably**, whenever something discrete happens (a shot, a hook, a miss, a catch, a refill: the view's `rev` goes up) instead of waiting for its next 20-per-second snapshot; a tap arriving just after contact finds the hook already made (the server settles the arrows before it counts the tap); and each phone **predicts the contact itself** with the same shared flight and fruit sums, so the arrow stops and the pin shows at the moment it touches and your reeling can start at once; the server's answer then takes over without a jump (and corrects the picture if it ever disagrees).

**Fights.** **Anyone can hit a fruit that is already pinned**: then everyone on it needs **30** taps (`FIGHT_TAPS`), and **every new hook resets everyone's count to zero** (so 12 taps and then someone else hooking means starting again at 0 of 30). The first to the needed taps pulls it free, worth **its points times the number of players fighting for it**; a fruit being fought over shows its multiplied worth. The others' arrows come out and they are free to shoot again. A player who leaves lets go.

**Overtime.** If at the clock's end any fruit is pinned or an arrow is still in the air, the round carries on with a small **OVERTIME +x.x** counter counting up; other players may still shoot (only to join the fight); it ends when the last pinned fruit is scored (`holdOpen` in the engine, honoured by `rooms.finishRound`).

**How it is done.** Engine `apps/server/src/games/shootingGallery.ts` (tick-driven and pure), view and types in `packages/shared/src/events.ts` (`ShootingGalleryView`, with each player's fixed `slot`), scene `apps/web/src/components/gallery/ShootingGalleryScene.ts` (the wall is a `ShapeGeometry` with the cutouts as holes), screen `ShootingGalleryScreen.tsx`. The server's action whitelist in `sockets.ts` accepts `fire`. Tests: `npm run test:gallery -w @fgn/server` (rules, including the carousels, the cutouts, an inert stuck arrow, and a fruit behind the wall) and `npm run test:gallery-net -w @fgn/server` (real sockets, a fight and an overtime).

**Not done yet (first draft).** No tile picture (a plain tile), no spectator follow-camera, few sounds, and the numbers (belt speeds and slot counts, 90 seconds, the hold time, the crosshair's offset) are first guesses to tune.

## 23. Closing the Gap (game id `mountain-goat`)

**The idea.** An individual game (2 to 8 players, 45 seconds: `GOAT_SECONDS`). Everyone is a mountain goat crossing gaps between ledges. Every ledge reached is a point; most points wins; level on points is a draw (rule 4). There is no overtime: the round ends at the clock.

**The jump.** Tap anywhere. A marker (an arc with an arrowhead, in the player's colour, in the style of Santa's Sack's aim arc) sweeps out from the goat and back at a **steady speed** (`SWEEP_SECONDS`, 2.2 s out and back; the speed never changes). Tapping when its end reaches the next ledge makes the goat leap and land (a point); the leap takes `JUMP_MS`. A tap off the ledge (or into the bird) makes the goat leap to where the marker was and tumble into the gap; it climbs back after `FALL_MS` and the marker starts again. Taps while in the air or climbing back do nothing.

**The ledges.** Every goat faces the **same** ledges and gaps (made from one seed per round, `packages/shared/src/goat.ts`), so it is a race over identical jumps. Gaps are 4 to 9 units. The ledges **get smaller** over the first `RAMP_JUMPS` jumps (the ledge's radius is also how far off the marker may be and still land).

**The bird.** From jump `BIRD_FROM` on, a bird may patrol back and forth across the gap (more likely the further you get: 40% rising 5 points a jump to 90%). It flies on the **round's clock**, so the next gap's bird is already flying (and shown) before the goat gets there. If the goat meets it in the air (box against box: `GOAT_BOX`, `BIRD_BOX`, along the goat's real leap, so leaping short or long into it counts) they collide: no point, the goat tumbles, and the bird is shoved away by physics (scene only) and flies back in. The bird's swing (`BIRD_AMP`) and period (`BIRD_PERIOD_MIN..MAX`) are tuned so a **correctly aimed leap at a random moment meets the bird about 1 time in 4** (measured 24.9%), and the periods are kept where the bird can never fall into **lockstep** with the 2.2 s sweep (the marker is on target at the same point of every sweep; the periods keep the bird's pattern from repeating sweep after sweep), so the player always has a clear moment to jump and chooses when. Re-measure the odds if the hitbox sizes, `BIRD_AMP` or the periods change.

**Lag.** A phone sends **when** it tapped (`{type:'jump', at}`, on its idea of the server clock). The server believes it up to `LAG_MAX_MS` in the past and never in the future, so the marker the player saw is the marker the server measures; the same shared maths (`judgeJump`) runs on the phone, so the goat leaps (or tumbles) the instant of the tap and the server's view takes over without a jump. Taps closer than `JUMP_TAP_GAP_MS` are ignored.

**The view and the look.** One goat at a time is shown: the player's own (a spectator follows any player with the shared spectator controls; at the end the camera follows the winner). Travel is left to right on a wide screen and bottom to top on a tall one, with a flatter, more overhead camera on tall screens. The setting is **scenery only** (nothing in the game reads it): a narrow crevice between two grey rock cliffs with a grassy rim and bushes, falling away to black; the ledges are brown, grass-topped pillars whose sides darken into the drop. A landing throws a plume of earth and a subtle camera shake; a fall shakes the screen harder.

**How it is done.** Shared maths in `packages/shared/src/goat.ts`, view types in `events.ts` (`MountainGoatView`; `GoatJumpView` carries the last tap's result), engine `apps/server/src/games/mountainGoat.ts` (no `tick`: the view changes only on taps), scene `apps/web/src/components/goat/MountainGoatScene.ts`, screen `MountainGoatScreen.tsx`. The action whitelist in `sockets.ts` accepts `jump`. Tile picture: `public/games/mountain-goat.png`. Tests: `npm run test:goat -w @fgn/server` (engine and the bird: the odds, off-target collisions, lag and throttle).

**Not done.** Sounds (only the shared round clock and the winner sounds), and a network test.

## 24. Zoo Adoption (game id `adoption-day`)

**The idea.** An individual, first-person search game (2 to 8 players, 90 seconds: `SHELTER_SECONDS`). Everyone is a volunteer in a huge animal shelter with no walls and every kind of animal wandering loose. Six adopters stand in a line behind the adoption counter (the north end), each with a thought bubble showing a rotating model of the animal they want (see "The thought bubbles" below). Find a matching animal, pick it up, carry it back and hand it over. The adopter then celebrates (a jump and a burst of hearts), leaves, and a new adopter with a new request takes the place. **Every player races for the same six requests**: whoever hands over a match first scores the point. Most adoptions wins; level on adoptions is a draw (rule 4). There is no overtime.

**The animals.** Twelve types (`SPECIES` in `packages/shared/src/shelter.ts`): penguin, seal, bear, fish, cat, dog, lion, tiger, parrot, seagull, pelican, cockroach. **Each type has two color options** (`VARIANTS`), and one exact animal is a **kind** (a type in one color option: `kind = type * VARIANTS + option`, 24 kinds; the view sends a kind for every animal and adopter). Option 0 is the original look, option 1 a second one: the colorful animals get another vivid scheme (fish: orange or blue with yellow fins; parrot: green, or a red, yellow and blue scarlet macaw), and the natural ones are only ever brown, black or white (penguin: navy or brown; seal: blue-grey or brown; bear: polar or brown; cat: orange tabby or black; dog: golden or white; lion and tiger: the usual coat or an albino/white one with pink or blue eyes; seagull: white adult or brown young bird; pelican: white or brown with a white head; cockroach: brown or black). There is one cat and one dog model (not a big and a small one). The penguin, seal and bear are the **same models as Penguin Lasso** (shapes and `HeadKit` heads; the first option is its colors, a recolor swaps the baked colors for the second) and the fish is the **Fishing / Snowball `FishKit` fish**; the rest were built for this game in the same flat-shaded style. Sizes follow the scale Penguin Lasso set (about 2.2 units per metre: a penguin is 2.4 tall, the bear is the biggest at about 3.8 (it was scaled down 15%), a lion 3.3, a cockroach under half a unit tall). **All animals move at one speed** (`ANIMAL_SPEED`, 3.5): nothing slides, everything waddles (a gentle rock and bob, less for the big ones), and a fish flops along on its side. Animals stand still now and then and keep out of the strip in front of the desk. **They steer round each other**: a walking animal heading for another one turns away (it only ever turns: nobody speeds up or slows down), picks the roomiest of a few directions when it sets off, and one standing on top of another walks off. It is tuned to be imperfect on purpose: about 12 to 14% of animals overlap another at any moment (about 20% with no avoidance; `avoidTurn`, measured by the test). The parrot is the round, crested cockatiel-style model and the cockroach the sleek, glossy one with jointed legs and long feelers (each chosen from three designs).

**Requests and the crowd.** A request is an exact kind, **color included** (the thought bubble shows the exact model, so a tabby cat is not a black cat: the right type in the wrong color is a wrong animal). The six requests are always six different **types**, and a request always has matching animals loose in the building. When an animal is adopted a new one of the same kind turns up elsewhere (away from the players), so the crowd stays the same size. A new adopter never asks for a type another adopter is already asking for.

**The thought bubbles are little screens.** Each adopter's animal does not sit inside the flat cloud (a model in a flat plane clips through it). Instead there is a **stage** per adopter in a separate scene that is never drawn to the screen: a big white cylinder with the animal turning round at its middle, lit by its own lights, and a camera inside looking at it. The camera renders into a small texture (`WebGLRenderTarget`, 320 pixels wide) and the cloud shape simply displays that picture, so the animal can only ever be seen inside the cloud's outline. The camera is placed so the picture matches the cloud 1 unit for 1 unit. A wrong animal turns the stage's **wall** red, so the whole bubble flashes red while the animal keeps its real colors. Only the bubbles that are on screen are rendered each frame (`renderBubbles` in `AdoptionScene.ts`).

**The counter and the hand-over carpets.** The adopters stand on a low platform **behind a counter** that runs along the whole north end (a wall nobody can walk through: `COUNTER_FRONT`, `resolveMove`). On the floor in front of each adopter is a **carpet** (a vivid golden rug with a patterned border, a field of diamonds and a medallion, drawn by `makeCarpetCanvas` and tinted by the scene; no words or arrows, the picture is enough; `padRect`, `PAD_DEPTH` give its place): you hand an animal over only while standing **on that adopter's carpet**. A carpet turns **green** while you stand on it holding an animal, and **grey** while its adopter is leaving. Standing anywhere else (including between two carpets), or on the carpet of an adopter who is leaving, the button just puts the animal down. The players start in a row just south of the carpets, and animals keep out of the strip in front of the desk (`ADOPTION_STRIP`).

**Picking up and handing over.** One button (Space / Enter on a keyboard): walk up to an animal and the one in reach and in front of you **lights up** (brighter, with a glowing ring under it); the button then picks it up and a **tiny model of it floats in front of you** (everyone else sees it floating over the carrier's head). You carry one animal at a time. A bigger animal can be picked up from farther away (`reachOf`). On an adopter's carpet the same button hands the animal over: a match scores a point (the adopter jumps for joy in a burst of hearts, then leaves and a new one steps up). **A wrong animal**: that adopter's thought bubble turns red and shakes, they shake their head, the animal is dropped and **runs off** away from them (`ANIMAL_FLEE_SPEED` for `ANIMAL_FLEE_MS`), and there is no point penalty. Actions are throttled (`ACTION_THROTTLE_MS`); a player who leaves puts down what they carry.

**Controls and the view.** First person with no body or hands drawn: **left thumb walks, right thumb looks** (a keyboard: WASD to walk, arrows or Q/E to turn, a mouse drag to look). The phone moves the camera **at once** (it runs the same movement maths, `resolveMove`, as the server and is only gently corrected by it) and sends the walking direction and the way it faces (`steer`, `look`), so the camera never lags. The field of view follows the screen's shape so a tall phone sees as wide as a wide screen. A strip of six pictures at the top shows what each adopter wants (the same models, in the same colors, as in their bubbles), so a player does not have to walk back to check. Other volunteers are drawn as people in their own colour with a name tag. Spectators follow a player and see through their eyes (position, facing, and what they carry). **The opening** is a **pan along the adopters** (`SHELTER_PAN_SECONDS`, 7 s; the game's `introSeconds` is the pan plus the usual 3 seconds): after the standard 2 second static buffer on the first adopter, the camera glides along the counter from one adopter to the next, in front of the carpets and under the roof, stopping at each so their thought bubble (the animal they want) fills the view. As the camera reaches each adopter they jump for joy (the success hop, without the hearts) and the bubble gives a little pulse, so the pan has movement. The **3, 2, 1 rolls straight off the end of the pan**: during it the camera sweeps on from the last adopter, turning round, into the player's own eyes, arriving at GO (`updateIntro`, `panPose` in `AdoptionScene.ts`). At the end the camera glides to the winner from behind (a draw pulls back to a high spot **inside** the building, never through the roof).

**The look of the building.** Walls (painted all round, floor to roof) carry a flat **jungle mural** (`makeJungleCanvas`: layered canopy, tall trees, palms, big leaves, hanging vines, flowers and small parrots; unlit and not fogged, so it reads as paint), because the shelter is a bit of a jungle. The floor is **pebbled tile** (`makeFloorCanvas`: pale tile with thin grout and small pebbles sparsely set in it, each with a soft shadow and a glint). The roof has girders over each row and column of pillars and the ceiling **lights hang in the middle of each square the pillars make** (never over a pillar). The textures are drawn on canvases in `shelterTextures.ts`.

**It scales with the number of players.** The building grows with the player count (`shelterDims`: the floor area is 3600 plus 900 per player, never less than for 2) and the crowd keeps the **same density** (`animalsPerKind`, about one animal per 70 square units, the same number of each of the 24 kinds). The roof's pillars (`pillars`) and the counter are solid; the walls of the floor stop everyone. The adopters (and their pads) are spread evenly along the counter.

**How it is done.** Shared sizes, speeds, layout, movement and the pick-up rule in `packages/shared/src/shelter.ts`; view types in `events.ts` (`AdoptionDayView`, with a compact `AnimalRow` per animal); engine `apps/server/src/games/adoptionDay.ts` (tick-driven and pure); the animals as one merged vertex-coloured model each, drawn as **instances** (a hundred animals cost 24 draws), in `apps/web/src/components/shelter/AnimalKit.ts`; people in `People.ts`; the species pictures in `animalIcons.ts`; scene `AdoptionScene.ts`; controls `useFirstPerson.ts` and `FirstPersonControls.tsx`; screen `AdoptionScreen.tsx`. The action whitelist in `sockets.ts` accepts `look`, `grab` and `give` (and `steer`). Tests: `npm run test:shelter -w @fgn/server` (rules: scaling, one speed for every animal, the overlap share, pick-up reach, the pads and the counter, hand-over right and wrong, replacement, leaving) and `npm run test:shelter-net -w @fgn/server` (real sockets).

**Tile picture:** `public/games/adoption-day.png` (the shelter floor with a crowd of animals walking about, models only).

**Not done yet.** Sounds beyond the shared round clock, the pick-up and adoption chimes borrowed from Penguin Lasso, and all the numbers (the 90 seconds, building and crowd density, walking and animal speeds, reach) are first guesses to tune by playing. Not played on a real phone.

## 25. Broadside Battle (game id `pirate-broadside`; a team game; first in the picker, alphabetically)

**The idea.** A team game (rule 17), 2 to 8 players, 90 seconds (`PIRATE_SECONDS`). Two pirate ships, Team Yellow's in the north and Team Purple's in the south, sail side by side on a wavy sea and fire at each other. **Every player has their own cannon**, standing between the masts along their ship's rail, set **inboard and raised** so the barrel rests on top of the rail and its muzzle reaches the hull's side but never pokes out through it (`stationLocal`, `PIVOT_HEIGHT`; there is no gun-port box on the hull), and sees the sea from behind its barrel in first person (no hands or body drawn: just the barrel, the carriage and the wick). **Every hit on the enemy ship is one point for the team, wherever it lands** (hull, deck or sails); the team with the most hits (plus its handicap) wins, level is a draw (rule 4). There is no overtime: only hits that **arrive** before the clock runs out count, and a wick that runs out after it never fires.

**The cannon.** Aiming is a **stick** (WASD or the arrow keys on a keyboard) that moves the barrel steadily (`stepAim`: up and down, and towards the bow or the stern, within an arc: `AIM_YAW_MAX`, `AIM_PITCH_MIN/MAX`; a steeper angle is a higher, longer shot). **Aiming never stops**, not during the wick and not during the reload. Fire is a button (Space or Enter): **press fire, the wick is lit and burns for 1 second (`WICK_MS`; it is visible: a cord that shrinks with a glowing, sparking end), BOOM, the ball launches, then 2 seconds (`RELOAD_MS`) before the cannon can be fired again**. Presses during the burn or the wait do nothing. The ball goes where the barrel points **at the moment of the boom** (so an aim changed during the burn counts). The phone moves the barrel at once and tells the server where it points (`aim`, about 20 a second); `fire` is the other action. The barrel's muzzle shows a flat black disc a little way in from the tip so it does not look hollow from the front. A hit sends **wood splinters** flying (thin tumbling shards in raw and dark wood colors, not round puffs) with a flash and smoke. **The barrel never rolls** as it turns (its up stays up), so the wick is always on top. When it fires the whole cannon, **the barrel on its wooden carriage, rolls straight back along the deck on its four wheels by 40% of the barrel's length, very fast (60 ms), and then rolls forward to its firing place, smoothed over the 2 seconds of the reload** (`recoilAmount`); the wheels turn backwards as it goes and forwards as it comes home (crossed spokes make the turning visible); a big flash, a jet of flame, a spray of fiery sparks and a heavy plume of smoke come out of the muzzle (`BLAST_SCALE`: 80% bigger and more than at first). The wick is small (a short cord with a small glowing end, 0.39 long, growing out of the top of the barrel about half way up what the player can see of it, `WICK_AT_Z`). **Sparks** (the wick's, and the cannon's) use the **same spark effect as Tap Race** (`SparkSystem`: glowing comet streaks), fiery orange only. **See-through rigging**: the masts, yards and sails of the ship you are on are drawn nearly transparent to you (`GHOST_RIGGING`, `GHOST_SAILS`), so a mast never hides the target; the other ship is always solid. **Screen shake**: your own cannon firing shakes your screen (`SHAKE_FIRE`, strong: 30% more than at first); a hit on your ship shakes it half as much; other cannons firing, even on your own ship, never shake it.

**The distance between the ships changes.** The two ships **veer closer and further apart, about every 30 seconds, give or take** (`shipPose(...).lane`: a slow swing plus a little wandering of each ship, never exactly the same, taking the gap between the hulls from about 20 to about 54), so the timing and the angle of a shot depend on how far away the other ship is right now: the same aim that hit a moment ago can fall short or sail over.

**The ships** are galleons (chosen from three designs): a dark planked wooden hull with curved sides, a gold trim band and a stripe in the team's color, a high sterncastle with a whole, windowed transom (a gold gallery and lanterns), a rising bow with a long beakhead and a gold figurehead, three masts, striped sails and a pennant. They are built in code (`buildHull`, `buildDeck`, `buildFittings`, `buildRigging` in `PirateModels.ts`).

**The sea and the "sailing".** The ships never move forward. They sit in place and **rock** in three dimensions (roll, pitch, a little yaw and heave: `shipPose`, a sum of slow and quick swells, different for each ship), and the **sails are full of wind**, billowing forward with a ripple. To make them seem to sail, the **sea runs past towards the stern**: the swells and the foam streaks (made in the sea shader) travel backwards, foam streams along each hull (a trail that runs from the bow to half a ship's length beyond the stern, fading out, at about 15 units a second), and the clouds drift past. The camera is part of the ship, so your view rocks with it and you must compensate when you aim.

**The shot.** **Every ball travels at the same speed across the water** (`BALL_SPEED_H`), whatever the angle of the barrel: the angle only sets how high the arc goes, so **the only thing that makes a shot take longer is the distance it has to travel** (about 1.5 seconds across the usual gap, up to about 3 for the longest). The ships are sailing towards the bow, so a ball fired straight at the other ship would land behind where it has got to: a steady **drift towards the stern** (`SEA_DRIFT`, 35% stronger than at first) pulls every ball astern as it flies, so **shots must be led: aim ahead, towards the bow**. (Gravity is separate and unchanged.) Because the enemy ship's rocking is a pure function of the round's clock (`shipPose` in `packages/shared/src/pirate.ts`), **the server works out the whole flight, and whether it hits the rocking enemy ship, at the moment of launch** (`simulateShot`: it checks the ball against the hull and sail boxes in the enemy's own frame, a hit is a ball touching one of them), and phones just replay it (`shotPoint`: nothing is streamed while a ball flies). The ball scores when it arrives; a miss lands in the sea with a splash.

**View and spectators.** A player sees through their own cannon, with the eyes just above and only a little behind the barrel's pivot (`EYE_BEHIND`, `EYE_HEIGHT`) so the back of the cannon is cropped and the barrel sits low in the picture: it is a reference, and it does not hide the target (the view turns part of the way with the aim, so the barrel moves across it); a spectator follows a pirate's cannon. The opening glides from a view of both ships (from the stern) into the player's eyes; at the end the camera glides to the outer side of the winning ship (a draw pulls back to see both).

**How it is done.** Shared maths in `packages/shared/src/pirate.ts`; view types in `events.ts` (`PirateBroadsideView`); engine `apps/server/src/games/pirateBroadside.ts` (a team game: the room adds the players' hits up per team; the engine has no single winner); scene `apps/web/src/components/pirate/PirateScene.ts` with the models in `PirateModels.ts`; aiming in `useAim.ts`; screen `PirateScreen.tsx`; sounds in `audio/pirateSounds.ts`. The action whitelist in `sockets.ts` accepts `aim` and `fire`. Tests: `npm run test:pirate -w @fgn/server` (rules: the rocking, the drift, the constant speed, the ships' changing distance, flight times, the fire / wick / boom / reload timeline, aiming during the burn, the result not depending on the tick rate, hits arriving and scoring) and `npm run test:pirate-net -w @fgn/server` (real sockets).

**The whale.** Every round, a battle-scarred green right whale (deep green, barnacles, a mouth of small rounded teeth, one brown harpoon in its back) visits the gap between the ships **three times, always in the same order**, each at a random moment inside its window (drawn fresh for every game by `makeWhaleSchedule`, sent to the phones in the view as `whale`; nothing is streamed): **1. a partial breach** (the head and back rise and sink, swimming with a bob; it starts between 15 and 30 seconds in), **2. a peek with a blow-hole spout** (between 35 and 55 seconds), and **3. the big breach** (between 65 and 75 seconds): a rumble with bubbles boiling on the sea and a growing screen shake, then one smooth arcing leap (about 3.8 seconds in the air, the body arching like a leaping whale) and a huge splash. The visits are never back to back: at least 3 seconds separate the end of one from the start of the next (the later windows start after the earlier visits are over, and the breach is done before the 90 seconds are). **The leaping whale blocks shots**: while it is out of the water (`whaleBlocks`), a ball that touches its body (a chain of balls along it, plus the flukes) is destroyed on the spot and scores nothing (`simulateShot` returns `blocked`; phones show a burst there). The animation is a pure function of the round's clock (`packages/shared/src/whale.ts`: `whalePose`, `breachEvents`, `shakeAt`, the tuned `WHALE_TUNING`), so the server and every phone agree. The picture is `WhaleActor.ts` (the body from `WhaleModels.ts`, foam rings, the sea-colored droplets from the Tap Race sparks, a soft white spout). `PirateConfig.whale` fixes the three times for a test (or `null` for none).

**The tile picture** (`public/games/pirate-broadside.png`) is a high view of the two galleons side by side on the sea at their closest, taken from the real game.

**Not done yet.** Sounds for the whale, a hit-reaction on the ship (damage, fire) beyond the splinters and smoke, crew figures, and all the numbers (speeds, the rocking, the pull, the range, the 90 seconds) are first guesses to tune by playing. Not played on a real phone.
