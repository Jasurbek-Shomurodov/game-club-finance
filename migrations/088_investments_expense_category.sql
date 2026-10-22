-- Adds the `investments` expense category (money put into growing the club,
-- such as new seats or upgrades). Re-runnable. The check gets a new name so
-- the Settings migration-health probe can tell this migration is applied.
alter table public.expenses drop constraint if exists expenses_category_known;
alter table public.expenses drop constraint if exists expenses_category_allowed;

alter table public.expenses
  add constraint expenses_category_allowed check (category in (
    'rent','salary','electricity','internet','repair','cleaning','food_drinks',
    'marketing','equipment','tax','correction','discount','supplies','investments'
  ));
