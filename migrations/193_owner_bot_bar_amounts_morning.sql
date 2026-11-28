-- Owner money bot, slices 4 and 5 (docs/plans/owner-money-bot.md): the bar
-- line, "✏️ Другая сумма", "✅ Всё забрал" / "🏦 Всё в резерв", and the
-- morning message after the daily report.
--
-- The same rules as 192: every wrapper is service role only, finds the user
-- linked to the presser's Telegram id, checks that user owns the (active) club
-- on every call (owner_bot_act_as), makes that user the transaction's
-- auth.uid(), and calls the existing RPCs unchanged. No existing function is
-- replaced: the 192 wrappers stay as they are and the new ones call them for
-- the Game Club money of one method (owner_bot_choose, owner_bot_confirm,
-- owner_bot_undo), adding the day's bar and "all" buttons to what they answer.
--
--   owner_money_handovers.group_id (new column): the "Всё…" marks of one
--     confirmation share it (the choice's request id); one undo undoes them all.
--   owner_bot_steps: the buttons and questions 192's table cannot hold, so
--     callback data still carries only a row id. Service role only.
--       day          one club's day for one Telegram account (the bar line's
--                    button and the "Всё…" buttons), 7 days, renewed like 192's lines.
--       bar_choice   🏦 В резерв or 👌 Оставил в баре for the bar, with the
--                    whole amount and request id fixed when chosen, 1 hour.
--       all_choice   ✅ Всё забрал or 🏦 Всё в резерв: every Game Club method
--                    with money in the till and no mark, each with its amount
--                    and request id, 1 hour.
--       amount_prompt  ✏️ Другая сумма: the question the bot sent with
--                    ForceReply (prompt_message_id), the day message it was
--                    asked from (the confirmation, sent below the answer,
--                    takes its buttons off), and what the amount is for,
--                    1 hour. The owner's reply is matched by that message id
--                    and the Telegram account.
--   owner_bot_day_messages: the morning message sent to each linked owner per
--     club and business date, so the report's retry runs never send it twice.
--
--   owner_bot_today(telegram id, club, date): owner_bot_open_day plus the day
--     row and the marks of both sides (with group_id). /today and the morning
--     message use it.
--   owner_bot_button(telegram id, row id): read only; the day a button of
--     either table belongs to and the button's own row, also when it has
--     expired (✖️ Нет, ⬅️ Назад and the submenus redraw instead of refusing).
--   owner_bot_pick(telegram id, row id, action): a choice to confirm.
--     A 192 line: collected / reserve (owner_bot_choose). The day row: reserve
--     or left for the bar (the day's bar sales, for the reserve capped by what
--     move_owner_profit_to_reserve allows for the month), or all_collected /
--     all_reserve for every Game Club method with money in the till.
--   owner_bot_ask_amount / owner_bot_prompt_sent / owner_bot_answer_amount:
--     ✏️ Другая сумма. The answer must be a whole sum above 0 and at most what
--     the default would be now; it becomes a choice like any other.
--   owner_bot_confirm_any(telegram id, choice id, chat, message): a 192 choice
--     goes through owner_bot_confirm; a bar choice is move_owner_profit_to_reserve
--     (source bar, the business date's month) or only the mark for "left"; an
--     all choice is collect_money (and move_collected_to_reserve) per method in
--     one transaction, one handover per method, all or nothing.
--   owner_bot_undo_any(telegram id, handover id): a single Game Club mark goes
--     through owner_bot_undo; a bar reserve is delete_owner_reserve_entry; a
--     "left" mark only gets undone_at; a "Всё…" group is undone as a whole.
--   owner_bot_club_owner_telegram_ids(club), owner_bot_claim_day_message,
--     owner_bot_finish_day_message, owner_bot_release_day_message: the
--     morning send's recipients and its once-only record.
--
-- Refusal hints, besides 192's: owner_bot_nothing_in_bar (no bar sales that
-- day), owner_bot_bar_reserve_unavailable (the month's bar profit allows no
-- reserve deposit); the RPCs keep theirs.
--
-- Locking, as 192: only choice and question rows are locked (FOR UPDATE in
-- the confirm and the answer) and one advisory lock per club, day and method
-- (the bar has its own key), taken in a fixed method order by "Всё…"; day rows
-- are never locked: owner_bot_day_extras skips rows other presses hold
-- (SKIP LOCKED) and inserts with ON CONFLICT DO NOTHING. A Game Club reserve
-- confirmation first takes move_collected_to_reserve's bucket lock for the
-- month (owner_bot_reserve_bucket_lock), before the mark locks and before
-- collect_money takes the method balance lock, the order an undo
-- (delete_owner_reserve_entry, then delete_money_collection) takes them in.
--
-- Non-destructive: a new column, new tables, indexes, policies and functions.
-- The DROP POLICY IF EXISTS statements remove only what this file creates.
-- The DELETEs inside owner_bot_day_extras remove only expired button rows of
-- owner_bot_steps; the one inside owner_bot_release_day_message removes only
-- an unsent morning-message claim. Money is deleted only through the existing
-- owner RPCs (undo). Re-runnable.

alter table public.owner_money_handovers add column if not exists group_id uuid;
create index if not exists owner_money_handovers_group
  on public.owner_money_handovers (club_id, group_id) where group_id is not null;

create table if not exists public.owner_bot_steps (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  business_date date not null,
  kind text not null,
  side text,
  payment_method text,
  action text,
  amount numeric,
  items jsonb,
  request_id uuid,
  handover_id uuid references public.owner_money_handovers(id) on delete set null,
  prompt_message_id bigint,
  day_chat_id bigint,
  day_message_id bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint owner_bot_steps_telegram_user_positive check (telegram_user_id > 0),
  constraint owner_bot_steps_kind check (kind in ('day', 'bar_choice', 'all_choice', 'amount_prompt')),
  constraint owner_bot_steps_shape check (
    (kind = 'day' and side is null and payment_method is null and action is null and amount is null
      and items is null and request_id is null and handover_id is null and used_at is null
      and prompt_message_id is null and day_chat_id is null and day_message_id is null)
    or (kind = 'bar_choice' and side = 'bar' and payment_method is null and action in ('reserve', 'left')
      and amount is not null and amount = round(amount) and (amount > 0 or (action = 'left' and amount = 0))
      and items is null and request_id is not null and prompt_message_id is null)
    or (kind = 'all_choice' and side = 'game_club' and payment_method is null and action in ('collected', 'reserve')
      and amount is not null and amount > 0 and amount = round(amount)
      and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0
      and request_id is not null and prompt_message_id is null)
    or (kind = 'amount_prompt' and amount is null and items is null and request_id is null and handover_id is null
      and ((side = 'game_club' and payment_method in ('cash', 'terminal', 'card', 'playstation') and action in ('collected', 'reserve'))
        or (side = 'bar' and payment_method is null and action = 'reserve')))
  ),
  constraint owner_bot_steps_expiry check (expires_at > created_at)
);
create unique index if not exists owner_bot_steps_day
  on public.owner_bot_steps (telegram_user_id, club_id, business_date)
  where kind = 'day';
create unique index if not exists owner_bot_steps_prompt_message
  on public.owner_bot_steps (telegram_user_id, prompt_message_id)
  where kind = 'amount_prompt' and prompt_message_id is not null;
create index if not exists owner_bot_steps_expiry on public.owner_bot_steps (telegram_user_id, expires_at);
create index if not exists owner_bot_steps_club on public.owner_bot_steps (club_id);
create index if not exists owner_bot_steps_handover on public.owner_bot_steps (handover_id);

alter table public.owner_bot_steps enable row level security;
revoke all on table public.owner_bot_steps from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_bot_steps to service_role;
-- Only the bot's service role; no browser role has a policy (or a grant).
drop policy if exists owner_bot_steps_service on public.owner_bot_steps;
create policy owner_bot_steps_service on public.owner_bot_steps for all to service_role
  using (true) with check (true);

create table if not exists public.owner_bot_day_messages (
  club_id uuid not null references public.clubs(id) on delete cascade,
  business_date date not null,
  telegram_user_id bigint not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  chat_id bigint,
  message_id bigint,
  primary key (club_id, business_date, telegram_user_id),
  constraint owner_bot_day_messages_telegram_user_positive check (telegram_user_id > 0),
  constraint owner_bot_day_messages_sent check ((sent_at is null) = (message_id is null))
);

alter table public.owner_bot_day_messages enable row level security;
revoke all on table public.owner_bot_day_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_bot_day_messages to service_role;
drop policy if exists owner_bot_day_messages_service on public.owner_bot_day_messages;
create policy owner_bot_day_messages_service on public.owner_bot_day_messages for all to service_role
  using (true) with check (true);

-- The day's bar sales (daily_stock_counts.bar_income, as sumBarSales), whole sums.
create or replace function public.owner_bot_bar_sales(p_club_id uuid, p_date date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(floor(coalesce(sum(counts.bar_income), 0)), 0)
  from public.daily_stock_counts counts
  where counts.club_id = p_club_id and counts.date = p_date
$$;
revoke all on function public.owner_bot_bar_sales(uuid, date) from public, anon, authenticated, service_role;

-- 192's one-mark-per-method-and-day lock; the bar has its own key.
create or replace function public.owner_bot_mark_lock(p_club_id uuid, p_date date, p_key text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'owner_bot_handover:' || p_club_id::text || ':' || p_date::text || ':' || p_key, 0));
end;
$$;
revoke all on function public.owner_bot_mark_lock(uuid, date, text) from public, anon, authenticated, service_role;

-- The Game Club reserve bucket lock of the business date's month, the same
-- key move_collected_to_reserve (169) takes. A reserve confirmation takes it
-- before anything else, ahead of the mark locks and of collect_money's
-- expense_method_balance lock, so every path takes them in one order:
-- bucket, then marks, then method balance. An undo
-- (delete_owner_reserve_entry, then delete_money_collection) takes the bucket
-- before the method balance too, so a confirm and an undo cannot wait on
-- each other in a cycle.
create or replace function public.owner_bot_reserve_bucket_lock(p_club_id uuid, p_date date)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || date_trunc('month', p_date)::date::text, 0));
end;
$$;
revoke all on function public.owner_bot_reserve_bucket_lock(uuid, date) from public, anon, authenticated, service_role;

-- What one mark may take at most now, read as the owner act_as made the
-- caller: the till of a Game Club method; for the bar the day's sales, for
-- its reserve capped by the month's bar profit move_owner_profit_to_reserve
-- would allow (owner_profit_bucket_available, 071/136). Refuses money already
-- marked that day and nothing to take.
create or replace function public.owner_bot_amount_limit(p_club_id uuid, p_date date, p_side text, p_method text, p_action text)
returns numeric
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  in_till numeric;
  sales numeric;
  reservable numeric;
begin
  if exists (
    select 1 from public.owner_money_handovers handovers
    where handovers.club_id = p_club_id and handovers.business_date = p_date and handovers.undone_at is null
      and handovers.side = p_side and handovers.payment_method is not distinct from p_method
  ) then
    raise exception 'This money has already been marked.' using errcode = 'P0001', hint = 'owner_bot_already_marked';
  end if;

  if p_side = 'game_club' then
    in_till := floor(coalesce((public.get_collection_balances(p_club_id, p_date) -> p_method ->> 'till')::numeric, 0));
    if in_till <= 0 then
      raise exception 'Nothing of this method is left in the till.' using errcode = 'P0001', hint = 'owner_bot_nothing_in_till';
    end if;
    return in_till;
  end if;

  sales := public.owner_bot_bar_sales(p_club_id, p_date);
  if sales <= 0 then
    raise exception 'The bar sold nothing that day.' using errcode = 'P0001', hint = 'owner_bot_nothing_in_bar';
  end if;
  if p_action = 'left' then
    return sales;
  end if;
  reservable := floor(coalesce(public.owner_profit_bucket_available(p_club_id, 'bar', null, date_trunc('month', p_date)::date), 0));
  if reservable <= 0 then
    raise exception 'The month''s bar profit allows no reserve deposit.' using errcode = 'P0001', hint = 'owner_bot_bar_reserve_unavailable';
  end if;
  return least(sales, reservable);
end;
$$;
revoke all on function public.owner_bot_amount_limit(uuid, date, text, text, text) from public, anon, authenticated, service_role;

-- What 193 adds to owner_bot_day (192): this account's day row (created,
-- renewed at most once a day while valid, replaced once expired) and the
-- marks of both sides with their group. Never waits for a row.
create or replace function public.owner_bot_day_extras(p_telegram_user_id bigint, p_owner_id uuid, p_club_id uuid, p_date date)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  day_id uuid;
begin
  -- Old rows of this account, and this day's expired day row; never a ledger row.
  delete from public.owner_bot_steps stale
  where stale.id in (
    select steps.id from public.owner_bot_steps steps
    where steps.telegram_user_id = p_telegram_user_id
      and (steps.expires_at < now() - interval '1 day'
        or (steps.kind = 'day' and steps.club_id = p_club_id and steps.business_date = p_date
          and steps.expires_at <= now()))
    for update skip locked
  );

  insert into public.owner_bot_steps (telegram_user_id, club_id, business_date, kind, expires_at)
  values (p_telegram_user_id, p_club_id, p_date, 'day', now() + interval '7 days')
  on conflict (telegram_user_id, club_id, business_date) where kind = 'day'
  do nothing;

  update public.owner_bot_steps renewed
  set expires_at = now() + interval '7 days'
  where renewed.id in (
    select steps.id from public.owner_bot_steps steps
    where steps.telegram_user_id = p_telegram_user_id and steps.club_id = p_club_id
      and steps.business_date = p_date and steps.kind = 'day'
      and steps.expires_at > now() and steps.expires_at < now() + interval '6 days'
    for update skip locked
  );

  select steps.id into day_id from public.owner_bot_steps steps
  where steps.telegram_user_id = p_telegram_user_id and steps.club_id = p_club_id
    and steps.business_date = p_date and steps.kind = 'day';

  return jsonb_build_object(
    'day_id', day_id,
    'handovers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', handovers.id,
          'side', handovers.side,
          'payment_method', handovers.payment_method,
          'action', handovers.action,
          'amount', handovers.amount,
          'group_id', handovers.group_id,
          'created_at', handovers.created_at,
          'undo_until', handovers.created_at + interval '10 minutes',
          'mine', coalesce(handovers.created_by = p_owner_id, false))
        order by handovers.created_at, handovers.id)
      from public.owner_money_handovers handovers
      where handovers.club_id = p_club_id and handovers.business_date = p_date and handovers.undone_at is null
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.owner_bot_day_extras(bigint, uuid, uuid, date) from public, anon, authenticated, service_role;

create or replace function public.owner_bot_full_day(p_telegram_user_id bigint, p_owner_id uuid, p_club_id uuid, p_date date)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  day jsonb := public.owner_bot_day(p_telegram_user_id, p_owner_id, p_club_id, p_date);
begin
  return day || public.owner_bot_day_extras(p_telegram_user_id, p_owner_id, p_club_id, p_date);
end;
$$;
revoke all on function public.owner_bot_full_day(bigint, uuid, uuid, date) from public, anon, authenticated, service_role;

-- A row of owner_bot_steps of this Telegram account; refuses another
-- account's. Only choice and question rows are ever locked (p_lock).
create or replace function public.owner_bot_step_row(p_telegram_user_id bigint, p_id uuid, p_lock boolean)
returns public.owner_bot_steps
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  step public.owner_bot_steps;
begin
  if p_lock then
    select * into step from public.owner_bot_steps candidate
    where candidate.id = p_id and candidate.kind in ('bar_choice', 'all_choice')
    for update;
  else
    select * into step from public.owner_bot_steps candidate where candidate.id = p_id;
  end if;
  if step.id is null then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  if step.telegram_user_id is distinct from p_telegram_user_id then
    raise exception 'This button belongs to another Telegram account.' using errcode = '42501', hint = 'owner_bot_forbidden';
  end if;
  return step;
end;
$$;
revoke all on function public.owner_bot_step_row(bigint, uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.owner_bot_today(p_telegram_user_id bigint, p_club_id uuid, p_date date)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := public.owner_bot_act_as(p_telegram_user_id, p_club_id);
begin
  if p_date is null or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid business date.' using errcode = '22007';
  end if;
  return public.owner_bot_full_day(p_telegram_user_id, owner_id, p_club_id, p_date);
end;
$$;
revoke all on function public.owner_bot_today(bigint, uuid, date) from public, anon, authenticated;
grant execute on function public.owner_bot_today(bigint, uuid, date) to service_role;

-- Read only: the day of any button row of this account (192 line or choice,
-- 193 day, choice or question) and the row itself, expired or not. Refuses
-- only an unknown row and another account's.
create or replace function public.owner_bot_button(p_telegram_user_id bigint, p_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  line public.owner_bot_pending_actions;
  step public.owner_bot_steps;
  club uuid;
  day date;
  info jsonb;
  owner_id uuid;
begin
  select * into line from public.owner_bot_pending_actions candidate where candidate.id = p_id;
  if line.id is not null then
    if line.telegram_user_id is distinct from p_telegram_user_id then
      raise exception 'This button belongs to another Telegram account.' using errcode = '42501', hint = 'owner_bot_forbidden';
    end if;
    club := line.club_id;
    day := line.business_date;
    info := jsonb_build_object(
      'id', line.id,
      'kind', case when line.action is null then 'line' else 'choice' end,
      'side', 'game_club',
      'payment_method', line.payment_method,
      'action', line.action,
      'amount', line.amount,
      'expired', line.expires_at <= now() or line.used_at is not null);
  else
    step := public.owner_bot_step_row(p_telegram_user_id, p_id, false);
    club := step.club_id;
    day := step.business_date;
    info := jsonb_build_object(
      'id', step.id,
      'kind', step.kind,
      'side', step.side,
      'payment_method', step.payment_method,
      'action', step.action,
      'amount', step.amount,
      'items', step.items,
      'expired', step.expires_at <= now() or step.used_at is not null);
  end if;
  owner_id := public.owner_bot_act_as(p_telegram_user_id, club);
  return public.owner_bot_full_day(p_telegram_user_id, owner_id, club, day) || jsonb_build_object('pending', info);
end;
$$;
revoke all on function public.owner_bot_button(bigint, uuid) from public, anon, authenticated;
grant execute on function public.owner_bot_button(bigint, uuid) to service_role;

create or replace function public.owner_bot_pick(p_telegram_user_id bigint, p_id uuid, p_action text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  line public.owner_bot_pending_actions;
  step public.owner_bot_steps;
  owner_id uuid;
  chosen jsonb;
  sales numeric;
  amount numeric;
  balances jsonb;
  items jsonb;
  choice public.owner_bot_steps;
begin
  if p_action is null or p_action not in ('collected', 'reserve', 'left', 'all_collected', 'all_reserve') then
    raise exception 'Unknown owner bot action.' using errcode = '22023';
  end if;

  select * into line from public.owner_bot_pending_actions candidate where candidate.id = p_id and candidate.action is null;
  if line.id is not null then
    if p_action not in ('collected', 'reserve') then
      raise exception 'Unknown owner bot action.' using errcode = '22023';
    end if;
    -- 192 checks the account, the owner, the line's expiry, the marks and the till.
    chosen := public.owner_bot_choose(p_telegram_user_id, p_id, p_action);
    owner_id := public.owner_bot_act_as(p_telegram_user_id, line.club_id);
    return chosen
      || public.owner_bot_day_extras(p_telegram_user_id, owner_id, line.club_id, line.business_date)
      || jsonb_build_object('pending', (chosen -> 'pending') || jsonb_build_object('kind', 'choice', 'side', 'game_club'));
  end if;

  step := public.owner_bot_step_row(p_telegram_user_id, p_id, false);
  owner_id := public.owner_bot_act_as(p_telegram_user_id, step.club_id);
  if step.kind <> 'day' or step.expires_at <= now() then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  if p_action = 'collected' then
    raise exception 'Bar money has no till to collect from.' using errcode = '22023';
  end if;

  if p_action in ('reserve', 'left') then
    sales := public.owner_bot_bar_sales(step.club_id, step.business_date);
    amount := public.owner_bot_amount_limit(step.club_id, step.business_date, 'bar', null, p_action);
    insert into public.owner_bot_steps
      (telegram_user_id, club_id, business_date, kind, side, action, amount, request_id, expires_at)
    values (p_telegram_user_id, step.club_id, step.business_date, 'bar_choice', 'bar', p_action, amount,
      gen_random_uuid(), now() + interval '1 hour')
    returning * into choice;
    return public.owner_bot_full_day(p_telegram_user_id, owner_id, step.club_id, step.business_date)
      || jsonb_build_object('pending', jsonb_build_object(
        'id', choice.id, 'kind', choice.kind, 'side', 'bar', 'payment_method', null,
        'action', choice.action, 'amount', choice.amount,
        'capped', choice.amount < sales, 'bar_sales', sales, 'expired', false));
  end if;

  -- ✅ Всё забрал / 🏦 Всё в резерв: every method with money in the till and no mark, in the report's order.
  balances := public.get_collection_balances(step.club_id, step.business_date);
  select jsonb_agg(jsonb_build_object('payment_method', methods.method, 'amount', methods.in_till, 'request_id', gen_random_uuid())
      order by methods.position)
  into items
  from (
    select listed.method, listed.position,
      floor(coalesce((balances -> listed.method ->> 'till')::numeric, 0)) as in_till
    from unnest(array['cash', 'terminal', 'card', 'playstation']) with ordinality as listed(method, position)
  ) methods
  where methods.in_till > 0 and not exists (
    select 1 from public.owner_money_handovers handovers
    where handovers.club_id = step.club_id and handovers.business_date = step.business_date
      and handovers.side = 'game_club' and handovers.payment_method = methods.method and handovers.undone_at is null
  );
  if items is null then
    raise exception 'Nothing is left in the till.' using errcode = 'P0001', hint = 'owner_bot_nothing_in_till';
  end if;
  insert into public.owner_bot_steps
    (telegram_user_id, club_id, business_date, kind, side, action, amount, items, request_id, expires_at)
  values (p_telegram_user_id, step.club_id, step.business_date, 'all_choice', 'game_club',
    case p_action when 'all_reserve' then 'reserve' else 'collected' end,
    (select sum((item ->> 'amount')::numeric) from jsonb_array_elements(items) item),
    items, gen_random_uuid(), now() + interval '1 hour')
  returning * into choice;
  return public.owner_bot_full_day(p_telegram_user_id, owner_id, step.club_id, step.business_date)
    || jsonb_build_object('pending', jsonb_build_object(
      'id', choice.id, 'kind', choice.kind, 'side', 'game_club', 'payment_method', null,
      'action', choice.action, 'amount', choice.amount, 'items', choice.items, 'expired', false));
end;
$$;
revoke all on function public.owner_bot_pick(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_bot_pick(bigint, uuid, text) to service_role;

-- ✏️ Другая сумма: the question for one line (192) or the bar (the day row,
-- reserve only), remembering the day message it was asked from. Answers the
-- most it may be now.
create or replace function public.owner_bot_ask_amount(
  p_telegram_user_id bigint, p_id uuid, p_action text, p_chat_id bigint default null, p_message_id bigint default null
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  line public.owner_bot_pending_actions;
  step public.owner_bot_steps;
  club uuid;
  day date;
  side text;
  method text;
  owner_id uuid;
  most numeric;
  prompt public.owner_bot_steps;
begin
  if p_action is null or p_action not in ('collected', 'reserve') then
    raise exception 'Unknown owner bot action.' using errcode = '22023';
  end if;
  select * into line from public.owner_bot_pending_actions candidate where candidate.id = p_id and candidate.action is null;
  if line.id is not null then
    if line.telegram_user_id is distinct from p_telegram_user_id then
      raise exception 'This button belongs to another Telegram account.' using errcode = '42501', hint = 'owner_bot_forbidden';
    end if;
    owner_id := public.owner_bot_act_as(p_telegram_user_id, line.club_id);
    if line.expires_at <= now() then
      raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
    end if;
    club := line.club_id; day := line.business_date; side := 'game_club'; method := line.payment_method;
  else
    step := public.owner_bot_step_row(p_telegram_user_id, p_id, false);
    owner_id := public.owner_bot_act_as(p_telegram_user_id, step.club_id);
    if step.kind <> 'day' or step.expires_at <= now() then
      raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
    end if;
    if p_action <> 'reserve' then
      raise exception 'Bar money has no till to collect from.' using errcode = '22023';
    end if;
    club := step.club_id; day := step.business_date; side := 'bar'; method := null;
  end if;

  most := public.owner_bot_amount_limit(club, day, side, method, p_action);
  insert into public.owner_bot_steps
    (telegram_user_id, club_id, business_date, kind, side, payment_method, action, day_chat_id, day_message_id, expires_at)
  values (p_telegram_user_id, club, day, 'amount_prompt', side, method, p_action, p_chat_id, p_message_id, now() + interval '1 hour')
  returning * into prompt;

  return public.owner_bot_full_day(p_telegram_user_id, owner_id, club, day)
    || jsonb_build_object('prompt', jsonb_build_object(
      'id', prompt.id, 'side', side, 'payment_method', method, 'action', p_action, 'max_amount', most,
      'day_chat_id', p_chat_id, 'day_message_id', p_message_id));
end;
$$;
revoke all on function public.owner_bot_ask_amount(bigint, uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_ask_amount(bigint, uuid, text, bigint, bigint) to service_role;

-- The ForceReply message the bot sent for a question; the owner's reply is
-- matched by it. A question asked again (after a wrong answer) moves to the
-- new message.
create or replace function public.owner_bot_prompt_sent(p_telegram_user_id bigint, p_prompt_id uuid, p_prompt_message_id bigint)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  prompt public.owner_bot_steps := public.owner_bot_step_row(p_telegram_user_id, p_prompt_id, false);
begin
  perform public.owner_bot_act_as(p_telegram_user_id, prompt.club_id);
  if prompt.kind <> 'amount_prompt' or prompt.used_at is not null or prompt.expires_at <= now()
    or p_prompt_message_id is null or p_prompt_message_id <= 0 then
    raise exception 'This question is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  update public.owner_bot_steps set prompt_message_id = p_prompt_message_id where id = prompt.id;
end;
$$;
revoke all on function public.owner_bot_prompt_sent(bigint, uuid, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_prompt_sent(bigint, uuid, bigint) to service_role;

-- The owner's reply to a question, already read as a whole sum by the bot
-- (null when it was not one). A sum that is not above 0, or more than the
-- default would be now, answers 'invalid' / 'too_large' and the question
-- stays open; a good one becomes a choice (a 192 choice for a Game Club
-- method, a bar choice for the bar) to confirm with ✅ Да.
create or replace function public.owner_bot_answer_amount(p_telegram_user_id bigint, p_prompt_message_id bigint, p_amount numeric)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  prompt public.owner_bot_steps;
  owner_id uuid;
  most numeric;
  question jsonb;
  pending jsonb;
  choice_id uuid;
  answer text;
begin
  select * into prompt from public.owner_bot_steps candidate
  where candidate.telegram_user_id = p_telegram_user_id and candidate.kind = 'amount_prompt'
    and candidate.prompt_message_id = p_prompt_message_id
  for update;
  if prompt.id is null or prompt.used_at is not null or prompt.expires_at <= now() then
    raise exception 'This question is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  owner_id := public.owner_bot_act_as(p_telegram_user_id, prompt.club_id);
  most := public.owner_bot_amount_limit(prompt.club_id, prompt.business_date, prompt.side, prompt.payment_method, prompt.action);
  question := jsonb_build_object(
    'id', prompt.id, 'side', prompt.side, 'payment_method', prompt.payment_method, 'action', prompt.action,
    'max_amount', most, 'day_chat_id', prompt.day_chat_id, 'day_message_id', prompt.day_message_id);

  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0 or p_amount <> round(p_amount) then
    answer := 'invalid';
  elsif p_amount > most then
    answer := 'too_large';
  end if;
  if answer is not null then
    return jsonb_build_object(
      'status', answer,
      'club_id', prompt.club_id,
      'club_name', (select clubs.name from public.clubs clubs where clubs.id = prompt.club_id),
      'business_date', prompt.business_date,
      'prompt', question);
  end if;

  if prompt.side = 'game_club' then
    insert into public.owner_bot_pending_actions
      (telegram_user_id, club_id, business_date, payment_method, action, amount, request_id, expires_at)
    values (p_telegram_user_id, prompt.club_id, prompt.business_date, prompt.payment_method, prompt.action, p_amount,
      gen_random_uuid(), now() + interval '1 hour')
    returning id into choice_id;
    pending := jsonb_build_object('id', choice_id, 'kind', 'choice', 'side', 'game_club',
      'payment_method', prompt.payment_method, 'action', prompt.action, 'amount', p_amount, 'expired', false);
  else
    insert into public.owner_bot_steps
      (telegram_user_id, club_id, business_date, kind, side, action, amount, request_id, expires_at)
    values (p_telegram_user_id, prompt.club_id, prompt.business_date, 'bar_choice', 'bar', prompt.action, p_amount,
      gen_random_uuid(), now() + interval '1 hour')
    returning id into choice_id;
    pending := jsonb_build_object('id', choice_id, 'kind', 'bar_choice', 'side', 'bar', 'payment_method', null,
      'action', prompt.action, 'amount', p_amount, 'capped', false,
      'bar_sales', public.owner_bot_bar_sales(prompt.club_id, prompt.business_date), 'expired', false);
  end if;
  update public.owner_bot_steps set used_at = now() where id = prompt.id;

  return public.owner_bot_full_day(p_telegram_user_id, owner_id, prompt.club_id, prompt.business_date)
    || jsonb_build_object('status', 'chosen', 'pending', pending, 'prompt', question);
end;
$$;
revoke all on function public.owner_bot_answer_amount(bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.owner_bot_answer_amount(bigint, bigint, numeric) to service_role;

create or replace function public.owner_bot_confirm_any(
  p_telegram_user_id bigint, p_choice_id uuid, p_chat_id bigint default null, p_message_id bigint default null
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  confirmed jsonb;
  single public.owner_bot_pending_actions;
  choice public.owner_bot_steps;
  owner_id uuid;
  saved_id uuid := null;
  status text := 'already_saved';
  item record;
  inserted uuid;
begin
  select * into single from public.owner_bot_pending_actions candidate where candidate.id = p_choice_id;
  if single.id is not null then
    -- One Game Club method: 192 as it is, after the reserve bucket lock for a
    -- reserve of this account's unsaved choice (192 itself refuses the rest).
    if single.action = 'reserve' and single.used_at is null and single.telegram_user_id = p_telegram_user_id then
      perform public.owner_bot_act_as(p_telegram_user_id, single.club_id);
      perform public.owner_bot_reserve_bucket_lock(single.club_id, single.business_date);
    end if;
    confirmed := public.owner_bot_confirm(p_telegram_user_id, p_choice_id, p_chat_id, p_message_id);
    owner_id := public.owner_bot_act_as(p_telegram_user_id, (confirmed ->> 'club_id')::uuid);
    return confirmed
      || public.owner_bot_day_extras(p_telegram_user_id, owner_id, (confirmed ->> 'club_id')::uuid, (confirmed ->> 'business_date')::date)
      || jsonb_build_object('result', (confirmed -> 'result') || jsonb_build_object('side', 'game_club', 'group', false));
  end if;

  choice := public.owner_bot_step_row(p_telegram_user_id, p_choice_id, true);
  owner_id := public.owner_bot_act_as(p_telegram_user_id, choice.club_id);
  saved_id := choice.handover_id;

  if choice.used_at is not null then
    if exists (select 1 from public.owner_money_handovers handovers where handovers.id = saved_id and handovers.undone_at is not null) then
      status := 'already_undone';
    end if;
  else
    if choice.expires_at <= now() then
      raise exception 'This confirmation is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
    end if;

    if choice.kind = 'bar_choice' then
      perform public.owner_bot_mark_lock(choice.club_id, choice.business_date, 'bar');
      if exists (
        select 1 from public.owner_money_handovers handovers
        where handovers.club_id = choice.club_id and handovers.business_date = choice.business_date
          and handovers.side = 'bar' and handovers.undone_at is null and handovers.request_id <> choice.request_id
      ) then
        raise exception 'This money has already been marked.' using errcode = 'P0001', hint = 'owner_bot_already_marked';
      end if;
      if choice.action = 'reserve' then
        -- The reserve entry takes the choice's request id as its own id.
        perform public.move_owner_profit_to_reserve(choice.club_id, choice.request_id,
          date_trunc('month', choice.business_date)::date, 'bar', null, choice.amount, 'Telegram', choice.business_date);
      end if;
      insert into public.owner_money_handovers
        (club_id, business_date, side, payment_method, amount, action, request_id, telegram_chat_id, telegram_message_id, created_by)
      values (choice.club_id, choice.business_date, 'bar', null, choice.amount, choice.action,
        choice.request_id, p_chat_id, p_message_id, owner_id)
      on conflict on constraint owner_money_handovers_request do nothing
      returning id into saved_id;
      if saved_id is null then
        select handovers.id into saved_id from public.owner_money_handovers handovers
        where handovers.club_id = choice.club_id and handovers.request_id = choice.request_id;
      end if;
    else
      -- The reserve bucket first (see owner_bot_reserve_bucket_lock), then every
      -- method's mark lock in the same order, then all or nothing.
      if choice.action = 'reserve' then
        perform public.owner_bot_reserve_bucket_lock(choice.club_id, choice.business_date);
      end if;
      for item in
        select listed.value ->> 'payment_method' as method
        from jsonb_array_elements(choice.items) listed
        order by array_position(array['cash', 'terminal', 'card', 'playstation'], listed.value ->> 'payment_method')
      loop
        perform public.owner_bot_mark_lock(choice.club_id, choice.business_date, item.method);
      end loop;
      if exists (
        select 1 from public.owner_money_handovers handovers
        join jsonb_array_elements(choice.items) listed on listed.value ->> 'payment_method' = handovers.payment_method
        where handovers.club_id = choice.club_id and handovers.business_date = choice.business_date
          and handovers.side = 'game_club' and handovers.undone_at is null
          and handovers.group_id is distinct from choice.request_id
      ) then
        raise exception 'This money has already been marked.' using errcode = 'P0001', hint = 'owner_bot_already_marked';
      end if;

      for item in
        select listed.value ->> 'payment_method' as method,
          (listed.value ->> 'amount')::numeric as amount,
          (listed.value ->> 'request_id')::uuid as request_id
        from jsonb_array_elements(choice.items) listed
        order by array_position(array['cash', 'terminal', 'card', 'playstation'], listed.value ->> 'payment_method')
      loop
        perform public.collect_money(choice.club_id, item.request_id, choice.business_date,
          jsonb_build_object(item.method, item.amount), 'Telegram');
        if choice.action = 'reserve' then
          perform public.move_collected_to_reserve(choice.club_id, item.request_id, choice.business_date,
            item.method, item.amount, 'Telegram');
        end if;
        inserted := null;
        insert into public.owner_money_handovers
          (club_id, business_date, side, payment_method, amount, action, request_id, group_id,
            telegram_chat_id, telegram_message_id, created_by)
        values (choice.club_id, choice.business_date, 'game_club', item.method, item.amount, choice.action,
          item.request_id, choice.request_id, p_chat_id, p_message_id, owner_id)
        on conflict on constraint owner_money_handovers_request do nothing
        returning id into inserted;
        if inserted is null then
          select handovers.id into inserted from public.owner_money_handovers handovers
          where handovers.club_id = choice.club_id and handovers.request_id = item.request_id;
        end if;
        saved_id := coalesce(saved_id, inserted);
      end loop;
    end if;

    update public.owner_bot_steps set used_at = now(), handover_id = saved_id where id = choice.id;
    status := 'saved';
  end if;

  return public.owner_bot_full_day(p_telegram_user_id, owner_id, choice.club_id, choice.business_date)
    || jsonb_build_object('result', jsonb_build_object(
      'status', status,
      'handover_id', saved_id,
      'side', choice.side,
      'payment_method', null,
      'action', choice.action,
      'amount', choice.amount,
      'group', choice.kind = 'all_choice'));
end;
$$;
revoke all on function public.owner_bot_confirm_any(bigint, uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_confirm_any(bigint, uuid, bigint, bigint) to service_role;

create or replace function public.owner_bot_undo_any(p_telegram_user_id bigint, p_handover_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  handover public.owner_money_handovers;
  undone jsonb;
  owner_id uuid;
  member public.owner_money_handovers;
  total numeric := 0;
  status text := 'already_undone';
begin
  select * into handover from public.owner_money_handovers candidate where candidate.id = p_handover_id;
  if handover.id is null then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;

  if handover.side = 'game_club' and handover.group_id is null then
    -- One Game Club method: 192 as it is.
    undone := public.owner_bot_undo(p_telegram_user_id, p_handover_id);
    owner_id := public.owner_bot_act_as(p_telegram_user_id, handover.club_id);
    return undone
      || public.owner_bot_day_extras(p_telegram_user_id, owner_id, handover.club_id, handover.business_date)
      || jsonb_build_object('result', (undone -> 'result') || jsonb_build_object('side', 'game_club', 'group', false));
  end if;

  owner_id := public.owner_bot_act_as(p_telegram_user_id, handover.club_id);
  if handover.created_by is distinct from owner_id then
    raise exception 'Only the owner who saved this can undo it here.' using errcode = '42501', hint = 'owner_bot_forbidden';
  end if;

  -- The mark, or every mark of its group, locked in id order.
  for member in
    select * from public.owner_money_handovers candidate
    where candidate.club_id = handover.club_id
      and (candidate.id = handover.id or (handover.group_id is not null and candidate.group_id = handover.group_id))
    order by candidate.id
    for update
  loop
    total := total + member.amount;
    if member.undone_at is null then
      status := 'undone';
    end if;
  end loop;

  if status = 'undone' then
    if handover.created_at + interval '10 minutes' <= now() then
      raise exception 'Undo is possible for 10 minutes only.' using errcode = 'P0001', hint = 'owner_bot_undo_expired';
    end if;
    if handover.action not in ('collected', 'reserve', 'left') then
      raise exception 'This mark cannot be undone from the bot.' using errcode = 'P0001', hint = 'owner_bot_cannot_undo';
    end if;
    for member in
      select * from public.owner_money_handovers candidate
      where candidate.club_id = handover.club_id and candidate.undone_at is null
        and (candidate.id = handover.id or (handover.group_id is not null and candidate.group_id = handover.group_id))
      order by candidate.id
    loop
      -- An owner may already have undone a part in the app; then only the mark is left.
      if member.action = 'reserve' and exists (
        select 1 from public.owner_reserve_entries entries
        where entries.club_id = member.club_id and entries.id = member.request_id
      ) then
        perform public.delete_owner_reserve_entry(member.club_id, member.request_id);
      end if;
      if member.side = 'game_club' then
        perform public.delete_money_collection(member.club_id, member.request_id);
      end if;
      update public.owner_money_handovers set undone_at = now() where id = member.id;
    end loop;
  end if;

  return public.owner_bot_full_day(p_telegram_user_id, owner_id, handover.club_id, handover.business_date)
    || jsonb_build_object('result', jsonb_build_object(
      'status', status,
      'handover_id', handover.id,
      'side', handover.side,
      'payment_method', case when handover.group_id is null then handover.payment_method end,
      'action', handover.action,
      'amount', total,
      'group', handover.group_id is not null));
end;
$$;
revoke all on function public.owner_bot_undo_any(bigint, uuid) from public, anon, authenticated;
grant execute on function public.owner_bot_undo_any(bigint, uuid) to service_role;

-- The morning message (slice 5): the Telegram accounts linked to the owners
-- of an active club.
create or replace function public.owner_bot_club_owner_telegram_ids(p_club_id uuid)
returns table(telegram_user_id bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select links.telegram_user_id
  from public.club_memberships memberships
  join public.clubs clubs on clubs.id = memberships.club_id and clubs.is_active
  join public.owner_telegram_links links on links.user_id = memberships.user_id
  where memberships.club_id = p_club_id and memberships.role = 'owner'
  order by links.telegram_user_id
$$;
revoke all on function public.owner_bot_club_owner_telegram_ids(uuid) from public, anon, authenticated;
grant execute on function public.owner_bot_club_owner_telegram_ids(uuid) to service_role;

-- True once per club, business date and Telegram account: the caller sends
-- the message. A claim is never taken again, so a run after a lost answer
-- does not send twice; only a definite failure releases it.
create or replace function public.owner_bot_claim_day_message(p_club_id uuid, p_date date, p_telegram_user_id bigint)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  claimed boolean;
begin
  insert into public.owner_bot_day_messages (club_id, business_date, telegram_user_id)
  values (p_club_id, p_date, p_telegram_user_id)
  on conflict (club_id, business_date, telegram_user_id) do nothing
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
revoke all on function public.owner_bot_claim_day_message(uuid, date, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_claim_day_message(uuid, date, bigint) to service_role;

create or replace function public.owner_bot_finish_day_message(
  p_club_id uuid, p_date date, p_telegram_user_id bigint, p_chat_id bigint, p_message_id bigint
) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update public.owner_bot_day_messages
  set sent_at = now(), chat_id = p_chat_id, message_id = p_message_id
  where club_id = p_club_id and business_date = p_date and telegram_user_id = p_telegram_user_id
$$;
revoke all on function public.owner_bot_finish_day_message(uuid, date, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_finish_day_message(uuid, date, bigint, bigint, bigint) to service_role;

-- A send that definitely did not reach Telegram gives the claim back, so a
-- later run of the same report may try again. A sent message is never released.
create or replace function public.owner_bot_release_day_message(p_club_id uuid, p_date date, p_telegram_user_id bigint)
returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from public.owner_bot_day_messages
  where club_id = p_club_id and business_date = p_date and telegram_user_id = p_telegram_user_id
    and sent_at is null
$$;
revoke all on function public.owner_bot_release_day_message(uuid, date, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_release_day_message(uuid, date, bigint) to service_role;
