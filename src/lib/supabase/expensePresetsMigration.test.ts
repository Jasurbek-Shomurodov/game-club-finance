import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/091_expense_presets.sql'), 'utf8');
const integrity = readFileSync(resolve(process.cwd(), 'migrations/093_expense_preset_integrity.sql'), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const power = '20000000-0000-0000-0000-000000000001';
const fridge = '20000000-0000-0000-0000-000000000002';
const foreign = '20000000-0000-0000-0000-000000000003';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const insertExpense = (preset: string | null, category = 'electricity', source = 'game_club', clubId = club) => db.query(
  'insert into public.expenses (club_id, category, payment_source, amount, preset_id) values ($1, $2, $3, 1000, $4)',
  [clubId, category, source, preset],
);

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(`
    create extension if not exists "uuid-ossp";
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${admin}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${club}'), ('${otherClub}');
    create table public.club_memberships (club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${club}','${admin}','admin'),('${otherClub}','${admin}','owner');
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_readable_clubs(p_features text[]) returns setof uuid language sql stable security definer set search_path=public as $$
      select club_id from public.club_memberships where user_id=auth.uid()
    $$;
    create table public.expenses (
      id uuid primary key default uuid_generate_v4(), club_id uuid not null references public.clubs(id),
      category text not null, payment_source text, amount numeric not null, date date not null default current_date
    );
    alter default privileges in schema public grant all on tables to authenticated;
    grant all on public.expenses to authenticated;
  `);
  // Both re-runnable.
  for (const sql of [migration, migration, integrity, integrity]) await db.exec(sql);
  await db.exec(`
    insert into public.expense_presets (id, club_id, name, category, payment_source, monthly_amount) values
      ('${power}', '${club}', 'Electricity', 'electricity', 'game_club', 3000000),
      ('${fridge}', '${club}', 'Fridge service', 'repair', 'bar', 200000),
      ('${foreign}', '${otherClub}', 'iCafe', 'equipment', 'game_club', 500000);
  `);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('expense presets migration (091)', () => {
  it('lets owners manage presets and keeps them in their own club', async () => {
    await asUser(owner, () => db.query(
      "insert into public.expense_presets (club_id, name, category, monthly_amount) values ($1, 'Server maintenance', 'equipment', 400000)",
      [club],
    ));
    // 093: the author is the signed-in owner.
    const author = await db.query<{ created_by: string }>("select created_by from public.expense_presets where name = 'Server maintenance'");
    expect(author.rows).toEqual([{ created_by: owner }]);
    await expect(asUser(owner, () => db.query(
      "insert into public.expense_presets (club_id, name, category, created_by) values ($1, 'Rent', 'rent', $2)", [club, admin],
    ))).rejects.toThrow(/row-level security/);
    await expect(asUser(admin, () => db.query(
      "insert into public.expense_presets (club_id, name, category) values ($1, 'Rent', 'rent')", [club],
    ))).rejects.toThrow(/row-level security/);
    const visible = await asUser(owner, () => db.query<{ name: string }>('select name from public.expense_presets order by name'));
    expect(visible.rows.map((row) => row.name)).toEqual(['Electricity', 'Fridge service', 'Server maintenance']);
    const changed = await asUser(admin, () => db.query(
      'update public.expense_presets set monthly_amount = 1 where id = $1', [power],
    ));
    expect(changed.affectedRows).toBe(0);
    await expect(asUser(owner, () => db.query('delete from public.expense_presets where id = $1', [power])))
      .rejects.toThrow(/permission denied/);
  });

  it('rejects a second live preset with the same name and a salary category', async () => {
    await expect(db.query(
      "insert into public.expense_presets (club_id, name, category) values ($1, ' electricity ', 'electricity')", [club],
    )).rejects.toThrow(/expense_presets_live_name_key/);
    await expect(db.query(
      "insert into public.expense_presets (club_id, name, category) values ($1, 'Staff', 'salary')", [club],
    )).rejects.toThrow(/expense_presets_category_manual/);
  });

  it('links expenses only to a live preset of the same club, category and money source', async () => {
    await expect(insertExpense(power)).resolves.toBeDefined();
    await expect(insertExpense(null, 'rent')).resolves.toBeDefined();
    await expect(insertExpense(fridge, 'repair', 'bar')).resolves.toBeDefined();
    await expect(insertExpense(power, 'repair')).rejects.toThrow(/does not match its preset/);
    await expect(insertExpense(fridge, 'repair', 'game_club')).rejects.toThrow(/does not match its preset/);
    await expect(insertExpense(foreign, 'equipment')).rejects.toThrow(/not available/);

    await db.query('update public.expense_presets set archived_at = now() where id = $1', [fridge]);
    await expect(insertExpense(fridge, 'repair', 'bar')).rejects.toThrow(/not available/);
    // An archived preset frees its name for a new one.
    await expect(db.query(
      "insert into public.expense_presets (club_id, name, category, payment_source) values ($1, 'Fridge service', 'repair', 'bar')", [club],
    )).resolves.toBeDefined();
  });

  it('fixes the category and money source once a payment links to the preset (093)', async () => {
    await db.query(
      "insert into public.expense_presets (id, club_id, name, category) values ('20000000-0000-0000-0000-000000000009', $1, 'Cleaning firm', 'cleaning')",
      [club],
    );
    const unused = '20000000-0000-0000-0000-000000000009';
    // A preset nothing links to yet can still be corrected.
    await expect(asUser(owner, () => db.query("update public.expense_presets set category = 'supplies' where id = $1", [unused])))
      .resolves.toBeDefined();
    await expect(asUser(owner, () => db.query("update public.expense_presets set payment_source = 'bar' where id = $1", [power])))
      .rejects.toThrow(/cannot change/);
    await expect(asUser(owner, () => db.query("update public.expense_presets set category = 'rent' where id = $1", [power])))
      .rejects.toThrow(/cannot change/);
    await expect(asUser(owner, () => db.query(
      "update public.expense_presets set name = 'Power', monthly_amount = 3200000 where id = $1", [power],
    ))).resolves.toBeDefined();
  });
});
