-- Pixel Gaming (Algoritm), 19 November 2026: 31 000 sum from Bar money for two
-- 10 l bottles of water and bread for hot dogs was filed under Cleaning while
-- Food / Drinks was not offered for Bar money. Move it to Food / Drinks.
do $$
begin
  update public.expenses
    set category = 'food_drinks'
    where id = '67f7a805-0dac-4b51-9a28-eb0a0dbd20f0'
      and date = '2026-11-19'
      and amount = 31000
      and payment_source = 'bar'
      and category = 'cleaning';
  if not found then
    raise notice 'Expense 67f7a805 was already moved or changed; nothing to do.';
  end if;
end;
$$;
