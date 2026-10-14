import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/075_debt_created_by_actor.sql'), 'utf8');
const admin = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000009';
const club = '10000000-0000-0000-0000-000000000001';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const insertDebt = (userId: string, createdBy?: string | null) => asUser(userId, () => db.query(
  createdBy === undefined
    ? 'insert into public.new_debts (club_id, person_name, amount) values ($1, $2, 10)'
    : 'insert into public.new_debts (club_id, person_name, amount, created_by) values ($1, $2, 10, $3)',
  createdBy === undefined ? [club, `debt-${userId}`] : [club, `debt-${userId}`, createdBy],
));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.club_memberships (club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${admin}','admin'),('${club}','${viewer}','viewer');
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_can_access_club_feature(p_club_id uuid, p_feature text) returns boolean
      language sql stable as $$ select true $$;
    create table public.new_debts (
      id uuid primary key default gen_random_uuid(), club_id uuid not null, person_name text not null,
      amount numeric not null, created_by uuid
    );
    alter table public.new_debts enable row level security;
    grant select, insert on public.new_debts to authenticated;
    create policy "club_read_debts" on public.new_debts for select using (true);
    -- The 036 insert policy that 075 replaces.
    create policy "club_admin_insert_debts" on public.new_debts
      for insert with check (
        public.current_user_club_role(club_id) in ('admin', 'owner')
        and public.current_user_can_access_club_feature(club_id, 'debts')
      );
  `);
  await db.exec(migration);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('debt author migration (075)', () => {
  it('records the signed-in user when the client omits created_by', async () => {
    await insertDebt(admin);
    const { rows } = await db.query<{ created_by: string }>(
      'select created_by from public.new_debts where person_name = $1', [`debt-${admin}`],
    );
    expect(rows).toEqual([{ created_by: admin }]);
  });

  it('still accepts older clients that send their own user id', async () => {
    await expect(insertDebt(admin, admin)).resolves.toBeDefined();
  });

  it('rejects a forged or empty author', async () => {
    await expect(insertDebt(admin, other)).rejects.toThrow(/row-level security/);
    await expect(insertDebt(admin, null)).rejects.toThrow(/row-level security/);
  });

  it('keeps the role check of the previous policy', async () => {
    await expect(insertDebt(viewer)).rejects.toThrow(/row-level security/);
  });
});
