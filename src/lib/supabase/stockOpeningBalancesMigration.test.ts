import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';
import { buildEditableClosingStockRows, buildClosingStockUpserts } from '../closingStock';
import type { Product } from '../../types';

const migration = (name: string) => readFileSync(resolve('migrations', name), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const actor = '20000000-0000-0000-0000-000000000001';
const fanta = '30000000-0000-0000-0000-000000000001';
const cappy = '30000000-0000-0000-0000-000000000002';
const otherProduct = '30000000-0000-0000-0000-000000000003';
let db: PGlite;

async function save(date: string, id: string, closing: number, sold: number, clubId = club) {
  return db.query('select public.save_closing_stock_counts($1,$2,$3::jsonb)', [clubId, date,
    JSON.stringify([{ product_id: id, closing_stock: closing, sold_quantity: sold }])]);
}
async function receipt(id: string, date: string, quantity: number) {
  return db.query('select record_stock_purchase($1,$2,$3,$4,8)', [club, date, id, quantity]);
}
async function opening(date: string) {
  return (await db.query<{ product_id: string; previous_stock: string }>(
    'select * from get_stock_opening_balances($1,$2) order by product_id', [club, date])).rows;
}
async function count(date: string, id = fanta) {
  return (await db.query(`select previous_stock,added_today,closing_stock,sold_quantity,bar_income::float8,bar_cost::float8,bar_profit::float8
    from daily_stock_counts where club_id=$1 and product_id=$2 and date=$3`, [club, id, date])).rows[0];
}
async function live(id = fanta) {
  return (await db.query<{ current_stock: string }>('select current_stock from products where club_id=$1 and id=$2', [club, id])).rows[0].current_stock;
}

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${actor}');
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create function current_user_club_role(id uuid) returns text language sql as $$
      select case when id='${club}' and auth.uid()='${actor}' then current_setting('test.role',true) end $$;
    create function current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$
      select coalesce(current_user_club_role(id) in ('owner','admin'),false) $$;
    create function club_business_date(uuid) returns date language sql as $$ select current_setting('test.date')::date $$;
    select set_config('test.date','2026-09-15',false);
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
  await db.exec(`grant usage on schema public, auth to authenticated;
    grant select on products, stock_purchases, daily_stock_counts to authenticated;
    alter table products enable row level security;
    alter table stock_purchases enable row level security;
    alter table daily_stock_counts enable row level security;
    create policy read_products on products for select to authenticated using (club_id='${club}' and auth.uid()='${actor}');
    create policy read_purchases on stock_purchases for select to authenticated using (club_id='${club}' and auth.uid()='${actor}');
    create policy read_counts on daily_stock_counts for select to authenticated using (club_id='${club}' and auth.uid()='${actor}');`);
}, 20000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;
    truncate daily_stock_counts,stock_purchases,products;
    select set_config('test.actor','',false);
    select set_config('test.date','2026-09-15',false);
    select set_config('test.role','owner',false);
    insert into products(id,club_id,name,current_stock,sale_price,cost_price) values
      ('${fanta}','${club}','Fanta',3,13,8),('${cappy}','${club}','Cappy',4,20,8),
      ('${otherProduct}','${otherClub}','Other club',50,20,8);
    select set_config('test.actor','${actor}',false);`);
});

describe('skipped-date stock migration in PostgreSQL', () => {
  it('reproduces the reported sequence through purchase, read, UI payload, save, and repeat save', async () => {
    await db.exec("select set_config('test.date','2026-09-12',false)");
    await save('2026-09-12', fanta, 3, 0);
    await save('2026-09-12', cappy, 4, 0);
    await db.exec("select set_config('test.date','2026-09-15',false)");
    await receipt(fanta, '2026-09-14', 6);
    await receipt(cappy, '2026-09-14', 6);
    expect(await live()).toBe('9');
    const balances = await opening('2026-09-15');
    expect(balances).toEqual([{ product_id: fanta, previous_stock: '9' }, { product_id: cappy, previous_stock: '10' }]);
    const products = (await db.query<Product>('select * from products where club_id=$1', [club])).rows;
    const rows = buildEditableClosingStockRows({ products, counts: [], purchases: [],
      previousClosings: Object.fromEntries(balances.map((r) => [r.product_id, Number(r.previous_stock)])), isCurrentDate: true });
    const { upserts } = buildClosingStockUpserts({ date: '2026-09-15', rows, createdBy: actor });
    const oldMigration = migration('038_stock_snapshot_and_payment_method_integrity.sql');
    await db.exec(oldMigration.slice(oldMigration.indexOf('create or replace function public.save_closing_stock_counts(')));
    await expect(db.query('select save_closing_stock_counts($1,$2,$3::jsonb)',
      [club, '2026-09-15', JSON.stringify(upserts)])).rejects.toThrow('Closing stock exceeds');
    await db.exec(migration('057_stock_opening_purchase_carry_forward.sql'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await db.query('select save_closing_stock_counts($1,$2,$3::jsonb)', [club, '2026-09-15', JSON.stringify(upserts)]);
      expect(await live()).toBe('9');
      expect(await live(cappy)).toBe('10');
      expect(await count('2026-09-15')).toMatchObject({ previous_stock: '9', added_today: '0', sold_quantity: '0', closing_stock: '9' });
    }
  });

  it('keeps same-day purchases separate, calculates sales, and does not carry purchases twice on the next day', async () => {
    await save('2026-09-12', fanta, 0, 0);
    await receipt(fanta, '2026-09-13', 2);
    await receipt(fanta, '2026-09-14', 4);
    await receipt(fanta, '2026-09-15', 3);
    expect(await opening('2026-09-15')).toEqual([{ product_id: fanta, previous_stock: '6' }]);
    await save('2026-09-15', fanta, 7, 2);
    expect(await count('2026-09-15')).toEqual({ previous_stock: '6', added_today: '3', closing_stock: '7', sold_quantity: '2', bar_income: 26, bar_cost: 16, bar_profit: 10 });
    await db.exec("select set_config('test.date','2026-09-16',false)");
    expect(await opening('2026-09-16')).toEqual([{ product_id: fanta, previous_stock: '7' }]);
    await save('2026-09-16', fanta, 7, 0);
  });

  it('supports first historical closings without using later live inventory', async () => {
    await receipt(fanta, '2026-09-13', 6);
    await receipt(fanta, '2026-09-15', 12);
    expect(await opening('2026-09-14')).toEqual([{ product_id: fanta, previous_stock: '6' }]);
    await save('2026-09-14', fanta, 5, 1);
    expect(await count('2026-09-14')).toMatchObject({ previous_stock: '6', added_today: '0', closing_stock: '5', sold_quantity: '1' });
  });

  it('includes skipped receipts in historical forward validation and recalculation', async () => {
    await db.exec("select set_config('test.date','2026-09-12',false)");
    await save('2026-09-12', fanta, 3, 0);
    await db.exec("select set_config('test.date','2026-09-15',false)");
    await receipt(fanta, '2026-09-14', 6);
    await save('2026-09-15', fanta, 7, 2);
    await save('2026-09-12', fanta, 2, 1);
    expect(await count('2026-09-15')).toMatchObject({ previous_stock: '8', closing_stock: '7', sold_quantity: '1', bar_income: 13, bar_cost: 8 });
    const before = await count('2026-09-12');
    await expect(save('2026-09-12', fanta, 0, 3)).rejects.toThrow('Historical change makes');
    expect(await count('2026-09-12')).toEqual(before);
    expect(await live()).toBe('7');
  });

  it('repartitions a gap when the owner inserts the missing intermediate closing', async () => {
    await save('2026-09-12', fanta, 0, 0);
    await receipt(fanta, '2026-09-14', 6);
    await save('2026-09-15', fanta, 5, 1);
    await save('2026-09-14', fanta, 6, 0);
    expect(await count('2026-09-14')).toMatchObject({ previous_stock: '0', added_today: '6', closing_stock: '6' });
    expect(await count('2026-09-15')).toMatchObject({ previous_stock: '6', added_today: '0', sold_quantity: '1' });
  });

  it('does not rewrite historical snapshots when the migration runs or reads occur', async () => {
    await save('2026-09-12', fanta, 0, 0);
    await receipt(fanta, '2026-09-14', 6);
    await save('2026-09-14', fanta, 5, 1);
    const before = await count('2026-09-14');
    await db.exec(`update stock_purchases set quantity=8 where product_id='${fanta}';`);
    await db.exec(migration('057_stock_opening_purchase_carry_forward.sql'));
    await opening('2026-09-15');
    expect(await count('2026-09-14')).toEqual(before);
    await save('2026-09-14', fanta, 5, 1);
    expect(await count('2026-09-14')).toEqual(before);
  });

  it('keeps a pre-fix historical snapshot editable without silently reconciling its opening', async () => {
    await db.exec("select set_config('test.date','2026-09-12',false)");
    await save('2026-09-12', fanta, 3, 0);
    await db.exec("select set_config('test.date','2026-09-15',false)");
    await receipt(fanta, '2026-09-14', 6);
    const oldMigration = migration('038_stock_snapshot_and_payment_method_integrity.sql');
    await db.exec(oldMigration.slice(oldMigration.indexOf('create or replace function public.save_closing_stock_counts(')));
    await save('2026-09-15', fanta, 3, 0); // The original bug's saved snapshot.
    await db.exec("select set_config('test.date','2026-09-16',false)");
    await db.exec(migration('057_stock_opening_purchase_carry_forward.sql'));
    await save('2026-09-15', fanta, 2, 1);
    expect(await count('2026-09-15')).toMatchObject({ previous_stock: '3', added_today: '0', closing_stock: '2', sold_quantity: '1' });
  });

  it('uses live stock without doubling earlier receipts before the first current-day closing', async () => {
    await receipt(fanta, '2026-09-14', 6);
    await receipt(fanta, '2026-09-15', 2);
    expect(await opening('2026-09-15')).toEqual([]);
    await save('2026-09-15', fanta, 10, 1);
    expect(await count('2026-09-15')).toMatchObject({ previous_stock: '9', added_today: '2', closing_stock: '10', sold_quantity: '1' });
  });

  it('keeps made-to-order sales independent of opening receipts', async () => {
    await db.exec(`update products set tracks_inventory=false,current_stock=0 where id='${fanta}'`);
    await save('2026-09-15', fanta, 0, 4);
    expect(await count('2026-09-15')).toMatchObject({ previous_stock: '0', added_today: '0', closing_stock: '0', sold_quantity: '4' });
    await expect(receipt(fanta, '2026-09-14', 6)).rejects.toThrow();
  });

  it('enforces club scope, RLS, admin date limits, and atomic rollback', async () => {
    await save('2026-09-12', fanta, 0, 0);
    await receipt(fanta, '2026-09-14', 6);
    await db.exec(`select set_config('test.actor','',false);
      insert into stock_purchases(club_id,product_id,date,quantity,cost_price) values('${otherClub}','${otherProduct}','2026-09-14',100,8);
      select set_config('test.actor','${actor}',false); set role authenticated;`);
    expect(await opening('2026-09-15')).toEqual([{ product_id: fanta, previous_stock: '6' }]);
    expect((await db.query('select * from get_stock_opening_balances($1,$2)', [otherClub, '2026-09-15'])).rows).toEqual([]);
    await expect(save('2026-09-15', otherProduct, 0, 0, otherClub)).rejects.toThrow('Not authorized');
    await db.exec("select set_config('test.role','admin',false)");
    await expect(save('2026-09-14', fanta, 6, 0)).rejects.toThrow('Admins can only');
    await save('2026-09-15', fanta, 6, 0);
    await expect(db.query('select save_closing_stock_counts($1,$2,$3::jsonb)', [club, '2026-09-15', JSON.stringify([
      { product_id: fanta, closing_stock: 5, sold_quantity: 1 },
      { product_id: otherProduct, closing_stock: 0, sold_quantity: 0 },
    ])])).rejects.toThrow('Active product does not exist');
    expect(await count('2026-09-15')).toMatchObject({ closing_stock: '6', sold_quantity: '0' });
  });
});
