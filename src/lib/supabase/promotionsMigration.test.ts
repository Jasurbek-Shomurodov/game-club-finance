import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(resolve('migrations', name), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const actor = '20000000-0000-0000-0000-000000000001';
const cola = '30000000-0000-0000-0000-000000000001';
const tea = '30000000-0000-0000-0000-000000000002';
const otherProduct = '30000000-0000-0000-0000-000000000003';
const promo = '40000000-0000-0000-0000-000000000001';
const otherPromo = '40000000-0000-0000-0000-000000000002';
let db: PGlite;

async function save(date: string, item: Record<string, unknown>, clubId = club) {
  return db.query('select public.save_closing_stock_counts($1,$2,$3::jsonb)', [clubId, date, JSON.stringify([item])]);
}
async function count(date: string, id = cola) {
  return (await db.query(`select previous_stock,added_today,closing_stock,sold_quantity,giveaway_quantity,promotion_id,
    giveaway_cost::float8,bar_income::float8,bar_cost::float8,bar_profit::float8
    from daily_stock_counts where club_id=$1 and product_id=$2 and date=$3`, [club, id, date])).rows[0];
}
async function live(id = cola) {
  return (await db.query<{ current_stock: string }>('select current_stock from products where club_id=$1 and id=$2', [club, id])).rows[0].current_stock;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${actor}');
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create table clubs(id uuid primary key);
    insert into clubs values ('${club}'),('${otherClub}');
    create function current_user_club_role(id uuid) returns text language sql as $$
      select case when id='${club}' and auth.uid()='${actor}' then current_setting('test.role',true) end $$;
    create function current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$
      select coalesce(current_user_club_role(id) in ('owner','admin'),false) $$;
    create function current_user_readable_clubs(features text[]) returns setof uuid language sql as $$
      select '${club}'::uuid where auth.uid()='${actor}' $$;
    create function club_business_date(uuid) returns date language sql as $$ select current_setting('test.date')::date $$;
    select set_config('test.date','2026-10-15',false);
  `);
  const schema = migration('002_rework_schema.sql');
  for (const table of ['products', 'stock_purchases', 'daily_stock_counts']) {
    const start = schema.indexOf(`create table if not exists ${table} (`);
    await db.exec(schema.slice(start, schema.indexOf('\n);', start) + 3));
    await db.exec(`alter table ${table} add club_id uuid not null;`);
  }
  await db.exec(`alter table products add sort_order integer;
    alter table daily_stock_counts add constraint daily_stock_counts_club_date_product_key unique(club_id,date,product_id);`);
  await db.exec(migration('013_soft_delete_products.sql'));
  await db.exec(migration('025_made_to_order_products.sql'));
  await db.exec(`create trigger trg_stock_purchase after insert on stock_purchases for each row execute function update_stock_on_purchase();
    create trigger trg_closing_count after insert or update on daily_stock_counts for each row execute function update_stock_on_closing_count();`);
  await db.exec(migration('034_atomic_closing_stock_save.sql'));
  const snapshot = migration('038_stock_snapshot_and_payment_method_integrity.sql');
  await db.exec(snapshot.slice(snapshot.indexOf('create or replace function public.save_closing_stock_counts(')));
  await db.exec(migration('055_product_archive_integrity.sql'));
  await db.exec(migration('056_owner_only_cost_prices.sql'));
  await db.exec(migration('057_stock_opening_purchase_carry_forward.sql'));
  await db.exec(migration('078_promotions_and_giveaways.sql'));
  await db.exec(`grant usage on schema public, auth to authenticated;
    grant select on products, stock_purchases, daily_stock_counts to authenticated;`);
}, 20000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;
    truncate daily_stock_counts,stock_purchases,promotions,products;
    select set_config('test.actor','',false);
    select set_config('test.date','2026-10-15',false);
    select set_config('test.role','owner',false);
    insert into products(id,club_id,name,current_stock,sale_price,cost_price) values
      ('${cola}','${club}','Cola',10,15000,9000),('${tea}','${club}','Tea',0,5000,1000),
      ('${otherProduct}','${otherClub}','Other club',50,20,8);
    update products set tracks_inventory=false where id='${tea}';
    insert into promotions(id,club_id,product_id,name,free_quantity,min_spend,starts_on) values
      ('${promo}','${club}','${cola}','Cola for 50k',1,50000,'2026-10-01');
    select set_config('test.actor','${actor}',false);`);
});

describe('promotions and giveaways migration in PostgreSQL', () => {
  it('records giveaways as unsold units with their cost charged to bar profit', async () => {
    await save('2026-10-15', { product_id: cola, closing_stock: 4, sold_quantity: 3, giveaway_quantity: 3, promotion_id: promo });
    expect(await count('2026-10-15')).toEqual({
      previous_stock: '10', added_today: '0', closing_stock: '4', sold_quantity: '3', giveaway_quantity: '3', promotion_id: promo,
      giveaway_cost: 27000, bar_income: 45000, bar_cost: 54000, bar_profit: -9000,
    });
    expect(await live()).toBe('4');
    // The giveaway is part of the stock movement, so a sold quantity that ignores it is rejected.
    await expect(save('2026-10-15', { product_id: cola, closing_stock: 4, sold_quantity: 6, giveaway_quantity: 3 }))
      .rejects.toThrow('Sold quantity does not match');
    await expect(save('2026-10-15', { product_id: cola, closing_stock: 9, sold_quantity: 0, giveaway_quantity: 3 }))
      .rejects.toThrow('Closing stock exceeds available stock');
    await expect(save('2026-10-15', { product_id: cola, closing_stock: 4, sold_quantity: 3, giveaway_quantity: -1 }))
      .rejects.toThrow('non-negative whole numbers');
  });

  it('keeps counts without giveaways identical to before and drops a promotion link without units', async () => {
    await save('2026-10-15', { product_id: cola, closing_stock: 7, sold_quantity: 3, promotion_id: promo });
    expect(await count('2026-10-15')).toMatchObject({
      sold_quantity: '3', giveaway_quantity: '0', promotion_id: null, giveaway_cost: 0, bar_income: 45000, bar_cost: 27000, bar_profit: 18000,
    });
  });

  it('allows giveaways of made-to-order products and admins', async () => {
    await db.exec("select set_config('test.role','admin',false)");
    await save('2026-10-15', { product_id: tea, closing_stock: 0, sold_quantity: 4, giveaway_quantity: 2 });
    expect(await count('2026-10-15', tea)).toMatchObject({
      sold_quantity: '4', giveaway_quantity: '2', giveaway_cost: 2000, bar_income: 20000, bar_cost: 6000, bar_profit: 14000,
    });
  });

  it('rejects promotions from another club or product', async () => {
    await db.exec(`select set_config('test.actor','',false);
      insert into promotions(id,club_id,product_id,name,starts_on) values ('${otherPromo}','${otherClub}','${otherProduct}','Other',  '2026-10-01');
      select set_config('test.actor','${actor}',false);`);
    await expect(save('2026-10-15', { product_id: cola, closing_stock: 9, sold_quantity: 0, giveaway_quantity: 1, promotion_id: otherPromo }))
      .rejects.toThrow('Promotion does not exist');
    await expect(db.query(`insert into promotions(club_id,product_id,name,starts_on) values ($1,$2,'Cross','2026-10-01')`, [club, otherProduct]))
      .rejects.toThrow('does not belong to this club');
    await expect(db.query(`insert into promotions(club_id,product_id,name,starts_on,ends_on) values ($1,$2,'Backwards','2026-10-10','2026-10-01')`, [club, cola]))
      .rejects.toThrow();
  });

  it('includes giveaways in historical forward validation and recalculation', async () => {
    await db.exec("select set_config('test.date','2026-10-12',false)");
    await save('2026-10-12', { product_id: cola, closing_stock: 10, sold_quantity: 0 });
    await db.exec("select set_config('test.date','2026-10-15',false)");
    await save('2026-10-15', { product_id: cola, closing_stock: 4, sold_quantity: 3, giveaway_quantity: 3, promotion_id: promo });
    // Editing the earlier closing recalculates the later sold quantity but keeps its giveaway.
    await save('2026-10-12', { product_id: cola, closing_stock: 9, sold_quantity: 1 });
    expect(await count('2026-10-15')).toMatchObject({
      previous_stock: '9', sold_quantity: '2', giveaway_quantity: '3', bar_income: 30000, bar_cost: 45000, bar_profit: -15000,
    });
    // Closing + giveaways on the later day cannot exceed the new opening.
    await expect(save('2026-10-12', { product_id: cola, closing_stock: 6, sold_quantity: 4 })).rejects.toThrow('Historical change makes');
  });

  it('applies row level security to promotions', async () => {
    await db.exec('set role authenticated');
    expect((await db.query('select id from promotions')).rows).toEqual([{ id: promo }]);
    await db.exec("select set_config('test.role','admin',false)");
    await expect(db.query(`insert into promotions(club_id,product_id,name,starts_on) values ($1,$2,'Admin','2026-10-01')`, [club, cola]))
      .rejects.toThrow();
    await db.exec("select set_config('test.role','owner',false)");
    await db.query(`insert into promotions(club_id,product_id,name,starts_on) values ($1,$2,'Owner','2026-10-01')`, [club, cola]);
    await expect(db.query(`insert into promotions(club_id,product_id,name,starts_on) values ($1,$2,'Foreign','2026-10-01')`, [otherClub, otherProduct]))
      .rejects.toThrow();
    expect((await db.query('select count(*)::int as n from promotions')).rows).toEqual([{ n: 2 }]);
  });
});
