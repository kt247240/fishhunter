-- FishHunter community catches ("みんなの釣果") — Supabase / Postgres schema.
-- Run once in Supabase: SQL Editor → paste → Run.
--
-- Privacy by design: only coarse, structured fields are shared
-- (one of the app's 37 public spots, species, size, count, method, time band).
-- No free text, no photos, no GPS, no account. Posts are anonymous and
-- identified only by a random per-device handle.

create table if not exists public.catch_posts (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  caught_at   timestamptz not null,
  spot_id     text not null check (spot_id ~ '^[a-z0-9-]{2,24}$'),
  species_id  text not null check (species_id ~ '^[a-z]{2,16}$'),
  size_cm     numeric(5,1) check (size_cm is null or (size_cm > 0 and size_cm <= 200)),
  count       smallint not null default 1 check (count between 1 and 300),
  method      text check (method is null or char_length(method) <= 20),
  lure_color  text check (lure_color is null or char_length(lure_color) <= 20),
  light       text check (light in ('朝マズメ','夕マズメ','日中','夜')),
  tide        text check (tide is null or tide in ('大潮','中潮','小潮','長潮','若潮')),
  handle      text not null check (handle ~ '^ANON-[0-9A-F]{4}$'),
  device      text not null check (char_length(device) between 16 and 64),
  hidden      boolean not null default false
);

create index if not exists catch_posts_recent on public.catch_posts (caught_at desc) where not hidden;
create index if not exists catch_posts_device on public.catch_posts (device, created_at desc);

-- Rate limit: at most 20 posts per device per 24 h.
create or replace function public.catch_posts_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.catch_posts
       where device = new.device and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate limit';
  end if;
  if new.caught_at > now() + interval '1 hour' or new.caught_at < now() - interval '14 days' then
    raise exception 'caught_at out of range';
  end if;
  new.hidden := false;          -- clients can never pre-hide or un-hide
  new.created_at := now();
  return new;
end $$;

drop trigger if exists catch_posts_rate_limit on public.catch_posts;
create trigger catch_posts_rate_limit before insert on public.catch_posts
  for each row execute function public.catch_posts_rate_limit();

-- Row Level Security: anonymous users may insert and read visible posts only.
alter table public.catch_posts enable row level security;

drop policy if exists "anon insert" on public.catch_posts;
create policy "anon insert" on public.catch_posts for insert to anon with check (true);

drop policy if exists "anon read visible" on public.catch_posts;
create policy "anon read visible" on public.catch_posts for select to anon
  using (not hidden and caught_at > now() - interval '30 days');

-- Never expose the device hash to readers.
revoke select on public.catch_posts from anon;
grant select (id, created_at, caught_at, spot_id, species_id, size_cm, count, method, lure_color, light, tide, handle)
  on public.catch_posts to anon;
grant insert (caught_at, spot_id, species_id, size_cm, count, method, lure_color, light, tide, handle, device)
  on public.catch_posts to anon;

-- Moderation (operator, in the Supabase dashboard): hide a post with
--   update public.catch_posts set hidden = true where id = <id>;
