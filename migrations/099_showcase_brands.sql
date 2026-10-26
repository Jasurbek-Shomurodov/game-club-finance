-- Brand page: one public page for an owner's chain of clubs ("Pixel Gaming"),
-- with a tab per club. It lists only the published showcases (098) of active
-- clubs the brand's owner owns, so no one can attach another owner's club or
-- show a club that has not been published.

create table if not exists public.showcase_brands (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  tagline text,
  hero_image_url text,
  telegram_url text,
  instagram_url text,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint showcase_brands_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  constraint showcase_brands_slug_key unique (slug),
  constraint showcase_brands_name_not_blank check (btrim(name) <> '')
);

comment on table public.showcase_brands is
  'Public brand page of one owner; read anonymously only through get_public_brand.';

drop trigger if exists trg_touch_showcase_brand on public.showcase_brands;
create trigger trg_touch_showcase_brand
  before update on public.showcase_brands
  for each row execute function public.touch_club_showcase();

alter table public.showcase_brands enable row level security;

drop policy if exists "own_showcase_brand" on public.showcase_brands;
create policy "own_showcase_brand" on public.showcase_brands
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

revoke all on public.showcase_brands from anon;
grant select, insert, update, delete on public.showcase_brands to authenticated;

-- One published club's public payload; shared by both public RPCs.
create or replace function public.public_showcase_payload(p_club_id uuid)
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
  where showcase.club_id = p_club_id
    and showcase.is_published
    and clubs.is_active;
$$;

revoke all on function public.public_showcase_payload(uuid) from public, anon, authenticated;

create or replace function public.get_public_showcase(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.public_showcase_payload(showcase.club_id)
  from public.club_showcases showcase
  where showcase.slug = lower(btrim(p_slug));
$$;

revoke all on function public.get_public_showcase(text) from public;
grant execute on function public.get_public_showcase(text) to anon, authenticated;

-- Anonymous read of one published brand page with its published clubs in
-- club creation order. Null when the slug is unknown or the page is hidden.
create or replace function public.get_public_brand(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', brand.slug,
    'name', brand.name,
    'tagline', brand.tagline,
    'hero_image_url', brand.hero_image_url,
    'telegram_url', brand.telegram_url,
    'instagram_url', brand.instagram_url,
    'clubs', coalesce((
      select jsonb_agg(public.public_showcase_payload(clubs.id) order by clubs.created_at, clubs.id)
      from public.clubs clubs
      join public.club_showcases showcase on showcase.club_id = clubs.id and showcase.is_published
      join public.club_memberships memberships
        on memberships.club_id = clubs.id
       and memberships.user_id = brand.owner_id
       and memberships.role = 'owner'
      where clubs.is_active
    ), '[]'::jsonb)
  )
  from public.showcase_brands brand
  where brand.slug = lower(btrim(p_slug))
    and brand.is_published;
$$;

revoke all on function public.get_public_brand(text) from public;
grant execute on function public.get_public_brand(text) to anon, authenticated;
