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
let db: PGlite;

async function save(date: string, item: Record<string, unknown>, clubId = club) {
  return db.query('select public.save_closing_stock_counts($1,$2,$3::jsonb)', [clubId, date, JSON.stringify([item])]);
}
async function count(date: string, id = cola) {
  return (await db.query(`select closing_stock,sold_quantity,adjustment_quantity,writeoff_cost::float8,
    bar_income::float8,bar_cost::float8,bar_profit::float8
    from daily_stock_counts where club_id=$1 and product_id=$2 and date=$3`, [club, id, date])).rows[0];
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
  await db.exec(migration('141_write_offs_in_bar_profit.sql'));
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
      ('${cola}','${club}','Cola',10,15000,9000),('${tea}','${club}','Tea',0,5000,1000);
    update products set tracks_inventory=false where id='${tea}';
    select set_config('test.actor','${actor}',false);`);
});

const backfill = migration('141_write_offs_in_bar_profit.sql');
const backfillStatement = backfill.slice(backfill.lastIndexOf('update public.daily_stock_counts'));

describe('write-offs in bar profit (migration 141)', () => {
  it('charges a shortage or expired write-off to bar cost without changing sales', async () => {
    // 10 on hand, 2 expired, 5 counted: 3 sold.
    await save('2026-10-15', { product_id: cola, closing_stock: 5, sold_quantity: 3, adjustment_quantity: -2, adjustment_reason: 'expired: sour' });
    expect(await count('2026-10-15')).toEqual({
      closing_stock: '5', sold_quantity: '3', adjustment_quantity: '-2', writeoff_cost: 18000,
      bar_income: 45000, bar_cost: 45000, bar_profit: 0,
    });
    await save('2026-10-15', { product_id: cola, closing_stock: 6, sold_quantity: 3, adjustment_quantity: -1, adjustment_reason: 'shortage' });
    expect(await count('2026-10-15')).toMatchObject({ writeoff_cost: 9000, bar_cost: 36000, bar_profit: 9000 });
  });

  it('leaves a free-text adjustment outside bar cost, as before', async () => {
    await save('2026-10-15', { product_id: cola, closing_stock: 5, sold_quantity: 3, adjustment_quantity: -2, adjustment_reason: 'broken bottles' });
    expect(await count('2026-10-15')).toMatchObject({ writeoff_cost: 0, bar_cost: 27000, bar_profit: 18000 });
  });

  it('keeps the write-off cost when a historical edit recalculates later counts', async () => {
    await db.exec("select set_config('test.date','2026-10-12',false)");
    await save('2026-10-12', { product_id: cola, closing_stock: 10, sold_quantity: 0 });
    await db.exec("select set_config('test.date','2026-10-15',false)");
    await save('2026-10-15', { product_id: cola, closing_stock: 5, sold_quantity: 3, adjustment_quantity: -2, adjustment_reason: 'expired' });
    await save('2026-10-12', { product_id: cola, closing_stock: 9, sold_quantity: 1 });
    expect(await count('2026-10-15')).toMatchObject({
      sold_quantity: '2', writeoff_cost: 18000, bar_income: 30000, bar_cost: 36000, bar_profit: -6000,
    });
  });

  it('rejects a write-off cost that does not match the adjustment', async () => {
    await save('2026-10-15', { product_id: cola, closing_stock: 5, sold_quantity: 3, adjustment_quantity: -2, adjustment_reason: 'expired' });
    await expect(db.query(`update daily_stock_counts set writeoff_cost = 0, bar_cost = 27000, bar_profit = 18000 where product_id = $1`, [cola]))
      .rejects.toThrow('Write-off cost does not match');
  });

  it('backfills write-offs saved before the migration and leaves other rows alone', async () => {
    await save('2026-10-15', { product_id: cola, closing_stock: 5, sold_quantity: 3, adjustment_quantity: -2, adjustment_reason: 'shortage: lost' });
    await save('2026-10-15', { product_id: tea, closing_stock: 0, sold_quantity: 4 });
    // As 078 saved it: no write-off cost in bar cost.
    await db.exec(`alter table daily_stock_counts disable trigger user;
      update daily_stock_counts set writeoff_cost = 0, bar_cost = 27000, bar_profit = 18000 where product_id = '${cola}';
      alter table daily_stock_counts enable trigger user;`);
    await db.exec(backfillStatement);
    expect(await count('2026-10-15')).toMatchObject({ writeoff_cost: 18000, bar_cost: 45000, bar_profit: 0 });
    expect(await count('2026-10-15', tea)).toMatchObject({ writeoff_cost: 0, bar_cost: 4000, bar_profit: 16000 });
  });
});
