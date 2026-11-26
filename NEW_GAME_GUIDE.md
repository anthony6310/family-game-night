# New game guide (read this FIRST when making or changing a game)

This is the go-to file for context on **building a new game** in Family Fun Game. It is deliberately abstract: it explains the structure, the standard building blocks that every game gets (or must plug into), the order of work, and the traps to avoid. It says nothing about how any particular existing game plays.

- **This file** = how games are built here (read before starting a game, and when you touch the game system).
- **`GAME_RULES.md`** = the numbered rules the standard building blocks follow, plus one section per existing game. Check its list when you add a game, and **add a section for the new game** when it is built.
- **`BLUEPRINT.md`** = the original milestone plan. Hands off: do not update it or lean on it unless asked.
- If you change how the standard blocks work, update **this file and the relevant GAME_RULES.md rule** in the same change.

---

## 1. The shape of the system

- **Monorepo (npm workspaces).** `packages/shared` (types, constants, shared geometry/rules, imported by both sides), `apps/server` (Node, Socket.io, the authority), `apps/web` (React + three.js phones/screens).
- **The server is authoritative.** A game's rules live in a **pure engine** (no timers, no sockets, no clock reads: the caller passes `now`). Phones send small **actions**; the server decides what they mean and streams a **view** (the slice of state phones may see). Phones draw the view; they never decide an outcome.
- **The room is a state machine** (`apps/server/src/rooms.ts`, timers in `sockets.ts`): lobby, countdown, roulette (Random only), teams (team games reached via Random), underdog (when there is one), starting (the flash step), playing, finish, results, session-over. A game only owns what happens inside **playing** (and its finish sequence); everything around it is shared and automatic.
- **Everything time-based is on the server's clock** (`serverNow()` on phones is synced to it). Anything shown to everyone at once (starts, ends, flights, countdowns) is described by server timestamps, not by "now plus a duration" decided locally.
- **Static facts about each game** are one entry in `packages/shared/src/games.ts` (name, description, min/max players, score label, optional finish length, optional intro length, optional team flag). The picker, start rules and finish timing all read from it. Keep the list **alphabetical by name**.
- **Game screens are lazy-loaded** (three.js is big) from `apps/web/src/pages/LobbyPage.tsx`, which routes the room's phase to a screen.

---

## 2. The checklist: every place a new game touches

Do these in roughly this order. Skipping one usually fails quietly (a dropped action, a missing tile, a screen that never loads).

**Shared (`packages/shared/src`)**
1. `games.ts`: add the entry (alphabetical). Set `finishSeconds` if the game has its own closing sequence, `introSeconds: 0` if it has its own opening, `teams: true` for a team game.
2. `config.ts`: round length and any named numbers the server and phones both need.
3. `events.ts`: add any new **action** to `GameAction`, a **view** interface, and add the view to the `GameView` union (told apart by `gameId`).
4. If server and phones must agree on geometry or motion (where things are at a given time), put the pure functions in a new shared file and export it from `index.ts`. Make positions **pure functions of the time** where you can: then nothing has to be streamed but the list of things.

**Server (`apps/server`)**
5. `src/games/<game>.ts`: the engine (see section 3). Optional extras it may use: `tick`, `holdOpen`, team context.
6. `src/rooms.ts`: import and register the engine in the `engines` map (tests shorten durations through the constructor options already used by the other games; reuse that pattern).
7. **`src/sockets.ts` action whitelist**: the `game:action` handler only accepts known action shapes. A new action type must be added there, or every phone message is silently dropped. (This has bitten before; a real-socket test catches it.)
8. `scripts/test-<game>.ts` (engine rules) and, for anything with live behaviour, `scripts/test-<game>-net.ts` (real sockets), plus a `test:*` entry in `apps/server/package.json`.

**Web (`apps/web/src`)**
9. `components/<game>/<Game>Scene.ts`: the three.js scene (class with `pushView`, `dispose`, a camera, `introFactor`, and so on, see section 5).
10. `components/<Game>Screen.tsx`: the React screen (HUD, input, winner moment).
11. `pages/LobbyPage.tsx`: a `load…Screen` lazy import, its entry in `GAME_LOADERS` (a `Record<GameId, ...>`, so a missing one is a compile error; it starts the download when the host picks the game), and the branch that renders the screen with the standard props. Add the game's tile picture to `GAME_IMAGES` once it exists. (Nothing else for the loading step: the screen is mounted under the loading page while the round loads, see section 4.)
12. `styles.css`: only what the HUD needs, namespaced to the game (reuse the shared `snow-*` HUD classes where they fit).
13. `public/games/<game-id>.png`: the tile picture (section 4, "Tile picture").

**Docs**
14. A new numbered section in `GAME_RULES.md` for the game, and any change to a standard block recorded where that block is described.

---

## 3. The engine contract (`apps/server/src/games/types.ts`)

An engine is created by a factory taking options (durations, so tests can shorten them), and provides:

- `init(playerIds, now, teams?)`: fresh state. `now` is the moment the round's clock starts (after the intro), not the moment the room entered `playing`.
- `reduce(state, playerId, action, now)`: apply one validated action. **Ignore** anything from a non-player, before `startsAt`, after the end (unless the game allows it), or malformed. Throttle taps (about 40 ms) to blunt auto-clickers.
- `tick?(state, dt, now)`: only for games with continuous movement or time-driven events. If present, the room calls it ~40 times a second and **streams the view on every tick**; a game without it streams only after actions. Use `tick` for anything that must happen "when time passes" (things landing, spawning, phases of the round).
- `isOver(state, now)`: when the round should end. Checked after actions and ticks; the room also ends the round on a timer at `endsAt`.
- `holdOpen?(state, now)`: **overtime hook.** Return true to stop the end-of-clock timer from ending the round (something is still unresolved). The game then ends through `isOver` on the tick loop. Show an overtime indicator in the view/HUD.
- `getWinner(state)`: one player id, or **null for a draw**. Never invent a tiebreak: draws are a standard case (see section 4).
- `scores(state)`: per-player number shown on the results screen.
- `removePlayer(state, playerId)`: a player left mid-round: release whatever they hold so nothing is stuck.
- `view(state)`: the slice phones may see. **Copy** mutable parts (the engine may mutate its state in place for speed; the view must not alias it).

Patterns that proved useful:
- **Decide outcomes at the moment they become true, using the time they became true** (not the time the tick happened to run). Resolve scheduled events in time order inside `tick`.
- **Randomness** (spawns, picks) may use `Math.random` inside the engine; keep it out of anything phones must reproduce (those come from the view or from shared pure functions).
- Keep `endsAt` in the view (the room's timer and the phones' clock both use it). A game with an overtime keeps `endsAt` as the clock's end and adds its own fields for the extra time.
- Team games get `teams` in `init`; the **room** decides the winning team (the engine just reports per-player scores). See section 4.

---

## 4. The standard building blocks (what the platform already does for you)

Each of these is standardized. **Plug into them; do not reinvent them per game.** The numbered rule in `GAME_RULES.md` has the detail.

- **Game picker and Random.** The host picks; everyone else sees a carousel; the Random tile makes the server pick a playable game after the lobby countdown (with a roulette). A new game appears automatically from its `games.ts` entry. The Random tile never picks a team game. Random is the default selection for a new room. (Rule 13.)
- **Lobby, ready, countdowns.** Everyone ready triggers a short lobby countdown. The lobby is a hub with menus; host-only features are hidden from non-hosts. (Rules 10, 19.)
- **Underdog and bets.** Spectators can bet; a lone un-bet player can be the underdog. Fully automatic and game-independent; the only thing a game must do is return honest `scores` and `getWinner`. (Rules 3, 5.)
- **The flash step and the loading step.** Between the countdown and `playing` there is a shared flash and loading page showing the game's tile picture and name. The round is made when that step begins, and every phone mounts the game's screen UNDER the page and builds the real scene there; the step lasts at least 3.5 s and then **until every phone has the game on screen and drawing smoothly**, with a 20 s safety net, so an asset-heavy game never starts frozen on a slow phone. Then the server announces one reveal moment and every phone lifts the page and starts the intro together, on the server's clock. Per game: only the tile picture and a `GAME_LOADERS` entry. Keep a scene's constructor free of side effects that should only happen once the game is visible (it runs under the page while the round loads), and do the heavy building there. (Rule 8.)
- **The in-game start.** The scene is shown at once, but the round's clock starts later: first a **2 second static buffer** (every game, no exceptions), then either the standard **3, 2, 1, GO** while the camera moves from an overview to the player's view (`introProgress` in `StartCountdown.tsx`, feed it to the scene as `introFactor`), or a game's **own opening** (set `introSeconds: 0` and time the countdown yourself so GO is when control starts, or set `introSeconds` to the opening's length plus the usual 3 so the 3, 2, 1 runs at the end of your opening: the scene works out the phases from `startsAt`). **No game gives control before GO**: the server ignores early actions, and screens hide controls and drop input until `useStarted` is true. (Rules 10, 11.)
- **The round clock.** Games with a clock use the shared end-of-round tick/whistle (`createRoundClock`); feed it the seconds left, no options. (Rule 1.)
- **The finish sequence.** Every round ends with **your own view, then the winner moment** (camera to the winner, banner naming them and any winning bettors; a draw pulls back and says so), then the results screen. Screens use `isWinnerMoment`, `useWinnerSounds` and `WinnerBanner` from `WinnerMoment.tsx`, and the scene exposes a way to move its camera to a winner. A game with a longer closing sequence sets `finishSeconds` in `games.ts` (the server uses it for the phase length). (Rules 2, 11.)
- **Draws.** `getWinner` returning null is a draw: nobody scores, it still counts as a round, no forced replay. (Rule 4.)
- **Spectators.** Every game must be watchable by people who are not playing, never acting. A spectator just **follows a player** and sees what that player sees, using the shared spectator tools (`apps/web/src/spectate`: `useSpectatorCamera` + `SpectatorControls`). **There is no free camera and a new game does not need one** (do not build one). A game is not finished until a spectator can follow a player. (Rule 3.)
- **Team games.** `teams: true` in `games.ts` gives you two fixed teams, a team panel and a host-only swap switch in the lobby, team bets, no underdog, a point for every member of the winning team, and a team step when Random lands on one. The engine reports per-player scores; the room adds them up. Draw everyone in their team's color in the scene. A **one-against-all** game (`lone: true`, one random player against everyone else, sides drawn when the round starts, no team picker) adds `teamNames` for what the sides are called. (Rules 17, 21, 26.)
- **Overtime.** A game whose end can be held open implements `holdOpen` and shows an indicator; see section 3. The room's timer respects it.
- **Reconnect.** A dropped player keeps their seat for a grace period; engines never need to handle it except through `removePlayer` when they truly leave. (Rule 15.)
- **Player colors and names.** Each player has one color in every game (a team game draws team colors instead). Floating names use the shared name-tag helper (`labelTexture.ts`, which draws on a top layer) and must be readable. (Rules 6, 7.)
- **No emojis anywhere in the UI.** Use text or the SVG icons in `Icon.tsx`. (Rule 20.)
- **Tile picture.** A 720 x 450 screenshot of the game's **3D models only**: no HUD, no timer, no names, no arrows over heads. Made by a short-lived preview page that builds just the scene in a fixed pose; registered in `GAME_IMAGES`. (Rule 9.)
- **Sounds.** Shared synthesized sounds live in `apps/web/src/audio`; play them through `audio.playFlat` (or the positional API). They follow the player's sound setting automatically. **Every game needs a theme:** add an entry to `GAME_THEMES` in `apps/web/src/audio/gameThemes.ts` (a `ThemeSpec` for the engine in `themeEngine.ts` is enough); the room screen plays it from the loading step to the finish, so the game's own screen must not play theme music itself. Looping ambience (wind, sea) is a bed started with `audio.startBed`. Build sounds from the shared toolkit in `audio/synth.ts`. **Register every sound in the mixer table** (`audio/mix.ts`: the sound in `ENTRIES`, its level in `MIX_LEVELS`, and `theme` for the game's music): the engine multiplies each sound's volume by its level there, so the volume of the whole game is tuned in that one place (a sound that is not listed plays at 1).

---

## 5. The scene and screen pattern (three.js)

- **A scene is a class** owning a renderer, scene, camera, a `requestAnimationFrame` loop and a `ResizeObserver`; it has `pushView(view)` (React feeds it every new view), `dispose()` (frees geometry, materials, textures, name tags, the renderer), and small setters for things React knows (seconds left, winner, aim, finish).
- **The scene draws the view; it decides nothing.** Local-only feedback (a tap sound, a reticle, a bounce) is fine and should be instant; the server's numbers follow.
- **Fit the camera to the screen shape.** Phones are narrow: compute the field of view (or distance) from the aspect ratio so everything the player needs is always in frame. Check a landscape and a portrait size.
- **`introFactor`** (0 overview .. 1 normal) from the screen drives the opening camera move; a **winner view** flag/setter drives the closing move.
- **Procedural everything:** canvas textures, low-poly flat-shaded meshes, instancing for repeated things. No external model files.
- **A screen** (`<Game>Screen.tsx`) creates the scene once in an effect, pushes each new view, reads the remaining time with `useRemainingMs`, gates input with `useStarted` and `frozen` (the finish sequence), draws the HUD (timer, standings, status), and renders `WinnerBanner` during the winner moment. Names and colors are captured once when the round starts (a leaving player must not recolor everyone). Input is pointer events on the canvas; avoid page scroll with `touch-action: none`.
- **First-person games.** A game can put the camera at the player's own eyes with only their own equipment visible (a child of the camera). Then everyone else must be readable through what they DO (colored projectiles, ropes, effects), the server's idea of where each player's actions start must match what that player sees closely enough (use fixed world offsets from the eye, not screen-shape-dependent ones), and a spectator follows a player by seeing through that player's eyes (with their equipment), like everyone else's view of themselves.
- **Walking in first person needs local prediction.** Move the camera from the player's own steering at once, using the same shared movement function as the server, and only pull it gently towards the server's position (snap if it is far off); never place the eyes straight from streamed positions, or every step lags by the round trip. Others are carried forward by their velocity and eased onto the streamed position. A crowd of many identical things should be **instanced** (one merged, vertex-coloured model per kind).
- **Aim aids are local.** A crosshair or any other aid for one player is built only for the local player and never sent to anyone. For a hold-to-aim, release-to-fire control, keep the pointer in a ref, show the aid a little above the finger, and ignore a touch released too soon.
- **Judging a flight on the server.** For projectiles with a flight time, share the path function (`arrowPoint`-style) and step along it on the server against where targets are at each instant; stop at the first thing touched (targets, obstacles, ground). Compute what is already known (obstacles) when the shot is fired, so phones can draw the end at once.
- **Players and spectators share a screen**: derive `isPlayer` from the view; spectators get no input.

---

## 6. Testing pattern

- **Engine test** (no sockets): create the engine with short durations, drive it with `init` / `reduce` / `tick`, assert rules, edge cases (early/late actions, bad input, leaving, ties, end conditions). Fast, deterministic where possible.
- **Network test**: the in-process server (`createGameServer` with shortened timings and a fake `onRound`), guests over real websockets, the full flow to the results screen. This is what catches wiring mistakes (whitelist, registration, timers, overtime). Run with `--env-file=.env`.
- Tests that close a connection to mean "leave" pass `reconnectGraceMs: 0`. Tests that need Random to land somewhere use `forceRandom`.
- After changing anything shared (a room rule, a standard block), **run the whole server suite** (every `scripts/test-*.ts`), then the web typecheck and a build.
- Use separate ports for any dev servers and previews; never kill the user's own servers.

---

## 7. How to work (the process that has worked)

1. **Read the request for rules, then list the decisions it leaves open.** Ask only about genuine choices the user must make; pick sensible defaults for the rest and say what you picked. Flag any rule that conflicts with a standard block (for example a game that can run past its clock).
2. **Shared first** (types, constants, shared geometry), so server and phones agree by construction.
3. **Engine + engine test**, run until green, before any 3D work.
4. **Register and wire** (rooms, whitelist, lobby page) and write the **network test** early: it proves the whole path with no graphics.
5. **Scene next**, with a **temporary staging page** (a standalone page under `apps/web` driving the scene, ideally with the real engine and bot players) so you can look at it in the browser at landscape and portrait sizes and tune it. Take screenshots, look at them, fix what is wrong.
6. **Screen and HUD**, then the **tile picture** (preview page, models only), then docs.
7. **Update the docs in the same change**: the game's section in `GAME_RULES.md`, and this guide if a standard block changed.
8. **Keep temporary harness pages until the user says to delete them**, then delete them (and stop their servers) and confirm `git status` shows only intended files.
9. **Report honestly**: what was verified (and how), what was not (for example "not played on a real phone"), and what is first-guess tuning. Offer the staged preview link.

Standing preferences from the user: no git commands unless explicitly asked; no emojis in the UI; host-only features hidden from non-hosts; show staged previews when asked; small iterative changes driven by sketches and screenshots; keep `BLUEPRINT.md` untouched; the user will make fine tuning requests themselves, so a first draft should be working and complete rather than polished.

---

## 8. Traps (all learned the hard way)

- **The action whitelist in `sockets.ts`** drops unknown action types silently. Add new ones there.
- **A comment placed mid-line swallows the rest of the line.** Put trailing comments at the very end of a statement line.
- **Stale timers.** Room timers carry the `endsAt` they were made for and are ignored if it no longer matches; keep that guard in anything you add.
- **Don't evaluate randomness inside a filter predicate** (it re-rolls for every element); pick once, then filter.
- **Engines may mutate state in place**; make `view()` copy anything the phones keep, and make `removePlayer` release every hold.
- **Decide with the event's own time**, not the tick's time, or results depend on the tick rate.
- **Everything the player needs must fit the narrowest phone**; a wide scene needs the field of view to follow the aspect ratio, and name tags must not collide.
- **A standard block you bypass will drift.** If a game needs something the blocks do not offer (a longer opening, an overtime, a different camera), extend the block through its hook (`introSeconds`, `finishSeconds`, `holdOpen`) and document it, instead of special-casing the room.
- **Heavy work belongs in the scene's constructor (or its first frames), not in something that happens later.** The loading step waits until each phone's scene is built and drawing smoothly, under the loading page; work that only starts later (when the round's clock starts, when a thing first comes into view) lands in the game's first seconds again, on a slow phone as a freeze.
- **The round's clock MOVES after the round is created** (GAME_RULES.md #8: the round is made when the loading step begins, with a provisional clock, and moved when every phone is ready). Two things follow. (1) Keep every time in the engine's state as an absolute server time in milliseconds computed from the `now` that `init` was given (`startsAt`, `endsAt`, a spawn's `at`, a `clock`): `shiftTimes` moves exactly the numbers that look like clock readings (above 1e12), so a time kept in seconds, as a `Date`, or as a number relative to something else is NOT moved and breaks the game. Add the new engine to `scripts/test-pending.ts`: it checks that shifting equals a later `init` for every game, and fails if the engine keeps a time some other way. (2) A scene lives on across the move, so never let it keep its own copy of `game.startsAt` (or `endsAt`): a function given to the scene in a mount-once effect must read it through `useLatest(game)` (see `introFactor` in any screen), and a scene must read times from the newest view. The screen's React `key` is `room.roundId`, not `startsAt`, so the scene is not rebuilt when the time moves.
- **Defaults changed elsewhere can break tests** (for example what a new room starts with): after changing a room default, search the tests for the old assumption.
