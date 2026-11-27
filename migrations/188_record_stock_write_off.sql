-- Write-offs cannot erase a day's saved sales
-- (docs/plans/logic-audit-fixes.md, slice 1).
--
-- /write-offs and the write-off dialog on /closing-stock rebuilt the product's
-- row from the copy the page loaded when it opened and sent it through
-- save_closing_stock_counts (164). That RPC trusts the row it is given, so a
-- page left open overwrote the sold quantity another device saved later, and
-- the Closing Stock dialog re-sent every product of the sheet.
--
-- record_stock_write_off records one product's write-off or correction for a
-- day from what the database holds instead:
--
--   * same caller checks as save_closing_stock_counts: a signed-in owner or
--     admin with the closing_stock feature, never a future date, admins only
--     on the current business day, under the club's stock advisory lock;
--   * it locks and reads the saved row for that club, date and product. With
--     no saved row it starts from the row the save path builds for the day
--     (the opening stock and purchases save_closing_stock_counts works out,
--     nothing sold, no giveaway);
--   * the write-off sets the row's adjustment to the requested total
--     (shortage/expired remove units, correction adds them, 0 removes it) and
--     moves closing stock by the difference, so the saved sold quantity,
--     giveaway and promotion stay exactly as saved;
--   * it then saves that single row through save_closing_stock_counts, so the
--     owner-only rules for reducing or switching an adjustment (164, 167), the
--     write-off cost in bar cost (141) and the forward recalculation of later
--     counts all run as before.
--
-- The reason is "<kind>" or "<kind>: <note>", as the write-off dialog sends
-- it. A free-text positive adjustment stays the owner's to change on Closing
-- Stock, as the dialog already says.
--
-- Additive: one new function. save_closing_stock_counts is unchanged and still
-- saves whole counts. Re-runnable.

create or replace function public.record_stock_write_off(
  p_club_id uuid,
  p_date date,
  p_product_id uuid,
  p_kind text,
  p_quantity numeric,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_business_date date;
  v_product public.products%rowtype;
  v_existing public.daily_stock_counts%rowtype;
  v_has_existing boolean;
  v_previous numeric;
  v_previous_date date;
  v_carried_purchases numeric;
  v_purchase_added numeric;
  v_added numeric;
  v_sold numeric;
  v_giveaway numeric;
  v_promotion_id uuid;
  v_note text;
  v_adjustment numeric;
  v_reason text;
  v_unadjusted numeric;
  v_closing numeric;
begin
  if v_actor is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  v_role := public.current_user_club_role(p_club_id);
  if v_role not in ('admin', 'owner')
    or not public.current_user_can_access_club_feature(p_club_id, 'closing_stock') then
    raise exception 'Not authorized to save stock counts for this club.'
      using errcode = '42501';
  end if;

  -- The lock every stock save takes, so the saved row cannot change between
  -- this read and the save below.
  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));

  v_business_date := public.club_business_date(p_club_id);
  if p_date is null or p_date > v_business_date then
    raise exception 'Stock count date cannot be in the future.'
      using errcode = '22008';
  end if;

  if v_role = 'admin' and p_date <> v_business_date then
    raise exception 'Admins can only save the current business day.'
      using errcode = '42501';
  end if;

  if p_product_id is null
    or p_kind is null
    or p_kind not in ('shortage', 'expired', 'correction')
    or p_quantity is null
    or p_quantity < 0
    or p_quantity <> trunc(p_quantity) then
    raise exception 'A write-off needs a product, a reason and a non-negative whole quantity.'
      using errcode = '22023';
  end if;

  select products.*
  into v_product
  from public.products products
  where products.id = p_product_id
    and products.club_id = p_club_id
    and products.is_active
    and not products.is_deleted
  for update;

  if not found then
    raise exception 'Active product does not exist in this club.'
      using errcode = '23503';
  end if;

  if not v_product.tracks_inventory then
    raise exception 'Made-to-order products cannot carry inventory quantities or adjustments.'
      using errcode = '23514';
  end if;

  select counts.*
  into v_existing
  from public.daily_stock_counts counts
  where counts.club_id = p_club_id
    and counts.product_id = p_product_id
    and counts.date = p_date
  for update;
  v_has_existing := found;

  -- Opening stock and purchases exactly as save_closing_stock_counts (164)
  -- works them out for this row, so the row it re-checks keeps its sales.
  select counts.closing_stock, counts.date
  into v_previous, v_previous_date
  from public.daily_stock_counts counts
  where counts.club_id = p_club_id
    and counts.product_id = p_product_id
    and counts.date < p_date
  order by counts.date desc
  limit 1;

  select sum(purchases.quantity)
  into v_purchase_added
  from public.stock_purchases purchases
  where purchases.club_id = p_club_id
    and purchases.product_id = p_product_id
    and purchases.date = p_date;

  select coalesce(sum(purchases.quantity), 0)
  into v_carried_purchases
  from public.stock_purchases purchases
  where purchases.club_id = p_club_id
    and purchases.product_id = p_product_id
    and (v_previous_date is null or purchases.date > v_previous_date)
    and purchases.date < p_date;

  if v_previous is not null then
    v_previous := v_previous + v_carried_purchases;
  end if;

  if v_previous is null then
    v_previous := case
      when v_has_existing then v_existing.previous_stock
      when p_date = v_business_date then greatest(v_product.current_stock - coalesce(v_purchase_added, 0), 0)
      else v_carried_purchases
    end;
  end if;

  if v_has_existing and p_date < v_business_date then
    v_previous := v_existing.previous_stock;
    v_added := v_existing.added_today;
  elsif v_purchase_added is not null and v_purchase_added <> trunc(v_purchase_added) then
    if v_has_existing then
      v_added := v_existing.added_today;
    else
      raise exception 'Legacy fractional purchases require an existing reconciled stock count.'
        using errcode = '23514';
    end if;
  else
    v_added := coalesce(
      v_purchase_added,
      case when v_has_existing then v_existing.added_today else 0 end
    );
  end if;

  if v_has_existing then
    if coalesce(v_existing.adjustment_quantity, 0) > 0
      and btrim(coalesce(v_existing.adjustment_reason, '')) !~ '^correction(:|$)' then
      raise exception 'This product already carries an inventory adjustment; change it on Closing Stock.'
        using errcode = '23514', hint = 'write_off_has_adjustment';
    end if;
    -- What was saved stays: sales, giveaways and the promotion they used.
    v_sold := coalesce(v_existing.sold_quantity, 0);
    v_giveaway := coalesce(v_existing.giveaway_quantity, 0);
    v_promotion_id := v_existing.promotion_id;
  else
    v_sold := 0;
    v_giveaway := 0;
    v_promotion_id := null;
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_quantity = 0 then
    v_adjustment := 0;
    v_reason := null;
  else
    v_adjustment := case when p_kind = 'correction' then p_quantity else -p_quantity end;
    v_reason := case when v_note is null then p_kind else p_kind || ': ' || v_note end;
  end if;

  -- Closing stock the row would have without any adjustment.
  v_unadjusted := v_previous + v_added - v_giveaway - v_sold;
  v_closing := v_unadjusted + v_adjustment;
  if v_closing < 0 then
    raise exception 'Write-off exceeds the stock left for this product.'
      using errcode = '23514',
        detail = greatest(v_unadjusted, 0)::text,
        hint = 'write_off_exceeds_stock';
  end if;

  return public.save_closing_stock_counts(
    p_club_id,
    p_date,
    jsonb_build_array(jsonb_build_object(
      'product_id', p_product_id,
      'closing_stock', v_closing,
      'sold_quantity', v_sold,
      'adjustment_quantity', v_adjustment,
      'adjustment_reason', v_reason,
      'giveaway_quantity', v_giveaway,
      'promotion_id', v_promotion_id
    ))
  );
end;
$$;

comment on function public.record_stock_write_off(uuid, date, uuid, text, numeric, text) is
  'Records one product''s write-off or correction for a day from its saved count, keeping the saved sales, then saves it through save_closing_stock_counts.';

revoke all on function public.record_stock_write_off(uuid, date, uuid, text, numeric, text)
  from public, anon;
grant execute on function public.record_stock_write_off(uuid, date, uuid, text, numeric, text)
  to authenticated;
