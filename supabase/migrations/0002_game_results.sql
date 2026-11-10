-- MVP 4: one row per decided round. Run ONCE in Supabase Dashboard -> SQL Editor.
-- Rooms live in server memory, so we store the room CODE as plain text rather than a foreign key.

create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  game_type text not null,
  -- Set only when an account won. Guests never have a profile, so it stays null.
  winner_profile_id uuid references public.profiles (id) on delete set null,
  winner_name text not null,          -- name snapshot: history still reads well for guests
  is_guest boolean not null,
  is_tiebreaker boolean not null default false,  -- used from MVP 5
  played_at timestamptz not null default now()
);

alter table public.game_results enable row level security;

-- Anyone may READ results (leaderboard/history). No insert/update/delete policy exists, so no
-- browser can write; only the server, whose secret key bypasses RLS, can.
create policy "results are publicly readable" on public.game_results
  for select to anon, authenticated using (true);

create index game_results_played_at_idx on public.game_results (played_at desc);
