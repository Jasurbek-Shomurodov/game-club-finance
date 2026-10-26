-- Every new manual spending entry says what the money was for: a note of at
-- least 5 words on expenses, money exchanges, new debts, debt payments and
-- owner withdrawals. Inserts only, so existing rows with short or empty notes
-- stay valid and can still be corrected or deleted. Payroll expenses created
-- by the salary RPCs (salary_entry_id set) are exempt. Daily income, stock
-- purchases and profit carryovers are not covered.
-- A word is a whitespace-separated piece with at least one character that is
-- neither space nor punctuation; this never counts fewer words than the app's
-- countNoteWords (src/lib/entryNote.ts). Re-runnable.

create or replace function public.entry_note_word_count(p_note text)
returns integer language sql immutable set search_path = public as $$
  select count(*)::integer
  from regexp_split_to_table(btrim(coalesce(p_note, '')), '\s+') as piece
  where piece ~ '[^[:space:][:punct:]]'
$$;

create or replace function public.require_entry_note()
returns trigger language plpgsql set search_path = public as $$
declare
  row_data jsonb := to_jsonb(NEW);
begin
  if tg_table_name = 'expenses' and row_data ->> 'salary_entry_id' is not null then
    return NEW;
  end if;
  if public.entry_note_word_count(row_data ->> 'comment') < 5 then
    raise exception 'The note must have at least 5 words.'
      using errcode = '23514', hint = 'note_required';
  end if;
  return NEW;
end;
$$;
revoke all on function public.require_entry_note() from public, anon, authenticated;

drop trigger if exists require_entry_note on public.expenses;
create trigger require_entry_note before insert on public.expenses
for each row execute function public.require_entry_note();

drop trigger if exists require_entry_note on public.money_exchanges;
create trigger require_entry_note before insert on public.money_exchanges
for each row execute function public.require_entry_note();

drop trigger if exists require_entry_note on public.new_debts;
create trigger require_entry_note before insert on public.new_debts
for each row execute function public.require_entry_note();

drop trigger if exists require_entry_note on public.debt_payments;
create trigger require_entry_note before insert on public.debt_payments
for each row execute function public.require_entry_note();

drop trigger if exists require_entry_note on public.owner_withdrawals;
create trigger require_entry_note before insert on public.owner_withdrawals
for each row execute function public.require_entry_note();
