-- Owners choose the order of clubs on the brand page (099): club_showcases
-- gains sort_order, lowest first; ties keep the previous order (club
-- creation date). Re-runnable.

alter table public.club_showcases
  add column if not exists sort_order integer not null default 0;

-- Replaces 104's brand read; only the club order changes.
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
    'translations', brand.translations,
    'hero_image_url', brand.hero_image_url,
    'phone', brand.phone,
    'email', brand.email,
    'opening_hours', brand.opening_hours,
    'telegram_url', brand.telegram_url,
    'instagram_url', brand.instagram_url,
    'youtube_url', brand.youtube_url,
    'clubs', coalesce((
      select jsonb_agg(public.public_showcase_payload(clubs.id) order by showcase.sort_order, clubs.created_at, clubs.id)
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
