import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';

const migration = (name: string) => readFileSync(resolve('migrations', name), 'utf8');
let db: PGlite;
beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create function public.current_user_club_role(uuid) returns text language sql as $$ select current_setting('test.role', true) $$;
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create table auth.users(id uuid primary key);
  `);
  const schema = migration('002_rework_schema.sql');
  for (const table of ['products', 'stock_purchases', 'daily_stock_counts']) {
    const start = schema.indexOf(`create table if not exists ${table} (`);
    await db.exec(schema.slice(start, schema.indexOf('\n);', start) + 3));
    await db.exec(`alter table ${table} add club_id uuid;`);
  }
  await db.exec(migration('013_soft_delete_products.sql'));
  await db.exec(migration('055_product_archive_integrity.sql'));
  await db.exec(`
    insert into products(id,club_id,name,current_stock,sale_price,cost_price) values
      ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Historical product',10,20,8);
    insert into stock_purchases(date,club_id,product_id,quantity,cost_price) select '2026-09-01',club_id,id,10,8 from products;
    insert into daily_stock_counts(date,club_id,product_id,previous_stock,closing_stock,sold_quantity,sale_price,cost_price,bar_income,bar_cost,bar_profit)
      select '2026-09-02',club_id,id,10,7,3,15,6,45,18,27 from products;
  `);
}, 20000);
afterAll(async () => { await db?.close(); });

it('uses non-cascading product foreign keys', async () => {
  const { rows } = await db.query<{ confdeltype: string }>(`select confdeltype from pg_constraint where confrelid='products'::regclass and contype='f'`);
  expect(rows).toEqual([{ confdeltype: 'a' }, { confdeltype: 'a' }]);
});

it('preserves every ledger field, joins, revenue, COGS and profit through archival', async () => {
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(c)) from daily_stock_counts c) counts,
    (select jsonb_agg(to_jsonb(p)) from stock_purchases p) purchases,
    (select jsonb_agg(jsonb_build_array(p.name, c.bar_income, c.bar_cost, c.bar_profit, c.closing_stock*c.cost_price))
     from daily_stock_counts c join products p on p.id=c.product_id) closing_report,
    (select jsonb_agg(jsonb_build_array(p.name, s.quantity*s.cost_price, coalesce(s.sale_price,p.sale_price)))
     from stock_purchases s join products p on p.id=s.product_id) purchase_report`)).rows;
  const before = await snapshot();
  await db.exec(`update products set is_deleted=true;`);
  expect(await snapshot()).toEqual(before);
  expect((await db.query('select is_active,current_stock,deleted_at is not null as dated from products')).rows)
    .toEqual([{ is_active: false, current_stock: '0', dated: true }]);
  expect((await db.query('select * from products where is_active and not is_deleted')).rows).toEqual([]);
  await expect(db.exec('delete from products')).rejects.toThrow('must be archived');
  await expect(db.exec("update products set name='Changed'")).rejects.toThrow('read-only');
  await expect(db.exec('update products set is_deleted=false,is_active=true')).rejects.toThrow('read-only');
  await db.exec('update products set current_stock=99');
  expect((await db.query('select current_stock from products')).rows).toEqual([{ current_stock: '0' }]);
  await expect(db.exec(`insert into stock_purchases(date,club_id,product_id,quantity,cost_price) select '2026-09-03',club_id,id,1,8 from products`)).rejects.toThrow('new stock operations');
  await expect(db.exec(`insert into daily_stock_counts(date,club_id,product_id) select '2026-09-03',club_id,id from products`)).rejects.toThrow('new stock operations');
  await expect(db.exec(`insert into daily_stock_counts(date,product_id) select '2026-09-03',id from products`)).rejects.toThrow('new stock operations');
  await expect(db.exec('update daily_stock_counts set sold_quantity=99')).rejects.toThrow('new stock operations');
  expect(await snapshot()).toEqual(before);
});

it('allows only owners to archive and also blocks hard deletion without history', async () => {
  await db.exec(`insert into products(name) values ('Unused'); select set_config('test.actor','20000000-0000-0000-0000-000000000001',false);`);
  for (const role of ['admin', 'viewer', '']) {
    await db.query("select set_config('test.role',$1,false)", [role]);
    await expect(db.exec("update products set is_deleted=true where name='Unused'")).rejects.toThrow('Only a club owner');
  }
  await expect(db.exec("delete from products where name='Unused'")).rejects.toThrow('must be archived');
  await db.exec("select set_config('test.role','owner',false); update products set is_deleted=true where name='Unused'");
});
