import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const original = readMigration('033_club_membership_feature_access.sql');
const migration = readMigration('054_cache_ledger_read_permissions.sql');
const tables = ['products', 'daily_cash_entries', 'stock_purchases', 'daily_stock_counts', 'expenses', 'new_debts', 'debt_payments', 'owner_withdrawals'];
const userId = '00000000-0000-0000-0000-000000000001';
const clubId = '10000000-0000-0000-0000-000000000001';
const otherClubId = '10000000-0000-0000-0000-000000000002';
const featureSets = [null, [], ['dashboard'], ['closing_stock'], ['reports'], ['owner_profit'], ['inventory'], ['debts'], ['team'], ['daily_cash', 'expenses', 'stock_purchase']];
const roles = ['owner', 'admin', 'viewer'];
let db: PGlite;
const baseline = new Map<string, unknown>();
const writeBaseline = new Map<string, unknown>();
const writeCases = [
  ['owner', null], ['admin', null], ['admin', []],
  ['admin', ['closing_stock']], ['viewer', ['closing_stock']],
] as const;

async function writeResults() {
  const statements = [
    `insert into daily_stock_counts(club_id,date) values ('${clubId}','2026-09-08') returning club_id,date`,
    `insert into daily_stock_counts(club_id,date) values ('${clubId}','2026-09-09') returning club_id,date`,
    `insert into daily_stock_counts(club_id,date) values ('${otherClubId}','2026-09-09') returning club_id,date`,
    `update daily_stock_counts set closing_stock=10 where club_id='${clubId}' and date='2026-09-08' returning club_id,date`,
    `update daily_stock_counts set date='2026-09-08' where club_id='${clubId}' and date='2026-09-09' returning club_id,date`,
    `update daily_stock_counts set club_id='${otherClubId}' where club_id='${clubId}' returning club_id,date`,
    `delete from daily_stock_counts where club_id='${clubId}' and date='2026-09-08' returning club_id,date`,
    `delete from daily_stock_counts where club_id='${clubId}' and date='2026-09-09' returning club_id,date`,
    `delete from daily_stock_counts where club_id='${otherClubId}' returning club_id,date`,
  ];
  const results = [];
  for (const sql of statements) {
    await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${userId}',true);`);
    try { results.push((await db.query(sql)).rows); }
    catch (error) { results.push((error as { code: string }).code); }
    finally { await db.exec('rollback'); }
  }
  return results;
}

// Synthetic history only: the test never connects to Supabase.
async function benchmarkHistory() {
  await configure('owner', null);
  await db.exec(`begin;
    insert into daily_stock_counts(club_id,date,product_id,closing_stock,updated_at)
    select '${clubId}', '2026-01-01'::date + n / 50, md5((n % 50)::text)::uuid, n % 20, now()
    from generate_series(1,6000) n;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',true);
  `);
  try {
    const result = await db.query<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>(
      'explain (analyze, format json) select sum(closing_stock) from daily_stock_counts where club_id=$1', [clubId],
    );
    return result.rows[0]['QUERY PLAN'][0]['Execution Time'];
  } finally { await db.exec('rollback'); }
}

async function withActor<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

async function configure(role: string, features: string[] | null) {
  await db.query('update public.club_memberships set role=$1::user_role, feature_access=$2::text[] where user_id=$3::uuid', [role, features, userId]);
}

async function visibleRows() {
  return withActor(async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      result[table] = (await db.query(`select club_id, date from public.${table} order by club_id,date`)).rows;
    }
    return result;
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create role anon nologin;
    create schema auth;
    grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create type public.user_role as enum ('owner','admin','viewer');
    create table public.club_memberships (club_id uuid, user_id uuid, role public.user_role, feature_access text[], primary key(club_id,user_id));
    create function public.current_user_club_role(p_club_id uuid) returns user_role language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.club_business_date(p_club_id uuid) returns date language sql stable as $$ select '2026-09-09'::date $$;
    insert into public.club_memberships values ('${clubId}','${userId}','owner',null);
    insert into public.club_memberships values ('${otherClubId}','00000000-0000-0000-0000-000000000002','owner',null);
    ${tables.map((table) => `
      create table public.${table} (club_id uuid, date date, product_id uuid, closing_stock numeric, updated_at timestamptz);
      alter table public.${table} enable row level security;
      grant select on public.${table} to authenticated, anon;
      insert into public.${table}(club_id,date) values ('${clubId}','2026-09-08'),('${clubId}','2026-09-09'),('${otherClubId}','2026-09-09');
    `).join('\n')}
    grant insert, update, delete on public.daily_stock_counts to authenticated;
  `);
  // Execute the actual original helpers and policies, rather than a JS model.
  const helperStart = original.indexOf('create or replace function public.current_user_can_access_club_feature(');
  const helperEnd = original.indexOf('-- Read policies');
  await db.exec(original.slice(helperStart, helperEnd));
  const policyStart = original.indexOf('create policy "club_read_products"');
  const policyEnd = original.indexOf('-- Feature access also gates writes.');
  await db.exec(original.slice(policyStart, policyEnd));
  const stockPolicyStart = original.indexOf('create policy "club_admin_write_stock_counts"');
  await db.exec(original.slice(stockPolicyStart, original.indexOf(';', stockPolicyStart) + 1));
  // 014's purchase FOR ALL policy still participates in SELECT. Preserve and
  // test that existing union too; this migration only splits stock counts.
  const multiClub = readMigration('014_multi_club_support.sql');
  const purchasePolicyStart = multiClub.indexOf('create policy "club_admin_write_stock_purchases"');
  await db.exec(multiClub.slice(purchasePolicyStart, multiClub.indexOf(';', purchasePolicyStart) + 1));

  for (const role of roles) {
    for (const features of featureSets) {
      await configure(role, features);
      baseline.set(JSON.stringify([role, features]), await visibleRows());
    }
  }
  for (const [role, features] of writeCases) {
    await configure(role, features ? [...features] : null);
    writeBaseline.set(JSON.stringify([role, features]), await writeResults());
  }
  const beforeMs = await benchmarkHistory();
  await db.exec(migration);
  const afterMs = await benchmarkHistory();
  console.info(`Synthetic 6,000-row stock scan: ${beforeMs.toFixed(1)} ms before, ${afterMs.toFixed(1)} ms after`);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('ledger read permission optimization (PostgreSQL)', () => {
  it.each(roles)('preserves every ledger result for %s across default, empty, and restricted feature access', async (role) => {
    for (const features of featureSets) {
      await configure(role, features);
      const actual = await visibleRows();
      expect(actual, JSON.stringify([role, features])).toEqual(baseline.get(JSON.stringify([role, features])));
      expect(JSON.stringify(actual)).not.toContain(otherClubId);
    }
  });

  it('returns no ledgers to anonymous users or an account without memberships', async () => {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false);");
    for (const table of tables) expect((await db.query(`select * from public.${table}`)).rows).toEqual([]);
    await db.exec('reset role');
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false);`);
    for (const table of tables) expect((await db.query(`select * from public.${table}`)).rows).toEqual([]);
    await db.exec('reset role');
  });

  it('preserves stock insert, update, and delete rules, including date changes and cross-club writes', async () => {
    for (const [role, features] of writeCases) {
      await configure(role, features ? [...features] : null);
      expect(await writeResults(), JSON.stringify([role, features])).toEqual(writeBaseline.get(JSON.stringify([role, features])));
    }
  });

  it('rechecks membership changes on the next statement instead of caching access across requests', async () => {
    await configure('owner', null);
    expect(JSON.stringify(await visibleRows())).not.toContain(otherClubId);
    await db.query('insert into club_memberships(club_id,user_id,role) values ($1,$2,$3)', [otherClubId, userId, 'owner']);
    expect(JSON.stringify(await visibleRows())).toContain(otherClubId);
    await db.query('delete from club_memberships where club_id=$1 and user_id=$2', [otherClubId, userId]);
    expect(JSON.stringify(await visibleRows())).not.toContain(otherClubId);
  });

  it('plans the membership lookup once for a stock history scan', async () => {
    await configure('owner', null);
    const plan = await withActor(async () => (await db.query<{ 'QUERY PLAN': unknown }>(
      'explain (analyze, verbose, format json) select * from daily_stock_counts where club_id=$1', [clubId],
    )).rows[0]['QUERY PLAN']);
    const nodes: Record<string, unknown>[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        const node = value as Record<string, unknown>;
        if (node['Node Type']) nodes.push(node);
        Object.values(node).forEach(visit);
      }
    }
    visit(plan);
    const permissionScan = nodes.find((node) => node['Parent Relationship'] === 'SubPlan' && JSON.stringify(node).includes('current_user_readable_clubs'));
    expect(permissionScan).toMatchObject({ 'Actual Loops': 1 });
    expect(JSON.stringify(plan)).not.toContain('club_business_date');
    expect(JSON.stringify(plan)).not.toContain('current_user_club_role');
  });
});

it('returns identical payroll earned-cash inputs despite restricted ledger access, without exposing withdrawal history', async () => {
  // Execute the actual owner aggregate and payroll wrapper with RLS enabled.
  await db.exec(`
    create function public.user_has_club_access(p_club_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=auth.uid())
    $$;
    alter table daily_cash_entries add cash_income numeric default 0, add terminal_income numeric default 0,
      add card_income numeric default 0, add playstation_income numeric default 0;
    alter table debt_payments add amount numeric default 0, add payment_method text;
    alter table daily_stock_counts add bar_income numeric default 0;
    alter table stock_purchases add quantity numeric default 0, add cost_price numeric default 0;
    alter table expenses add amount numeric default 0, add payment_source text, add payment_method text;
    alter table owner_withdrawals add id uuid, add period_month date, add source text,
      add amount numeric, add comment text, add created_by uuid, add created_at timestamptz;
    update daily_cash_entries set cash_income=1000 where club_id='${clubId}' and date='2026-09-08';
    update daily_stock_counts set bar_income=500 where club_id='${clubId}' and date='2026-09-08';
    update expenses set amount=100,payment_source='game_club' where club_id='${clubId}' and date='2026-09-08';
    update owner_withdrawals set period_month='2026-09-01',source='game_club',amount=50,comment='private withdrawal';
  `);
  const access = readMigration('061_salary_edit_access.sql');
  await db.exec(access.slice(0, access.indexOf('drop policy salary_employees_owner_read')));
  await db.exec(readMigration('050_owner_profit_monthly_payment_balances.sql'));
  await db.exec(readMigration('065_payroll_read_and_rate_integrity.sql'));
  const snapshot=()=>withActor(async()=> (await db.query<{snapshot:unknown}>(
    'select get_salary_profit_snapshot($1,$2) as snapshot',[clubId,'2026-09-09'],
  )).rows[0].snapshot);
  await configure('owner',null);
  const expected=await snapshot();
  expect(expected).toEqual({monthlyBalances:[{period_month:'2026-09-01',game_club_earned:900,bar_earned:500,game_club_withdrawn:0,bar_withdrawn:0}]});
  for(const role of ['viewer','admin']) {
    for(const access of [[],['salaries'],['expenses']]) {
      await configure(role,access);
      expect(await snapshot()).toEqual(expected);
    }
  }
  // 109: investment expenses come back per pool so payroll KPI can leave them out.
  await db.exec(`alter table expenses add category text;
    update expenses set category='investments' where club_id='${clubId}' and date='2026-09-08';`);
  await db.exec(readMigration('109_salary_kpi_excludes_investments.sql'));
  await configure('viewer',['salaries']);
  expect(await snapshot()).toMatchObject({monthlyBalances:[{period_month:'2026-09-01',game_club_earned:900,game_club_investments:100,bar_investments:0}]});
  await configure('viewer',['salaries']);
  expect((await visibleRows()).daily_cash_entries).toEqual([]);
  await withActor(async()=>{
    await expect(db.query('select get_salary_profit_snapshot($1,$2)',[otherClubId,'2026-09-09'])).rejects.toThrow('Not authorized');
    await expect(db.query('select get_salary_profit_snapshot($1,$2)',[clubId,'2026-09-10'])).rejects.toThrow('Invalid payroll date');
  });
  await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
  try { await expect(db.query('select get_salary_profit_snapshot($1,$2)',[clubId,'2026-09-09'])).rejects.toThrow('permission denied'); }
  finally { await db.exec('reset role'); }
});
