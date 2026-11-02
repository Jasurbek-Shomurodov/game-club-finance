-- Brand pages (099) gain a Telegram channel and group link, both optional.
-- telegram_url stays out of this: booking Telegram belongs to each club.
-- Re-runnable.

alter table public.showcase_brands
  add column if not exists telegram_channel_url text,
  add column if not exists telegram_group_url text;

-- Replaces 105's brand read; only the two Telegram links are new.
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
    'telegram_channel_url', brand.telegram_channel_url,
    'telegram_group_url', brand.telegram_group_url,
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
