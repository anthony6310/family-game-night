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
4. **Room lobby** → everyone sees who's in. The **host (party leader)** picks the **session length** (3, 5 or 7 rounds; configurable by you in code) and a game from the menu.
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
| `rooms` | `id`, `code` (unique), `host_id`, `total_rounds`, `status` (`lobby/playing/finished/closed`), `created_at` | A play session container |
| `room_players` | `room_id`, `profile_id` (nullable for guests), `joined_at`, `wins` | Membership and per-session points. *May stay in server memory only (see below)* |
| `game_results` | `id`, `room_id`, `game_type`, `winner_profile_id` (nullable), `winner_name`, `is_guest`, `played_at` | One row per round |
| `session_results` | `id`, `room_id`, `winner_profile_id` (nullable), `winner_name`, `is_guest`, `winner_wins`, `total_rounds`, `finished_at` | **Daily record**: one row per completed session |

**Guest rule:** guests never get a `profiles` row or a Supabase user. Result tables store a `winner_name` snapshot (so history still reads well) plus `winner_profile_id` only for real accounts.

**Round options** live in `packages/shared/config.ts`, e.g. `ROUND_OPTIONS = [3, 5, 7]`. Adding or removing options is a one-line change. The server validates the host's pick against this list and the DB `total_rounds` check should be odd and positive.

**Tie-breaker rule:** after the final scheduled round, if 2+ players share the top score, the server runs **tie-breaker rounds** with only the tied players, repeating until one player leads. Odd round counts stay (they fully avoid ties in 2-player rooms). Tie-breakers are not counted in `total_rounds`; `session_results` gets a `tiebreaker_rounds` int (default 0), and tie-breaker rounds are saved in `game_results` with `is_tiebreaker = true`. Players not in the tie spectate.

**Player cap:** `MAX_PLAYERS = 8` in `packages/shared/config.ts`, enforced by the server on join (the lobby also shows "room full"). Games must work for 2–8 players, so UI (scoreboard, lobby, tap counts) must fit 8 entries on a phone screen.

Storage: `avatars` bucket, with files at `avatars/{user_id}/...`.

**RLS rules (draft)**
- `profiles`: anyone authenticated can **read**; a user can **insert/update only their own** row (`auth.uid() = id`).
- `avatar_presets`: read-only for all authenticated users; only you can write (via migration/dashboard).
- `rooms` / `room_players`: live room state is held by the Socket.io server (guests have no DB identity), so these tables are mainly for history. Only the server writes them.
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

**Game plugin interface (draft):** `{ id, name, minPlayers, init(players), reduce(state, action), isOver(state), getWinner(state) }`. Adding a game later = adding one file implementing this.

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
- [ ] 3.1 Shared `Game` interface, game registry and `ROUND_OPTIONS` config
- [ ] 3.2 Host picks session length (3/5/7) and a game; all players see both
- [ ] 3.3 Ready toggle per player; the server starts a synced countdown when all are ready
- [ ] 3.4 Edge cases: a player un-readies or leaves mid-countdown, so cancel
- **Done when:** countdown starts only when everyone is ready and is in sync across phones.

### MVP 4 — Tap Race (proof of concept) & Scoring
- [ ] 4.1 Bare-bones **Tap Race**: on "Go", players tap a big button as fast as they can for a fixed time (e.g. 10s, or first to N taps); most taps wins. No theme or art yet.
- [ ] 4.2 Server counts taps (authoritative) and decides the round winner
- [ ] 4.3 Winner screen, then +1 point on the room scoreboard
- [ ] 4.4 Persist each round to `game_results`
- **Done when:** a full round plays end-to-end and the winner's point shows on every phone.

### MVP 5 — Session Loop & Winner Record
- [ ] 5.1 Track round count against the host's chosen `total_rounds`; return to the lobby between rounds
- [ ] 5.2 After the final round, crown the session winner; if tied, run tie-breaker rounds among the tied players only (spectators watch)
- [ ] 5.3 Host chooses **Reset room** or **Close room**
- [ ] 5.4 Write `session_results` (guest winners stored by name only)
- [ ] 5.5 History page showing past session winners
- **Done when:** a 3-round session ends with a crowned winner and a new `session_results` row, for both account and guest winners; a forced 3-way tie resolves via tie-breaker rounds.

### MVP 6 — Polish, Games & Deploy *(stretch)*
- [ ] 6.1 Additional games via the plugin interface
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
