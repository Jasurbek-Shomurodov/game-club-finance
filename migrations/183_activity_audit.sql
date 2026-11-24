-- Activity notices (docs/plans/activity-history.md): every change investors
-- should hear about is kept in entry_audit_logs and announced in the club's
-- Telegram group.
--
-- 1. entry_audit_logs (111) also keeps creations: action 'insert' with only
--    new_row. A row can be marked notice_pending: a Telegram notice for it is
--    still to be sent.
-- 2. record_activity_audit() captures inserts, deletes and changes of the
--    watched columns of the tables below. record_entry_audit (111) is not
--    changed and keeps logging the money ledgers' edits and deletes.
-- 3. mark_audit_notice_pending() marks the rows whose change has no notice of
--    its own; claim_activity_notices() hands them to the sender once,
--    release_activity_notices() gives back the ones it could not send, and
--    expire_activity_notices() drops what is older than three days. All
--    three are for the service role only.
--
-- No row is changed or removed. Statements that drop something, all to widen
-- entry_audit_logs, never data:
--   DROP CONSTRAINT: both check constraints of entry_audit_logs, recreated
--     wider below (the row check under its 111 name); every existing row
--     satisfies them.
--   ALTER COLUMN old_row DROP NOT NULL: an insert has no old row.
--   DROP TRIGGER IF EXISTS: only the triggers this file creates, so it can
--     run again.
-- Re-runnable.

alter table public.entry_audit_logs alter column old_row drop not null;
alter table public.entry_audit_logs add column if not exists notice_pending boolean not null default false;

-- 111 created the action check inline, so its name is the server's choice:
-- drop whichever checks the table has, then add the wider pair. The row
-- check keeps 111's name, which the Settings migration probes look for.
do $$
declare
  check_name text;
begin
  for check_name in
    select conname from pg_constraint
    where conrelid = 'public.entry_audit_logs'::regclass and contype = 'c'
  loop
    execute format('alter table public.entry_audit_logs drop constraint %I', check_name);
  end loop;
end;
$$;
alter table public.entry_audit_logs add constraint entry_audit_logs_action_valid
  check (action in ('insert', 'update', 'delete'));
alter table public.entry_audit_logs add constraint entry_audit_logs_new_row_matches_action
  check (
    (action = 'insert' and old_row is null and new_row is not null)
    or (action = 'update' and old_row is not null and new_row is not null)
    or (action = 'delete' and old_row is not null and new_row is null)
  );

create index if not exists entry_audit_logs_notice_pending_idx
  on public.entry_audit_logs (club_id, id)
  where notice_pending;

-- Trigger arguments: the club column, the row-id column, then the watched
-- columns. An insert keeps new_row, a delete old_row, an update both, and an
-- update is logged only when a watched column changed. A change another
-- table's trigger makes (a purchase moving a product's cost) is that table's
-- record and is not logged twice.
create or replace function public.record_activity_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_data jsonb := case when tg_op <> 'INSERT' then to_jsonb(OLD) end;
  new_data jsonb := case when tg_op <> 'DELETE' then to_jsonb(NEW) end;
  row_data jsonb := coalesce(new_data, old_data);
  target_club uuid := (row_data ->> tg_argv[0])::uuid;
  changed boolean := tg_nargs <= 2;
  i integer;
begin
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 then
      return NEW;
    end if;
    for i in 2 .. tg_nargs - 1 loop
      if (old_data -> tg_argv[i]) is distinct from (new_data -> tg_argv[i]) then
        changed := true;
        exit;
      end if;
    end loop;
    if not changed then
      return NEW;
    end if;
  end if;

  -- The club itself is being deleted: its history goes too.
  if target_club is null or not exists (select 1 from public.clubs where id = target_club) then
    return coalesce(NEW, OLD);
  end if;

  insert into public.entry_audit_logs
    (club_id, table_name, row_id, action, old_row, new_row, changed_by, changed_on)
  values (
    target_club,
    tg_table_name,
    row_data ->> tg_argv[1],
    lower(tg_op),
    old_data,
    new_data,
    auth.uid(),
    public.club_business_date(target_club, now())
  );
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.record_activity_audit() from public, anon, authenticated;

do $$
declare
  watched record;
begin
  for watched in
    select * from (values
      ('products', 'insert or update', 'club_id', 'id',
        array['name', 'category', 'sale_price', 'cost_price', 'low_stock_threshold', 'is_active', 'is_deleted']),
      ('daily_stock_counts', 'update', 'club_id', 'id',
        array['closing_stock', 'adjustment_quantity', 'adjustment_reason']),
      ('promotions', 'insert or update or delete', 'club_id', 'id',
        array['name', 'product_id', 'free_quantity', 'min_spend', 'starts_on', 'ends_on', 'is_active']),
      ('club_memberships', 'insert or update or delete', 'club_id', 'user_id',
        array['role', 'feature_access']),
      ('clubs', 'update', 'id', 'id',
        array['name', 'address', 'business_day_start_hour', 'enabled_payment_methods', 'internet_payment_day']),
      ('expense_presets', 'insert or update', 'club_id', 'id',
        array['name', 'category', 'payment_source', 'payment_method', 'monthly_amount', 'archived_at']),
      ('salary_employees', 'update', 'club_id', 'id',
        array['name', 'job_title']),
      ('salary_entries', 'update', 'club_id', 'id',
        array['payment_method', 'payment_source']),
      ('owner_withdrawals', 'insert', 'club_id', 'id', array[]::text[]),
      ('owner_profit_carryovers', 'insert', 'club_id', 'id', array[]::text[]),
      ('stock_purchases', 'insert', 'club_id', 'id', array[]::text[]),
      ('new_debts', 'insert', 'club_id', 'id', array[]::text[]),
      ('debt_payments', 'insert', 'club_id', 'id', array[]::text[])
    ) as t(table_name, events, club_column, id_column, columns)
  loop
    execute format('drop trigger if exists record_activity_audit on public.%I', watched.table_name);
    execute format(
      'create trigger record_activity_audit after %s on public.%I '
      'for each row execute function public.record_activity_audit(%s)',
      watched.events,
      watched.table_name,
      (select string_agg(quote_literal(argument), ', ')
        from unnest(array[watched.club_column, watched.id_column] || watched.columns) as argument)
    );
  end loop;
end;
$$;

-- Two creations that are not a ledger of their own: a shortage recovered
-- from salary (a fine carrying cash_shortage_id, 135) and collected money
-- moved into the reserve (169).
drop trigger if exists record_activity_audit_recovery on public.salary_entries;
create trigger record_activity_audit_recovery after insert on public.salary_entries
  for each row when (new.cash_shortage_id is not null)
  execute function public.record_activity_audit('club_id', 'id');

drop trigger if exists record_activity_audit_collected on public.owner_reserve_entries;
create trigger record_activity_audit_collected after insert on public.owner_reserve_entries
  for each row when (new.from_collected)
  execute function public.record_activity_audit('club_id', 'id');

-- A row is still to be announced when its change has no notice of its own:
-- every creation (only record_activity_audit writes them), every change of
-- products, stock counts, promotions, team access, club settings and planned
-- expenses, and the edits and deletes of collected money, cash shortages,
-- owner withdrawals, profit carryovers and stock purchases. Salary employee
-- and payment-method changes are kept but not marked: /api/salaries and
-- PATCH /api/expenses announce them.
create or replace function public.mark_audit_notice_pending()
returns trigger language plpgsql set search_path = public as $$
begin
  NEW.notice_pending := NEW.action = 'insert' or NEW.table_name in (
    'products', 'daily_stock_counts', 'promotions', 'club_memberships', 'clubs', 'expense_presets',
    'money_collections', 'cash_shortages',
    'owner_withdrawals', 'owner_profit_carryovers', 'stock_purchases'
  );
  return NEW;
end;
$$;
revoke all on function public.mark_audit_notice_pending() from public, anon, authenticated;

drop trigger if exists mark_audit_notice_pending on public.entry_audit_logs;
create trigger mark_audit_notice_pending before insert on public.entry_audit_logs
  for each row execute function public.mark_audit_notice_pending();

-- Hands the oldest pending rows of one club to the sender, once: each row is
-- unmarked as it is returned, and rows another sender holds are skipped.
-- Rows older than three days are never handed out; a notice that late would
-- only confuse the group (expire_activity_notices unmarks them).
create or replace function public.claim_activity_notices(p_club_id uuid, p_limit integer default 50)
returns setof public.entry_audit_logs
language plpgsql security definer set search_path = public as $$
begin
  return query
    with claimed as (
      update public.entry_audit_logs logs
      set notice_pending = false
      where logs.id in (
        select pending.id
        from public.entry_audit_logs pending
        where pending.club_id = p_club_id and pending.notice_pending
          and pending.changed_at >= now() - interval '3 days'
        order by pending.id
        limit greatest(1, least(coalesce(p_limit, 50), 200))
        for update skip locked
      )
      returning logs.*
    )
    select * from claimed order by claimed.id;
end;
$$;
revoke all on function public.claim_activity_notices(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_activity_notices(uuid, integer) to service_role;

-- Gives claimed rows whose notice was not sent (Telegram refused it for now,
-- or the sender ran out of time) back to the next sender. Only rows of that
-- club that are still young enough to be announced.
create or replace function public.release_activity_notices(p_club_id uuid, p_ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  released integer;
begin
  update public.entry_audit_logs
  set notice_pending = true
  where club_id = p_club_id and id = any(coalesce(p_ids, array[]::bigint[]))
    and not notice_pending and changed_at >= now() - interval '3 days';
  get diagnostics released = row_count;
  return released;
end;
$$;
revoke all on function public.release_activity_notices(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.release_activity_notices(uuid, bigint[]) to service_role;

-- Unmarks every club's pending rows older than three days, including clubs
-- with no Telegram group, whose rows nobody claims. Run by the daily report.
create or replace function public.expire_activity_notices()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  expired integer;
begin
  update public.entry_audit_logs
  set notice_pending = false
  where notice_pending and changed_at < now() - interval '3 days';
  get diagnostics expired = row_count;
  return expired;
end;
$$;
revoke all on function public.expire_activity_notices() from public, anon, authenticated;
grant execute on function public.expire_activity_notices() to service_role;
