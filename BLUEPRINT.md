# Family Fun Game — BLUEPRINT

> Shared source of truth and roadmap. Status: **DRAFT v0.4** (tie-breaker rounds, 8-player cap).
> Primary goal: hands-on learning of how every layer connects.
> Convention: check off `[x]` a milestone only after its "Done when" passes.

---

## 0. Product Vision

A site where family members create accounts, join a shared room from their **phones**, and play quick games together. Mobile-first UI.

**User flow**
1. **Landing page** → two options: *Play now* and *Log in*.
2. **Two ways in:**
   - **Account:** email + password, **email confirmation required**. Then pick an avatar (preset list *or* upload). Profile and history persist.
   - **Guest** (*Play now*): enter a display name and go. **No profile or personal data is stored.** The only trace a guest leaves in the DB is their name on a winner record.
3. **Play** → creates a room with an **invite code**. Others join by code, as account users or guests.
4. **Room lobby**, in two steps. **Step 1:** the **host** picks the **session length** (3, 5 or 7 rounds; configurable in code) and confirms with *Let's play!*. This happens **once per session**: the question doesn't come back until the session is over and the host chooses *Play again* (or *Start over*). **Step 2:** the host picks a game from the menu (the game can change from round to round).
5. **Ready-up** → all players see the selected game and tap Ready. When all are ready → **countdown** → game starts.
6. **Round ends** → winner is shown, winner gets **+1 point**. Room scoreboard updates.
7. Repeat until the chosen number of rounds is played. The room crowns the **session winner**, and the host can **reset** or **close** the room.
8. Each completed session's winner is **logged to the database** (name snapshot, plus account id when not a guest).

## 1. Tech Stack Overview

| Layer | Choice | Why (learning note) |
|---|---|---|
| Frontend | React + Vite + TypeScript | Component model; fast dev loop; mobile-friendly |
| Auth / DB / Storage | Supabase | Email confirmation, Postgres, RLS and avatar storage with no CRUD API to write |
| Realtime | Node + Socket.io | Live rooms, ready-up, countdown and game state |
| Layout | Monorepo (npm workspaces) | Shared types and event names across client and server |
| HTTPS | Host-provided (e.g. Vercel/Netlify + Render/Fly) | Free TLS, so no cert wrangling. Supabase is HTTPS by default |

**Do we need our own backend?** Mostly no for accounts, profiles and history (Supabase covers them). But a small Node server is still worth having for **authoritative game state, countdowns and scoring**, which shouldn't live in a phone that could cheat or disconnect. This is also the best way to learn WebSockets.

**Layout**

```
family-game-night/
├── apps/
│   ├── web/        # React client (landing, auth, profile, room, games)
│   └── server/     # Node + Socket.io (rooms, readiness, game engine)
├── packages/
│   └── shared/     # TS types, socket event names, game interface
├── supabase/       # SQL migrations, RLS policies, seed (avatar presets)
└── BLUEPRINT.md
```

## 2. Database Schema & RLS (draft)

| Table | Key columns | Purpose |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `display_name`, `avatar_url` (preset path or uploaded image URL), `created_at` | Public-facing player identity |
| `avatar_presets` | `id`, `label`, `image_url` | Your provided image list (seeded) |
| `game_results` | `id`, `room_code`, `game_type`, `winner_profile_id` (nullable), `winner_name`, `is_guest`, `is_tiebreaker`, `played_at` | One row per decided round. Rooms live in server memory, so there are no `rooms`/`room_players` tables; `room_code` is plain text |
| `session_results` | `id`, `room_code`, `winner_profile_id` (nullable), `winner_name`, `is_guest`, `winner_wins`, `total_rounds`, `tiebreaker_rounds`, `finished_at` | **Daily record**: one row per completed session |

**Guest rule:** guests never get a `profiles` row or a Supabase user. Result tables store a `winner_name` snapshot (so history still reads well) plus `winner_profile_id` only for real accounts.

**Round options** live in `packages/shared/config.ts`, e.g. `ROUND_OPTIONS = [3, 5, 7]`. Adding or removing options is a one-line change. The server validates the host's pick against this list and the DB `total_rounds` check should be odd and positive.

**Tie-breaker rule:** after the final scheduled round, if 2+ players share the top score, the server runs **tie-breaker rounds** with only the tied players, repeating until one player leads. Odd round counts stay (they fully avoid ties in 2-player rooms). Tie-breakers are not counted in `total_rounds`; `session_results` gets a `tiebreaker_rounds` int (default 0), and tie-breaker rounds are saved in `game_results` with `is_tiebreaker = true`. Players not in the tie spectate.

**Player cap:** `MAX_PLAYERS = 8` in `packages/shared/config.ts`, enforced by the server on join (the lobby also shows "room full"). Games must work for 2–8 players, so UI (scoreboard, lobby, tap counts) must fit 8 entries on a phone screen.

Storage: `avatars` bucket, with files at `avatars/{user_id}/...`.

**RLS rules (draft)**
- `profiles`: anyone authenticated can **read**; a user can **insert/update only their own** row (`auth.uid() = id`).
- `avatar_presets`: read-only for all authenticated users; only you can write (via migration/dashboard).
- Live room state (rooms, players, scores) is held by the Socket.io server, since guests have no DB identity. There are no `rooms` tables.
- `game_results` / `session_results`: readable by anyone (leaderboard/history); **written only by the server** with the service-role key. No client, guest or account, can write scores.
- Storage `avatars`: a user can write only inside their own folder; reads are public.

**Design note:** scores live in server memory during a session and are written to the DB as each round and the session end.

## 3. System Architecture & Component Mapping

```
 Phone (React) ──HTTPS──▶ Supabase ── Auth (email confirm), Postgres+RLS, Storage
      │                        ▲
      └──WSS (JWT)──▶ Node/Socket.io ──service role──┘  (writes results)
```

- **Supabase** owns identity, profiles, avatars and permanent history.
- **Socket.io server** owns *live* state: rooms, who's connected, ready flags, countdown, current game, scores.
  - Handshake accepts **either** a Supabase JWT (account) **or** a guest display name, for which the server mints an ephemeral in-memory player id. Nothing is stored for guests.
  - Room lives in memory while active; results saved to Postgres when games and sessions end.
- **Shared package** defines the event contract and the `Game` interface so client and server can't drift.

**Component map (draft)**

| Screen / unit | Talks to |
|---|---|
| Landing | static |
| Auth (login/signup/confirm) | Supabase Auth |
| Profile setup | Supabase DB + Storage |
| Room (lobby, scoreboard, ready-up, countdown) | Socket.io |
| Game screen (plugin per game) | Socket.io |
| History / leaderboard | Supabase DB |

**Core socket events (draft):** `room:create`, `room:join`, `room:state`, `room:leave`, `game:select`, `player:ready`, `game:countdown`, `game:start`, `game:action`, `game:end`, `session:end`, `room:reset`, `room:close`.

**Game plugin interface:** a pure engine `{ id, init, reduce, tick?, isOver, getWinner, scores, removePlayer, view }` (see `apps/server/src/games/types.ts`). `tick` is optional: games with continuous movement (Snowball) get a server game loop; turn-based games (Tap Race) omit it. Adding a game = one engine file, one entry in `GAMES`, and one phone screen.

## 4. Execution Plan (MVP-first)

Each milestone is small, testable, and leaves the app working.

### MVP 0 — Foundations
- [x] 0.1 Monorepo scaffold (npm workspaces, TS, Prettier; ESLint deferred)
- [x] 0.2 `apps/web` shows a landing page shell; `apps/server` serves `/health`
- [x] 0.3 Supabase project created; env vars wired (secrets never committed)
- **Done when:** one command starts both apps and web can reach the server's `/health`.

### MVP 1 — Landing, Auth, Guest & Profile
- [x] 1.1 Landing page with *Play now* / *Log in* (mobile-first)
- [x] 1.2 Sign up / log in / log out with **email confirmation** enforced
- [x] 1.3 `profiles` table + auto-create trigger; RLS tested with two users
- [x] 1.4 Profile setup: choose a preset avatar **or** upload one (Storage + bucket policy)
- [x] 1.5 Guest entry: *Play now* collects a display name only (no DB writes)
- **Done when:** a new user confirms email, picks an avatar and reaches Play; a guest reaches Play with just a name; user B cannot edit user A's profile.

### MVP 2 — Rooms, Invite Codes & Lobby
- [x] 2.1 Socket.io server; handshake accepts a Supabase JWT **or** a guest name
- [x] 2.2 *Play* creates a room with a short invite code; host is the first player
- [x] 2.3 Join by code (account or guest)
- [x] 2.4 Live lobby: avatars and names update as players join, leave or disconnect
- [x] 2.5 Host handling: host leaves, so host is reassigned
- [x] 2.6 Enforce the 8-player cap ("room full")
- **Done when:** 3 phones (mix of account and guest) join one room and all see the same player list in real time; a 9th join is rejected.

### MVP 3 — Session Setup, Ready-up & Countdown
- [x] 3.1 Shared game registry (`GAMES` info: name, min/max players) and `ROUND_OPTIONS` config. The game *engine* interface is designed in MVP 4 alongside Tap Race
- [x] 3.2 Two-step room setup: the host first confirms the session length (3/5/7) with *Let's play!* (once per session; enforced by the server via `session:start`), and only then picks a game. Resetting after a session brings the rounds question back
- [x] 3.3 Ready toggle per player; the server starts a synced countdown when all are ready
- [x] 3.4 Edge cases: the countdown cancels whenever the start conditions stop holding (someone un-readies, an unready player joins, the host changes settings, or players drop below the minimum). A ready player leaving does not cancel it if enough ready players remain
- **Done when:** countdown starts only when everyone is ready and is in sync across phones.

### MVP 4 — Tap Race (proof of concept) & Scoring
- [x] 4.1 Bare-bones **Tap Race**: after the countdown, players tap a big button for 10s (`TAP_RACE_SECONDS`); most taps wins; a tie for most (or nobody tapping) is a draw with no point. Pure game engine in `apps/server/src/games/`. No theme or art yet.
- [x] 4.2 Server counts taps (authoritative: server clock window, per-player tap-rate limit) and decides the round winner
- [x] 4.3 Winner screen, then +1 point on the room scoreboard
- [x] 4.4 Persist each decided round to `game_results` (verified by `npm run test:results -w @fgn/server`). Draws are not saved
- **Done when:** a full round plays end-to-end and the winner's point shows on every phone.

### MVP 5 — Session Loop & Winner Record
- [x] 5.1 Track round count against the host's chosen `total_rounds` (a drawn round is replayed and doesn't count); results move on by themselves back to the lobby between rounds; the session length locks after the first round
- [x] 5.2 After the final round, crown the session winner; if tied, run tie-breaker rounds among the tied players only (spectators watch)
- [x] 5.3 Host chooses **Reset room** or **Close room**
- [x] 5.4 Write `session_results` (guest winners stored by name only; verified by `npm run test:history -w @fgn/server`)
- [x] 5.5 History page showing past session winners (`/history`)
- **Done when:** a 3-round session ends with a crowned winner and a new `session_results` row, for both account and guest winners; a forced 3-way tie resolves via tie-breaker rounds.

### MVP 6 — Polish, Games & Deploy *(stretch)*
- [ ] 6.1 Additional games via the plugin interface *(ongoing: more games will follow; the rest of MVP 6 is parked for now)*
  - [x] Tap Race (MVP 4)
  - [ ] **Snowball** (three.js). Roll, grow by distance rolled, bigger balls steal snow from smaller ones on hard hits; biggest ball after 60 s wins. Solid circular wall, rebounds off balls and walls, 0.2 s immunity after a hit, plain white low-poly balls, a single snow *texture* for the ground (no snow geometry).
    - [x] Engine tick support (`tick` on the game engine, a server game loop at 40 Hz, volatile `game:view` snapshots at 20 Hz)
    - [x] Snowball engine and tests (`test:snowball`, `test:snowball-net`); all tuning numbers in one `SnowballConfig`
    - [x] three.js scene (`SnowballScene`) with keyboard steering
    - [x] Touch joystick, HUD (timer, live sizes), name tags and colours, spectator view
    - [x] Round 2 changes: size-relative player rebounds (stronger) and weaker wall bounces; damage scaled by impact speed; bigger arena (radius 45) with a big hill, small hill and ditch from one shared height function (`packages/shared/src/terrain.ts`); uphill slows to 90% (ramps over 1.5 s), downhill speeds to 130% (ramps over 3 s); a profile avatar is tiled over the ball as its texture (white if none)
    - [x] Round 3 changes: base speed +30% (7.8); hills now hand out flat speed *stacks* (uphill: 10 slow stacks, floor 90%, full after 1.5 s; downhill: 15 boost stacks, ceiling 130%, full after 3 s) that share a 0.3 s lifetime, refreshed while you stay on the slope, so you return to normal speed on flat ground; size no longer slows top speed or acceleration (kept as `speedFalloff` / `accelFalloff`, both 0); permanent speed gauge on the HUD (current speed, current top speed, slow/boost chip with stack count)
    - [x] Round 4 changes: base speed 9; flat damage in size points (a ball's size is its radius × 100, the number on screen), dealt by both balls (5 per hit, 10 from the single biggest ball, immunity 0.2 s, no speed scaling and no percentages); small ball buff (the smaller ball of a hit gets +30% top speed for 2 s, stacking with hills up to 160%); random terrain every round (one big hill, one small hill, one ditch at random spots, never moving mid-round, spawn points always flat); gauge chips for 👑 Biggest, ⚡ Escape and hills
    - [x] Round 5 changes: the map grows with the player count (arena area proportional to players: radius 45 at 2 players, ~64 at 4, 90 at 8) and every additional player adds one more hill or ditch of a random type on top of the base big hill, small hill and ditch (players + 1 features in total); hills and ditches are at their base size (radius 22 / 12 / 10) for 1-2 players and every additional player adds a fixed +2 to each one's radius
    - [x] Round 6 changes: speed gauge and its chips removed from the HUD (the 👑 next to the biggest player's name in the standings stays); base speed 11
    - [x] Round 7 changes: a small flat 2D gold crown (billboard sprite, bobbing) floats above the single biggest ball
    - [ ] Tuning from playtests on real phones (speed, growth, damage, hills, camera, map size)
- [ ] 6.2 Reconnection (phone sleeps or loses signal), error and empty states
- [ ] 6.3 Deploy over HTTPS (web, Node server, Supabase prod)

## 5. Working Agreements

- Explain key architectural decisions concisely as we go.
- Clean, well-commented code (core logic, not the obvious).
- Check off milestones here before starting the next one.
- You handle git and deployment yourself.

## 6. Open Questions

**Decided:** guests supported (no persistence) · TypeScript · Tap Race as the first game · host picks 3/5/7 rounds, configurable in code · tie-breaker rounds among tied players (odd round counts kept) · max 8 players per room · npm (not pnpm).

- [ ] Tap Race tie-breaker edge case: if a tie-breaker round itself ties on taps, just replay it (assumed).
- [ ] Hosting targets for the Node server (Render, Fly, Railway)?
