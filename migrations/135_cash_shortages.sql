-- Cash shortages (kamomad): money that should be in the till but is not,
-- because an admin took it, handed over too little, or nobody knows.
--
-- A shortage is its own ledger row (who, why, which money) and, like a salary
-- payment (059), creates one linked expense in the `shortage` category in the
-- same transaction. That expense is what every existing total already reads,
-- so the dashboard, reports, Owner Profit limits, KPI profit and the daily
-- Telegram report all lose the missing money without a second formula. The
-- linked expense cannot be edited, moved or deleted on its own, and a
-- `shortage` expense cannot exist without a shortage.
--
-- Part of a shortage can be recovered from the responsible employee's salary:
-- the recovery is an ordinary salary fine (salary_entries, kind `fine`) that
-- names the shortage. Actually lost = amount - live recovery fines. Deleting
-- such a fine in Salaries (soft delete, 062/113) makes that part lost again.
--
-- Only owners record, recover, delete or read shortages. Shortages are not
-- limited by the method balance (125): the money is gone whatever the ledger
-- says. A collected day (097) stays closed to them like any other expense.
-- Re-runnable.

create table if not exists public.cash_shortages (
  id uuid primary key, -- caller's retry/idempotency key
  club_id uuid not null references public.clubs(id) on delete cascade,
  date date not null,
  payment_source text not null check (payment_source in ('game_club', 'bar')),
  payment_method text not null check (payment_method in ('cash', 'terminal', 'card', 'playstation')),
  amount numeric(16,2) not null check (amount > 0 and amount < 100000000000000 and amount = round(amount)),
  reason text not null check (reason in ('stolen', 'short_handover', 'unknown')),
  employee_id uuid,
  comment text not null check (length(comment) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (club_id, id),
  foreign key (club_id, employee_id) references public.salary_employees(club_id, id),
  check (payment_method <> 'playstation' or payment_source = 'game_club')
);
create index if not exists cash_shortages_club_date on public.cash_shortages(club_id, date);

alter table public.cash_shortages enable row level security;
revoke all on public.cash_shortages from public, anon, authenticated;
grant select on public.cash_shortages to authenticated;
drop policy if exists cash_shortages_owner_read on public.cash_shortages;
create policy cash_shortages_owner_read on public.cash_shortages for select to authenticated
  using (public.current_user_club_role(club_id) = 'owner');

-- The linked expense goes with its shortage.
alter table public.expenses add column if not exists cash_shortage_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_cash_shortage_fk') then
    alter table public.expenses add constraint expenses_cash_shortage_fk
      foreign key (club_id, cash_shortage_id) references public.cash_shortages(club_id, id) on delete cascade;
  end if;
end;
$$;
create unique index if not exists expenses_cash_shortage_unique
  on public.expenses(club_id, cash_shortage_id) where cash_shortage_id is not null;

-- A recovery fine keeps its row (and its deletion history) if the shortage goes.
alter table public.salary_entries add column if not exists cash_shortage_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salary_entries_cash_shortage_fk') then
    alter table public.salary_entries add constraint salary_entries_cash_shortage_fk
      foreign key (club_id, cash_shortage_id) references public.cash_shortages(club_id, id)
      on delete set null (cash_shortage_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_entries_cash_shortage_fine') then
    alter table public.salary_entries add constraint salary_entries_cash_shortage_fine
      check (cash_shortage_id is null or kind = 'fine');
  end if;
end;
$$;
create index if not exists salary_entries_cash_shortage
  on public.salary_entries(club_id, cash_shortage_id) where cash_shortage_id is not null;

-- 088's list plus `shortage`, written only through record_cash_shortage.
alter table public.expenses drop constraint if exists expenses_category_allowed;
alter table public.expenses drop constraint if exists expenses_category_with_shortage;
alter table public.expenses
  add constraint expenses_category_with_shortage check (category in (
    'rent','salary','electricity','internet','repair','cleaning','food_drinks',
    'marketing','equipment','tax','correction','discount','supplies','investments','shortage'
  ));

create or replace function public.protect_cash_shortage_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare shortage public.cash_shortages;
  bookkeeping constant text[] := array['telegram_chat_id', 'telegram_message_id', 'updated_at'];
begin
  if TG_OP = 'DELETE' then
    -- Allowed only once the shortage itself is gone (its cascade, or the club's).
    if OLD.cash_shortage_id is not null and exists (
      select 1 from public.cash_shortages where club_id = OLD.club_id and id = OLD.cash_shortage_id
    ) then
      raise exception 'A shortage expense is deleted with its shortage.' using errcode = '42501', hint = 'shortage_expense';
    end if;
    return OLD;
  end if;
  if TG_OP = 'UPDATE' and (OLD.cash_shortage_id is not null or NEW.cash_shortage_id is not null)
    and (to_jsonb(NEW) - bookkeeping) <> (to_jsonb(OLD) - bookkeeping) then
    raise exception 'A shortage expense cannot be edited.' using errcode = '42501', hint = 'shortage_expense';
  end if;
  if NEW.category = 'shortage' and NEW.cash_shortage_id is null then
    raise exception 'Shortages are recorded on their own, not as an expense.' using errcode = '23514', hint = 'shortage_expense';
  end if;
  if NEW.cash_shortage_id is not null then
    select * into shortage from public.cash_shortages where club_id = NEW.club_id and id = NEW.cash_shortage_id;
    if not found or NEW.category <> 'shortage' or NEW.salary_entry_id is not null
      or NEW.amount is distinct from shortage.amount or NEW.date is distinct from shortage.date
      or NEW.payment_source is distinct from shortage.payment_source
      or NEW.payment_method is distinct from shortage.payment_method
      or NEW.created_by is distinct from shortage.created_by then
      raise exception 'Invalid shortage expense.' using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.protect_cash_shortage_expense() from public, anon, authenticated;
-- Named to run before expenses_method_balance (triggers fire in name order),
-- so a refused shortage expense reports why, not a balance error.
drop trigger if exists expenses_cash_shortage_guard on public.expenses;
create trigger expenses_cash_shortage_guard before insert or update or delete on public.expenses
  for each row execute function public.protect_cash_shortage_expense();

-- 125 unchanged, except a shortage is not limited by what the method holds.
create or replace function public.enforce_expense_method_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  available numeric;
  spent numeric;
  spent_before numeric;
  method text;
begin
  -- Plain assignments: PL/pgSQL ends an IF condition at the first THEN, even one inside a CASE.
  spent := case when new.payment_method = 'usd' then new.usd_amount else new.amount end;
  if tg_op = 'UPDATE' then
    spent_before := case when old.payment_method = 'usd' then old.usd_amount else old.amount end;
  end if;
  method := case when new.payment_method in ('cash', 'terminal', 'playstation', 'usd') then new.payment_method else 'card' end;
  if auth.uid() is null
    or new.salary_entry_id is not null
    or new.cash_shortage_id is not null
    or coalesce(new.payment_source, 'game_club') <> 'game_club' then
    return new;
  end if;
  -- A correction that spends no more from the same method and month is always fine.
  if tg_op = 'UPDATE'
    and old.payment_method is not distinct from new.payment_method
    and coalesce(old.payment_source, 'game_club') = 'game_club'
    and (new.payment_method = 'usd' or date_trunc('month', old.date) = date_trunc('month', new.date))
    and spent <= spent_before then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || new.club_id::text, 0));
  available := public.expense_method_balance(new.club_id, method, new.date, new.id);
  if spent > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;
  return new;
end;
$$;

-- What is still lost of a shortage: its amount minus the live recovery fines.
create or replace function public.cash_shortage_recovered(p_club_id uuid, p_shortage_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.salary_entries
  where club_id = p_club_id and cash_shortage_id = p_shortage_id and kind = 'fine' and deleted_at is null
$$;
revoke all on function public.cash_shortage_recovered(uuid, uuid) from public, anon, authenticated;

-- Adds a salary fine for the shortage's employee. The caller holds the shortage lock.
create or replace function public.add_cash_shortage_fine(
  p_shortage public.cash_shortages, p_request_id uuid, p_amount numeric, p_comment text
) returns void language plpgsql security definer set search_path = public as $$
declare employee public.salary_employees; fine_date date;
begin
  if p_shortage.employee_id is null then
    raise exception 'Choose who is responsible before recovering from salary.' using errcode = '23514', hint = 'shortage_no_employee';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount)
    or p_amount > p_shortage.amount - public.cash_shortage_recovered(p_shortage.club_id, p_shortage.id) then
    raise exception 'The recovery is more than is still lost.' using errcode = '23514', hint = 'shortage_recovery_too_large';
  end if;
  -- The same lock as every other payroll write for this employee.
  perform pg_advisory_xact_lock(hashtextextended(p_shortage.employee_id::text, 0));
  select * into employee from public.salary_employees
    where club_id = p_shortage.club_id and id = p_shortage.employee_id for update;
  fine_date := greatest(p_shortage.date, employee.joined_on);
  if fine_date > public.club_business_date(p_shortage.club_id) then
    fine_date := public.club_business_date(p_shortage.club_id);
  end if;
  insert into public.salary_entries(id, club_id, employee_id, date, kind, amount, comment, created_by, cash_shortage_id)
    values (p_request_id, p_shortage.club_id, p_shortage.employee_id, fine_date, 'fine', p_amount,
      left(coalesce(p_comment, ''), 1000), auth.uid(), p_shortage.id);
end;
$$;
revoke all on function public.add_cash_shortage_fine(public.cash_shortages, uuid, numeric, text) from public, anon, authenticated;

create or replace function public.record_cash_shortage(
  p_club_id uuid, p_id uuid, p_date date, p_payment_source text, p_payment_method text,
  p_amount numeric, p_reason text, p_employee_id uuid, p_comment text,
  p_recover_amount numeric default 0, p_recovery_id uuid default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare existing public.cash_shortages; shortage public.cash_shortages; methods text[]; note text := btrim(coalesce(p_comment, ''));
  employee_name text;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can record a shortage.' using errcode = '42501';
  end if;
  if p_id is null or p_date is null or p_date > public.club_business_date(p_club_id)
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_payment_source not in ('game_club', 'bar')
    or p_payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or (p_payment_method = 'playstation' and p_payment_source <> 'game_club')
    or p_reason not in ('stolen', 'short_handover', 'unknown') then
    raise exception 'Invalid shortage.' using errcode = '23514';
  end if;
  if public.entry_note_word_count(note) < 5 then
    raise exception 'The note must have at least 5 words.' using errcode = '23514', hint = 'note_required';
  end if;
  if p_payment_method <> 'playstation' then
    select enabled_payment_methods into methods from public.clubs where id = p_club_id;
    if methods is not null and not (p_payment_method = any(methods)) then
      raise exception 'Payment method is not enabled for this club.' using errcode = '23514';
    end if;
  end if;
  if p_employee_id is not null then
    select name into employee_name from public.salary_employees where club_id = p_club_id and id = p_employee_id;
    if not found then raise exception 'Employee does not belong to this club.' using errcode = 'P0002'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cash_shortage:' || p_id::text, 0));
  select * into existing from public.cash_shortages where club_id = p_club_id and id = p_id;
  if found then
    -- A retry of the same submit is saved once.
    if existing.date is distinct from p_date or existing.amount is distinct from p_amount
      or existing.payment_source is distinct from p_payment_source or existing.payment_method is distinct from p_payment_method
      or existing.reason is distinct from p_reason or existing.employee_id is distinct from p_employee_id
      or existing.comment is distinct from note then
      raise exception 'This request has already been used for a different shortage.';
    end if;
    return false;
  end if;

  insert into public.cash_shortages(id, club_id, date, payment_source, payment_method, amount, reason, employee_id, comment, created_by)
    values (p_id, p_club_id, p_date, p_payment_source, p_payment_method, p_amount, p_reason, p_employee_id, note, auth.uid())
    returning * into shortage;
  insert into public.expenses(club_id, date, amount, category, payment_method, payment_source, comment, created_by, cash_shortage_id)
    values (p_club_id, p_date, p_amount, 'shortage', p_payment_method, p_payment_source,
      case when employee_name is null then note else employee_name || ': ' || note end, auth.uid(), p_id);
  if coalesce(p_recover_amount, 0) > 0 then
    if p_recovery_id is null then raise exception 'Invalid shortage.' using errcode = '23514'; end if;
    perform public.add_cash_shortage_fine(shortage, p_recovery_id, p_recover_amount, note);
  end if;
  return true;
end;
$$;
revoke all on function public.record_cash_shortage(uuid,uuid,date,text,text,numeric,text,uuid,text,numeric,uuid) from public, anon;
grant execute on function public.record_cash_shortage(uuid,uuid,date,text,text,numeric,text,uuid,text,numeric,uuid) to authenticated;

create or replace function public.recover_cash_shortage(
  p_club_id uuid, p_shortage_id uuid, p_request_id uuid, p_amount numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare shortage public.cash_shortages; existing public.salary_entries;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can recover a shortage.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'Invalid recovery.' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cash_shortage:' || p_shortage_id::text, 0));
  select * into shortage from public.cash_shortages where club_id = p_club_id and id = p_shortage_id;
  if not found then raise exception 'Shortage does not belong to this club.' using errcode = 'P0002'; end if;
  select * into existing from public.salary_entries where club_id = p_club_id and id = p_request_id;
  if found then
    if existing.cash_shortage_id is distinct from p_shortage_id or existing.amount is distinct from p_amount then
      raise exception 'This request has already been used for a different entry.';
    end if;
    return false;
  end if;
  perform public.add_cash_shortage_fine(shortage, p_request_id, p_amount, shortage.comment);
  return true;
end;
$$;
revoke all on function public.recover_cash_shortage(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function public.recover_cash_shortage(uuid,uuid,uuid,numeric) to authenticated;

-- Removes a shortage recorded by mistake, with its expense. Live recovery
-- fines must be deleted in Salaries first, so no fine outlives its reason.
create or replace function public.delete_cash_shortage(p_club_id uuid, p_shortage_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can delete a shortage.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cash_shortage:' || p_shortage_id::text, 0));
  if not exists (select 1 from public.cash_shortages where club_id = p_club_id and id = p_shortage_id) then
    raise exception 'Shortage does not belong to this club.' using errcode = 'P0002';
  end if;
  if public.cash_shortage_recovered(p_club_id, p_shortage_id) > 0 then
    raise exception 'Delete the salary fines that recover this shortage first.' using errcode = '23514', hint = 'shortage_has_recoveries';
  end if;
  -- The linked expense cascades; the collected-day lock (097) still applies to it.
  delete from public.cash_shortages where club_id = p_club_id and id = p_shortage_id;
end;
$$;
revoke all on function public.delete_cash_shortage(uuid,uuid) from public, anon;
grant execute on function public.delete_cash_shortage(uuid,uuid) to authenticated;

-- Edit and delete history (111) covers the new ledger.
drop trigger if exists record_entry_audit on public.cash_shortages;
create trigger record_entry_audit after update or delete on public.cash_shortages
  for each row execute function public.record_entry_audit();
