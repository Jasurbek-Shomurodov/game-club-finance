-- 1. Salary entries and rates remember the club-group Telegram message that
--    announced them, so deleting the record removes that message too (as
--    expenses already do since 046). Both tables are select-only for app
--    users, so the coordinates are saved through a narrow RPC that only fills
--    them once.
-- 2. An owner can correct an expense's payment method. Expenses are otherwise
--    append-only for app users (083), so the change goes through a security
--    definer RPC that checks ownership and the club's enabled methods; the
--    protect_salary_expense trigger still refuses payroll-linked expenses.
-- Re-runnable.

alter table public.salary_entries
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_message_id bigint;
alter table public.salary_rates
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_message_id bigint;

alter table public.salary_entries drop constraint if exists salary_entries_telegram_message_coordinates_check;
alter table public.salary_entries add constraint salary_entries_telegram_message_coordinates_check check (
  (telegram_chat_id is null and telegram_message_id is null)
  or (nullif(btrim(telegram_chat_id), '') is not null and telegram_message_id > 0)
);
alter table public.salary_rates drop constraint if exists salary_rates_telegram_message_coordinates_check;
alter table public.salary_rates add constraint salary_rates_telegram_message_coordinates_check check (
  (telegram_chat_id is null and telegram_message_id is null)
  or (nullif(btrim(telegram_chat_id), '') is not null and telegram_message_id > 0)
);

create or replace function public.set_salary_record_telegram_message(
  p_club_id uuid, p_kind text, p_id uuid, p_chat_id text, p_message_id bigint
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'salaries') then
    raise exception 'Salary editing access is required.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null or p_message_id is null or p_message_id <= 0 then
    raise exception 'Invalid Telegram message.';
  end if;
  -- A newer announcement of the same rate (a same-day correction) replaces the
  -- older one; an entry is announced once, so its coordinates are set once.
  if p_kind = 'entry' then
    update public.salary_entries set telegram_chat_id = btrim(p_chat_id), telegram_message_id = p_message_id
      where club_id = p_club_id and id = p_id and deleted_at is null and telegram_message_id is null;
  elsif p_kind = 'rate' then
    update public.salary_rates set telegram_chat_id = btrim(p_chat_id), telegram_message_id = p_message_id
      where club_id = p_club_id and id = p_id and deleted_at is null;
  else
    raise exception 'Invalid salary record type.';
  end if;
end;
$$;
revoke all on function public.set_salary_record_telegram_message(uuid,text,uuid,text,bigint) from public, anon;
grant execute on function public.set_salary_record_telegram_message(uuid,text,uuid,text,bigint) to authenticated;

create or replace function public.update_expense_payment_method(
  p_club_id uuid, p_expense_id uuid, p_payment_method text
) returns void language plpgsql security definer set search_path = public as $$
declare methods text[];
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change an expense.' using errcode = '42501';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card') then
    raise exception 'Invalid payment method.';
  end if;
  select enabled_payment_methods into methods from public.clubs where id = p_club_id;
  if methods is not null and not (p_payment_method = any(methods)) then
    raise exception 'Payment method is not enabled for this club.';
  end if;
  update public.expenses set payment_method = p_payment_method
    where club_id = p_club_id and id = p_expense_id;
  if not found then raise exception 'Expense does not belong to this club.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.update_expense_payment_method(uuid,uuid,text) from public, anon;
grant execute on function public.update_expense_payment_method(uuid,uuid,text) to authenticated;
