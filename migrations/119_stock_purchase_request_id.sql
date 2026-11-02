-- A purchase whose response was lost could be recorded twice: stock, average
-- cost and bar cash all moved a second time. This overload takes the client's
-- request id as the row id, so a retry of one submit returns the first result.
-- The 034 function stays as it is for older clients; it has no default for the
-- new argument, so callers without an id keep resolving to it.
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
      and date >= p_date
  ) then
    raise exception 'Cannot add a purchase on or before a saved stock closing. Reopen the affected closing first.'
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

  return p_request_id;
end;
$$;

revoke all on function public.record_stock_purchase(uuid, uuid, date, uuid, numeric, numeric, numeric, text, text)
  from public, anon;
grant execute on function public.record_stock_purchase(uuid, uuid, date, uuid, numeric, numeric, numeric, text, text)
  to authenticated;
