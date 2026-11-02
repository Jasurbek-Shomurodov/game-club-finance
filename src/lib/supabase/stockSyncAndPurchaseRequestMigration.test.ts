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
const request = '50000000-0000-0000-0000-000000000001';
let db: PGlite;

const save = (date: string, closing: number, sold: number, extra: Record<string, unknown> = {}) => db.query(
  'select public.save_closing_stock_counts($1,$2,$3::jsonb)',
  [club, date, JSON.stringify([{ product_id: cola, closing_stock: closing, sold_quantity: sold, ...extra }])],
);
const purchase = (date: string, quantity: number, id: string | null = null, cost = 9000) => db.query<{ id: string }>(
  id
    ? 'select public.record_stock_purchase(p_request_id => $6, p_club_id => $1, p_date => $2, p_product_id => $3, p_quantity => $4, p_cost_price => $5) as id'
    : 'select public.record_stock_purchase(p_club_id => $1, p_date => $2, p_product_id => $3, p_quantity => $4, p_cost_price => $5) as id',
  id ? [club, date, cola, quantity, cost, id] : [club, date, cola, quantity, cost],
);
const businessDay = (date: string) => db.exec(`select set_config('test.date','${date}',false);`);
const live = async () => Number((await db.query<{ current_stock: string }>('select current_stock from products where id=$1', [cola])).rows[0].current_stock);
const counts = async () => (await db.query('select date::text,previous_stock::int,closing_stock::int,sold_quantity::int,bar_income::float8 from daily_stock_counts where product_id=$1 order by date', [cola])).rows;
const purchases = async () => Number((await db.query<{ n: number }>('select count(*)::int as n from stock_purchases')).rows[0].n);

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
  await db.exec(migration('118_latest_closing_syncs_live_stock.sql'));
  await db.exec(migration('119_stock_purchase_request_id.sql'));
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

describe('migration 118: live stock follows the latest closing', () => {
  it('keeps following the open day', async () => {
    await save('2026-10-15', 7, 3);
    expect(await live()).toBe(7);
  });

  it('moves live stock when the latest closing is corrected on a past date', async () => {
    await businessDay('2026-10-14');
    await save('2026-10-14', 10, 0);
    await businessDay('2026-10-15');
    await save('2026-10-14', 8, 2);
    expect(await live()).toBe(8);
  });

  it('adds receipts dated after the saved closing', async () => {
    await businessDay('2026-10-13');
    await save('2026-10-13', 10, 0);
    await businessDay('2026-10-15');
    await purchase('2026-10-14', 5);
    expect(await live()).toBe(15);
    await save('2026-10-13', 8, 2);
    expect(await live()).toBe(13);
  });

  it('moves live stock when a missed latest day is backfilled', async () => {
    await businessDay('2026-10-12');
    await save('2026-10-12', 10, 0);
    await businessDay('2026-10-15');
    await save('2026-10-14', 6, 4);
    expect(await live()).toBe(6);
  });

  it('leaves live stock alone when an older date than the latest count is saved', async () => {
    await businessDay('2026-10-13');
    await save('2026-10-13', 10, 0);
    await businessDay('2026-10-15');
    await save('2026-10-15', 6, 4);
    await save('2026-10-14', 9, 1);
    expect(await live()).toBe(6);
  });

  it('changes no saved history beyond what the save itself recalculates', async () => {
    await businessDay('2026-10-13');
    await save('2026-10-13', 10, 0);
    await businessDay('2026-10-14');
    await save('2026-10-14', 8, 2);
    await businessDay('2026-10-16');
    const before = await counts();
    await save('2026-10-14', 7, 3);
    const after = await counts();
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toMatchObject({ closing_stock: 7, sold_quantity: 3 });
    expect(await live()).toBe(7);
  });

  it('does not move live stock when a past row changes without a new closing', async () => {
    await businessDay('2026-10-14');
    await save('2026-10-14', 8, 2);
    await businessDay('2026-10-15');
    await db.exec(`reset role;
      update products set current_stock = 99 where id='${cola}';
      update daily_stock_counts set updated_at = now() where product_id='${cola}';`);
    expect(await live()).toBe(99);
  });

  it('never gives made-to-order products a balance', async () => {
    await db.query('select public.save_closing_stock_counts($1,$2,$3::jsonb)', [club, '2026-10-14', JSON.stringify([{ product_id: tea, closing_stock: 0, sold_quantity: 4 }])]);
    expect(Number((await db.query<{ current_stock: string }>('select current_stock from products where id=$1', [tea])).rows[0].current_stock)).toBe(0);
  });

  it('re-runs cleanly', async () => {
    await db.exec(migration('118_latest_closing_syncs_live_stock.sql'));
  });
});

describe('migration 119: a purchase request is recorded once', () => {
  it('uses the request id as the row id and moves stock once on a repeat', async () => {
    expect((await purchase('2026-10-15', 5, request)).rows[0].id).toBe(request);
    expect((await purchase('2026-10-15', 5, request)).rows[0].id).toBe(request);
    expect(await purchases()).toBe(1);
    expect(await live()).toBe(15);
  });

  it('returns the first result when a closing was saved after it', async () => {
    await purchase('2026-10-15', 5, request);
    await save('2026-10-15', 12, 3);
    expect((await purchase('2026-10-15', 5, request)).rows[0].id).toBe(request);
    expect(await purchases()).toBe(1);
  });

  it('refuses one request id for a different purchase', async () => {
    await purchase('2026-10-15', 5, request);
    await expect(purchase('2026-10-15', 6, request)).rejects.toThrow('already used');
  });

  it('keeps the checks of the older function', async () => {
    await expect(purchase('2026-10-16', 5, request)).rejects.toThrow('future');
    await expect(purchase('2026-10-15', 1.5, request)).rejects.toThrow('whole number');
    await save('2026-10-15', 7, 3);
    await expect(purchase('2026-10-15', 5, request)).rejects.toThrow('saved stock closing');
    await db.exec(`select set_config('test.actor','',false);`);
    await expect(purchase('2026-10-14', 5, request)).rejects.toThrow('Not authorized');
  });

  it('refuses someone who is not a member of the club', async () => {
    await db.exec(`select set_config('test.role','',false);`);
    await expect(purchase('2026-10-15', 5, request)).rejects.toThrow('Not authorized');
  });

  it('rejects a zero sale price', async () => {
    await expect(db.query(
      'select public.record_stock_purchase(p_request_id => $1, p_club_id => $2, p_date => $3, p_product_id => $4, p_quantity => 1, p_cost_price => 1, p_sale_price => 0)',
      [request, club, '2026-10-15', cola],
    )).rejects.toThrow('sale price must be positive');
  });

  it('leaves callers without a request id on the older function', async () => {
    expect((await purchase('2026-10-15', 5)).rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await live()).toBe(15);
  });

  it('re-runs cleanly', async () => {
    await db.exec(migration('119_stock_purchase_request_id.sql'));
  });
});
