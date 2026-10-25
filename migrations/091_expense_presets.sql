-- Planned (preset) expenses. Each club keeps its own list of recurring costs
-- with a monthly planned amount, e.g. Electricity, iCafe, Server maintenance;
-- one club may have iCafe and another not. Staff record the real payment by
-- hand by picking the preset in the expense form, which links the expense to
-- it. Financial analysis compares the planned amount with the linked expenses.
--
-- A preset belongs to one side of the club (game club or bar money), so plans
-- are never added across the two businesses. Presets are archived, never
-- deleted, so expenses linked to them keep their label. Only owners manage
-- presets; members who can read expenses can read them. Re-runnable.

create table if not exists public.expense_presets (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  category text not null,
  payment_source text not null default 'game_club',
  monthly_amount numeric(14, 0) not null default 0,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint expense_presets_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint expense_presets_category_manual check (category in (
    'rent','electricity','internet','repair','cleaning','food_drinks',
    'marketing','equipment','tax','correction','discount','supplies','investments'
  )),
  constraint expense_presets_payment_source_valid check (payment_source in ('game_club', 'bar')),
  constraint expense_presets_monthly_amount_non_negative check (monthly_amount >= 0),
  constraint expense_presets_club_id_id_key unique (club_id, id)
);

comment on table public.expense_presets is
  'Club recurring expenses with a monthly planned amount; expenses link to them through expenses.preset_id.';

-- Two live presets of a club cannot share a name.
create unique index if not exists expense_presets_live_name_key
  on public.expense_presets (club_id, lower(btrim(name)))
  where archived_at is null;

alter table public.expense_presets enable row level security;

drop policy if exists "club_read_expense_presets" on public.expense_presets;
create policy "club_read_expense_presets" on public.expense_presets
  for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['dashboard', 'expenses', 'reports', 'owner_profit']::text[])));

drop policy if exists "club_owner_insert_expense_presets" on public.expense_presets;
create policy "club_owner_insert_expense_presets" on public.expense_presets
  for insert to authenticated
  with check (public.current_user_club_role(club_id) = 'owner' and archived_at is null);

drop policy if exists "club_owner_update_expense_presets" on public.expense_presets;
create policy "club_owner_update_expense_presets" on public.expense_presets
  for update to authenticated
  using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

-- Archive instead of delete; the club and author never change.
revoke delete, update on table public.expense_presets from anon, authenticated;
grant update (name, category, payment_source, monthly_amount, sort_order, archived_at)
  on table public.expense_presets to authenticated;

-- The link from an expense to its preset. The composite key keeps it inside
-- the expense's own club.
alter table public.expenses add column if not exists preset_id uuid;

alter table public.expenses drop constraint if exists expenses_preset_fkey;
alter table public.expenses
  add constraint expenses_preset_fkey
  foreign key (club_id, preset_id) references public.expense_presets (club_id, id);

create index if not exists idx_expenses_club_preset_date
  on public.expenses (club_id, preset_id, date)
  where preset_id is not null;

-- A linked expense must use a live preset and its category and money source,
-- so a plan only ever counts payments from its own side of the club.
create or replace function public.enforce_expense_preset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare preset public.expense_presets%rowtype;
begin
  if NEW.preset_id is null then
    return NEW;
  end if;
  select * into preset from public.expense_presets
    where club_id = NEW.club_id and id = NEW.preset_id;
  if not found or preset.archived_at is not null then
    raise exception 'Expense preset is not available.' using errcode = '23514';
  end if;
  if NEW.category is distinct from preset.category
    or coalesce(NEW.payment_source, 'game_club') is distinct from preset.payment_source then
    raise exception 'Expense does not match its preset.' using errcode = '23514';
  end if;
  return NEW;
end;
$$;

revoke execute on function public.enforce_expense_preset()
  from PUBLIC, anon, authenticated;

drop trigger if exists trg_expense_preset_guard on public.expenses;
create trigger trg_expense_preset_guard
  before insert on public.expenses
  for each row execute function public.enforce_expense_preset();
