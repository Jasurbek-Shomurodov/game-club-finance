-- A business date ticked as collected (096) is closed: its income and expenses
-- can no longer be added, changed, moved in or out, or deleted, by anyone. An
-- owner reopens the day by removing the tick (unmark_daily_cash_collected).
-- Locked ledgers: daily_cash_entries, expenses, debt_payments and
-- money_exchanges (every write), and new_debts (inserts only: a later payment
-- still updates its parent debt).
-- Every write path, including security definer RPCs, goes through these
-- triggers. Re-runnable.

create or replace function public.assert_day_not_collected(p_club_id uuid, p_date date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_club_id is not null and p_date is not null and exists (
    select 1 from public.daily_cash_collections where club_id = p_club_id and date = p_date
  ) then
    raise exception 'The money for % has been collected; this day is closed.', p_date
      using errcode = '55000', hint = 'day_collected';
  end if;
end;
$$;
revoke all on function public.assert_day_not_collected(uuid, date) from public, anon, authenticated;

create or replace function public.prevent_collected_day_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Saving or clearing the club group's Telegram message is bookkeeping, not money.
  if tg_op = 'UPDATE' and (to_jsonb(NEW) - array['telegram_chat_id', 'telegram_message_id', 'updated_at'])
    = (to_jsonb(OLD) - array['telegram_chat_id', 'telegram_message_id', 'updated_at']) then
    return NEW;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    -- Deleting a whole club takes its closed days with it.
    if tg_op = 'DELETE' and not exists (select 1 from public.clubs where id = OLD.club_id) then
      return OLD;
    end if;
    perform public.assert_day_not_collected(OLD.club_id, OLD.date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.assert_day_not_collected(NEW.club_id, NEW.date);
    return NEW;
  end if;
  return OLD;
end;
$$;
revoke all on function public.prevent_collected_day_changes() from public, anon, authenticated;

drop trigger if exists lock_collected_day on public.daily_cash_entries;
create trigger lock_collected_day before insert or update or delete on public.daily_cash_entries
for each row execute function public.prevent_collected_day_changes();

drop trigger if exists lock_collected_day on public.expenses;
create trigger lock_collected_day before insert or update or delete on public.expenses
for each row execute function public.prevent_collected_day_changes();

drop trigger if exists lock_collected_day on public.debt_payments;
create trigger lock_collected_day before insert or update or delete on public.debt_payments
for each row execute function public.prevent_collected_day_changes();

drop trigger if exists lock_collected_day on public.money_exchanges;
create trigger lock_collected_day before insert or update or delete on public.money_exchanges
for each row execute function public.prevent_collected_day_changes();

drop trigger if exists lock_collected_day on public.new_debts;
create trigger lock_collected_day before insert on public.new_debts
for each row execute function public.prevent_collected_day_changes();
