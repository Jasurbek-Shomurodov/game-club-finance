import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';

/**
 * Migration 189: save_salary_employee and change_salary_term accept the
 * `game_club_income` KPI basis that 134 added to salary_rates, and store it
 * with the Game Club pool only.
 */
let db: PGlite;
const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const migration = (name: string) => readFileSync(resolve('migrations', name), 'utf8');

async function create(id: string, date: string, basis: string | null, gameClub: boolean | null, bar: boolean | null) {
  return db.query(`select save_salary_employee($1,$2,'Employee','Manager',$3,'daily',150000,10,true,$4,$5,$6)`,
    [club, id, date, basis, gameClub, bar]);
}
async function live(id: string) {
  return (await db.query(`select effective_date::text, salary_type, amount, kpi_percent, kpi_basis, kpi_game_club, kpi_bar
    from salary_rates where employee_id = $1 and deleted_at is null order by effective_date`, [id])).rows;
}

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public,auth to authenticated,anon;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type user_role as enum ('owner','admin','viewer');
    create table club_memberships(club_id uuid,user_id uuid,role user_role,feature_access text[]);
    insert into club_memberships values ('${club}','${owner}','owner',null);
    create function current_user_club_role(p_club_id uuid) returns user_role language sql stable security definer set search_path=public as $$ select role from club_memberships where club_id=p_club_id and user_id=auth.uid() $$;
    create function club_business_date(uuid) returns date language sql stable as $$ select '2026-09-24'::date $$;
    create table clubs(id uuid primary key,enabled_payment_methods text[]);
    insert into clubs values ('${club}',array['cash']);
    create table expenses(id uuid primary key default gen_random_uuid(),club_id uuid not null,date date,amount numeric,category text,payment_method text,payment_source text,comment text,created_by uuid,telegram_message_id bigint);
    grant select,insert,update,delete on expenses to authenticated;
  `);
  for (const name of [
    '059_employee_salaries.sql', '060_future_salary_employees.sql', '061_salary_edit_access.sql',
    '062_salary_record_deletion.sql', '063_deactivate_salary_employee.sql', '064_salary_employee_role.sql',
    '065_payroll_read_and_rate_integrity.sql', '067_owner_only_payroll_terms.sql', '070_salary_kpi_basis.sql',
    '077_salary_entry_created_flag.sql', '089_salary_deletion_reason.sql', '113_owner_only_salary_deletion.sql',
    '115_salary_deactivation_date.sql', '121_backdated_deactivation_replaces_later_rates.sql',
    '122_hide_salary_employee.sql', '123_backdated_salary_term_change.sql', '132_salary_activation_date.sql',
    '134_salary_kpi_game_club_income.sql',
  ]) await db.exec(migration(name));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('Game Club income KPI basis in the payroll RPCs (migration 189)', () => {
  it('was refused before 189 and is accepted after it', async () => {
    const id = '20000000-0000-0000-0000-000000000001';
    await expect(create(id, '2026-09-24', 'game_club_income', true, false)).rejects.toThrow('Invalid KPI settings');
    await db.exec(`reset role; ${migration('189_salary_game_club_income_basis.sql')} set role authenticated;`);
    await create(id, '2026-09-24', 'game_club_income', true, false);
    expect(await live(id)).toEqual([
      { effective_date: '2026-09-24', salary_type: 'daily', amount: '150000.00', kpi_percent: '10.00', kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false },
    ]);
  });

  it('stores the Game Club pool only, whatever pools were sent', async () => {
    const id = '20000000-0000-0000-0000-000000000002';
    await create(id, '2026-09-24', 'game_club_income', null, null);
    expect(await live(id)).toMatchObject([{ kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false }]);
    await create(id, '2026-09-24', 'game_club_income', false, true);
    expect(await live(id)).toMatchObject([{ kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false }]);
  });

  it('changes salary and KPI on the same day for an employee on that basis', async () => {
    const id = '20000000-0000-0000-0000-000000000003';
    await create(id, '2026-09-01', 'game_club_income', true, false);
    // A salary change keeps the rate's basis and goes through save_salary_employee.
    await db.query('select change_salary_term($1,$2,$3,$4,$5)', [club, id, 'salary', 200000, 'daily']);
    await db.query('select change_salary_term($1,$2,$3,$4)', [club, id, 'kpi', 12]);
    expect(await live(id)).toEqual([
      { effective_date: '2026-09-01', salary_type: 'daily', amount: '150000.00', kpi_percent: '10.00', kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false },
      { effective_date: '2026-09-24', salary_type: 'daily', amount: '200000.00', kpi_percent: '12.00', kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false },
    ]);
  });

  it('switches an overall-profit rate to Game Club income today and on a past date', async () => {
    const today = '20000000-0000-0000-0000-000000000004';
    await create(today, '2026-09-01', 'overall_profit', true, true);
    await db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8)', [club, today, 'kpi', 10, null, 'game_club_income', true, true]);
    expect((await live(today)).at(-1)).toMatchObject({ effective_date: '2026-09-24', kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false });

    const backdated = '20000000-0000-0000-0000-000000000005';
    await create(backdated, '2026-09-01', 'overall_profit', true, true);
    await db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8,$9)', [club, backdated, 'kpi', 10, null, 'game_club_income', null, null, '2026-09-10']);
    expect(await live(backdated)).toMatchObject([
      { effective_date: '2026-09-01', kpi_basis: 'overall_profit', kpi_game_club: true, kpi_bar: true },
      { effective_date: '2026-09-10', kpi_basis: 'game_club_income', kpi_game_club: true, kpi_bar: false },
    ]);
  });

  it('still refuses an unknown basis and a rate with no pool', async () => {
    const id = '20000000-0000-0000-0000-000000000006';
    await expect(create(id, '2026-09-24', 'bar_income', true, false)).rejects.toThrow('Invalid KPI settings');
    await expect(create(id, '2026-09-24', 'overall_profit', false, false)).rejects.toThrow('Invalid KPI settings');
    await create(id, '2026-09-24', 'owner_profit', false, true);
    await expect(db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8,$9)', [club, id, 'kpi', 5, null, 'bar_income', null, null, '2026-09-24']))
      .rejects.toThrow('Invalid KPI settings');
  });
});
