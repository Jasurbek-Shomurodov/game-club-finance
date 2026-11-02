-- Live stock follows the product's latest closing, not only today's. Saving a
-- past date used to leave products.current_stock on the old balance until the
-- next count of the open day: correcting yesterday's closing, or backfilling a
-- missed day, showed a stale figure on Products and in the Telegram low-stock
-- list and fed it to the weighted average cost of the next purchase.
--
-- When the written row is the product's latest count, live stock becomes its
-- closing plus the receipts dated after it. An older date changes nothing. This
-- touches products only: saved daily_stock_counts rows are never rewritten here.
-- Updates that leave a past row's closing as it was (a forward recalculation of
-- its opening, a promotion link cleared on delete) do not move live stock.
create or replace function public.update_stock_on_closing_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE'
    and NEW.closing_stock is not distinct from OLD.closing_stock
    and NEW.date <> public.club_business_date(NEW.club_id) then
    return NEW;
  end if;

  if exists (
    select 1
    from public.daily_stock_counts later
    where later.club_id = NEW.club_id
      and later.product_id = NEW.product_id
      and later.date > NEW.date
  ) then
    return NEW;
  end if;

  update public.products
  set current_stock = NEW.closing_stock + coalesce((
        select sum(purchases.quantity)
        from public.stock_purchases purchases
        where purchases.club_id = NEW.club_id
          and purchases.product_id = NEW.product_id
          and purchases.date > NEW.date
      ), 0),
      updated_at = now()
  where id = NEW.product_id
    and club_id = NEW.club_id
    and tracks_inventory;

  return NEW;
end;
$$;

revoke all on function public.update_stock_on_closing_count() from public, anon, authenticated;
