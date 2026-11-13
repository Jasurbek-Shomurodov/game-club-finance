import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_OWNER_MONEY, fetchOwnerMoney } from './ownerMoney';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];
interface Read { table: string; calls: Call[] }

const ok = (data: unknown): Result => ({ data, error: null });
const fail = (error: unknown): Result => ({ data: null, error });
const missingFunction = (name: string) => fail({ code: 'PGRST202', message: `Could not find the function public.${name}` });

const has = (read: Read, method: string, ...args: unknown[]) => read.calls.some(
  ([name, values]) => name === method && JSON.stringify(values) === JSON.stringify(args),
);
const selected = (read: Read) => String(read.calls.find(([name]) => name === 'select')?.[1][0] ?? '');

/** Names the seven different reads so one handler can answer each. */
function kind(read: Read): string {
  if (read.table === 'expenses') {
    if (has(read, 'eq', 'category', 'investments')) return 'investments';
    if (has(read, 'eq', 'paid_from_reserve', true)) return 'reserve_expenses';
    if (has(read, 'eq', 'payment_method', 'usd')) return 'dollar_expenses';
    return 'expenses';
  }
  if (read.table === 'owner_withdrawals') return selected(read) === 'id,payment_method' ? 'withdrawal_methods' : 'owner_withdrawals';
  return read.table;
}

/**
 * Every `from(table)` starts a fresh chainable read; when awaited it resolves to
 * `answers[kind]` (an empty page by default). RPCs resolve to `rpcs[name]`.
 */
function fakeClient(answers: Record<string, Result>, rpcs: Record<string, Result>) {
  const reads: Read[] = [];
  const from = vi.fn((table: string) => {
    const read: Read = { table, calls: [] };
    reads.push(read);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'not', 'gte', 'lte', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { read.calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answers[kind(read)] ?? ok([])).then(resolve);
    return chain;
  });
  const rpc = vi.fn(async (name: string) => rpcs[name] ?? fail({ code: 'XX000', message: `unexpected rpc ${name}` }));
  const readOf = (name: string) => reads.find((read) => kind(read) === name);
  return { supabase: { from, rpc } as unknown as SupabaseClient, rpc, reads, readOf };
}

const withdrawal = (id: string, source: 'game_club' | 'bar', amount: number, extra: Record<string, unknown> = {}) => ({
  id, club_id: 'club-1', period_month: '2026-10-01', source, amount, comment: null, created_by: 'u1', created_at: `2026-10-1${id.slice(-1)}T10:00:00Z`, ...extra,
});

const payload = (extra: Record<string, unknown> = {}) => ({
  monthlyBalances: [
    { period_month: '2026-10-01', game_club_earned: 500, game_club_withdrawn: 0, bar_earned: 200, bar_withdrawn: 50 },
  ],
  withdrawalRows: [],
  paymentMethodBalancesByMonth: {},
  ...extra,
});
const withMethods = (data: unknown) => ({ get_owner_profit_snapshot_with_methods: ok(data) });
const TODAY = '2026-10-25';

describe('fetchOwnerMoney club scoping', () => {
  it('scopes every first-stage read to the club and through the business date', async () => {
    const { supabase, reads, readOf } = fakeClient({}, withMethods(payload()));
    await fetchOwnerMoney(supabase, 'club-1', TODAY);

    expect(reads.map(kind).sort()).toEqual([
      'dollar_expenses', 'investments', 'money_exchanges', 'owner_profit_carryovers', 'owner_reserve_entries', 'reserve_expenses',
    ]);
    for (const read of reads) expect(read.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    // Carryovers out of a future month do not exist yet for this page.
    expect(readOf('owner_profit_carryovers')!.calls).toContainEqual(['lte', ['from_month', '2026-10-01']]);
    expect(readOf('investments')!.calls).toContainEqual(['lte', ['date', TODAY]]);
    expect(readOf('money_exchanges')!.calls).toEqual(expect.arrayContaining([['gte', ['date', '2000-01-01']], ['lte', ['date', TODAY]]]));
    expect(readOf('dollar_expenses')!.calls).toContainEqual(['lte', ['date', TODAY]]);
  });
});

describe('fetchOwnerMoney on the snapshot path', () => {
  it('keeps the payment method the 076 snapshot recorded and leaves the rest unassigned', async () => {
    const rows = [withdrawal('w1', 'game_club', 100, { payment_method: 'terminal' }), withdrawal('w2', 'game_club', 50), withdrawal('w3', 'bar', 50, { payment_method: null })];
    const { supabase, rpc, readOf } = fakeClient({}, withMethods(payload({ withdrawalRows: rows })));

    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);

    expect(result.withdrawals.map((row) => [row.id, row.payment_method])).toEqual([['w1', 'terminal'], ['w2', null], ['w3', null]]);
    expect(result.methodsSupported).toBe(true);
    // One RPC is enough: neither the 050 snapshot nor the method rows are read.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(readOf('withdrawal_methods')).toBeUndefined();
  });

  it('moves exchanged money between methods of the month it happened in', async () => {
    const exchanges = [
      { id: 'x1', date: '2026-10-05', from_method: 'cash', to_method: 'card', from_amount: '300', to_amount: '300', rate: null },
      // 1 280 000 sums of cash became 100 dollars: cash drops, no UZS method gains.
      { id: 'x2', date: '2026-09-20', from_method: 'cash', to_method: 'usd', from_amount: 1_280_000, to_amount: 100, rate: 12_800 },
    ];
    const { supabase } = fakeClient(
      { money_exchanges: ok(exchanges) },
      withMethods(payload({ paymentMethodBalancesByMonth: { '2026-10': { cash: '1000', terminal: 400 } } })),
    );

    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);

    expect(result.paymentMethodBalancesByMonth['2026-10']).toEqual({ cash: 700, terminal: 400, card: 300, playstation: 0 });
    // September had no snapshot row: the exchange alone creates it.
    expect(result.paymentMethodBalancesByMonth['2026-09']).toEqual({ cash: -1_280_000, terminal: 0, card: 0, playstation: 0 });
    expect(result.exchangeRows).toEqual(exchanges);
    // Exchanges are neither earnings nor withdrawals.
    expect(result.balancesByMonth['2026-10'].gameClub).toMatchObject({ earned: 500, withdrawn: 0, available: 500 });
  });

  it('returns the dollar expenses, and none when that read fails', async () => {
    const dollars = [{ id: 'e1', date: '2026-10-07', amount: 640_000, payment_method: 'usd', usd_amount: 50, usd_rate: 12_800 }];
    const read = fakeClient({ dollar_expenses: ok(dollars) }, withMethods(payload()));
    await expect(fetchOwnerMoney(read.supabase, 'club-1', TODAY)).resolves.toMatchObject({ dollarExpenses: dollars });

    const denied = fakeClient({ dollar_expenses: fail({ code: '42501', message: 'denied' }) }, withMethods(payload()));
    const result = await fetchOwnerMoney(denied.supabase, 'club-1', TODAY);
    expect(result.dollarExpenses).toEqual([]);
    // The page still loads with its balances.
    expect(result.balancesByMonth['2026-10'].bar.available).toBe(150);
  });

  it('throws a failed exchange read: method balances would be wrong without it', async () => {
    const error = { code: '42501', message: 'exchanges denied' };
    const { supabase } = fakeClient({ money_exchanges: fail(error) }, withMethods(payload()));
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).rejects.toBe(error);
  });
});

describe('fetchOwnerMoney carryovers', () => {
  it('has nothing to carry before migration 071', async () => {
    const { supabase } = fakeClient(
      { owner_profit_carryovers: fail({ code: 'PGRST205', message: "Could not find the table 'public.owner_profit_carryovers'" }) },
      withMethods(payload()),
    );
    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);
    expect(result.carryoversSupported).toBe(false);
    expect(result.carryovers).toEqual([]);
    expect(result.balancesByMonth['2026-10'].gameClub.available).toBe(500);
  });

  it('throws any other carryover error', async () => {
    const { supabase } = fakeClient({ owner_profit_carryovers: fail({ code: '42501', message: 'carryovers denied' }) }, withMethods(payload()));
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).rejects.toThrow('carryovers denied');
  });
});

describe('fetchOwnerMoney owner reserve (fund)', () => {
  const entry = (id: string, kind: 'deposit' | 'return', source: 'game_club' | 'bar', amount: string, month = '2026-10-01') => ({
    id, club_id: 'club-1', kind, period_month: month, source, payment_method: source === 'game_club' ? 'cash' : null, amount, comment: null, created_at: '2026-10-12T10:00:00Z',
  });
  const reserveExpense = { id: 'e9', date: '2026-10-10', amount: '30', payment_source: 'game_club', payment_method: 'cash', category: 'equipment', comment: null, created_at: '2026-10-10T09:00:00Z' };

  it('takes deposits out of what is left, adds returns back, and does not charge reserve purchases to the month', async () => {
    const { supabase, readOf } = fakeClient(
      {
        owner_reserve_entries: ok([
          entry('r1', 'deposit', 'game_club', '150'),
          entry('r2', 'return', 'game_club', '50'),
          entry('r3', 'deposit', 'bar', '40'),
          // A deposit dated after the business month is not part of this page yet.
          entry('r4', 'deposit', 'game_club', '999', '2026-11-01'),
        ]),
        reserve_expenses: ok([reserveExpense]),
      },
      withMethods(payload()),
    );

    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);

    expect(readOf('reserve_expenses')!.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(result.reserveSupported).toBe(true);
    expect(result.reserveEntries.map((row) => row.amount)).toEqual([150, 50, 40, 999]);
    expect(result.reserveExpenses).toEqual([{ ...reserveExpense, amount: 30 }]);
    // Game Club: earned 500 + 30 the reserve paid = 530; left 500 + 30 - (150 - 50) = 430.
    expect(result.balancesByMonth['2026-10'].gameClub).toEqual({ earned: 530, withdrawn: 0, available: 430, overdrawnBy: 0 });
    // Bar: 200 earned - 50 withdrawn - 40 set aside = 110. A deposit is not a withdrawal.
    expect(result.balancesByMonth['2026-10'].bar).toEqual({ earned: 200, withdrawn: 50, available: 110, overdrawnBy: 0 });
    expect(Object.keys(result.balancesByMonth)).toEqual(['2026-10']);
  });

  it('has no reserve before migration 136 creates the table', async () => {
    const { supabase } = fakeClient(
      {
        owner_reserve_entries: fail({ code: '42P01', message: 'relation "public.owner_reserve_entries" does not exist' }),
        reserve_expenses: ok([reserveExpense]),
      },
      withMethods(payload()),
    );
    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);
    expect(result).toMatchObject({ reserveSupported: false, reserveEntries: [], reserveExpenses: [] });
    expect(result.balancesByMonth['2026-10'].gameClub).toMatchObject({ earned: 500, available: 500 });
  });

  it('has no reserve before migration 136 adds the expense flag', async () => {
    const { supabase } = fakeClient(
      {
        owner_reserve_entries: ok([entry('r1', 'deposit', 'game_club', '150')]),
        reserve_expenses: fail({ code: '42703', message: 'column expenses.paid_from_reserve does not exist' }),
      },
      withMethods(payload()),
    );
    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);
    expect(result).toMatchObject({ reserveSupported: false, reserveEntries: [], reserveExpenses: [] });
    expect(result.balancesByMonth['2026-10'].gameClub.available).toBe(500);
  });

  it('throws any other reserve entries error', async () => {
    const { supabase } = fakeClient({ owner_reserve_entries: fail({ code: '42501', message: 'reserve denied' }) }, withMethods(payload()));
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).rejects.toThrow('reserve denied');
  });

  it('leaves reserve purchases out when their read fails, so the month shows less left, never more', async () => {
    const { supabase } = fakeClient(
      {
        owner_reserve_entries: ok([entry('r1', 'deposit', 'game_club', '150')]),
        reserve_expenses: fail({ code: '42501', message: 'expenses denied' }),
      },
      withMethods(payload()),
    );
    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);
    expect(result).toMatchObject({ reserveSupported: true, reserveExpenses: [] });
    expect(result.reserveEntries).toHaveLength(1);
    expect(result.balancesByMonth['2026-10'].gameClub).toMatchObject({ earned: 500, available: 350 });
  });
});

describe('fetchOwnerMoney before migration 076', () => {
  const legacy = (data: unknown, methods: Result = ok([])) => ({
    rpcs: {
      get_owner_profit_snapshot_with_methods: missingFunction('get_owner_profit_snapshot_with_methods'),
      get_owner_profit_snapshot: ok(data),
    },
    answers: { withdrawal_methods: methods },
  });

  it('reads the 050 snapshot for the same club and date, and the withdrawal methods separately', async () => {
    const rows = [withdrawal('w1', 'game_club', 100), withdrawal('w2', 'game_club', 50, { payment_method: 'card' })];
    const { rpcs, answers } = legacy(payload({ withdrawalRows: rows }), ok([{ id: 'w1', payment_method: 'cash' }]));
    const { supabase, rpc, readOf } = fakeClient(answers, rpcs);

    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);

    expect(rpc).toHaveBeenLastCalledWith('get_owner_profit_snapshot', { p_club_id: 'club-1', p_through_date: TODAY });
    expect(readOf('withdrawal_methods')!.calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['not', ['payment_method', 'is', null]],
    ]));
    // The separate method rows are the source of truth; a withdrawal absent from them is unassigned, never guessed.
    expect(result.withdrawals.map((row) => [row.id, row.payment_method])).toEqual([['w1', 'cash'], ['w2', null]]);
    expect(result.methodsSupported).toBe(true);
    expect(result.balancesByMonth['2026-10'].bar).toMatchObject({ earned: 200, withdrawn: 50, available: 150 });
  });

  it('keeps every withdrawal unassigned before migration 066 adds the method column', async () => {
    const rows = [withdrawal('w1', 'game_club', 100)];
    const { rpcs, answers } = legacy(payload({ withdrawalRows: rows }), fail({ code: '42703', message: 'column owner_withdrawals.payment_method does not exist' }));
    const result = await fetchOwnerMoney(fakeClient(answers, rpcs).supabase, 'club-1', TODAY);
    expect(result.methodsSupported).toBe(false);
    expect(result.withdrawals).toEqual([{ ...rows[0], payment_method: null }]);
  });

  it('throws any other withdrawal method error', async () => {
    const { rpcs, answers } = legacy(payload(), fail({ code: '42501', message: 'methods denied' }));
    await expect(fetchOwnerMoney(fakeClient(answers, rpcs).supabase, 'club-1', TODAY)).rejects.toThrow('methods denied');
  });

  it('throws a 050 snapshot error that is not a missing function', async () => {
    const { supabase } = fakeClient({}, {
      get_owner_profit_snapshot_with_methods: missingFunction('get_owner_profit_snapshot_with_methods'),
      get_owner_profit_snapshot: fail({ code: '42501', message: 'snapshot denied' }),
    });
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).rejects.toThrow('snapshot denied');
  });

  it('returns the empty value when superseded while the 050 snapshot loads', async () => {
    const { rpcs, answers } = legacy(payload());
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(fetchOwnerMoney(fakeClient(answers, rpcs).supabase, 'club-1', TODAY, isCurrent)).resolves.toBe(EMPTY_OWNER_MONEY);
    expect(isCurrent).toHaveBeenCalledTimes(2);
  });
});

describe('fetchOwnerMoney from the raw ledgers (no snapshot RPC deployed)', () => {
  const rpcs = {
    get_owner_profit_snapshot_with_methods: missingFunction('get_owner_profit_snapshot_with_methods'),
    get_owner_profit_snapshot: missingFunction('get_owner_profit_snapshot'),
  };
  const ledgers = {
    daily_cash_entries: ok([
      { date: '2026-09-10', cash_income: 500, terminal_income: 200, card_income: 100, playstation_income: 50 },
      { date: '2026-10-05', cash_income: 1_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
    ]),
    debt_payments: ok([{ date: '2026-10-06', amount: 100, payment_method: 'cash' }]),
    expenses: ok([
      { id: 'e1', date: '2026-10-07', amount: 300, category: 'rent', payment_method: 'cash', payment_source: 'game_club' },
      { id: 'e2', date: '2026-10-08', amount: 40, category: 'other', payment_method: 'cash', payment_source: 'bar' },
    ]),
    daily_stock_counts: ok([{ date: '2026-10-05', bar_income: 400, bar_profit: 150, bar_cost: 250, sold_quantity: 8 }]),
    stock_purchases: ok([{ date: '2026-10-06', quantity: 2, cost_price: 50 }]),
    owner_withdrawals: ok([withdrawal('w1', 'game_club', 200)]),
    withdrawal_methods: ok([{ id: 'w1', payment_method: 'cash' }]),
    money_exchanges: ok([{ id: 'x1', date: '2026-10-09', from_method: 'cash', to_method: 'terminal', from_amount: 250, to_amount: 250, rate: null }]),
  };
  const LEDGER_KINDS = ['daily_cash_entries', 'daily_stock_counts', 'stock_purchases', 'expenses', 'debt_payments', 'owner_withdrawals'];

  it('reads the six current ledgers for the club through the business date', async () => {
    const { supabase, readOf, reads } = fakeClient(ledgers, rpcs);
    await fetchOwnerMoney(supabase, 'club-1', TODAY);

    for (const name of LEDGER_KINDS) expect(readOf(name)!.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    for (const name of LEDGER_KINDS.slice(0, 5)) expect(readOf(name)!.calls).toContainEqual(['lte', ['date', TODAY]]);
    expect(readOf('owner_withdrawals')!.calls).toContainEqual(['lte', ['period_month', '2026-10-01']]);
    // The retired ledgers are never a source.
    const tables = reads.map((read) => read.table);
    for (const retired of ['income_transactions', 'expense_transactions', 'cash_movements']) expect(tables).not.toContain(retired);
  });

  it('computes each month and each side on its own', async () => {
    const result = await fetchOwnerMoney(fakeClient(ledgers, rpcs).supabase, 'club-1', TODAY);

    // September: 500 + 200 + 100 + 50 collected, nothing spent or taken.
    expect(result.balancesByMonth['2026-09'].gameClub).toEqual({ earned: 850, withdrawn: 0, available: 850, overdrawnBy: 0 });
    // October Game Club: 1 000 collected + 100 debt payment - 300 own expense = 800; 200 taken leaves 600.
    expect(result.balancesByMonth['2026-10'].gameClub).toEqual({ earned: 800, withdrawn: 200, available: 600, overdrawnBy: 0 });
    // October Bar is cash left, not accounting profit: 400 sales - 100 stock bought - 40 own expense = 260 (profit would be 400 - 250 - 40 = 110).
    expect(result.balancesByMonth['2026-10'].bar).toEqual({ earned: 260, withdrawn: 0, available: 260, overdrawnBy: 0 });
    expect(result.balancesByMonth['2026-09'].bar.earned).toBe(0);
    expect(result.balancesByMonth['2026-10'].hasOverWithdrawal).toBe(false);
  });

  it('computes what each payment method holds per month, with exchanges moved', async () => {
    const result = await fetchOwnerMoney(fakeClient(ledgers, rpcs).supabase, 'club-1', TODAY);
    expect(result.paymentMethodBalancesByMonth['2026-09']).toEqual({ cash: 500, terminal: 200, card: 100, playstation: 50 });
    // Cash: 1 000 + 100 - 300 = 800, then 250 moved to terminal. The Bar-paid expense does not touch it.
    expect(result.paymentMethodBalancesByMonth['2026-10']).toEqual({ cash: 550, terminal: 250, card: 0, playstation: 0 });
  });

  it('attaches the recorded payment methods to the raw withdrawals', async () => {
    const result = await fetchOwnerMoney(fakeClient(ledgers, rpcs).supabase, 'club-1', TODAY);
    expect(result.withdrawals).toEqual([{ ...withdrawal('w1', 'game_club', 200), payment_method: 'cash' }]);
    expect(result).toMatchObject({ methodsSupported: true, carryoversSupported: true, reserveSupported: true });
  });

  it('applies carryovers and the reserve to the raw-ledger balances too', async () => {
    const { supabase } = fakeClient({
      ...ledgers,
      owner_profit_carryovers: ok([{ id: 'c1', from_month: '2026-09-01', to_month: '2026-10-01', source: 'game_club', payment_method: 'cash', amount: '350' }]),
      owner_reserve_entries: ok([{ id: 'r1', kind: 'deposit', period_month: '2026-10-01', source: 'bar', payment_method: null, amount: '60', created_at: '2026-10-12T00:00:00Z' }]),
    }, rpcs);

    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);

    // 350 of September's 850 moved on: earnings stay as recorded, only what is left moves.
    expect(result.balancesByMonth['2026-09'].gameClub).toMatchObject({ earned: 850, available: 500 });
    expect(result.balancesByMonth['2026-10'].gameClub).toMatchObject({ earned: 800, withdrawn: 200, available: 950 });
    expect(result.balancesByMonth['2026-10'].bar).toMatchObject({ earned: 260, available: 200 });
  });

  it('flags a month whose withdrawals exceed its own earnings, whatever other months hold', async () => {
    const { supabase } = fakeClient({ ...ledgers, owner_withdrawals: ok([withdrawal('w1', 'game_club', 200), withdrawal('w2', 'game_club', 700)]) }, rpcs);
    const october = (await fetchOwnerMoney(supabase, 'club-1', TODAY)).balancesByMonth['2026-10'];
    // 800 earned, 900 taken: September's 850 cannot cover October's 100 overdraft.
    expect(october.gameClub).toEqual({ earned: 800, withdrawn: 900, available: -100, overdrawnBy: 100 });
    expect(october.hasOverWithdrawal).toBe(true);
    expect(october.invalidWithdrawals).toEqual([
      { id: 'w2', period_month: '2026-10-01', source: 'game_club', amount: 700, availableBefore: 600, overdrawnBy: 100 },
    ]);
  });

  it('uses the raw ledgers when a snapshot answers without method balances', async () => {
    const { supabase, readOf } = fakeClient(ledgers, withMethods({ monthlyBalances: [], withdrawalRows: [] }));
    const result = await fetchOwnerMoney(supabase, 'club-1', TODAY);
    expect(readOf('daily_cash_entries')).toBeDefined();
    expect(result.balancesByMonth['2026-10'].gameClub.earned).toBe(800);
    // The 076 RPC answered, so the snapshot rows would have carried the methods: none is read separately.
    expect(readOf('withdrawal_methods')).toBeUndefined();
    expect(result.withdrawals).toEqual([{ ...withdrawal('w1', 'game_club', 200), payment_method: null }]);
  });

  it('is empty for a club with no ledger rows', async () => {
    const none = ok(null);
    const { supabase } = fakeClient({
      daily_cash_entries: none, daily_stock_counts: none, stock_purchases: none, expenses: none, debt_payments: none, owner_withdrawals: none,
      withdrawal_methods: none, owner_profit_carryovers: none, owner_reserve_entries: none, reserve_expenses: none, investments: none,
    }, rpcs);
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).resolves.toEqual({
      ...EMPTY_OWNER_MONEY, carryoversSupported: true, methodsSupported: true, reserveSupported: true,
    });
  });

  it.each(LEDGER_KINDS)('throws a failed %s read', async (name) => {
    const { supabase } = fakeClient({ ...ledgers, [name]: fail({ message: `${name} denied` }) }, rpcs);
    await expect(fetchOwnerMoney(supabase, 'club-1', TODAY)).rejects.toThrow(`${name} denied`);
  });
});
