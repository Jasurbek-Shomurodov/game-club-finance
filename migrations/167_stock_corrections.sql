-- Bar stock corrections: more units counted than the system expected.
--
-- The write-off dialog gains a third reason next to "shortage" and "expired":
-- "correction". It is saved as a positive inventory adjustment whose reason is
-- "correction" or "correction: note". The units join the available stock, so
-- the count can be saved without inventing sales; bar income, bar cost and bar
-- profit are unchanged (stock_write_off_quantity still counts only negative
-- shortage/expired adjustments, migration 141).
--
-- Admins may record a correction or raise it on the current business day,
-- exactly as they may add to a write-off (migration 164). Reducing or removing
-- one, switching its reason, and every other adjustment stay owner-only.
--
-- Only stock_write_off_is_addition changes; save_closing_stock_counts (164)
-- already defers the admin check to it.

create or replace function public.stock_write_off_is_addition(
  p_old_adjustment numeric,
  p_old_reason text,
  p_new_adjustment numeric,
  p_new_reason text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    (
      public.stock_write_off_quantity(p_new_adjustment, p_new_reason) > 0
      and coalesce(p_old_adjustment, 0) <= 0
      and p_new_adjustment <= coalesce(p_old_adjustment, 0)
      and (
        coalesce(p_old_adjustment, 0) = 0
        or (
          public.stock_write_off_quantity(p_old_adjustment, p_old_reason) > 0
          and substring(btrim(p_old_reason) from '^(shortage|expired)')
            = substring(btrim(p_new_reason) from '^(shortage|expired)')
        )
      )
    )
    or (
      coalesce(p_new_adjustment, 0) > 0
      and btrim(coalesce(p_new_reason, '')) ~ '^correction(:|$)'
      and coalesce(p_old_adjustment, 0) >= 0
      and p_new_adjustment >= coalesce(p_old_adjustment, 0)
      and (
        coalesce(p_old_adjustment, 0) = 0
        or btrim(coalesce(p_old_reason, '')) ~ '^correction(:|$)'
      )
    );
$$;

comment on function public.stock_write_off_is_addition(numeric, text, numeric, text) is
  'True when an adjustment change only records a write-off or correction, or adds to one of the same reason (the change an admin may make).';

revoke all on function public.stock_write_off_is_addition(numeric, text, numeric, text) from public, anon;
grant execute on function public.stock_write_off_is_addition(numeric, text, numeric, text) to authenticated;
