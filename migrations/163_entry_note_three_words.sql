-- A required entry note needs at least 3 words instead of 5 (108, 135, 151).
-- The app's MIN_NOTE_WORDS (src/lib/entryNote.ts) is lowered in the same change.
-- require_entry_note (expenses, money exchanges, debts, debt payments, owner
-- withdrawals) and record_cash_shortage are redefined with the new minimum;
-- everything else in them is unchanged from 108 and 151. Re-runnable.

create or replace function public.require_entry_note()
returns trigger language plpgsql set search_path = public as $$
declare
  row_data jsonb := to_jsonb(NEW);
begin
  if tg_table_name = 'expenses' and row_data ->> 'salary_entry_id' is not null then
    return NEW;
  end if;
  if public.entry_note_word_count(row_data ->> 'comment') < 3 then
    raise exception 'The note must have at least 3 words.'
      using errcode = '23514', hint = 'note_required';
  end if;
  return NEW;
end;
$$;
revoke all on function public.require_entry_note() from public, anon, authenticated;

create or replace function public.record_cash_shortage(
  p_club_id uuid, p_id uuid, p_date date, p_payment_source text, p_payment_method text,
  p_amount numeric, p_reason text, p_employee_id uuid, p_comment text,
  p_recover_amount numeric default 0, p_recovery_id uuid default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare existing public.cash_shortages; shortage public.cash_shortages; methods text[]; note text := btrim(coalesce(p_comment, ''));
  employee_name text; month_start date; available numeric;
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
  if public.entry_note_word_count(note) < 3 then
    raise exception 'The note must have at least 3 words.' using errcode = '23514', hint = 'note_required';
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

  -- Never more than the month still has on that side (and, for the Game Club, in that method).
  month_start := date_trunc('month', p_date)::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_payment_source || ':' || month_start::text, 0));
  available := greatest(0, public.owner_profit_bucket_available(
    p_club_id, p_payment_source, case when p_payment_source = 'game_club' then p_payment_method end, month_start));
  if p_amount > available then
    raise exception 'The shortage is more than the month has: % available', available
      using errcode = '23514', hint = 'shortage_exceeds_available';
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
