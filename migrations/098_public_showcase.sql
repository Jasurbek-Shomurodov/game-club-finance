-- Public club showcase: a page anyone can open at /club/<slug> that shows the
-- club's games (with cover images) and its computer zones (with hardware
-- specs and hourly price). Owners edit it from /showcase.
--
-- The tables are owner-only for application roles. Anonymous visitors never
-- read them directly: get_public_showcase(slug) returns only published,
-- presentation-safe fields, so no finance or membership data is reachable.
-- Images live in the public "showcase" storage bucket under <club_id>/...;
-- only an owner of that club may write there.

create table if not exists public.club_showcases (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  slug text not null,
  is_published boolean not null default false,
  headline text,
  tagline text,
  hero_image_url text,
  address text,
  phone text,
  opening_hours text,
  telegram_url text,
  instagram_url text,
  updated_at timestamptz not null default now(),
  constraint club_showcases_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  constraint club_showcases_slug_key unique (slug)
);

comment on table public.club_showcases is
  'Public landing page settings of one club; read anonymously only through get_public_showcase.';

create table if not exists public.showcase_games (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  genre text,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint showcase_games_title_not_blank check (btrim(title) <> '')
);

create index if not exists idx_showcase_games_club_order
  on public.showcase_games (club_id, sort_order, created_at);

create table if not exists public.showcase_pc_zones (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  pc_count integer not null default 1,
  cpu text,
  gpu text,
  ram text,
  monitor text,
  peripherals text,
  price_per_hour numeric,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint showcase_pc_zones_name_not_blank check (btrim(name) <> ''),
  constraint showcase_pc_zones_pc_count_positive check (pc_count > 0),
  constraint showcase_pc_zones_price_non_negative check (price_per_hour is null or price_per_hour >= 0)
);

create index if not exists idx_showcase_pc_zones_club_order
  on public.showcase_pc_zones (club_id, sort_order, created_at);

create or replace function public.touch_club_showcase()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_club_showcase on public.club_showcases;
create trigger trg_touch_club_showcase
  before update on public.club_showcases
  for each row execute function public.touch_club_showcase();

alter table public.club_showcases enable row level security;
alter table public.showcase_games enable row level security;
alter table public.showcase_pc_zones enable row level security;

drop policy if exists "club_owner_all_club_showcases" on public.club_showcases;
create policy "club_owner_all_club_showcases" on public.club_showcases
  for all to authenticated
  using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

drop policy if exists "club_owner_all_showcase_games" on public.showcase_games;
create policy "club_owner_all_showcase_games" on public.showcase_games
  for all to authenticated
  using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

drop policy if exists "club_owner_all_showcase_pc_zones" on public.showcase_pc_zones;
create policy "club_owner_all_showcase_pc_zones" on public.showcase_pc_zones
  for all to authenticated
  using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

revoke all on public.club_showcases, public.showcase_games, public.showcase_pc_zones from anon;
grant select, insert, update, delete on public.club_showcases, public.showcase_games, public.showcase_pc_zones to authenticated;

-- Anonymous read of one published showcase. Returns null when the slug is
-- unknown or the page is not published.
create or replace function public.get_public_showcase(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'club_name', clubs.name,
    'slug', showcase.slug,
    'headline', showcase.headline,
    'tagline', showcase.tagline,
    'hero_image_url', showcase.hero_image_url,
    'address', coalesce(showcase.address, clubs.address),
    'phone', showcase.phone,
    'opening_hours', showcase.opening_hours,
    'telegram_url', showcase.telegram_url,
    'instagram_url', showcase.instagram_url,
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', games.id, 'title', games.title, 'genre', games.genre, 'image_url', games.image_url
      ) order by games.sort_order, games.created_at)
      from public.showcase_games games
      where games.club_id = showcase.club_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', zones.id, 'name', zones.name, 'pc_count', zones.pc_count,
        'cpu', zones.cpu, 'gpu', zones.gpu, 'ram', zones.ram, 'monitor', zones.monitor,
        'peripherals', zones.peripherals, 'price_per_hour', zones.price_per_hour,
        'image_url', zones.image_url
      ) order by zones.sort_order, zones.created_at)
      from public.showcase_pc_zones zones
      where zones.club_id = showcase.club_id
    ), '[]'::jsonb)
  )
  from public.club_showcases showcase
  join public.clubs clubs on clubs.id = showcase.club_id
  where showcase.slug = lower(btrim(p_slug))
    and showcase.is_published
    and clubs.is_active;
$$;

revoke all on function public.get_public_showcase(text) from public;
grant execute on function public.get_public_showcase(text) to anon, authenticated;

-- Supabase Storage: a public bucket for cover images. Skipped where the
-- storage schema does not exist (local PostgreSQL test databases).
do $storage$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('showcase', 'showcase', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "showcase_owner_insert" on storage.objects';
  execute $policy$
    create policy "showcase_owner_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid() and memberships.role = 'owner'
        )
      )
  $policy$;

  execute 'drop policy if exists "showcase_owner_update" on storage.objects';
  execute $policy$
    create policy "showcase_owner_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid() and memberships.role = 'owner'
        )
      )
  $policy$;

  execute 'drop policy if exists "showcase_owner_delete" on storage.objects';
  execute $policy$
    create policy "showcase_owner_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid() and memberships.role = 'owner'
        )
      )
  $policy$;
end;
$storage$;
