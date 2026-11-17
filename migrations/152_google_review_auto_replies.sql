-- Daily automatic replies to Google Maps reviews.
--
-- Once a day Supabase Cron calls /api/cron/google-review-replies. For every
-- club with a connected listing and auto replies on, the server reads the
-- listing's reviews, writes a short reply to each review that has none yet and
-- posts it to Google. Each posted reply is recorded here so the admin app can
-- show what was said on the club's behalf.
--
-- Like google_business_connections (112), browser roles get nothing: the
-- server checks the caller's club access with their own client and reads this
-- table with the service client. Re-runnable.

alter table public.google_business_connections
  add column if not exists review_auto_reply boolean not null default true;

create table if not exists public.google_review_replies (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  review_name text not null,
  reviewer_name text,
  star_rating smallint,
  review_comment text,
  review_time timestamptz,
  reply_comment text not null,
  replied_at timestamptz not null default now(),
  constraint google_review_replies_review_name_format
    check (review_name ~ '^accounts/[0-9]+/locations/[0-9]+/reviews/[^/]+$'),
  constraint google_review_replies_star_rating_range
    check (star_rating is null or star_rating between 1 and 5),
  constraint google_review_replies_reply_not_blank
    check (length(btrim(reply_comment)) > 0)
);

create unique index if not exists google_review_replies_review_name_key
  on public.google_review_replies (review_name);
create index if not exists google_review_replies_club_replied_idx
  on public.google_review_replies (club_id, replied_at desc);

alter table public.google_review_replies enable row level security;

revoke all on table public.google_review_replies
  from public, anon, authenticated;
grant select, insert, update, delete on table public.google_review_replies
  to service_role;

-- Same Vault secret as the daily finance report (041): both routes check the
-- deployment's CRON_SECRET.
create or replace function public.invoke_game_club_google_review_replies()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'game_club_daily_report_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(btrim(cron_secret), '') is null then
    raise exception 'Missing Vault secret: game_club_daily_report_cron_secret';
  end if;

  select net.http_get(
    url := 'https://admin.pixelgaming.uz/api/cron/google-review-replies',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Accept', 'application/json',
      'User-Agent', 'Game-Club-Supabase-Cron/1.0'
    ),
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_game_club_google_review_replies()
  from public, anon, authenticated;

-- 05:00 UTC is 10:00 in Asia/Tashkent. Skipped where pg_cron is not installed
-- (local and test databases).
do $$
declare
  existing_job_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for existing_job_id in
    execute 'select jobid from cron.job where jobname = ''game-club-google-review-replies'''
  loop
    execute 'select cron.unschedule($1)' using existing_job_id;
  end loop;

  execute 'select cron.schedule($1, $2, $3)'
    using 'game-club-google-review-replies',
          '0 5 * * *',
          'select public.invoke_game_club_google_review_replies();';
end;
$$;
