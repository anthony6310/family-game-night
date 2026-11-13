-- Sessions no longer have a fixed, odd number of rounds: they last until the host ends them (or the room empties).
-- total_rounds now stores how many rounds were actually played. Run ONCE in Supabase Dashboard -> SQL Editor.

alter table public.session_results drop constraint if exists session_results_total_rounds_check;
alter table public.session_results add constraint session_results_total_rounds_check check (total_rounds > 0);
