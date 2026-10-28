-- Edit and delete history for finance entries. Every update and delete of a
-- row in the money ledgers below keeps the row as it was and (for updates) as
-- it became, who did it, and the club business date it happened on. Owners
-- read it on /history; nobody can write, change or erase it through the API,
-- because the rows are inserted only by this security-definer trigger.
--
-- Updates that change nothing but bookkeeping columns are skipped: Telegram
-- message coordinates, updated_at, and the paid/remaining/status totals a debt
-- payment writes into its debt (that payment is its own entry). Inserts are not
-- logged; the entry itself is the record of its creation.
-- A whole club being deleted cascades its ledgers without logging them, and
-- the club's history goes with it. Re-runnable.

create table if not exists public.entry_audit_logs (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  table_name text not null,
  row_id text,
  action text not null check (action in ('update', 'delete')),
  old_row jsonb not null,
  new_row jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  changed_on date not null,
  constraint entry_audit_logs_new_row_matches_action
    check ((action = 'update') = (new_row is not null))
);

create index if not exists entry_audit_logs_club_changed_idx
  on public.entry_audit_logs (club_id, changed_on desc, id desc);

alter table public.entry_audit_logs enable row level security;
revoke all on public.entry_audit_logs from public, anon, authenticated;
grant select on public.entry_audit_logs to authenticated;
drop policy if exists entry_audit_logs_owner_read on public.entry_audit_logs;
create policy entry_audit_logs_owner_read on public.entry_audit_logs for select to authenticated
  using (public.current_user_club_role(club_id) = 'owner');

create or replace function public.record_entry_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ignored constant text[] := array[
    'telegram_chat_id', 'telegram_message_id', 'updated_at',
    'paid_amount', 'remaining_amount', 'status'
  ];
  old_data jsonb := to_jsonb(OLD);
  new_data jsonb;
  target_club uuid := (to_jsonb(OLD) ->> 'club_id')::uuid;
begin
  if tg_op = 'UPDATE' then
    new_data := to_jsonb(NEW);
    if (old_data - ignored) = (new_data - ignored) then
      return NEW;
    end if;
  end if;

  -- The club itself is being deleted: its history goes too.
  if not exists (select 1 from public.clubs where id = target_club) then
    return coalesce(NEW, OLD);
  end if;

  insert into public.entry_audit_logs
    (club_id, table_name, row_id, action, old_row, new_row, changed_by, changed_on)
  values (
    target_club,
    tg_table_name,
    old_data ->> 'id',
    lower(tg_op),
    old_data,
    new_data,
    auth.uid(),
    public.club_business_date(target_club, now())
  );
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.record_entry_audit() from public, anon, authenticated;

do $$
declare
  audited text;
begin
  foreach audited in array array[
    'daily_cash_entries', 'expenses', 'money_exchanges', 'stock_purchases',
    'owner_withdrawals', 'owner_profit_carryovers', 'new_debts', 'debt_payments',
    'daily_cash_collections'
  ] loop
    execute format('drop trigger if exists record_entry_audit on public.%I', audited);
    execute format(
      'create trigger record_entry_audit after update or delete on public.%I '
      'for each row execute function public.record_entry_audit()',
      audited
    );
  end loop;
end;
$$;
