-- Owner money bot, slice 3 (docs/plans/owner-money-bot.md): the owner marks a
-- Game Club method's money from Telegram as collected (✅ Забрал) or moved
-- into the reserve (🏦 В резерв), confirms it, and can undo it for 10 minutes.
--
-- The bot runs with the service role, so auth.uid() is empty and every money
-- RPC would refuse it. These wrappers act as the linked owner instead: they
-- look up the app user linked to the Telegram id (190), check that user owns
-- the club and the club is active, then set the transaction's JWT claims so
-- auth.uid() is that user, and call the existing RPCs unchanged:
-- collect_money, move_collected_to_reserve, delete_owner_reserve_entry,
-- delete_money_collection and get_collection_balances (169, 170). Their
-- access checks, balance triggers, day locks and audit (changed_by) all run
-- as for the owner in the app. No existing function is replaced.
--
-- Supabase's auth.uid() reads request.jwt.claim.sub and falls back to the
-- sub of request.jwt.claims; both are set, with set_config(..., true), so the
-- change ends with the transaction (one PostgREST call).
--
--   owner_bot_pending_actions: what a button stands for, so callback data
--     carries only an id and never a club, date, method or amount. A line row
--     (action null) is one method of one club's day for one Telegram account,
--     reused by every message of that day, 7 days. A choice row is one
--     "collect" or "reserve" the owner is asked to confirm, with the amount
--     fixed when it was chosen and the request id of the ledger rows it will
--     make, 1 hour. Service role only, no browser access and no policies.
--   owner_bot_open_day(telegram id, club, date): the day's till per method,
--     the handovers not undone and the line ids, for the /today message.
--   owner_bot_pending(telegram id, pending id): the same for the day a button
--     belongs to, with the button's own row (menu, back, no); an expired
--     button is refused. A line is renewed for 7 days while still valid, at
--     most once a day; an expired one is replaced when its day is drawn again.
--   owner_bot_choose(telegram id, line id, action): a new choice for what is
--     still in the till for that method on that day.
--   owner_bot_confirm(telegram id, choice id, chat, message): collects (and
--     moves into the reserve) in one transaction and records the handover.
--     A repeated press or a resent update saves nothing twice and answers
--     already_saved (already_undone once the mark was undone).
--   owner_bot_undo(telegram id, handover id): within 10 minutes, by the owner
--     who made it, deletes the reserve entry and the collection again.
--
-- Each wrapper answers the day as owner_bot_open_day does. Refusals of the
-- wrappers carry a hint the bot turns into a reply: owner_bot_not_linked,
-- owner_bot_not_owner, owner_bot_forbidden (42501), owner_bot_expired,
-- owner_bot_already_marked, owner_bot_nothing_in_till,
-- owner_bot_undo_expired, owner_bot_cannot_undo; refusals of the RPCs keep theirs
-- (INSUFFICIENT_BALANCE, reserve_exceeds_available, day_collected,
-- COLLECTED_INSUFFICIENT, reserve_already_used).
--
-- Locking: only a choice row is locked (FOR UPDATE in owner_bot_confirm) and
-- one advisory lock per club, day and method; owner_bot_day skips rows other
-- presses hold (SKIP LOCKED) and inserts lines in a fixed order with ON
-- CONFLICT DO NOTHING, so concurrent presses never wait on each other in a
-- cycle.
--
-- Non-destructive: a new table, its indexes and new functions only. The
-- DELETE in owner_bot_day removes only expired button rows of this table,
-- never a ledger row; the money deletes in owner_bot_undo go through the
-- existing owner RPCs. Re-runnable.

create table if not exists public.owner_bot_pending_actions (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  business_date date not null,
  payment_method text not null,
  action text,
  amount numeric,
  request_id uuid,
  handover_id uuid references public.owner_money_handovers(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint owner_bot_pending_actions_telegram_user_positive check (telegram_user_id > 0),
  constraint owner_bot_pending_actions_method check (payment_method in ('cash', 'terminal', 'card', 'playstation')),
  constraint owner_bot_pending_actions_kind check (
    (action is null and amount is null and request_id is null and used_at is null and handover_id is null)
    or (action in ('collected', 'reserve') and amount > 0 and amount = round(amount) and request_id is not null)
  ),
  constraint owner_bot_pending_actions_expiry check (expires_at > created_at)
);
create unique index if not exists owner_bot_pending_actions_line
  on public.owner_bot_pending_actions (telegram_user_id, club_id, business_date, payment_method)
  where action is null;
create index if not exists owner_bot_pending_actions_expiry on public.owner_bot_pending_actions (telegram_user_id, expires_at);
create index if not exists owner_bot_pending_actions_club on public.owner_bot_pending_actions (club_id);
create index if not exists owner_bot_pending_actions_handover on public.owner_bot_pending_actions (handover_id);

alter table public.owner_bot_pending_actions enable row level security;
revoke all on table public.owner_bot_pending_actions from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_bot_pending_actions to service_role;

-- The linked owner of an active club, made the caller of this transaction.
-- Internal: only the wrappers below call it, never a client role.
create or replace function public.owner_bot_act_as(p_telegram_user_id bigint, p_club_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  linked_user uuid;
  claims jsonb;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 then
    raise exception 'A Telegram user id is required.' using errcode = '22023';
  end if;
  select links.user_id into linked_user
  from public.owner_telegram_links links
  where links.telegram_user_id = p_telegram_user_id;
  if linked_user is null then
    raise exception 'This Telegram account is not linked to the app.' using errcode = '42501', hint = 'owner_bot_not_linked';
  end if;
  if p_club_id is null or not exists (
    select 1 from public.club_memberships memberships
    join public.clubs clubs on clubs.id = memberships.club_id and clubs.is_active
    where memberships.club_id = p_club_id and memberships.user_id = linked_user and memberships.role = 'owner'
  ) then
    raise exception 'Only an owner of this club can do that.' using errcode = '42501', hint = 'owner_bot_not_owner';
  end if;

  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if claims is null or jsonb_typeof(claims) <> 'object' then
    claims := '{}'::jsonb;
  end if;
  perform set_config('request.jwt.claims',
    (claims || jsonb_build_object('sub', linked_user::text, 'role', 'authenticated'))::text, true);
  perform set_config('request.jwt.claim.sub', linked_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  return linked_user;
end;
$$;
revoke all on function public.owner_bot_act_as(bigint, uuid) from public, anon, authenticated, service_role;

-- One club's day for the bot message, read as the owner act_as made the
-- caller: till balances (get_collection_balances), the handovers not undone,
-- and this Telegram account's line ids (created or renewed here).
create or replace function public.owner_bot_day(p_telegram_user_id bigint, p_owner_id uuid, p_club_id uuid, p_date date)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  line_ids jsonb;
begin
  -- No row is waited for here: rows another press holds are skipped, and line
  -- rows are never locked by the wrappers, so two presses at once cannot
  -- lock rows in opposite orders.
  -- Old buttons of this account, and this day's expired lines (their
  -- messages answer "expired" and the new message gets new ones); never a
  -- ledger row.
  delete from public.owner_bot_pending_actions stale
  where stale.id in (
    select pending.id from public.owner_bot_pending_actions pending
    where pending.telegram_user_id = p_telegram_user_id
      and (pending.expires_at < now() - interval '1 day'
        or (pending.action is null and pending.club_id = p_club_id and pending.business_date = p_date
          and pending.expires_at <= now()))
    for update skip locked
  );

  insert into public.owner_bot_pending_actions (telegram_user_id, club_id, business_date, payment_method, expires_at)
  select p_telegram_user_id, p_club_id, p_date, methods.method, now() + interval '7 days'
  from unnest(array['cash', 'terminal', 'card', 'playstation']) with ordinality as methods(method, position)
  order by methods.position
  on conflict (telegram_user_id, club_id, business_date, payment_method) where action is null
  do nothing;

  -- A line still valid gets its 7 days again at most once a day.
  update public.owner_bot_pending_actions renewed
  set expires_at = now() + interval '7 days'
  where renewed.id in (
    select pending.id from public.owner_bot_pending_actions pending
    where pending.telegram_user_id = p_telegram_user_id and pending.club_id = p_club_id
      and pending.business_date = p_date and pending.action is null
      and pending.expires_at > now() and pending.expires_at < now() + interval '6 days'
    order by pending.payment_method
    for update skip locked
  );

  select jsonb_object_agg(pending.payment_method, pending.id) into line_ids
  from public.owner_bot_pending_actions pending
  where pending.telegram_user_id = p_telegram_user_id and pending.club_id = p_club_id
    and pending.business_date = p_date and pending.action is null;

  return (
    select jsonb_build_object(
      'club_id', clubs.id,
      'club_name', clubs.name,
      'business_date', p_date,
      'balances', public.get_collection_balances(p_club_id, p_date),
      'handovers', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', handovers.id,
            'side', handovers.side,
            'payment_method', handovers.payment_method,
            'action', handovers.action,
            'amount', handovers.amount,
            'created_at', handovers.created_at,
            'undo_until', handovers.created_at + interval '10 minutes',
            'mine', coalesce(handovers.created_by = p_owner_id, false))
          order by handovers.created_at, handovers.id)
        from public.owner_money_handovers handovers
        where handovers.club_id = p_club_id and handovers.business_date = p_date and handovers.undone_at is null
      ), '[]'::jsonb),
      'lines', coalesce(line_ids, '{}'::jsonb))
    from public.clubs clubs
    where clubs.id = p_club_id
  );
end;
$$;
revoke all on function public.owner_bot_day(bigint, uuid, uuid, date) from public, anon, authenticated, service_role;

-- A button row of this Telegram account; refuses another account's. Only a
-- choice row (p_choice true) is locked, so a repeated ✅ Да waits for the
-- first; line rows are shared by every message of the day and never locked.
create or replace function public.owner_bot_pending_row(p_telegram_user_id bigint, p_id uuid, p_choice boolean)
returns public.owner_bot_pending_actions
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  pending public.owner_bot_pending_actions;
begin
  if p_choice is true then
    select * into pending from public.owner_bot_pending_actions candidate
    where candidate.id = p_id and candidate.action is not null
    for update;
  else
    select * into pending from public.owner_bot_pending_actions candidate
    where candidate.id = p_id and (p_choice is null or candidate.action is null);
  end if;
  if pending.id is null then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  if pending.telegram_user_id is distinct from p_telegram_user_id then
    raise exception 'This button belongs to another Telegram account.' using errcode = '42501', hint = 'owner_bot_forbidden';
  end if;
  return pending;
end;
$$;
revoke all on function public.owner_bot_pending_row(bigint, uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.owner_bot_open_day(p_telegram_user_id bigint, p_club_id uuid, p_date date)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := public.owner_bot_act_as(p_telegram_user_id, p_club_id);
begin
  if p_date is null or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid business date.' using errcode = '22007';
  end if;
  return public.owner_bot_day(p_telegram_user_id, owner_id, p_club_id, p_date);
end;
$$;
revoke all on function public.owner_bot_open_day(bigint, uuid, date) from public, anon, authenticated;
grant execute on function public.owner_bot_open_day(bigint, uuid, date) to service_role;

create or replace function public.owner_bot_pending(p_telegram_user_id bigint, p_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  pending public.owner_bot_pending_actions := public.owner_bot_pending_row(p_telegram_user_id, p_id, null);
  owner_id uuid := public.owner_bot_act_as(p_telegram_user_id, pending.club_id);
begin
  if pending.expires_at <= now() then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  return public.owner_bot_day(p_telegram_user_id, owner_id, pending.club_id, pending.business_date)
    || jsonb_build_object('pending', jsonb_build_object(
      'id', pending.id,
      'payment_method', pending.payment_method,
      'action', pending.action,
      'amount', pending.amount));
end;
$$;
revoke all on function public.owner_bot_pending(bigint, uuid) from public, anon, authenticated;
grant execute on function public.owner_bot_pending(bigint, uuid) to service_role;

create or replace function public.owner_bot_choose(p_telegram_user_id bigint, p_line_id uuid, p_action text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  line public.owner_bot_pending_actions;
  owner_id uuid;
  in_till numeric;
  choice public.owner_bot_pending_actions;
begin
  if p_action is null or p_action not in ('collected', 'reserve') then
    raise exception 'Unknown owner bot action.' using errcode = '22023';
  end if;
  line := public.owner_bot_pending_row(p_telegram_user_id, p_line_id, false);
  owner_id := public.owner_bot_act_as(p_telegram_user_id, line.club_id);
  if line.expires_at <= now() then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  if exists (
    select 1 from public.owner_money_handovers handovers
    where handovers.club_id = line.club_id and handovers.business_date = line.business_date
      and handovers.side = 'game_club' and handovers.payment_method = line.payment_method and handovers.undone_at is null
  ) then
    raise exception 'This money has already been marked.' using errcode = 'P0001', hint = 'owner_bot_already_marked';
  end if;

  in_till := floor(coalesce((public.get_collection_balances(line.club_id, line.business_date)
    -> line.payment_method ->> 'till')::numeric, 0));
  if in_till <= 0 then
    raise exception 'Nothing of this method is left in the till.' using errcode = 'P0001', hint = 'owner_bot_nothing_in_till';
  end if;

  insert into public.owner_bot_pending_actions
    (telegram_user_id, club_id, business_date, payment_method, action, amount, request_id, expires_at)
  values (p_telegram_user_id, line.club_id, line.business_date, line.payment_method, p_action, in_till,
    gen_random_uuid(), now() + interval '1 hour')
  returning * into choice;

  return public.owner_bot_day(p_telegram_user_id, owner_id, line.club_id, line.business_date)
    || jsonb_build_object('pending', jsonb_build_object(
      'id', choice.id,
      'payment_method', choice.payment_method,
      'action', choice.action,
      'amount', choice.amount));
end;
$$;
revoke all on function public.owner_bot_choose(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_bot_choose(bigint, uuid, text) to service_role;

create or replace function public.owner_bot_confirm(
  p_telegram_user_id bigint, p_choice_id uuid, p_chat_id bigint default null, p_message_id bigint default null
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  choice public.owner_bot_pending_actions := public.owner_bot_pending_row(p_telegram_user_id, p_choice_id, true);
  owner_id uuid := public.owner_bot_act_as(p_telegram_user_id, choice.club_id);
  saved_id uuid := choice.handover_id;
  status text := 'already_saved';
begin
  if choice.used_at is not null then
    -- A resent ✅ Да after the mark was undone says so, not "saved".
    if exists (select 1 from public.owner_money_handovers handovers where handovers.id = saved_id and handovers.undone_at is not null) then
      status := 'already_undone';
    end if;
  else
    if choice.expires_at <= now() then
      raise exception 'This confirmation is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
    end if;
    -- One mark per method and day at a time, whichever owner presses.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'owner_bot_handover:' || choice.club_id::text || ':' || choice.business_date::text || ':' || choice.payment_method, 0));
    if exists (
      select 1 from public.owner_money_handovers handovers
      where handovers.club_id = choice.club_id and handovers.business_date = choice.business_date
        and handovers.side = 'game_club' and handovers.payment_method = choice.payment_method
        and handovers.undone_at is null and handovers.request_id <> choice.request_id
    ) then
      raise exception 'This money has already been marked.' using errcode = 'P0001', hint = 'owner_bot_already_marked';
    end if;

    perform public.collect_money(choice.club_id, choice.request_id, choice.business_date,
      jsonb_build_object(choice.payment_method, choice.amount), 'Telegram');
    if choice.action = 'reserve' then
      -- The reserve entry takes the collection's request id as its own id.
      perform public.move_collected_to_reserve(choice.club_id, choice.request_id, choice.business_date,
        choice.payment_method, choice.amount, 'Telegram');
    end if;

    insert into public.owner_money_handovers
      (club_id, business_date, side, payment_method, amount, action, request_id, telegram_chat_id, telegram_message_id, created_by)
    values (choice.club_id, choice.business_date, 'game_club', choice.payment_method, choice.amount, choice.action,
      choice.request_id, p_chat_id, p_message_id, owner_id)
    on conflict on constraint owner_money_handovers_request do nothing
    returning id into saved_id;
    if saved_id is null then
      select handovers.id into saved_id from public.owner_money_handovers handovers
      where handovers.club_id = choice.club_id and handovers.request_id = choice.request_id;
    end if;
    update public.owner_bot_pending_actions set used_at = now(), handover_id = saved_id where id = choice.id;
    status := 'saved';
  end if;

  return public.owner_bot_day(p_telegram_user_id, owner_id, choice.club_id, choice.business_date)
    || jsonb_build_object('result', jsonb_build_object(
      'status', status,
      'handover_id', saved_id,
      'payment_method', choice.payment_method,
      'action', choice.action,
      'amount', choice.amount));
end;
$$;
revoke all on function public.owner_bot_confirm(bigint, uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_confirm(bigint, uuid, bigint, bigint) to service_role;

create or replace function public.owner_bot_undo(p_telegram_user_id bigint, p_handover_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  handover public.owner_money_handovers;
  owner_id uuid;
  status text := 'already_undone';
begin
  select * into handover from public.owner_money_handovers candidate where candidate.id = p_handover_id for update;
  if handover.id is null then
    raise exception 'This button is no longer valid.' using errcode = 'P0002', hint = 'owner_bot_expired';
  end if;
  owner_id := public.owner_bot_act_as(p_telegram_user_id, handover.club_id);
  if handover.created_by is distinct from owner_id then
    raise exception 'Only the owner who saved this can undo it here.' using errcode = '42501', hint = 'owner_bot_forbidden';
  end if;

  if handover.undone_at is null then
    if handover.created_at + interval '10 minutes' <= now() then
      raise exception 'Undo is possible for 10 minutes only.' using errcode = 'P0001', hint = 'owner_bot_undo_expired';
    end if;
    if handover.side <> 'game_club' or handover.action not in ('collected', 'reserve') then
      raise exception 'This mark cannot be undone from the bot.' using errcode = 'P0001', hint = 'owner_bot_cannot_undo';
    end if;
    -- An owner may already have undone it in the app; then only the mark is left.
    if handover.action = 'reserve' and exists (
      select 1 from public.owner_reserve_entries entries
      where entries.club_id = handover.club_id and entries.id = handover.request_id
    ) then
      perform public.delete_owner_reserve_entry(handover.club_id, handover.request_id);
    end if;
    perform public.delete_money_collection(handover.club_id, handover.request_id);
    update public.owner_money_handovers set undone_at = now() where id = handover.id;
    status := 'undone';
  end if;

  return public.owner_bot_day(p_telegram_user_id, owner_id, handover.club_id, handover.business_date)
    || jsonb_build_object('result', jsonb_build_object(
      'status', status,
      'handover_id', handover.id,
      'payment_method', handover.payment_method,
      'action', handover.action,
      'amount', handover.amount));
end;
$$;
revoke all on function public.owner_bot_undo(bigint, uuid) from public, anon, authenticated;
grant execute on function public.owner_bot_undo(bigint, uuid) to service_role;
