-- Planned expense integrity (follows 091). Re-runnable.
--
-- 1. A preset's category and money source are fixed once an expense links to
--    it. Financial analysis places linked payments by the preset's current
--    source, so moving "Electricity" from game club to bar money would count
--    game-club payments under the bar plan. Name, monthly amount, order and
--    archiving stay editable.
-- 2. created_by is the signed-in owner on insert, as 086 does for expenses.
-- 3. The preset category list must stay the expense category list without
--    `salary` (expenses_category_allowed, 088); migrationReplay.test.ts fails
--    when the two drift, so a migration adding a category updates both.

create or replace function public.enforce_expense_preset_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (NEW.category is distinct from OLD.category or NEW.payment_source is distinct from OLD.payment_source)
    and exists (
      select 1 from public.expenses
      where club_id = OLD.club_id and preset_id = OLD.id
    ) then
    raise exception 'Expense preset already has payments; its category and money source cannot change.'
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

revoke execute on function public.enforce_expense_preset_terms()
  from PUBLIC, anon, authenticated;

drop trigger if exists trg_expense_preset_terms_guard on public.expense_presets;
create trigger trg_expense_preset_terms_guard
  before update of category, payment_source on public.expense_presets
  for each row execute function public.enforce_expense_preset_terms();

drop policy if exists "club_owner_insert_expense_presets" on public.expense_presets;
create policy "club_owner_insert_expense_presets" on public.expense_presets
  for insert to authenticated
  with check (
    public.current_user_club_role(club_id) = 'owner'
    and archived_at is null
    and created_by = (select auth.uid())
  );

comment on constraint expense_presets_category_manual on public.expense_presets is
  'Every expenses_category_allowed category except salary; keep the two lists in step.';
