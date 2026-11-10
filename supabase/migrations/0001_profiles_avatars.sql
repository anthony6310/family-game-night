-- MVP 1: profiles, avatar presets, avatar storage. Run ONCE in Supabase Dashboard -> SQL Editor.
-- Guests never appear here: only real accounts get a profile.

-- ===== profiles: one row per account, same id as auth.users =====
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 20),
  avatar_url text,            -- preset image path OR public URL of an uploaded image
  created_at timestamptz not null default now()
);

-- RLS is deny-by-default once enabled: with no policy, nobody can do anything.
alter table public.profiles enable row level security;

-- (select auth.uid()) instead of auth.uid(): Postgres evaluates it once per query, not per row.
create policy "signed-in users can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "users insert only their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "users update only their own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- No delete policy on purpose: profiles go away only when the auth user is deleted (cascade).

-- ===== auto-create an empty profile whenever someone signs up =====
-- SECURITY DEFINER runs with the function owner's rights, so it can write to profiles
-- even though the brand-new user has no session yet. Empty search_path avoids hijacking.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== avatar presets: the curated image list (read-only for clients) =====
create table public.avatar_presets (
  id serial primary key,
  label text not null,
  image_url text not null
);
alter table public.avatar_presets enable row level security;
create policy "signed-in users can read presets" on public.avatar_presets
  for select to authenticated using (true);

-- Placeholder presets. Replace the files in apps/web/public/avatars/ with your own images.
insert into public.avatar_presets (label, image_url) values
  ('Fox', '/avatars/fox.svg'), ('Panda', '/avatars/panda.svg'),
  ('Frog', '/avatars/frog.svg'), ('Robot', '/avatars/robot.svg'),
  ('Cat', '/avatars/cat.svg'), ('Owl', '/avatars/owl.svg'),
  ('Octopus', '/avatars/octopus.svg'), ('Unicorn', '/avatars/unicorn.svg');

-- ===== avatar storage: public bucket, 2 MB, images only =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

-- Files live at avatars/<user_id>/...; the first folder name must equal the uploader's id.
create policy "avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "users upload into their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users replace files in their own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users delete files in their own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
