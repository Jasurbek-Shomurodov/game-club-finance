import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrationHealth, unrecordedMigrations, type HealthResult } from './migrationHealth';
import manifest from './migrationManifest.json';

/**
 * The Settings "Check health" button end to end: the real get_migration_health
 * RPC on a database with every committed migration applied, called through
 * loadMigrationHealth exactly as MigrationHealthPanel calls it.
 */

const migrationsDir = resolve(process.cwd(), 'migrations');
const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const CLUB = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CLUB = '00000000-0000-4000-8000-0000000000c2';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const ADMIN = '00000000-0000-4000-8000-0000000000a2';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema extensions; create schema cron; create schema net;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
    create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    grant usage on schema public, auth, extensions, cron, net to authenticated, anon, service_role;
  `);
  for (const name of files) {
    await db.exec(readFileSync(resolve(migrationsDir, name), 'utf8')
      .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, ''));
  }
  await db.exec(`
    insert into auth.users(id, email) values ('${OWNER}', 'owner@example.test'), ('${ADMIN}', 'admin@example.test');
    insert into public.clubs(id, name) values ('${CLUB}', 'Health A'), ('${OTHER_CLUB}', 'Health B');
    insert into public.club_memberships(club_id, user_id, role)
      values ('${CLUB}', '${OWNER}', 'owner'), ('${CLUB}', '${ADMIN}', 'admin'), ('${OTHER_CLUB}', '${ADMIN}', 'owner');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

/** A client shaped like supabase-js that runs the RPC as `userId` the way PostgREST does. */
function clientAs(userId: string | null) {
  return {
    async rpc(name: string, args: { p_club_id: string }) {
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
        await db.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
        const { rows } = await db.query<{ result: unknown }>(`select public.${name}($1::uuid) as result`, [args.p_club_id]);
        return { data: rows[0].result, error: null };
      } catch (error) {
        const { code, message } = error as { code?: string; message?: string };
        return { data: null, error: { code, message } };
      } finally {
        await db.exec('rollback');
      }
    },
  };
}

const check = (userId: string | null = OWNER, clubId = CLUB) => loadMigrationHealth(clientAs(userId), clubId);
const ready = (result: HealthResult) => {
  if (result.status !== 'ready') throw new Error(`Expected a ready result, got ${result.status}`);
  return result.data;
};
const statusOf = (data: ReturnType<typeof ready>) => Object.fromEntries(data.checks.map((c) => [c.name, c.status]));

/** Runs `sql` as the database owner, checks health as the owner, then undoes `sql`. */
async function checkAfter(sql: string) {
  await db.exec(`begin; ${sql}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query<{ result: unknown }>('select public.get_migration_health($1::uuid) as result', [CLUB]);
    return ready(await loadMigrationHealth({ rpc: async () => ({ data: rows[0].result, error: null }) }, CLUB));
  } finally {
    await db.exec('rollback');
  }
}

describe('Settings migration health check (full migration chain in PGlite)', () => {
  it('reports every fingerprinted function as matching on a fully migrated database', async () => {
    const data = ready(await check());
    expect(data.checks).toEqual([
      { version: '050', name: 'get_owner_profit_snapshot', status: 'matching' },
      { version: '051', name: 'enforce_owner_withdrawal_month_balance', status: 'matching' },
      { version: '051', name: 'withdraw_owner_money_for_month', status: 'matching' },
    ]);
  });

  it('reports history as unavailable when no migration history table exists (SQL Editor installs)', async () => {
    const data = ready(await check());
    expect(data).toMatchObject({ historyAvailable: false, recordedVersions: [] });
  });

  it('reads the history scripts/db-migrate.sh writes and lists only unrecorded migrations', async () => {
    const recorded = files.map((file) => file.split('_')[0]).filter((version) => version !== '083');
    const values = recorded.map((version) => `('${version}')`).join(',');
    const data = await checkAfter(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text not null primary key, statements text[], name text);
      insert into supabase_migrations.schema_migrations(version) values ${values};
    `);
    expect(data.historyAvailable).toBe(true);
    expect(data.recordedVersions).toEqual(recorded);
    expect(unrecordedMigrations(manifest, data.recordedVersions)).toEqual(['083_expense_update_column_grant.sql']);
  });

  it('confirms every committed migration once all of them are recorded', async () => {
    const values = files.map((file) => `('${file.split('_')[0]}')`).join(',');
    const data = await checkAfter(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text not null primary key, statements text[], name text);
      insert into supabase_migrations.schema_migrations(version) values ${values};
    `);
    expect(unrecordedMigrations(manifest, data.recordedVersions)).toEqual([]);
  });

  it('treats an unreadable history table as unavailable rather than failing the check', async () => {
    const data = await checkAfter(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(name text);
    `);
    expect(data).toMatchObject({ historyAvailable: false, recordedVersions: [] });
    expect(statusOf(data).get_owner_profit_snapshot).toBe('matching');
  });

  it('flags a missing 051 function as missing', async () => {
    const data = await checkAfter('drop function public.withdraw_owner_money_for_month(uuid, date, text, numeric, text);');
    expect(statusOf(data)).toEqual({
      get_owner_profit_snapshot: 'matching',
      enforce_owner_withdrawal_month_balance: 'matching',
      withdraw_owner_money_for_month: 'missing',
    });
  });

  it('flags a function whose body differs from the committed migration', async () => {
    const data = await checkAfter(`
      create or replace function public.get_owner_profit_snapshot(p_club_id uuid, p_through_date date)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    `);
    expect(statusOf(data).get_owner_profit_snapshot).toBe('different');
  });

  it('flags the 051 balance function when its trigger is detached or disabled', async () => {
    const dropped = await checkAfter('drop trigger trg_owner_withdrawal_month_balance on public.owner_withdrawals;');
    expect(statusOf(dropped).enforce_owner_withdrawal_month_balance).toBe('different');
    const disabled = await checkAfter('alter table public.owner_withdrawals disable trigger trg_owner_withdrawal_month_balance;');
    expect(statusOf(disabled).enforce_owner_withdrawal_month_balance).toBe('different');
  });

  it('flags an RPC the app role can no longer execute', async () => {
    const data = await checkAfter(`
      revoke execute on function public.withdraw_owner_money_for_month(uuid, date, text, numeric, text) from public, authenticated;
    `);
    expect(statusOf(data).withdraw_owner_money_for_month).toBe('different');
  });

  it('refuses non-owners, owners of another club and signed-out callers without calling it missing', async () => {
    expect(await check(ADMIN, CLUB)).toEqual({ status: 'error' });
    expect(await check(OWNER, OTHER_CLUB)).toEqual({ status: 'error' });
    expect(await check(null)).toEqual({ status: 'error' });
    expect(ready(await check(ADMIN, OTHER_CLUB)).checks).toHaveLength(3);
  });

  it('reports a database without migration 052 as unavailable', async () => {
    await db.exec('begin; drop function public.get_migration_health(uuid);');
    try {
      const result = await loadMigrationHealth({
        rpc: async () => {
          try {
            await db.query("select public.get_migration_health($1::uuid)", [CLUB]);
            return { data: null, error: null };
          } catch (error) {
            return { data: null, error: { code: (error as { code?: string }).code } };
          }
        },
      }, CLUB);
      expect(result).toEqual({ status: 'unavailable' });
    } finally {
      await db.exec('rollback');
    }
  });
});
