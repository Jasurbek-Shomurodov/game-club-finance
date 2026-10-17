import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('migrations', '084_daily_cash_entry_author_integrity.sql'), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const admin = '20000000-0000-0000-0000-000000000001';
const owner = '20000000-0000-0000-0000-000000000002';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function public.current_user_club_role(id uuid) returns text language sql as $$ select 'admin' $$;
    create function public.current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$ select true $$;
    create table public.daily_cash_entries(
      id uuid primary key default gen_random_uuid(), club_id uuid not null, date date not null,
      cash_income numeric not null default 0, created_by uuid, created_at timestamptz not null default now()
    );
    alter table public.daily_cash_entries enable row level security;
    create policy cash_read on public.daily_cash_entries for select using (true);
    create policy cash_update on public.daily_cash_entries for update using (true)
      with check (created_at > now() - interval '15 minutes');
    grant select, insert, update on public.daily_cash_entries to authenticated;
  `);
  await db.exec(sql);
  await db.exec(sql); // re-runnable
});

afterAll(async () => { await db.close(); });

async function asUser(actor: string, statement: string) {
  await db.exec(`set test.actor = '${actor}'; set role authenticated`);
  try {
    return await db.query<{ created_by: string; created_at: string }>(statement);
  } finally {
    await db.exec('reset role; reset test.actor');
  }
}

describe('084 daily cash entry author integrity', () => {
  it('records the signed-in user as the author by default', async () => {
    await asUser(admin, `insert into public.daily_cash_entries (club_id, date, cash_income) values ('${club}', '2026-10-16', 1000)`);
    const { rows } = await db.query<{ created_by: string }>(`select created_by from public.daily_cash_entries where date = '2026-10-16'`);
    expect(rows[0].created_by).toBe(admin);
  });

  it('refuses an insert that names another member as the author', async () => {
    await expect(asUser(admin, `insert into public.daily_cash_entries (club_id, date, created_by) values ('${club}', '2026-10-15', '${owner}')`))
      .rejects.toThrow(/row-level security/);
  });

  it('keeps created_at and created_by fixed so the edit window cannot be reopened', async () => {
    await db.exec(`insert into public.daily_cash_entries (club_id, date, created_by, created_at)
      values ('${club}', '2026-10-14', '${admin}', now() - interval '1 hour')`);
    await expect(asUser(admin, `update public.daily_cash_entries set created_at = now(), cash_income = 5 where date = '2026-10-14'`))
      .rejects.toThrow(/row-level security/);
    await db.exec(`update public.daily_cash_entries set created_by = '${owner}', created_at = now() where date = '2026-10-14'`);
    const { rows } = await db.query<{ created_by: string; old: boolean }>(
      `select created_by, created_at < now() - interval '30 minutes' as old from public.daily_cash_entries where date = '2026-10-14'`);
    expect(rows[0]).toEqual({ created_by: admin, old: true });
  });
});
