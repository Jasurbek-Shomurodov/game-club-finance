-- Owner money bot, slice 2 (docs/plans/owner-money-bot.md): a limit on wrong
-- /link codes per Telegram account, so nobody can try code after code.
--
-- The webhook runs as a serverless function, so a counter in memory would
-- reset with every cold start and differ between instances; the count lives
-- here instead.
--
--   owner_bot_link_throttle: one row per Telegram account that sent /link:
--     the start of its current 15-minute window and the wrong codes (invalid,
--     used or expired) sent in it. Service role only; no browser role can
--     read or write it, so it has no policies.
--   owner_bot_redeem_link_code_limited(code, telegram id, username): service
--     role only; answers 'rate_limited' after 5 wrong codes in the window,
--     otherwise redeems through owner_bot_redeem_link_code (190) and counts a
--     wrong code. A new window starts 15 minutes after the previous one began.
--
-- Non-destructive: a new table, a new function and grants only. Rows are
-- inserted and updated by the function, never deleted. Re-runnable.

create table if not exists public.owner_bot_link_throttle (
  telegram_user_id bigint primary key,
  window_started_at timestamptz not null default now(),
  failures integer not null default 0,
  constraint owner_bot_link_throttle_telegram_user_positive check (telegram_user_id > 0),
  constraint owner_bot_link_throttle_failures check (failures >= 0)
);

alter table public.owner_bot_link_throttle enable row level security;
revoke all on table public.owner_bot_link_throttle from public, anon, authenticated;
grant select, insert, update on table public.owner_bot_link_throttle to service_role;

create or replace function public.owner_bot_redeem_link_code_limited(p_code text, p_telegram_user_id bigint, p_username text default null)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  max_failures constant integer := 5;
  window_length constant interval := interval '15 minutes';
  throttle public.owner_bot_link_throttle%rowtype;
  status text;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 then
    raise exception 'A Telegram user id is required.' using errcode = '22023';
  end if;

  insert into public.owner_bot_link_throttle (telegram_user_id)
  values (p_telegram_user_id)
  on conflict (telegram_user_id) do nothing;
  -- One redeem at a time per Telegram account, so parallel deliveries count too.
  select * into throttle from public.owner_bot_link_throttle
  where telegram_user_id = p_telegram_user_id
  for update;

  if throttle.window_started_at <= now() - window_length then
    update public.owner_bot_link_throttle
    set window_started_at = now(), failures = 0
    where telegram_user_id = p_telegram_user_id;
    throttle.failures := 0;
  end if;

  if throttle.failures >= max_failures then
    return 'rate_limited';
  end if;

  status := public.owner_bot_redeem_link_code(p_code, p_telegram_user_id, p_username);
  if status in ('invalid', 'used', 'expired') then
    update public.owner_bot_link_throttle
    set failures = failures + 1
    where telegram_user_id = p_telegram_user_id;
  end if;
  return status;
end;
$$;
revoke all on function public.owner_bot_redeem_link_code_limited(text, bigint, text) from public, anon, authenticated;
grant execute on function public.owner_bot_redeem_link_code_limited(text, bigint, text) to service_role;
