-- Owner Profit needs each withdrawal's payment method (066). The 050 snapshot
-- omits it, so the page used to read every withdrawal again in a second query.
--
-- get_owner_profit_snapshot (050) is left untouched: migration health (052)
-- fingerprints its exact body, and payroll (065/070) reuses it. This wrapper
-- returns the same payload with withdrawalRows extended by payment_method.
-- Like 050 it runs as the caller, so RLS and the club access check still apply.

create or replace function public.get_owner_profit_snapshot_with_methods(
  p_club_id uuid,
  p_through_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  -- The 050 snapshot authorizes the caller for the club and raises otherwise.
  return public.get_owner_profit_snapshot(p_club_id, p_through_date)
    || jsonb_build_object('withdrawalRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.period_month desc, rows.created_at desc, rows.id)
      from (
        select id, club_id, period_month, source, payment_method, amount, comment, created_by, created_at, updated_at
        from public.owner_withdrawals
        where club_id = p_club_id and period_month <= date_trunc('month', p_through_date)::date
      ) rows
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.get_owner_profit_snapshot_with_methods(uuid, date) from public, anon;
grant execute on function public.get_owner_profit_snapshot_with_methods(uuid, date) to authenticated;
