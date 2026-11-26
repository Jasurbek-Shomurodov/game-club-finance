import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';

const migration = (name: string) => readFileSync(`migrations/${name}`, 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const actor = '20000000-0000-0000-0000-000000000001';
const product = '30000000-0000-0000-0000-000000000001';
const otherProduct = '30000000-0000-0000-0000-000000000002';
let db: PGlite;

function functionSql(file: string, name: string) {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}
async function buy(quantity: number, cost: number, clubId = club, productId = product) {
  const result = await db.query<{ id: string }>('select record_stock_purchase($1,$2,$3,$4,$5) as id',
    [clubId, '2026-09-15', productId, quantity, cost]);
  return result.rows[0].id;
}
async function balance() {
  return (await db.query('select current_stock::float8,cost_price::float8 from products where club_id=$1 and id=$2', [club, product])).rows[0];
}
async function asRole(role: string) {
  await db.query("select set_config('test.role',$1,false)", [role]);
}

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${actor}');
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create function current_user_club_role(id uuid) returns text language sql as $$
      select case when id='${club}' and auth.uid()='${actor}' then current_setting('test.role',true) end $$;
    create function current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$
      select coalesce(current_user_club_role(id) in ('admin','owner'),false) and current_setting('test.access',true)='enabled' $$;
    create function club_business_date(uuid) returns date language sql as $$ select '2026-09-15'::date $$;
  `);
  const schema = migration('002_rework_schema.sql');
  for (const table of ['products', 'stock_purchases', 'daily_stock_counts']) {
    const start = schema.indexOf(`create table if not exists ${table} (`);
    await db.exec(schema.slice(start, schema.indexOf('\n);', start) + 3));
    await db.exec(`alter table ${table} add club_id uuid not null;`);
  }
  await db.exec(migration('013_soft_delete_products.sql'));
  await db.exec(migration('025_made_to_order_products.sql'));
  await db.exec(`create trigger trg_stock_purchase after insert on stock_purchases for each row execute function update_stock_on_purchase();`);
  await db.exec(functionSql('034_atomic_closing_stock_save.sql', 'record_stock_purchase'));
  await db.exec(functionSql('031_inventory_and_access_hardening.sql', 'delete_stock_purchase'));
  const feature = migration('033_club_membership_feature_access.sql');
  await db.exec(feature.slice(feature.indexOf('create or replace function public.enforce_stock_purchase_feature_access(')));
  await db.exec(migration('055_product_archive_integrity.sql'));
  await db.exec(migration('056_owner_only_cost_prices.sql'));
  await db.exec(migration('058_admin_purchase_cost_entry.sql'));
  await db.exec(`
    grant usage on schema auth,public to authenticated,anon;
    grant select,insert on products to authenticated;
    grant update(name,cost_price) on products to authenticated;
    grant select on stock_purchases to authenticated;
    revoke insert,update,delete on stock_purchases from public,anon,authenticated;
    revoke all on function record_stock_purchase(uuid,date,uuid,numeric,numeric,numeric,text,text) from public,anon;
    revoke all on function delete_stock_purchase(uuid,uuid) from public,anon;
    grant execute on function record_stock_purchase(uuid,date,uuid,numeric,numeric,numeric,text,text) to authenticated;
    grant execute on function delete_stock_purchase(uuid,uuid) to authenticated;
    alter table products enable row level security;
    alter table stock_purchases enable row level security;
    create policy product_access on products to authenticated using (current_user_club_role(club_id) in ('admin','owner')) with check (current_user_club_role(club_id) in ('admin','owner'));
    create policy purchase_read on stock_purchases for select to authenticated using (current_user_club_role(club_id) in ('admin','owner'));
    -- These test-only wrappers prove a cost-only privileged write is still
    -- blocked; the exception requires an authorized stock movement.
    create function repair_cost(cost numeric) returns void language sql security definer set search_path=public as $$
      update products set cost_price=cost where id='${product}' $$;
    create function rewrite_receipt(id uuid, cost numeric) returns void language sql security definer set search_path=public as $$
      update stock_purchases set cost_price=cost where stock_purchases.id=$1 $$;
  `);
}, 20000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;
    select set_config('test.actor','',false);
    select set_config('test.role','admin',false);
    select set_config('test.access','enabled',false);
    truncate daily_stock_counts,stock_purchases,products;
    insert into products(id,club_id,name,current_stock,cost_price,sale_price) values
      ('${product}','${club}','Drink',10,8,20),('${otherProduct}','${otherClub}','Other drink',10,8,20);
    select set_config('test.actor','${actor}',false);
    set role authenticated;`);
});

describe('catalog cost protection and admin purchase costs', () => {
  it('accepts an admin receipt at a different cost and applies the weighted average atomically', async () => {
    const id = await buy(10, 12);
    expect(await balance()).toEqual({ current_stock: 20, cost_price: 10 });
    expect((await db.query('select quantity::float8,cost_price::float8,created_by from stock_purchases where id=$1', [id])).rows)
      .toEqual([{ quantity: 10, cost_price: 12, created_by: actor }]);
  });

  it('allows an admin to enter the first purchase cost for a zero-cost catalog product', async () => {
    await db.exec(`reset role; select set_config('test.actor','',false); update products set current_stock=0,cost_price=0 where id='${product}';
      select set_config('test.actor','${actor}',false); set role authenticated;`);
    await buy(36, 9168);
    expect(await balance()).toEqual({ current_stock: 36, cost_price: 9168 });
  });

  it('allows lower and unchanged receipt costs, including fractional unit currency', async () => {
    await buy(10, 4.5);
    expect(await balance()).toEqual({ current_stock: 20, cost_price: 6.25 });
    await buy(4, 6.25);
    expect(await balance()).toEqual({ current_stock: 24, cost_price: 6.25 });
  });

  it('keeps direct admin inventory cost edits and nonzero-cost product creation blocked', async () => {
    await expect(db.query('update products set cost_price=12 where id=$1', [product])).rejects.toThrow('Only a club owner');
    await expect(db.query("insert into products(club_id,name,cost_price) values($1,'New',12)", [club])).rejects.toThrow('Only a club owner');
    await expect(db.query('update products set current_stock=20,cost_price=12 where id=$1', [product])).rejects.toThrow('permission denied');
    await expect(db.exec('select repair_cost(12)')).rejects.toThrow('Only a club owner');
    expect(await balance()).toEqual({ current_stock: 10, cost_price: 8 });
    await db.query('update products set name=$1 where id=$2', ['Renamed', product]);
    await db.query("insert into products(club_id,name) values($1,'New without cost')", [club]);
  });

  it('allows owners to change catalog cost and enter receipt costs', async () => {
    await asRole('owner');
    await db.query('update products set cost_price=12 where id=$1', [product]);
    await buy(10, 16);
    expect(await balance()).toEqual({ current_stock: 20, cost_price: 14 });
  });

  it('reverses an admin purchase through the atomic delete RPC and restores its cost basis', async () => {
    const id = await buy(10, 12);
    await db.query('select delete_stock_purchase($1,$2)', [club, id]);
    expect(await balance()).toEqual({ current_stock: 10, cost_price: 8 });
    expect((await db.query('select id from stock_purchases')).rows).toEqual([]);
  });

  it('rejects direct ledger writes and privileged rewrites of an existing receipt by admins', async () => {
    const id = await buy(10, 12);
    await expect(db.query('update stock_purchases set cost_price=99 where id=$1', [id])).rejects.toThrow('permission denied');
    await expect(db.query('select rewrite_receipt($1,99)', [id])).rejects.toThrow('Only a club owner');
    await expect(db.query("insert into stock_purchases(club_id,product_id,date,quantity,cost_price) values($1,$2,'2026-09-15',1,8)", [club, product])).rejects.toThrow('permission denied');
    expect(await balance()).toEqual({ current_stock: 20, cost_price: 10 });
  });

  it('denies viewers, unauthenticated callers, other clubs and disabled purchase access', async () => {
    await asRole('viewer');
    await expect(buy(10, 12)).rejects.toThrow('Not authorized');
    await asRole('admin');
    await expect(buy(10, 12, otherClub, otherProduct)).rejects.toThrow('Stock Purchase access');
    await expect(buy(10, 12, club, otherProduct)).rejects.toThrow('Active inventory product');
    await db.exec("select set_config('test.access','disabled',false)");
    await expect(buy(10, 12)).rejects.toThrow('Stock Purchase access');
    await db.exec("select set_config('test.actor','',false)");
    await expect(buy(10, 12)).rejects.toThrow('Not authorized');
    await db.exec(`select set_config('test.actor','${actor}',false); select set_config('test.access','enabled',false)`);
    expect(await balance()).toEqual({ current_stock: 10, cost_price: 8 });
    expect((await db.query('select id from stock_purchases')).rows).toEqual([]);
  });

  it('rolls back invalid receipt quantities and negative costs without changing stock', async () => {
    await expect(buy(1.5, 12)).rejects.toThrow('positive whole number');
    await expect(buy(0, 12)).rejects.toThrow('positive whole number');
    await expect(buy(1, -1)).rejects.toThrow('cannot be negative');
    expect(await balance()).toEqual({ current_stock: 10, cost_price: 8 });
    expect((await db.query('select id from stock_purchases')).rows).toEqual([]);
  });
});
