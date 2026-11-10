-- MVP 5: one row per completed session (the "winner of the day" record).
-- Run ONCE in Supabase Dashboard -> SQL Editor.

create table public.session_results (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  -- Set only when an account won. Guests never have a profile, so it stays null.
  winner_profile_id uuid references public.profiles (id) on delete set null,
  winner_name text not null,           -- name snapshot: history still reads well for guests
  is_guest boolean not null,
  winner_wins integer not null check (winner_wins >= 0),  -- rounds the winner won (a tie-breaker win counts)
  total_rounds integer not null check (total_rounds > 0 and total_rounds % 2 = 1),  -- host's choice; always odd
  tiebreaker_rounds integer not null default 0 check (tiebreaker_rounds >= 0),
  finished_at timestamptz not null default now()
);

alter table public.session_results enable row level security;

-- Anyone may READ the history. With no insert/update/delete policy, only the server
-- (secret key, which bypasses RLS) can write.
create policy "session history is publicly readable" on public.session_results
  for select to anon, authenticated using (true);

create index session_results_finished_at_idx on public.session_results (finished_at desc);
