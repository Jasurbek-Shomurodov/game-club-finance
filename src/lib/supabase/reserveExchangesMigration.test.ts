import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 170 on the full replayed schema: buying and selling dollars inside the owner reserve. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test'), ('${stranger}','s@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'), ('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',100000,200,0,0,'${owner}');
    -- Supabase's default table privileges; RLS and triggers still decide.
    grant select, insert on public.expenses to authenticated;
    -- The money report snapshot reads as the caller (RLS still decides).
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });


const call = <T = unknown>(sql: string, params: unknown[], userId = owner) => asUser(userId, () => db.query<T>(sql, params));
const note = 'dollars for the reserve';
const deposit = (n: number, amount: number) => call(
  'select move_owner_profit_to_reserve($1,$2,$3,$4,$5,$6,$7,$8) as created', [club, id(n), '2024-08-01', 'game_club', 'cash', amount, 'PS5 money', '2024-08-03'],
);
const exchange = (n: number, direction: 'buy' | 'sell', amount: number, rate: number, userId = owner, method = 'cash', date = '2024-08-05') => call<{ created: boolean }>(
  'select exchange_owner_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9) as created',
  [club, id(n), id(n + 500), date, direction, method, amount, rate, note], userId,
);
const scalar = async <T>(sql: string): Promise<T> => Object.values((await db.query<Record<string, T>>(sql, [club])).rows[0])[0];
const sumsHeld = () => scalar<string>('select public.owner_reserve_sums_held($1)::text');
const dollarsHeld = () => scalar<string>("select public.expense_method_balance($1, 'usd', date '2024-08-31')::text");
const cashLeft = () => scalar<string>("select public.expense_method_balance($1, 'cash', date '2024-08-31')::text");
const undo = (n: number, userId = owner) => call('select public.delete_money_exchange($1,$2)', [club, id(n)], userId);

describe('reserve exchanges (170)', () => {
  it('buys dollars with the reserve\'s sums without touching the till', async () => {
    await deposit(1, 60000);
    expect(await sumsHeld()).toBe('60000.00');
    expect(await cashLeft()).toBe('40000.00');
    expect((await exchange(10, 'buy', 25000, 12500)).rows[0]).toEqual({ created: true });
    expect(await sumsHeld()).toBe('35000.00');
    expect(await dollarsHeld()).toBe('2.00');
    expect(await cashLeft()).toBe('40000.00');
    const legs = await db.query<{ kind: string; amount: string; paired: string }>(
      'select kind, amount::text, paired_exchange_id::text as paired from public.owner_reserve_entries where id = $1', [id(510)],
    );
    expect(legs.rows).toEqual([{ kind: 'return', amount: '25000.00', paired: id(10) }]);
  });

  it('records a retried request once and refuses a reused id', async () => {
    expect((await exchange(10, 'buy', 25000, 12500)).rows[0]).toEqual({ created: false });
    await expect(exchange(10, 'buy', 26000, 12500)).rejects.toThrow(/already been used/);
    expect(await sumsHeld()).toBe('35000.00');
  });

  it('refuses more sums than the reserve holds, dollars it does not hold, and non-owners', async () => {
    await expect(exchange(11, 'buy', 35001, 12500)).rejects.toThrow(/holds/);
    await expect(exchange(12, 'sell', 3, 12500)).rejects.toThrow(/Insufficient payment method balance/);
    await expect(exchange(13, 'buy', 1000, 12500, admin)).rejects.toThrow(/Only a club owner/);
    await expect(exchange(14, 'buy', 1000, 12500, owner, 'card')).rejects.toThrow(/not enabled/);
  });

  it('sells dollars back into the reserve\'s sums', async () => {
    expect((await exchange(20, 'sell', 1, 13000)).rows[0]).toEqual({ created: true });
    expect(await sumsHeld()).toBe('48000.00');
    expect(await dollarsHeld()).toBe('1.00');
    expect(await cashLeft()).toBe('40000.00');
  });

  it('keeps each half from being deleted alone and undoes the pair together', async () => {
    await expect(call('select public.delete_owner_reserve_entry($1,$2)', [club, id(520)])).rejects.toThrow(/half of a reserve exchange/);
    await undo(20);
    expect(await sumsHeld()).toBe('35000.00');
    expect(await dollarsHeld()).toBe('2.00');
    expect((await db.query('select 1 from public.owner_reserve_entries where id = $1', [id(520)])).rows).toEqual([]);
  });

  it('refuses to undo a buy whose dollars were already sold', async () => {
    await exchange(30, 'sell', 2, 12000);
    await expect(undo(10)).rejects.toThrow(/already been spent|Insufficient/);
    await undo(30);
    await undo(10);
    expect(await sumsHeld()).toBe('60000.00');
    expect(Number(await dollarsHeld())).toBe(0);
    expect(await cashLeft()).toBe('40000.00');
  });
});
