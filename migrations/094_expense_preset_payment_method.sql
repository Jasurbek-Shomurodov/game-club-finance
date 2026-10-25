-- A planned expense (091) may name its usual payment method (cash, terminal
-- or card). Picking the plan in the expense form preselects that method; the
-- person recording the payment can still choose another enabled one, so the
-- method is a default, not a rule, and expenses are not checked against it.
-- Null means no usual method. Re-runnable.

alter table public.expense_presets add column if not exists payment_method text;

alter table public.expense_presets drop constraint if exists expense_presets_payment_method_valid;
alter table public.expense_presets add constraint expense_presets_payment_method_valid
  check (payment_method is null or payment_method in ('cash', 'terminal', 'card'));

grant update (payment_method) on table public.expense_presets to authenticated;
