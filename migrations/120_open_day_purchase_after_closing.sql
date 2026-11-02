-- A delivery that arrives after the day's closing was saved could not be recorded
-- until the next business day, and the error sent staff to a reopen step that does
-- not exist. The open business day is not history: its purchases are the live
-- source of added_today, and save_closing_stock_counts re-reads them on every save.
--
-- A purchase on the open day now joins that day's saved row: added_today and
-- closing_stock both move by its quantity, so the recorded sold quantity and bar
-- amounts stay as they were and live stock still equals the closing. Deleting it
-- reverses the same delta. Dates before the open day remain closed snapshots, and
-- so does any date with a later saved count.
--
-- The 034 function stays as it is: only clients without a request id reach it.
create or replace function public.record_stock_purchase(
  p_request_id uuid,
  p_club_id uuid,
  p_date date,
  p_product_id uuid,
  p_quantity numeric,
  p_cost_price numeric,
  p_sale_price numeric default null,
  p_payment_method text default 'cash',
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_date date;
  v_product_found boolean;
  v_existing public.stock_purchases%rowtype;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) is null
    or public.current_user_club_role(p_club_id) not in ('admin', 'owner') then
    raise exception 'Not authorized to record purchases for this club.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'A purchase request id is required.'
      using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
    raise exception 'Purchase quantity must be a positive whole number.'
      using errcode = '23514';
  end if;

  if p_cost_price is null or p_cost_price < 0 then
    raise exception 'Purchase cost price cannot be negative.'
      using errcode = '23514';
  end if;

  -- The purchase trigger copies this onto the catalog; zero would record free sales.
  if p_sale_price is not null and p_sale_price <= 0 then
    raise exception 'Purchase sale price must be positive.'
      using errcode = '23514';
  end if;

  if p_payment_method not in ('cash', 'terminal', 'card') then
    raise exception 'Unsupported purchase payment method.'
      using errcode = '23514';
  end if;

  v_business_date := public.club_business_date(p_club_id);
  if p_date is null or p_date > v_business_date then
    raise exception 'Purchase date cannot be in the future.'
      using errcode = '22008';
  end if;

  perform 1
  from public.products
  where id = p_product_id
    and club_id = p_club_id
    and is_active
    and tracks_inventory
  for update;
  v_product_found := found;

  -- Under the product lock, so two copies of one request cannot both insert. It
  -- comes before the closing check: a closing saved since the first attempt
  -- must not turn a recorded purchase into a failure.
  select * into v_existing
  from public.stock_purchases
  where id = p_request_id;

  if found then
    if v_existing.club_id is distinct from p_club_id
      or v_existing.product_id is distinct from p_product_id
      or v_existing.date is distinct from p_date
      or v_existing.quantity is distinct from p_quantity
      or v_existing.cost_price is distinct from p_cost_price then
      raise exception 'This purchase request was already used for a different purchase.'
        using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if not v_product_found then
    raise exception 'Active inventory product does not exist for this club.'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.daily_stock_counts
    where club_id = p_club_id
      and product_id = p_product_id
      and (date > p_date or (date = p_date and p_date <> v_business_date))
  ) then
    raise exception 'Cannot add a purchase to a closed stock date.'
      using errcode = '55000';
  end if;

  insert into public.stock_purchases (
    id,
    club_id,
    date,
    product_id,
    quantity,
    cost_price,
    sale_price,
    payment_method,
    comment,
    created_by
  ) values (
    p_request_id,
    p_club_id,
    p_date,
    p_product_id,
    p_quantity,
    p_cost_price,
    p_sale_price,
    p_payment_method,
    nullif(btrim(p_comment), ''),
    auth.uid()
  );

  -- After the checks above, a row on this date can only be the open day's.
  update public.daily_stock_counts
  set added_today = added_today + p_quantity,
      closing_stock = closing_stock + p_quantity,
      updated_at = now()
  where club_id = p_club_id
    and product_id = p_product_id
    and date = p_date;

  return p_request_id;
end;
$$;

revoke all on function public.record_stock_purchase(uuid, uuid, date, uuid, numeric, numeric, numeric, text, text)
  from public, anon;
grant execute on function public.record_stock_purchase(uuid, uuid, date, uuid, numeric, numeric, numeric, text, text)
  to authenticated;

create or replace function public.delete_stock_purchase(
  p_club_id uuid,
  p_purchase_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.stock_purchases%rowtype;
  v_business_date date;
  v_current_stock numeric;
  v_current_cost numeric;
  v_remaining_stock numeric;
  v_remaining_value numeric;
  v_count_added numeric;
  v_count_closing numeric;
  v_has_count boolean;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) not in ('admin', 'owner') then
    raise exception 'Not authorized to delete purchases for this club.'
      using errcode = '42501';
  end if;

  select *
  into v_purchase
  from public.stock_purchases
  where id = p_purchase_id
    and club_id = p_club_id
  for update;

  if not found then
    raise exception 'Stock purchase does not exist in this club.'
      using errcode = 'P0002';
  end if;

  select current_stock, cost_price
  into v_current_stock, v_current_cost
  from public.products
  where id = v_purchase.product_id
    and club_id = p_club_id
  for update;

  if not found then
    raise exception 'Product does not exist for this club.'
      using errcode = '23503';
  end if;

  v_business_date := public.club_business_date(p_club_id);
  if exists (
    select 1
    from public.daily_stock_counts
    where club_id = p_club_id
      and product_id = v_purchase.product_id
      and (date > v_purchase.date or (date = v_purchase.date and v_purchase.date <> v_business_date))
  ) then
    raise exception 'Cannot delete a purchase included in a closed stock date.'
      using errcode = '55000';
  end if;

  select added_today, closing_stock
  into v_count_added, v_count_closing
  from public.daily_stock_counts
  where club_id = p_club_id
    and product_id = v_purchase.product_id
    and date = v_purchase.date
  for update;
  v_has_count := found;

  -- The saved count already sold these units: removing them would need a negative
  -- closing or a change to recorded sales, which only a new count can decide.
  if v_has_count and (v_count_added < v_purchase.quantity or v_count_closing < v_purchase.quantity) then
    raise exception 'Cannot delete a purchase the saved closing has already counted as sold.'
      using errcode = '55000';
  end if;

  v_remaining_stock := coalesce(v_current_stock, 0) - v_purchase.quantity;
  if v_remaining_stock < 0 then
    raise exception 'Cannot delete purchase because current stock is lower than its quantity.'
      using errcode = '23514';
  end if;

  v_remaining_value := (coalesce(v_current_stock, 0) * coalesce(v_current_cost, 0))
    - (v_purchase.quantity * v_purchase.cost_price);

  delete from public.stock_purchases
  where id = v_purchase.id;

  if v_has_count then
    update public.daily_stock_counts
    set added_today = added_today - v_purchase.quantity,
        closing_stock = closing_stock - v_purchase.quantity,
        updated_at = now()
    where club_id = p_club_id
      and product_id = v_purchase.product_id
      and date = v_purchase.date;
  end if;

  update public.products
  set current_stock = v_remaining_stock,
      cost_price = case
        when v_remaining_stock = 0 then 0
        else greatest(v_remaining_value / v_remaining_stock, 0)
      end,
      updated_at = now()
  where id = v_purchase.product_id
    and club_id = p_club_id;
end;
$$;

revoke all on function public.delete_stock_purchase(uuid, uuid)
  from public, anon;
grant execute on function public.delete_stock_purchase(uuid, uuid)
  to authenticated;
