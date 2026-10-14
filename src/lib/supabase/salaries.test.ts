import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const employee = '20000000-0000-0000-0000-000000000001';
const payment = '30000000-0000-0000-0000-000000000001';
async function save(id = employee, date = '2026-09-01', clubId = club) {
  return db.query(`select save_salary_employee($1,$2,'Employee','Manager',$3,'monthly',3000000,10,true)`, [clubId, id, date]);
}
async function pay(id = payment, kind = 'payment', amount = 100, date = '2026-09-24', clubId = club, method: string | null = 'cash') {
  return db.query(`select record_salary_entry($1,$2,$3,$4,$5,$6,'note',$7,$8)`, [clubId, employee, id, date, kind, amount, kind === 'payment' ? method : null, kind === 'payment' ? 'game_club' : null]);
}
beforeAll(async () => {
  db = new PGlite();
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
    insert into clubs values ('${club}',array['cash','terminal']),('${other}',array['cash']);
    create table expenses(id uuid primary key default gen_random_uuid(),club_id uuid not null,date date,amount numeric,category text,payment_method text,payment_source text,comment text,created_by uuid,telegram_message_id bigint);
    grant select,insert,update,delete on expenses to authenticated;
  `);
  await db.exec(readFileSync(resolve('migrations/059_employee_salaries.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/060_future_salary_employees.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/061_salary_edit_access.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/062_salary_record_deletion.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/063_deactivate_salary_employee.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/064_salary_employee_role.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/065_payroll_read_and_rate_integrity.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/067_owner_only_payroll_terms.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/070_salary_kpi_basis.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/077_salary_entry_created_flag.sql'), 'utf8'));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await save();
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('salary database authorization and ledger integrity', () => {
  it('atomically writes one salary expense, makes retries idempotent and rejects changed retries', async () => {
    await pay(); await pay();
    expect((await db.query('select * from salary_entries')).rows).toHaveLength(1);
    expect((await db.query('select * from expenses')).rows).toHaveLength(1);
    expect((await db.query('select category,amount,salary_entry_id from expenses')).rows[0]).toEqual({ category: 'salary', amount: '100', salary_entry_id: payment });
    await expect(pay(payment, 'payment', 101)).rejects.toThrow('different entry');
  });
  it('records fines and bonuses without recording cash expenses', async () => {
    await pay('30000000-0000-0000-0000-000000000002', 'bonus');
    await pay('30000000-0000-0000-0000-000000000003', 'fine');
    expect((await db.query('select * from expenses')).rows).toHaveLength(1);
  });
  it('rejects future, pre-employment, invalid and disabled-method payments without partial rows', async () => {
    const id = '30000000-0000-0000-0000-000000000004';
    for (const [amount, date, method] of [[100, '2026-09-25','cash'],[100,'2026-08-31','cash'],[-1,'2026-09-24','cash'],[100,'2026-09-24','card'],[100,'2026-09-24',null]] as const) {
      await expect(pay(id, 'payment', amount, date, club, method)).rejects.toThrow();
    }
    expect((await db.query('select * from salary_entries where id=$1',[id])).rows).toHaveLength(0);
  });
  it('rolls back the ledger entry when the expense write fails', async () => {
    await db.exec(`reset role; alter table expenses add constraint test_limit check (amount < 1000); set role authenticated;`);
    const id = '30000000-0000-0000-0000-000000000005';
    await expect(pay(id, 'payment', 1000)).rejects.toThrow();
    expect((await db.query('select * from salary_entries where id=$1',[id])).rows).toHaveLength(0);
    await db.exec('reset role; alter table expenses drop constraint test_limit; set role authenticated;');
  });
  it('blocks cross-club writes, keeps ungranted members read-only and denies nonmembers', async () => {
    await expect(save('20000000-0000-0000-0000-000000000002','2026-09-24',other)).rejects.toThrow('club owner');
    await expect(pay(payment,'payment',100,'2026-09-24',other)).rejects.toThrow('Salary editing access');
    for (const role of ['admin','viewer']) {
      await db.exec(`reset role; update club_memberships set role='${role}'; set role authenticated;`);
      for (const table of ['salary_employees','salary_rates','salary_entries']) expect((await db.query(`select * from ${table}`)).rows.length).toBeGreaterThan(0);
      await expect(pay()).rejects.toThrow('Salary editing access');
      await expect(save()).rejects.toThrow('club owner');
      await expect(db.query('select change_salary_term($1,$2,$3,$4)', [club,employee,'kpi',5])).rejects.toThrow('club owner');
    }
    await db.exec(`reset role; update club_memberships set role='owner'; set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false);`);
    expect((await db.query('select * from salary_employees')).rows).toEqual([]);
    await expect(pay()).rejects.toThrow('Salary editing access');
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
  });
  it('forbids direct ledger mutations and payroll expense edits/deletes while allowing report metadata', async () => {
    await expect(db.query('delete from salary_entries')).rejects.toThrow();
    await expect(db.query('update salary_rates set amount=0')).rejects.toThrow();
    await expect(db.query(`insert into salary_entries(id) values (gen_random_uuid())`)).rejects.toThrow();
    await expect(db.query('delete from expenses where salary_entry_id=$1',[payment])).rejects.toThrow('cannot be deleted');
    await expect(db.query('update expenses set salary_entry_id=null where salary_entry_id=$1',[payment])).rejects.toThrow('cannot be edited');
    await expect(db.query('update expenses set amount=50 where salary_entry_id=$1',[payment])).rejects.toThrow('cannot be edited');
    await db.query('update expenses set telegram_message_id=123 where salary_entry_id=$1',[payment]);
  });
  it('safely retries initial backdated employee setup without creating duplicates', async () => {
    await save();
    expect((await db.query('select * from salary_employees')).rows).toHaveLength(1);
  });

  it('preserves historical rates and permits current-business-date changes', async () => {
    await expect(save(employee,'2026-09-10')).rejects.toThrow('current business date');
    await save(employee,'2026-09-24');
    await save(employee,'2026-09-24');
    expect((await db.query('select effective_date from salary_rates order by effective_date')).rows).toHaveLength(2);
  });
  it('allows future staff and updates only requested terms at the joining date', async () => {
    const id = '20000000-0000-0000-0000-000000000010';
    await save(id, '2026-10-01');
    await db.query('select change_salary_term($1,$2,$3,$4)', [club,id,'kpi',7]);
    await db.query('select change_salary_term($1,$2,$3,$4,$5)', [club,id,'salary',150000,'daily']);
    expect((await db.query('select effective_date::text,amount,kpi_percent,salary_type from salary_rates where employee_id=$1',[id])).rows).toEqual([
      { effective_date: '2026-10-01', amount: '150000.00', kpi_percent: '7.00', salary_type: 'daily' },
    ]);
    await expect(save(id, '2026-09-24')).rejects.toThrow('before the employee joins');
    await expect(db.query('select change_salary_term($1,$2,$3,$4)', [other,id,'kpi',5])).rejects.toThrow('club owner');
    await expect(db.query('select record_salary_entry($1,$2,$3,$4,$5,$6,$7,$8,$9)', [club,id,'30000000-0000-0000-0000-000000000010','2026-09-24','bonus',100,'',null,null])).rejects.toThrow();
  });
  it('changes KPI for an employee who joined on the current business date', async () => {
    const id = '20000000-0000-0000-0000-000000000011';
    await save(id, '2026-09-24');
    await db.query('select change_salary_term($1,$2,$3,$4,$5)', [club,id,'kpi',5,null]);
    expect((await db.query('select effective_date::text,kpi_percent,amount from salary_rates where employee_id=$1 and deleted_at is null',[id])).rows).toEqual([
      { effective_date: '2026-09-24', kpi_percent: '5.00', amount: '3000000.00' },
    ]);
  });
  it('changes KPI today without overwriting past rates or the base salary', async () => {
    await db.query('select change_salary_term($1,$2,$3,$4)', [club,employee,'kpi',6]);
    expect((await db.query('select effective_date::text,amount,kpi_percent from salary_rates where employee_id=$1 order by effective_date',[employee])).rows).toEqual([
      { effective_date:'2026-09-01',amount:'3000000.00',kpi_percent:'10.00' },
      { effective_date:'2026-09-24',amount:'3000000.00',kpi_percent:'6.00' },
    ]);
  });

  it('lets granted admins and viewers record payments, bonuses and fines but never change payroll terms', async () => {
    for (const [index, role] of ['admin','viewer'].entries()) {
      await db.exec(`reset role; update club_memberships set role='${role}',feature_access=array['salaries']; set role authenticated;`);
      await pay(`30000000-0000-0000-0000-00000000002${index}`, 'payment', 100);
      await pay(`30000000-0000-0000-0000-00000000003${index}`, 'bonus', 100);
      await pay(`30000000-0000-0000-0000-00000000004${index}`, 'fine', 100);
      await expect(save()).rejects.toThrow('club owner');
      await expect(db.query('select change_salary_term($1,$2,$3,$4)', [club,employee,'kpi',5])).rejects.toThrow('club owner');
      await expect(db.query('select change_salary_term($1,$2,$3,$4,$5)', [club,employee,'salary',5,'daily'])).rejects.toThrow('club owner');
      await expect(db.query('select deactivate_salary_employee($1,$2)', [club,employee])).rejects.toThrow('club owner');
      await expect(db.query('select activate_salary_employee($1,$2)', [club,employee])).rejects.toThrow('club owner');
      await expect(db.query('select change_salary_employee_role($1,$2,$3)', [club,employee,'Cleaner'])).rejects.toThrow('club owner');
      const rate = (await db.query<{id:string}>('select id from salary_rates where employee_id=$1 and deleted_at is null limit 1',[employee])).rows[0];
      await expect(db.query('select delete_salary_record($1,$2,$3)',[club,rate.id,'rate'])).rejects.toThrow('club owner');
      await db.exec(`reset role; update club_memberships set feature_access=array[]::text[]; set role authenticated;`);
      await expect(pay()).rejects.toThrow('Salary editing access');
      await expect(db.query('update salary_rates set amount=0 where employee_id=$1',[employee])).rejects.toThrow();
    }
    await db.exec(`reset role; update club_memberships set role='owner',feature_access=null; set role authenticated;`);
  });

  it('deletes a payment and expense atomically while retaining the audited entry', async () => {
    await db.exec(`reset role; create function test_prevent_salary_delete() returns trigger language plpgsql as $$ begin raise exception 'test delete failure'; end; $$; create trigger test_delete before delete on expenses for each row execute function test_prevent_salary_delete(); set role authenticated;`);
    await expect(db.query('select delete_salary_record($1,$2,$3)',[club,payment,'entry'])).rejects.toThrow('test delete failure');
    expect((await db.query<{deleted_at:string|null}>('select deleted_at from salary_entries where id=$1',[payment])).rows[0]).toEqual({deleted_at:null});
    await db.exec('reset role; drop trigger test_delete on expenses; set role authenticated;');
    await db.query('select delete_salary_record($1,$2,$3)',[club,payment,'entry']);
    await db.query('select delete_salary_record($1,$2,$3)',[club,payment,'entry']);
    expect((await db.query('select * from expenses where salary_entry_id=$1',[payment])).rows).toHaveLength(0);
    const row = (await db.query<{deleted_at:string|null;deleted_by:string;amount:string}>('select deleted_at,deleted_by,amount from salary_entries where id=$1',[payment])).rows[0];
    expect(row).toMatchObject({deleted_by:owner,amount:'100.00'});
    expect(row.deleted_at).not.toBeNull();
  });
  it('keeps deleted rates when a replacement is saved on the same effective date', async () => {
    const row = (await db.query<{id:string}>("select id from salary_rates where employee_id=$1 and effective_date='2026-09-24'",[employee])).rows[0];
    await db.query('select delete_salary_record($1,$2,$3)',[club,row.id,'rate']);
    await save(employee,'2026-09-24');
    const rows = (await db.query<{deleted_at:string|null}>("select deleted_at from salary_rates where employee_id=$1 and effective_date='2026-09-24'",[employee])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter(row=>row.deleted_at===null)).toHaveLength(1);
    await db.query('select change_salary_term($1,$2,$3,$4)',[club,employee,'kpi',4]);
  });
  it('enforces deletion grants, club isolation and protects audit fields', async () => {
    const id='30000000-0000-0000-0000-000000000002';
    await expect(db.query('select delete_salary_record($1,$2,$3)',[other,id,'entry'])).rejects.toThrow('Salary editing access');
    await db.exec("reset role; update club_memberships set role='viewer',feature_access=array[]::text[]; set role authenticated;");
    await expect(db.query('select delete_salary_record($1,$2,$3)',[club,id,'entry'])).rejects.toThrow('Salary editing access');
    await expect(db.query('update salary_entries set deleted_at=now() where id=$1',[id])).rejects.toThrow();
    await db.exec("reset role; update club_memberships set feature_access=array['salaries']; set role authenticated;");
    await db.query('select delete_salary_record($1,$2,$3)',[club,id,'entry']);
    expect((await db.query<{deleted_at:string|null}>('select deleted_at from salary_entries where id=$1',[id])).rows[0].deleted_at).not.toBeNull();
    await db.exec("reset role; update club_memberships set role='owner',feature_access=null; set role authenticated;");
  });

  it('deactivates from the business date while preserving previous rates and entries', async () => {
    const id='20000000-0000-0000-0000-000000000030';
    await save(id,'2026-09-01');
    const entries = (await db.query('select * from salary_entries order by id')).rows;
    await db.query('select deactivate_salary_employee($1,$2)',[club,id]);
    await db.query('select deactivate_salary_employee($1,$2)',[club,id]);
    expect((await db.query('select effective_date::text,active,amount,kpi_percent from salary_rates where employee_id=$1 order by effective_date',[id])).rows).toEqual([
      {effective_date:'2026-09-01',active:true,amount:'3000000.00',kpi_percent:'10.00'},
      {effective_date:'2026-09-24',active:false,amount:'3000000.00',kpi_percent:'10.00'},
    ]);
    expect((await db.query('select * from salary_entries order by id')).rows).toEqual(entries);
  });
  it('requires ownership to deactivate and supports future employees', async () => {
    const id='20000000-0000-0000-0000-000000000031';
    await save(id,'2026-10-01');
    await expect(db.query('select deactivate_salary_employee($1,$2)',[other,id])).rejects.toThrow('club owner');
    await db.exec("reset role; update club_memberships set role='viewer',feature_access=array['salaries']; set role authenticated;");
    await expect(db.query('select deactivate_salary_employee($1,$2)',[club,id])).rejects.toThrow('club owner');
    await db.exec("reset role; update club_memberships set role='owner',feature_access=null; set role authenticated;");
    await db.query('select deactivate_salary_employee($1,$2)',[club,id]);
    expect((await db.query('select effective_date::text,active from salary_rates where employee_id=$1',[id])).rows).toEqual([{effective_date:'2026-10-01',active:false}]);
  });
  it('reactivates from the business date, keeping terms and history, idempotently', async () => {
    const id='20000000-0000-0000-0000-000000000030';
    await db.query('select activate_salary_employee($1,$2)',[club,id]);
    await db.query('select activate_salary_employee($1,$2)',[club,id]);
    expect((await db.query('select effective_date::text,active,amount,kpi_percent from salary_rates where employee_id=$1 and deleted_at is null order by effective_date',[id])).rows).toEqual([
      {effective_date:'2026-09-01',active:true,amount:'3000000.00',kpi_percent:'10.00'},
      {effective_date:'2026-09-24',active:true,amount:'3000000.00',kpi_percent:'10.00'},
    ]);
    await expect(db.query('select activate_salary_employee($1,$2)',[other,id])).rejects.toThrow('club owner');
  });

  it('changes only the employee job title, and only for owners', async () => {
    const rates = (await db.query('select * from salary_rates order by id')).rows;
    const entries = (await db.query('select * from salary_entries order by id')).rows;
    await expect(db.query('select change_salary_employee_role($1,$2,$3)',[other,employee,'Cleaner'])).rejects.toThrow('club owner');
    await expect(db.query('select change_salary_employee_role($1,$2,$3)',[club,employee,'Owner'])).rejects.toThrow('Invalid employee role');
    await db.exec("reset role; update club_memberships set role='viewer',feature_access=array['salaries']; set role authenticated;");
    await expect(db.query('select change_salary_employee_role($1,$2,$3)',[club,employee,'Cleaner'])).rejects.toThrow('club owner');
    await db.exec("reset role; update club_memberships set role='owner',feature_access=null; set role authenticated;");
    await db.query('select change_salary_employee_role($1,$2,$3)',[club,employee,'Cleaner']);
    expect((await db.query('select name,job_title from salary_employees where id=$1',[employee])).rows).toEqual([{name:'Employee',job_title:'Cleaner'}]);
    expect((await db.query('select * from salary_rates order by id')).rows).toEqual(rates);
    expect((await db.query('select * from salary_entries order by id')).rows).toEqual(entries);
    await db.exec("reset role; update club_memberships set role='owner',feature_access=null; set role authenticated;");
  });

});

it('prevents deleting the last live rate and preserves salary/KPI editing',async()=>{
 const id='20000000-0000-0000-0000-000000000099';
 await save(id,'2026-09-01');
 const rate=(await db.query<{id:string}>('select id from salary_rates where employee_id=$1',[id])).rows[0];
 await expect(db.query('select delete_salary_record($1,$2,$3)',[club,rate.id,'rate'])).rejects.toThrow('last salary rate');
 await db.query('select change_salary_term($1,$2,$3,$4,$5)',[club,id,'salary',100,'daily']);
 await db.query('select change_salary_term($1,$2,$3,$4)',[club,id,'kpi',5]);
 await db.query('select delete_salary_record($1,$2,$3)',[club,rate.id,'rate']);
 await db.query('select delete_salary_record($1,$2,$3)',[club,rate.id,'rate']);
 expect((await db.query('select * from salary_rates where employee_id=$1 and deleted_at is null',[id])).rows).toHaveLength(1);
});
it('restores already missing salary settings without erasing deleted history',async()=>{
 const id='20000000-0000-0000-0000-000000000098';
 await save(id,'2026-09-01');
 await db.exec('reset role');
 await db.query('update salary_rates set deleted_at=now(),deleted_by=$1 where employee_id=$2',[owner,id]);
 await db.exec('set role authenticated');
 await save(id,'2026-09-24');
 await db.query('select change_salary_term($1,$2,$3,$4)',[club,id,'kpi',5]);
 expect((await db.query('select * from salary_rates where employee_id=$1',[id])).rows).toHaveLength(2);
});

it('stores the KPI basis and pools, keeping them when other terms change', async () => {
  const id = '20000000-0000-0000-0000-000000000090';
  await save(id, '2026-09-24');
  const read = async () => (await db.query('select kpi_basis,kpi_game_club,kpi_bar from salary_rates where employee_id=$1 and deleted_at is null',[id])).rows;
  expect(await read()).toEqual([{ kpi_basis: 'overall_profit', kpi_game_club: true, kpi_bar: true }]);
  await db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8)', [club,id,'kpi',8,null,'owner_profit',false,true]);
  expect(await read()).toEqual([{ kpi_basis: 'owner_profit', kpi_game_club: false, kpi_bar: true }]);
  await db.query('select change_salary_term($1,$2,$3,$4,$5)', [club,id,'salary',5000,'daily']);
  await db.query('select deactivate_salary_employee($1,$2)', [club,id]);
  await db.query('select activate_salary_employee($1,$2)', [club,id]);
  expect(await read()).toEqual([{ kpi_basis: 'owner_profit', kpi_game_club: false, kpi_bar: true }]);
  await expect(db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8)', [club,id,'kpi',8,null,'owner_profit',false,false])).rejects.toThrow('Invalid KPI settings');
  await expect(db.query('select change_salary_term($1,$2,$3,$4,$5,$6,$7,$8)', [club,id,'kpi',8,null,'weekly',true,true])).rejects.toThrow('Invalid KPI settings');
});

it('reports whether a salary entry was newly recorded, once per request id', async () => {
  const id = '30000000-0000-0000-0000-000000000077';
  const record = (amount = 250) => db.query<{ entry_id: string; created: boolean }>(
    `select * from record_salary_entry_with_status($1,$2,$3,'2026-09-24','payment',$4,'note','cash','game_club')`, [club, employee, id, amount]);
  expect((await record()).rows).toEqual([{ entry_id: id, created: true }]);
  expect((await record()).rows).toEqual([{ entry_id: id, created: false }]);
  expect((await db.query('select * from expenses where salary_entry_id=$1', [id])).rows).toHaveLength(1);
  await expect(record(251)).rejects.toThrow('different entry');
});
