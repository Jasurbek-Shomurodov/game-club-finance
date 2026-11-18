-- Bar write-offs for every member who saves stock counts.
--
-- Until now only the owner could record a write-off (a negative adjustment
-- whose reason is "shortage" or "expired", migration 141): the save RPC refused
-- every adjustment change from an admin. Write-offs now have their own page,
-- and the admins who count the bar can record them there or on Closing Stock.
--
-- An admin may create a write-off, or raise its quantity and change its note,
-- on the current business day (the RPC already limits admins to that day).
-- Reducing or removing a write-off, switching its reason, and every other
-- inventory adjustment stay owner-only, so a recorded loss cannot be quietly
-- taken back. Viewers still cannot save stock counts at all.
--
-- Replaces 141's save_closing_stock_counts; only the admin adjustment check
-- changes.

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
  select public.stock_write_off_quantity(p_new_adjustment, p_new_reason) > 0
    and coalesce(p_old_adjustment, 0) <= 0
    and p_new_adjustment <= coalesce(p_old_adjustment, 0)
    and (
      coalesce(p_old_adjustment, 0) = 0
      or (
        public.stock_write_off_quantity(p_old_adjustment, p_old_reason) > 0
        and substring(btrim(p_old_reason) from '^(shortage|expired)')
          = substring(btrim(p_new_reason) from '^(shortage|expired)')
      )
    );
$$;

comment on function public.stock_write_off_is_addition(numeric, text, numeric, text) is
  'True when an adjustment change only records a write-off or adds to one of the same reason (the change an admin may make).';

revoke all on function public.stock_write_off_is_addition(numeric, text, numeric, text) from public, anon;
grant execute on function public.stock_write_off_is_addition(numeric, text, numeric, text) to authenticated;

create or replace function public.save_closing_stock_counts(
  p_club_id uuid,
  p_date date,
  p_counts jsonb
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
  v_item jsonb;
  v_product public.products%rowtype;
  v_existing public.daily_stock_counts%rowtype;
  v_has_existing boolean;
  v_product_id uuid;
  v_product_ids uuid[] := array[]::uuid[];
  v_previous numeric;
  v_previous_date date;
  v_carried_purchases numeric;
  v_added numeric;
  v_purchase_added numeric;
  v_adjustment numeric;
  v_adjustment_reason text;
  v_giveaway numeric;
  v_writeoff_cost numeric;
  v_promotion_id uuid;
  v_closing numeric;
  v_requested_sold numeric;
  v_sold numeric;
  v_sale_price numeric;
  v_cost_price numeric;
  v_adjustment_recorded_by uuid;
  v_adjustment_recorded_at timestamptz;
  v_future_date date;
  v_future_product_id uuid;
  v_updated_count integer := 0;
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

  if p_counts is null
    or jsonb_typeof(p_counts) <> 'array'
    or jsonb_array_length(p_counts) = 0 then
    raise exception 'At least one stock count is required.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_counts)
  loop
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      v_closing := nullif(v_item ->> 'closing_stock', '')::numeric;
      v_requested_sold := nullif(v_item ->> 'sold_quantity', '')::numeric;
      v_adjustment := coalesce(nullif(v_item ->> 'adjustment_quantity', '')::numeric, 0);
      v_giveaway := coalesce(nullif(v_item ->> 'giveaway_quantity', '')::numeric, 0);
      v_promotion_id := nullif(v_item ->> 'promotion_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Stock count contains an invalid product or numeric value.'
        using errcode = '22023';
    end;

    if v_product_id is null or v_product_id = any(v_product_ids) then
      raise exception 'Each product must appear exactly once in the stock count.'
        using errcode = '22023';
    end if;
    v_product_ids := array_append(v_product_ids, v_product_id);

    select products.*
    into v_product
    from public.products products
    where products.id = v_product_id
      and products.club_id = p_club_id
      and products.is_active
      and not products.is_deleted
    for update;

    if not found then
      raise exception 'Active product does not exist in this club.'
        using errcode = '23503';
    end if;

    select counts.*
    into v_existing
    from public.daily_stock_counts counts
    where counts.club_id = p_club_id
      and counts.product_id = v_product_id
      and counts.date = p_date
    for update;
    v_has_existing := found;

    select counts.closing_stock, counts.date
    into v_previous, v_previous_date
    from public.daily_stock_counts counts
    where counts.club_id = p_club_id
      and counts.product_id = v_product_id
      and counts.date < p_date
    order by counts.date desc
    limit 1;

    select sum(purchases.quantity)
    into v_purchase_added
    from public.stock_purchases purchases
    where purchases.club_id = p_club_id
      and purchases.product_id = v_product_id
      and purchases.date = p_date;

    -- Same-day purchases stay in added_today. Receipts on skipped dates
    -- belong to the opening balance and must not disappear between closings.
    select coalesce(sum(purchases.quantity), 0)
    into v_carried_purchases
    from public.stock_purchases purchases
    where purchases.club_id = p_club_id
      and purchases.product_id = v_product_id
      and (v_previous_date is null or purchases.date > v_previous_date)
      and purchases.date < p_date;

    if v_previous is not null then
      v_previous := v_previous + v_carried_purchases;
    end if;

    v_adjustment_reason := nullif(btrim(v_item ->> 'adjustment_reason'), '');

    if not v_product.tracks_inventory then
      if v_adjustment <> 0
        or coalesce(v_closing, 0) <> 0
        or v_adjustment_reason is not null then
        raise exception 'Made-to-order products cannot carry inventory quantities or adjustments.'
          using errcode = '23514';
      end if;
      v_previous := 0;
      v_added := 0;
      v_adjustment := 0;
      v_closing := 0;
    else
      if v_previous is null then
        v_previous := case
          when v_has_existing then v_existing.previous_stock
          when p_date = v_business_date then greatest(v_product.current_stock - coalesce(v_purchase_added, 0), 0)
          else v_carried_purchases
        end;
      end if;

      if v_has_existing and p_date < v_business_date then
        -- Keep an existing historical row editable using its displayed
        -- snapshot. An explicit edit to an earlier closing still recalculates
        -- the forward chain below; deployment alone must not alter history.
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
    end if;

    if v_adjustment = 0 then
      v_adjustment_reason := null;
    end if;
    v_sale_price := case when v_has_existing then v_existing.sale_price else v_product.sale_price end;
    v_cost_price := case when v_has_existing then v_existing.cost_price else v_product.cost_price end;

    if v_previous < 0
      or v_added < 0
      or v_closing is null
      or v_closing < 0
      or v_requested_sold is null
      or v_requested_sold < 0
      or v_giveaway < 0
      or v_previous <> trunc(v_previous)
      or v_added <> trunc(v_added)
      or v_adjustment <> trunc(v_adjustment)
      or v_giveaway <> trunc(v_giveaway)
      or v_closing <> trunc(v_closing)
      or v_requested_sold <> trunc(v_requested_sold) then
      raise exception 'Stock quantities must be non-negative whole numbers; only adjustments may be signed.'
        using errcode = '23514';
    end if;

    if v_adjustment <> 0 and v_adjustment_reason is null then
      raise exception 'A non-zero inventory adjustment requires a reason.'
        using errcode = '23514';
    end if;

    -- A promotion link is informational; the giveaway quantity is the ledger
    -- fact. Any linked promotion must belong to this club and product.
    if v_giveaway = 0 then
      v_promotion_id := null;
    elsif v_promotion_id is not null and not exists (
      select 1 from public.promotions promotions
      where promotions.id = v_promotion_id
        and promotions.club_id = p_club_id
        and promotions.product_id = v_product_id
    ) then
      raise exception 'Promotion does not exist for this product in this club.'
        using errcode = '23503';
    end if;

    if v_product.tracks_inventory then
      if v_previous + v_added + v_adjustment < 0 then
        raise exception 'Inventory adjustment makes available stock negative.'
          using errcode = '23514';
      end if;

      v_sold := v_previous + v_added + v_adjustment - v_giveaway - v_closing;
      if v_sold < 0 then
        raise exception 'Closing stock exceeds available stock. Record an explicit inventory adjustment with a reason.'
          using errcode = '23514';
      end if;

      if v_requested_sold <> v_sold then
        raise exception 'Sold quantity does not match the stock movement.'
          using errcode = '23514';
      end if;
    else
      v_sold := v_requested_sold;
      v_adjustment_reason := null;
    end if;

    v_writeoff_cost := public.stock_write_off_quantity(v_adjustment, v_adjustment_reason) * v_cost_price;

    -- Admins may record a write-off or add to one (same reason, note free);
    -- every other adjustment change, including reducing or removing a
    -- write-off, stays with the owner.
    if v_role = 'admin' and (
      v_adjustment is distinct from case when v_has_existing then v_existing.adjustment_quantity else 0 end
      or v_adjustment_reason is distinct from case when v_has_existing then v_existing.adjustment_reason else null end
    ) and not public.stock_write_off_is_addition(
      case when v_has_existing then v_existing.adjustment_quantity else 0 end,
      case when v_has_existing then v_existing.adjustment_reason else null end,
      v_adjustment,
      v_adjustment_reason
    ) then
      raise exception 'Only a club owner can reduce, remove or change an inventory adjustment; admins can only add write-offs.'
        using errcode = '42501';
    end if;

    if v_has_existing
      and v_adjustment is not distinct from v_existing.adjustment_quantity
      and v_adjustment_reason is not distinct from v_existing.adjustment_reason then
      v_adjustment_recorded_by := v_existing.adjustment_recorded_by;
      v_adjustment_recorded_at := v_existing.adjustment_recorded_at;
    elsif v_adjustment = 0 then
      v_adjustment_recorded_by := null;
      v_adjustment_recorded_at := null;
    else
      v_adjustment_recorded_by := v_actor;
      v_adjustment_recorded_at := now();
    end if;

    insert into public.daily_stock_counts (
      club_id,
      date,
      product_id,
      previous_stock,
      added_today,
      adjustment_quantity,
      adjustment_reason,
      adjustment_recorded_by,
      adjustment_recorded_at,
      giveaway_quantity,
      giveaway_cost,
      writeoff_cost,
      promotion_id,
      closing_stock,
      sold_quantity,
      sale_price,
      cost_price,
      bar_income,
      bar_cost,
      bar_profit,
      created_by,
      updated_at
    ) values (
      p_club_id,
      p_date,
      v_product_id,
      v_previous,
      v_added,
      v_adjustment,
      v_adjustment_reason,
      v_adjustment_recorded_by,
      v_adjustment_recorded_at,
      v_giveaway,
      v_giveaway * v_cost_price,
      v_writeoff_cost,
      v_promotion_id,
      v_closing,
      v_sold,
      v_sale_price,
      v_cost_price,
      v_sold * v_sale_price,
      (v_sold + v_giveaway) * v_cost_price + v_writeoff_cost,
      (v_sold * v_sale_price) - ((v_sold + v_giveaway) * v_cost_price + v_writeoff_cost),
      v_actor,
      now()
    )
    on conflict on constraint daily_stock_counts_club_date_product_key do update
    set
      previous_stock = excluded.previous_stock,
      added_today = excluded.added_today,
      adjustment_quantity = excluded.adjustment_quantity,
      adjustment_reason = excluded.adjustment_reason,
      adjustment_recorded_by = excluded.adjustment_recorded_by,
      adjustment_recorded_at = excluded.adjustment_recorded_at,
      giveaway_quantity = excluded.giveaway_quantity,
      giveaway_cost = excluded.giveaway_cost,
      writeoff_cost = excluded.writeoff_cost,
      promotion_id = excluded.promotion_id,
      closing_stock = excluded.closing_stock,
      sold_quantity = excluded.sold_quantity,
      sale_price = excluded.sale_price,
      cost_price = excluded.cost_price,
      bar_income = excluded.bar_income,
      bar_cost = excluded.bar_cost,
      bar_profit = excluded.bar_profit,
      updated_at = excluded.updated_at;
  end loop;

  with closing_timeline as (
    select
      counts.product_id,
      counts.date,
      counts.closing_stock,
      counts.added_today,
      counts.adjustment_quantity,
      counts.giveaway_quantity,
      products.tracks_inventory,
      lag(counts.closing_stock) over (
        partition by counts.product_id
        order by counts.date, counts.id
      ) as previous_closing,
      lag(counts.date) over (
        partition by counts.product_id
        order by counts.date, counts.id
      ) as previous_date
    from public.daily_stock_counts counts
    join public.products products
      on products.id = counts.product_id
     and products.club_id = counts.club_id
    where counts.club_id = p_club_id
      and counts.product_id = any(v_product_ids)
      and counts.date >= p_date
  ), timeline as (
    select closing_timeline.*,
      previous_closing + coalesce((
        select sum(purchases.quantity)
        from public.stock_purchases purchases
        where purchases.club_id = p_club_id
          and purchases.product_id = closing_timeline.product_id
          and purchases.date > closing_timeline.previous_date
          and purchases.date < closing_timeline.date
      ), 0) as canonical_previous
    from closing_timeline
  )
  select timeline.date, timeline.product_id
  into v_future_date, v_future_product_id
  from timeline
  where timeline.date > p_date
    and timeline.tracks_inventory
    and timeline.closing_stock + timeline.giveaway_quantity > timeline.canonical_previous
      + timeline.added_today
      + timeline.adjustment_quantity
  order by timeline.date, timeline.product_id
  limit 1;

  if found then
    raise exception 'Historical change makes the saved stock count on % invalid for product %. Add an explicit adjustment to that later count first.',
      v_future_date, v_future_product_id
      using errcode = '23514';
  end if;

  with closing_timeline as (
    select
      counts.id,
      counts.product_id,
      counts.date,
      counts.closing_stock,
      counts.added_today,
      counts.adjustment_quantity,
      counts.giveaway_quantity,
      counts.writeoff_cost,
      counts.sale_price,
      counts.cost_price,
      products.tracks_inventory,
      lag(counts.closing_stock) over (
        partition by counts.product_id
        order by counts.date, counts.id
      ) as previous_closing,
      lag(counts.date) over (
        partition by counts.product_id
        order by counts.date, counts.id
      ) as previous_date
    from public.daily_stock_counts counts
    join public.products products
      on products.id = counts.product_id
     and products.club_id = counts.club_id
    where counts.club_id = p_club_id
      and counts.product_id = any(v_product_ids)
      and counts.date >= p_date
  ), timeline as (
    select closing_timeline.*,
      previous_closing + coalesce((
        select sum(purchases.quantity)
        from public.stock_purchases purchases
        where purchases.club_id = p_club_id
          and purchases.product_id = closing_timeline.product_id
          and purchases.date > closing_timeline.previous_date
          and purchases.date < closing_timeline.date
      ), 0) as canonical_previous
    from closing_timeline
  ), recalculated as (
    select
      timeline.id,
      timeline.canonical_previous,
      timeline.canonical_previous
        + timeline.added_today
        + timeline.adjustment_quantity
        - timeline.giveaway_quantity
        - timeline.closing_stock as canonical_sold,
      timeline.giveaway_quantity,
      timeline.writeoff_cost,
      timeline.sale_price,
      timeline.cost_price
    from timeline
    where timeline.date > p_date
      and timeline.tracks_inventory
  )
  update public.daily_stock_counts counts
  set
    previous_stock = recalculated.canonical_previous,
    sold_quantity = recalculated.canonical_sold,
    bar_income = recalculated.canonical_sold * recalculated.sale_price,
    bar_cost = ((recalculated.canonical_sold + recalculated.giveaway_quantity) * recalculated.cost_price + recalculated.writeoff_cost),
    bar_profit = (recalculated.canonical_sold * recalculated.sale_price)
      - (((recalculated.canonical_sold + recalculated.giveaway_quantity) * recalculated.cost_price + recalculated.writeoff_cost)),
    updated_at = now()
  from recalculated
  where counts.id = recalculated.id
    and (
      counts.previous_stock is distinct from recalculated.canonical_previous
      or counts.sold_quantity is distinct from recalculated.canonical_sold
      or counts.bar_income is distinct from recalculated.canonical_sold * recalculated.sale_price
      or counts.bar_cost is distinct from
        ((recalculated.canonical_sold + recalculated.giveaway_quantity) * recalculated.cost_price + recalculated.writeoff_cost)
      or counts.bar_profit is distinct from
        (recalculated.canonical_sold * recalculated.sale_price)
        - (((recalculated.canonical_sold + recalculated.giveaway_quantity) * recalculated.cost_price + recalculated.writeoff_cost))
    );

  get diagnostics v_updated_count = row_count;
  return jsonb_array_length(p_counts) + v_updated_count;
end;
$$;

revoke all on function public.save_closing_stock_counts(uuid, date, jsonb)
  from public, anon;
grant execute on function public.save_closing_stock_counts(uuid, date, jsonb)
  to authenticated;
