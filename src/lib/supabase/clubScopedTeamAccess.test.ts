import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const multiClub = readMigration('014_multi_club_support.sql');
const lastOwner = readMigration('031_inventory_and_access_hardening.sql');
const rejection = readMigration('072_reject_access_requests.sql');
const migration = readMigration('074_club_scoped_team_access.sql');

const slice = (sql: string, start: string, end: string) => {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return sql.slice(from, to);
};

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const clubA = '10000000-0000-0000-0000-000000000001';
const clubB = '10000000-0000-0000-0000-000000000002';
const ownerA = id(1);
const adminA = id(2);
const ownerB = id(3);
const memberB = id(4);
const pending = id(5);
const rejected = id(6);

let db: PGlite;

interface DbError { code?: string }

/** Runs statements as `actor` inside a transaction that is always rolled back. */
async function asActor<T>(actor: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${actor}', true);`);
  try {
    return await work();
  } finally {
    await db.exec('rollback');
  }
}

async function errorCode(sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as DbError).code ?? 'unknown';
  }
}

async function ids(sql: string) {
  return (await db.query<{ id: string }>(sql)).rows.map((row) => row.id).sort();
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create role anon nologin;
    create schema auth;
    grant usage on schema public, auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create type public.user_role as enum ('owner', 'admin', 'viewer');
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text,
      email text,
      role public.user_role not null default 'viewer',
      updated_at timestamptz default now()
    );
    create table public.clubs (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      address text,
      updated_at timestamptz default now()
    );
    create table public.club_memberships (
      club_id uuid references public.clubs(id) on delete cascade,
      user_id uuid references auth.users(id) on delete cascade,
      role public.user_role not null,
      feature_access text[],
      updated_at timestamptz default now(),
      primary key (club_id, user_id)
    );
    alter table public.profiles enable row level security;
    grant select, insert, update, delete on public.profiles, public.clubs, public.club_memberships to authenticated;
  `);

  // The actual helpers, policies, and triggers in migration order.
  await db.exec(slice(multiClub, 'create or replace function public.user_has_club_access', 'create or replace function public.current_user_role()'));
  await db.exec(slice(multiClub, 'create or replace function public.create_club_with_owner', 'create or replace function public.ensure_product_club_match'));
  await db.exec(slice(multiClub, 'alter table public.clubs enable row level security;', 'drop policy if exists "auth_all_products"'));
  await db.exec(slice(lastOwner, 'create or replace function public.prevent_last_club_owner_removal()', 'revoke all on function public.prevent_last_club_owner_removal()'));
  await db.exec(rejection);
  await db.exec(migration);

  const users = [ownerA, adminA, ownerB, memberB, pending, rejected];
  await db.exec(`
    insert into auth.users (id) values ${users.map((user) => `('${user}')`).join(',')};
    insert into public.profiles (id, full_name) values ${users.map((user, index) => `('${user}', 'User ${index + 1}')`).join(',')};
    insert into public.clubs (id, name) values ('${clubA}', 'Club A'), ('${clubB}', 'Club B');
    insert into public.club_memberships (club_id, user_id, role) values
      ('${clubA}', '${ownerA}', 'owner'),
      ('${clubA}', '${adminA}', 'admin'),
      ('${clubB}', '${ownerB}', 'owner'),
      ('${clubB}', '${memberB}', 'viewer');
    update public.profiles set access_rejected_at = now() where id = '${rejected}';
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('074 club-scoped team access', () => {
  it('no longer references the any-club owner bypass in active policies', () => {
    const active = new Map<string, string>();
    for (const file of readdirSync(resolve(process.cwd(), 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = readMigration(file);
      for (const match of sql.matchAll(/\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?(\w+)([^;]*);/gi)) {
        const [, operation, name, table, body] = match;
        if (operation.toLowerCase() === 'create') active.set(`${table}:${name}`, body);
        else active.delete(`${table}:${name}`);
      }
    }
    const bypasses = [...active].filter(([, body]) => body.includes('current_user_is_global_owner'));
    expect(bypasses.map(([key]) => key)).toEqual([]);
    expect(active.has('club_memberships:owners_manage_members')).toBe(false);
  });

  it('limits profile, membership, and club reads to the caller\'s clubs plus open requests', async () => {
    await asActor(ownerA, async () => {
      expect(await ids('select id from public.profiles')).toEqual([ownerA, adminA, pending].sort());
      expect(await ids('select distinct club_id as id from public.club_memberships')).toEqual([clubA]);
      expect(await ids('select id from public.clubs')).toEqual([clubA]);
    });
    // Open requests are visible to owners only.
    await asActor(adminA, async () => {
      expect(await ids('select id from public.profiles')).toEqual([ownerA, adminA].sort());
    });
  });

  it('refuses cross-club membership writes and allows approval inside an owned club', async () => {
    await asActor(ownerA, async () => {
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubB}', '${ownerA}', 'owner')`)).toBe('42501');
    });
    await asActor(ownerA, async () => {
      // A member of an unrelated club is not an open request.
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubA}', '${memberB}', 'viewer')`)).toBe('42501');
    });
    await asActor(ownerA, async () => {
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubA}', '${rejected}', 'viewer')`)).toBe('42501');
    });
    await asActor(ownerA, async () => {
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubA}', '${pending}', 'viewer')`)).toBeNull();
    });
    await asActor(ownerA, async () => {
      expect((await db.query(`update public.club_memberships set role = 'admin' where club_id = '${clubB}' returning user_id`)).rows).toEqual([]);
      expect((await db.query(`delete from public.club_memberships where club_id = '${clubB}' returning user_id`)).rows).toEqual([]);
      expect(await errorCode(`update public.club_memberships set club_id = '${clubB}' where user_id = '${adminA}'`)).not.toBeNull();
    });
    await asActor(adminA, async () => {
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubA}', '${pending}', 'viewer')`)).toBe('42501');
    });
  });

  it('keeps the last-owner guard', async () => {
    await asActor(ownerA, async () => {
      expect(await errorCode(`update public.club_memberships set role = 'admin' where club_id = '${clubA}' and user_id = '${ownerA}'`)).toBe('23514');
    });
  });

  it('scopes club and profile updates to owned clubs', async () => {
    await asActor(ownerA, async () => {
      expect((await db.query(`update public.clubs set name = 'Taken' where id = '${clubB}' returning id`)).rows).toEqual([]);
      expect((await db.query(`update public.clubs set name = 'Renamed' where id = '${clubA}' returning id`)).rows).toHaveLength(1);
      expect((await db.query(`update public.profiles set role = 'owner' where id = '${ownerB}' returning id`)).rows).toEqual([]);
      expect((await db.query(`update public.profiles set role = 'owner' where id = '${pending}' returning id`)).rows).toEqual([]);
      expect((await db.query(`update public.profiles set role = 'admin' where id = '${adminA}' returning id`)).rows).toHaveLength(1);
    });
  });

  it('still lets an owner create a club', async () => {
    await asActor(ownerA, async () => {
      const result = await db.query<{ name: string }>(`select name from public.create_club_with_owner('New club', null)`);
      expect(result.rows[0].name).toBe('New club');
    });
    await asActor(pending, async () => {
      expect(await errorCode(`select public.create_club_with_owner('Mine', null)`)).not.toBeNull();
    });
  });

  it('rejects only open requests, atomically marking them', async () => {
    const reject = async (user: string) => (
      await db.query<{ outcome: string }>(`select public.reject_access_request('${user}') as outcome`)
    ).rows[0].outcome;

    await asActor(ownerA, async () => {
      expect(await reject(memberB)).toBe('has_access');
      expect(await reject(rejected)).toBe('not_pending');
      expect(await reject(id(99))).toBe('not_pending');
      expect(await reject(pending)).toBe('rejected');
      // A grant after the rejection is refused.
      expect(await errorCode(`insert into public.club_memberships (club_id, user_id, role) values ('${clubA}', '${pending}', 'viewer')`)).toBe('42501');
    });
    await asActor(ownerA, async () => {
      expect(await errorCode(`select public.reject_access_request('${ownerA}')`)).toBe('22023');
    });
    await asActor(adminA, async () => {
      expect(await errorCode(`select public.reject_access_request('${pending}')`)).toBe('42501');
    });
  });
});
