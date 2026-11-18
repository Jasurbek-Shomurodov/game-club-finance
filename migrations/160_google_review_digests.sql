-- Daily Google Maps review image for each club's Telegram group.
--
-- After /api/cron/google-review-replies (152) replies to new reviews, it sends
-- each club with a Telegram group an "AI bot" image: rating, review count and
-- every reply it posted. One row per club and Tashkent date. The row is
-- inserted before the send, so a timed-out or repeated run never sends the
-- same day twice. It also keeps the day's rating and review count, which the
-- next day's image compares against.
--
-- Like google_review_replies, browser roles get nothing; only the cron route
-- (service role) reads and writes it. Re-runnable.

create table if not exists public.google_review_digests (
  club_id uuid not null references public.clubs(id) on delete cascade,
  digest_date date not null,
  average_rating numeric(3, 2),
  total_review_count integer,
  replied integer not null default 0,
  failed integer not null default 0,
  remaining integer not null default 0,
  error text,
  results jsonb not null default '[]'::jsonb,
  telegram_chat_id text not null,
  send_attempted_at timestamptz not null default now(),
  telegram_message_id bigint,
  sent_at timestamptz,
  send_error text,
  primary key (club_id, digest_date),
  constraint google_review_digests_rating_range
    check (average_rating is null or average_rating between 0 and 5),
  constraint google_review_digests_counts_not_negative
    check (replied >= 0 and failed >= 0 and remaining >= 0 and (total_review_count is null or total_review_count >= 0)),
  constraint google_review_digests_results_array
    check (jsonb_typeof(results) = 'array')
);

alter table public.google_review_digests enable row level security;

revoke all on table public.google_review_digests
  from public, anon, authenticated;
grant select, insert, update, delete on table public.google_review_digests
  to service_role;
