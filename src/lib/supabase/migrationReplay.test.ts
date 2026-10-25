import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, MANUAL_EXPENSE_CATEGORIES } from '@/lib/expenseCategories';

/**
 * The /cr pass 9 migration replay and schema drift checks (MIG-008, MIG-009,
 * DB-006). Every migration applies in order on an empty PGlite database with
 * only the Supabase stubs below; the newest ten re-run without error; every
 * public table matches its row type in src/types/index.ts.
 */

const migrationsDir = resolve(process.cwd(), 'migrations');
const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const readMigration = (name: string) =>
  readFileSync(resolve(migrationsDir, name), 'utf8')
    // PGlite has no pg_cron or pg_net; both are stubbed in the preamble.
    .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');

/**
 * Applied migrations are never edited (AGENTS.md invariant 9). A migration whose
 * statements cannot run twice stays one-shot; a later migration carries the
 * same effect in guarded form, and the replay re-runs that one instead.
 */
const SUPERSEDED_ONE_SHOT: Record<string, string> = {
  '077_salary_entry_created_flag.sql':
    'create function record_salary_entry_with_status without "or replace"; re-runnable copy in 082',
  '081_cost_and_index_cleanup.sql':
    'create policy club_role_read_stock_purchases without "drop policy if exists"; re-runnable copy in 082',
};

/** Row types whose table name the plural heuristic does not produce. */
const TABLE_FOR_TYPE: Record<string, string> = {
  LegacyDebt: 'debts',
};

/** Typed fields that are joins or computed, never columns. */
const NON_COLUMN_FIELDS: Record<string, string[]> = {
  ClubMembership: ['clubs'],
};

const tableName = (typeName: string) => {
  if (TABLE_FOR_TYPE[typeName]) return TABLE_FOR_TYPE[typeName];
  const snake = typeName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return snake.endsWith('y') ? `${snake.slice(0, -1)}ies` : `${snake}s`;
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema extensions; create schema cron; create schema net;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
    create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    grant usage on schema public, auth, extensions, cron, net to authenticated, anon, service_role;
  `);
  for (const name of files) {
    try {
      await db.exec(readMigration(name));
    } catch (error) {
      throw new Error(`${name} failed on an empty database: ${(error as Error).message}`);
    }
  }
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('migration chain replay (PGlite)', () => {
  it('applies every migration file in order on an empty database', async () => {
    expect(files.length).toBeGreaterThan(80);
    const tables = await db.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(tables.rows[0].n).toBeGreaterThan(20);
  });

  it('re-runs the newest ten migrations without error', async () => {
    const failures: string[] = [];
    for (const name of files.slice(-10)) {
      if (SUPERSEDED_ONE_SHOT[name]) continue;
      try {
        await db.exec(readMigration(name));
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('lists only committed migrations as superseded one-shots', () => {
    for (const name of Object.keys(SUPERSEDED_ONE_SHOT)) expect(files).toContain(name);
  });

  it('082 carries the 077 function and the 081 policy in guarded form', async () => {
    const sql = readMigration('082_rerunnable_salary_status_and_purchase_policy.sql');
    expect(sql).toContain('create or replace function public.record_salary_entry_with_status(');
    expect(sql).toContain('drop policy if exists "club_role_read_stock_purchases"');
    const body077 = readMigration('077_salary_entry_created_flag.sql').split('create function')[1];
    expect(sql).toContain(body077.split('\n').slice(1).join('\n').trim());
    const policies = await db.query<{ policyname: string; cmd: string }>(
      "select policyname, cmd from pg_policies where tablename = 'stock_purchases' order by policyname",
    );
    expect(policies.rows).toEqual([
      { policyname: 'club_read_stock_purchases', cmd: 'SELECT' },
      { policyname: 'club_role_read_stock_purchases', cmd: 'SELECT' },
    ]);
    const fn = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname = 'record_salary_entry_with_status'",
    );
    expect(fn.rows[0].n).toBe(1);
  });
});

describe('row types match the migrated tables (schema drift)', () => {
  it('every src/types interface maps to a public table with the same columns', async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' order by 1, ordinal_position",
    );
    const tables = new Map<string, Set<string>>();
    for (const row of columns.rows) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
      tables.get(row.table_name)!.add(row.column_name);
    }

    const source = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf8');
    const drift: Record<string, unknown> = {};
    for (const [, name, body] of source.matchAll(/export interface (\w+) \{([^}]*)\}/g)) {
      const table = tableName(name);
      const actual = tables.get(table);
      if (!actual) { drift[name] = { noTable: table }; continue; }
      const fields = new Set([...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]));
      const nonColumns = new Set(NON_COLUMN_FIELDS[name] ?? []);
      const missingInType = [...actual].filter((column) => !fields.has(column));
      const missingInTable = [...fields].filter((field) => !actual.has(field) && !nonColumns.has(field));
      if (missingInType.length || missingInTable.length) drift[name] = { table, missingInType, missingInTable };
    }
    expect(drift).toEqual({});
  });
});

describe('expense category checks match the application lists', () => {
  /** The quoted values of a check constraint after the whole chain. */
  const allowed = async (table: string, constraint: string) => {
    const { rows } = await db.query<{ def: string }>(
      'select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and conname = $2',
      [`public.${table}`, constraint],
    );
    return [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
  };

  it('expenses allow every category and planned expenses every manual one (091, 093)', async () => {
    expect(await allowed('expenses', 'expenses_category_allowed')).toEqual([...EXPENSE_CATEGORIES].sort());
    expect(await allowed('expense_presets', 'expense_presets_category_manual')).toEqual([...MANUAL_EXPENSE_CATEGORIES].sort());
  });
});
