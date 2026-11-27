import { describe, expect, it } from 'vitest';
import { applyOwnerReserve, dollarReserveEntries, reserveActivity, groupReserveActivityByDay, reserveMonthlySeries, reserveDailySeries, reserveBalances, reserveForMonth, planGameClubDepositAll, reserveHoldingsOn, reserveMonthMoves, reserveReturnLimits, reserveSumsHeld, canReturnFromReserve, withReservePurchaseDollars, type ReservePaidExpense } from './ownerReserve';
import { sumAvailableMoneyResults, type AvailableMoneyByMonth } from './availableMoney';
import type { OwnerReserveEntry } from '@/types';

const entry = (id: string, overrides: Partial<OwnerReserveEntry>): OwnerReserveEntry => ({
  id, club_id: 'club', kind: 'deposit', period_month: '2026-09-01', source: 'game_club', payment_method: 'cash',
  amount: 1_000_000, comment: 'For new PCs', collection_date: null, created_by: 'owner', created_at: '2026-09-30T10:00:00Z', ...overrides,
});
const purchase = (id: string, overrides: Partial<ReservePaidExpense> = {}): ReservePaidExpense => ({
  id, date: '2026-11-05', amount: 2_500_000, payment_source: 'game_club', payment_method: 'cash',
  category: 'equipment', comment: 'Two new PCs', created_at: '2026-11-05T12:00:00Z', ...overrides,
});
const month = (gameClubEarned: number, barEarned = 0): AvailableMoneyByMonth[string] => {
  const base = sumAvailableMoneyResults([]);
  return {
    ...base,
    gameClub: { earned: gameClubEarned, withdrawn: 0, available: gameClubEarned, overdrawnBy: 0 },
    bar: { earned: barEarned, withdrawn: 0, available: barEarned, overdrawnBy: 0 },
  };
};

const entries = [
  entry('sep', {}),
  entry('oct', { period_month: '2026-10-01', amount: 2_000_000, created_at: '2026-10-31T10:00:00Z' }),
  entry('bar', { source: 'bar', payment_method: null, amount: 300_000 }),
  entry('back', { kind: 'return', period_month: '2026-10-01', amount: 200_000, created_at: '2026-10-31T11:00:00Z' }),
];
const purchases = [purchase('pcs')];

describe('applyOwnerReserve', () => {
  it('takes deposits out of their month, returns into it, and lifts a reserve purchase off its month', () => {
    const result = applyOwnerReserve({
      '2026-09': month(3_000_000, 500_000),
      '2026-10': month(3_000_000),
      // November earned already counts the 2 500 000 purchase as an expense.
      '2026-11': month(500_000),
    }, entries, purchases, '2026-11');
    expect(result['2026-09'].gameClub).toMatchObject({ earned: 3_000_000, available: 2_000_000 });
    expect(result['2026-09'].bar).toMatchObject({ earned: 500_000, available: 200_000 });
    expect(result['2026-10'].gameClub).toMatchObject({ available: 1_200_000 });
    expect(result['2026-11'].gameClub).toMatchObject({ earned: 3_000_000, available: 3_000_000 });
  });

  it('leaves out months after the current one', () => {
    const result = applyOwnerReserve({}, [entry('future', { period_month: '2026-12-01' })], [], '2026-11');
    expect(result['2026-12']).toBeUndefined();
  });
});

describe('reserveBalances', () => {
  it('holds deposits minus returns minus purchases, per side and per Game Club method', () => {
    const balances = reserveBalances(entries, [...purchases, purchase('bar-fridge', { payment_source: 'bar', payment_method: 'terminal', amount: 100_000 })]);
    expect(balances.game_club).toMatchObject({ deposited: 3_000_000, returned: 200_000, spent: 2_500_000, held: 300_000 });
    expect(balances.game_club.byMethod.cash).toBe(300_000);
    expect(balances.bar).toMatchObject({ held: 200_000, spent: 100_000 });
  });
});

describe('reserveForMonth', () => {
  it('buckets an unknown Game Club method into card, like the database', () => {
    const flow = reserveForMonth([], [purchase('qr', { payment_method: 'qr', amount: 10 })], '2026-11');
    expect(flow.byMethod.card.spent).toBe(10);
    expect(flow.bySource.game_club.spent).toBe(10);
  });
});

describe('reserveActivity', () => {
  it('lists the newest first', () => {
    expect(reserveActivity(entries, purchases).map((row) => row.id)).toEqual(['pcs', 'back', 'oct', 'sep', 'bar']);
  });

  it('gives a USD-account purchase its dollars and cost per dollar, and a sums purchase none', () => {
    const rows = withReservePurchaseDollars(
      [
        purchase('rent', { payment_method: 'usd', amount: 1_082_003, category: 'rent' }),
        purchase('pcs'),
        // Read before the dollar expense read caught up: the sums still show.
        purchase('late', { payment_method: 'usd', amount: 250_000 }),
      ],
      [
        { id: 'rent', usd_amount: '90', usd_rate: '12022.26' },
        // A sums purchase never takes dollars, whatever a read says.
        { id: 'pcs', usd_amount: 10, usd_rate: 12_000 },
      ],
    );
    expect(rows.map((row) => [row.id, row.usd_amount, row.usd_rate])).toEqual([
      ['rent', '90', '12022.26'], ['pcs', undefined, undefined], ['late', undefined, undefined],
    ]);
    const activity = reserveActivity([], rows);
    const dollarsOf = (id: string) => {
      const row = activity.find((item) => item.id === id);
      return row?.kind === 'purchase' ? row.dollars : 'not a purchase';
    };
    expect(dollarsOf('rent')).toEqual({ amount: 90, rate: 12_022.26 });
    expect(dollarsOf('pcs')).toBeUndefined();
    expect(dollarsOf('late')).toBeUndefined();
    expect(activity.find((item) => item.id === 'rent')?.amount).toBe(1_082_003);
  });

  it('dates a deposit by the day the money moved, else the day it was made kept inside its month', () => {
    const rows = reserveActivity([
      entry('ps5', { period_month: '2026-11-01', entry_date: '2026-11-11', created_at: '2026-11-18T08:46:00Z' }),
      entry('late', { period_month: '2026-10-01', created_at: '2026-11-17T07:11:00Z' }),
    ], []);
    expect(rows.map((row) => [row.id, row.date])).toEqual([['ps5', '2026-11-11'], ['late', '2026-10-31']]);
  });
});

describe('groupReserveActivityByDay', () => {
  it('buckets newest-first activity by day with each day\'s in and out', () => {
    const days = groupReserveActivityByDay(reserveActivity(entries, purchases));
    expect(days.map((day) => [day.date, day.rows.map((row) => row.id), day.deposited, day.withdrawn])).toEqual([
      ['2026-11-05', ['pcs'], 0, 2_500_000],
      ['2026-10-31', ['back', 'oct'], 2_000_000, 200_000],
      ['2026-09-30', ['sep', 'bar'], 1_300_000, 0],
    ]);
  });
});

describe('dollarReserveEntries', () => {
  const row = (id: string, from: 'cash' | 'usd', to: 'cash' | 'usd' | 'card', fromAmount: number, toAmount: number) => ({
    id, date: '2026-10-31', from_method: from, to_method: to, from_amount: fromAmount, to_amount: toAmount, rate: 12_000,
  });

  it('turns exchanges into and out of dollars into reserve deposits and returns of the sums', () => {
    const entries = dollarReserveEntries([
      row('a', 'cash', 'usd', 1_200_000, 100),
      row('b', 'usd', 'cash', 10, 125_000),
      row('c', 'cash', 'card', 5_000, 5_000),
    ], 'club');
    expect(entries.map(({ kind, amount, payment_method, period_month, exchange_id }) => ({ kind, amount, payment_method, period_month, exchange_id })))
      .toEqual([
        { kind: 'deposit', amount: 1_200_000, payment_method: 'usd', period_month: '2026-10-01', exchange_id: 'a' },
        { kind: 'return', amount: 125_000, payment_method: 'usd', period_month: '2026-10-01', exchange_id: 'b' },
      ]);
  });

  it('lets the reserve pay dollar expenses, so the month keeps only what its methods hold', () => {
    const entries = dollarReserveEntries([row('a', 'cash', 'usd', 21_243_000, 1_796.92)], 'club');
    const rent: ReservePaidExpense = {
      id: 'rent', date: '2026-10-31', amount: 15_000_000, payment_source: 'game_club', payment_method: 'usd',
      category: 'rent', comment: null, created_at: '2026-10-31T10:00:00Z',
    };
    const month = reserveForMonth(entries, [rent], '2026-10');
    expect(month.byMethod.usd).toEqual({ deposited: 21_243_000, returned: 0, spent: 15_000_000 });
    expect(reserveBalances(entries, [rent]).game_club.byMethod.usd).toBe(6_243_000);
  });

  it('keeps the average price of the dollars left when dollars are spent at what they cost (184)', async () => {
    const { reserveDollarRates } = await import('./ownerReserve');
    const exchanges = [
      { ...row('a', 'cash', 'usd', 1_200_000, 100), rate: 12_000 },
      { ...row('b', 'cash', 'usd', 1_300_000, 100), rate: 13_000 },
    ];
    const entries = dollarReserveEntries(exchanges, 'club');
    const before = reserveDollarRates(exchanges, 200, reserveBalances(entries, []).game_club.byMethod.usd);
    expect(before.averageRate).toBe(12_500);
    // $50 at the database's cost rate: amount = round(50 x 12 500).
    const parts: ReservePaidExpense = {
      id: 'parts', date: '2026-10-31', amount: 625_000, payment_source: 'game_club', payment_method: 'usd',
      category: 'repair', comment: null, created_at: '2026-10-31T10:00:00Z',
    };
    const value = reserveBalances(entries, [parts]).game_club.byMethod.usd;
    expect(value).toBe(1_875_000);
    expect(reserveDollarRates(exchanges, 150, value).averageRate).toBe(12_500);
  });
});

describe('reserveMonthlySeries', () => {
  const entry = (month: string, kind: 'deposit' | 'return', amount: number, source: 'game_club' | 'bar' = 'game_club'): OwnerReserveEntry => ({
    id: `${month}-${kind}-${amount}`, club_id: 'club', kind, period_month: `${month}-01`, source,
    payment_method: source === 'bar' ? null : 'cash', amount, comment: null, collection_date: null, created_by: 'owner', created_at: `${month}-02T00:00:00Z`,
  });

  it('fills every month through today and keeps a running balance per side', () => {
    const purchase: ReservePaidExpense = {
      id: 'p', date: '2026-10-05', amount: 200, payment_source: 'game_club', payment_method: 'cash',
      category: 'repair', comment: null, created_at: '2026-10-05T00:00:00Z',
    };
    const rows = reserveMonthlySeries(
      [entry('2026-08', 'deposit', 1_000), entry('2026-10', 'return', 100), entry('2026-10', 'deposit', 50, 'bar'), entry('2027-01', 'deposit', 5)],
      [purchase],
      '2026-11',
    );
    expect(rows).toEqual([
      { month: '2026-08', deposited: 1_000, withdrawn: 0, gameClubHeld: 1_000, barHeld: 0 },
      { month: '2026-09', deposited: 0, withdrawn: 0, gameClubHeld: 1_000, barHeld: 0 },
      { month: '2026-10', deposited: 50, withdrawn: 300, gameClubHeld: 700, barHeld: 50 },
      { month: '2026-11', deposited: 0, withdrawn: 0, gameClubHeld: 700, barHeld: 50 },
    ]);
  });

  it('is empty without reserve activity', () => {
    expect(reserveMonthlySeries([], [], '2026-11')).toEqual([]);
  });
});

describe('reserveDailySeries', () => {
  const entry = (day: string, kind: 'deposit' | 'return', amount: number, source: 'game_club' | 'bar' = 'game_club'): OwnerReserveEntry => ({
    id: `${day}-${kind}-${amount}`, club_id: 'club', kind, period_month: `${day.slice(0, 7)}-01`, source,
    payment_method: source === 'bar' ? null : 'cash', amount, comment: null, collection_date: null, created_by: 'owner', created_at: `${day}T10:00:00Z`,
  });

  it('fills every day through today with the whole reserve\'s running balance', () => {
    const purchase: ReservePaidExpense = {
      id: 'p', date: '2026-10-31', amount: 200, payment_source: 'game_club', payment_method: 'cash',
      category: 'repair', comment: null, created_at: '2026-10-31T09:00:00Z',
    };
    const rows = reserveDailySeries(
      [entry('2026-10-30', 'deposit', 1_000), entry('2026-11-01', 'return', 100), entry('2026-11-01', 'deposit', 50, 'bar')],
      [purchase],
      '2026-11-02',
    );
    expect(rows).toEqual([
      { date: '2026-10-30', held: 1_000 },
      { date: '2026-10-31', held: 800 },
      { date: '2026-11-01', held: 750 },
      { date: '2026-11-02', held: 750 },
    ]);
  });

  it('shows a purchase recorded before the money that paid for it as an empty reserve, never a negative one', () => {
    const rent: ReservePaidExpense = {
      id: 'rent', date: '2026-10-31', amount: 15_000_000, payment_source: 'game_club', payment_method: 'usd',
      category: 'rent', comment: null, created_at: '2026-11-08T16:17:00Z',
    };
    expect(reserveDailySeries([entry('2026-11-02', 'deposit', 16_863_000)], [rent], '2026-11-03')).toEqual([
      { date: '2026-10-31', held: 0 },
      { date: '2026-11-01', held: 0 },
      { date: '2026-11-02', held: 1_863_000 },
      { date: '2026-11-03', held: 1_863_000 },
    ]);
  });

  it('counts activity dated after today on today, and is empty without activity', () => {
    expect(reserveDailySeries([entry('2026-11-05', 'deposit', 10)], [], '2026-11-03')).toEqual([
      { date: '2026-11-03', held: 10 },
    ]);
    expect(reserveDailySeries([], [], '2026-11-03')).toEqual([]);
  });
});

describe('planGameClubDepositAll', () => {
  it('takes every method that holds money, skips negative ones, and never exceeds Game Club', () => {
    const methods = [
      { method: 'cash' as const, available: 7_928_483 },
      { method: 'terminal' as const, available: -800 },
      { method: 'card' as const, available: 4_172_000 },
      { method: 'playstation' as const, available: 0 },
    ];
    expect(planGameClubDepositAll(methods, 12_099_683)).toEqual([
      { method: 'cash', amount: 7_928_483 },
      { method: 'card', amount: 4_171_200 },
    ]);
    expect(planGameClubDepositAll(methods, -5)).toEqual([]);
  });
});

describe('reserve overview figures', () => {
  it('holds sums as one pot without the sums value of the dollars', async () => {
    const { reserveSumsHeld } = await import('./ownerReserve');
    const balances = reserveBalances(
      [...entries, entry('usd', { payment_method: 'usd', amount: 1_250_000 })],
      purchases,
    );
    expect(balances.game_club.byMethod.usd).toBe(1_250_000);
    expect(reserveSumsHeld(balances)).toBe(balances.game_club.held + balances.bar.held - 1_250_000);
    // Deposits 1 000 000 + 2 000 000 + 300 000, 200 000 returned, 2 500 000 spent.
    expect(reserveSumsHeld(reserveBalances(entries, purchases))).toBe(600_000);
  });

  it('sums purchases per category and leaves other kinds out', async () => {
    const { reserveSpendingByCategory } = await import('./ownerReserve');
    const activity = reserveActivity(entries, [
      purchase('pcs'),
      purchase('chairs', { amount: 400_000 }),
      purchase('rent', { category: 'rent', amount: 100_000 }),
    ]);
    expect(reserveSpendingByCategory(activity).sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: 'equipment', amount: 2_900_000 },
      { category: 'rent', amount: 100_000 },
    ]);
    expect(reserveSpendingByCategory(reserveActivity(entries, []))).toEqual([]);
  });

  it('splits what was put in into spent, returned and still held, never below zero', async () => {
    const { reserveFlowSplit } = await import('./ownerReserve');
    expect(reserveFlowSplit({ deposited: 3_300_000, returned: 200_000, spent: 2_500_000 })).toEqual({ spent: 2_500_000, returned: 200_000, held: 600_000 });
    expect(reserveFlowSplit({ deposited: 100, returned: 80, spent: 50 }).held).toBe(0);
  });
});

describe('reserveDepositPrefill', () => {
  const till = { cash: 1_280_000, terminal: 850_000, card: 0, playstation: 250_000 };

  it('starts every method at everything the till holds when nothing was asked for', async () => {
    const { reserveDepositPrefill } = await import('./ownerReserve');
    expect(reserveDepositPrefill(undefined, till)).toEqual(till);
    expect(reserveDepositPrefill({}, till)).toEqual(till);
  });

  it('caps what was asked for at the till, and leaves methods not asked for empty', async () => {
    const { reserveDepositPrefill } = await import('./ownerReserve');
    expect(reserveDepositPrefill({ cash: 2_000_000, terminal: 300_000, card: 50_000 }, till))
      .toEqual({ cash: 1_280_000, terminal: 300_000, card: 0, playstation: 0 });
  });

  it('never starts below zero, and gives whole sums', async () => {
    const { reserveDepositPrefill } = await import('./ownerReserve');
    expect(reserveDepositPrefill({ cash: -40_000, terminal: 100_000.75 }, { cash: 500_000, terminal: 900_000, card: -10 }))
      .toEqual({ cash: 0, terminal: 100_000, card: 0, playstation: 0 });
    expect(reserveDepositPrefill(null, { cash: -5, terminal: 12_000.9, card: Number.NaN }))
      .toEqual({ cash: 0, terminal: 12_000, card: 0, playstation: 0 });
  });
});

describe('reserveDepositParts', () => {
  it('sends one whole, positive part per shown method, in the order shown', async () => {
    const { reserveDepositParts } = await import('./ownerReserve');
    expect(reserveDepositParts({ cash: 300_000, terminal: 0, card: 120_000.6, playstation: 50_000 }, ['card', 'cash', 'terminal']))
      .toEqual([{ method: 'card', amount: 120_000 }, { method: 'cash', amount: 300_000 }]);
    expect(reserveDepositParts({ cash: -1 }, ['cash'])).toEqual([]);
  });
});

describe('reserveHoldingsOn', () => {
  const exchange = { id: 'x', date: '2026-10-31', from_method: 'cash' as const, to_method: 'usd' as const, from_amount: 1_200_000, to_amount: 100, rate: 12_000 };
  const dollarRent = { id: 'rent', date: '2026-11-04', amount: 240_000, payment_method: 'usd' as const, usd_amount: 20, usd_rate: 12_000 };
  const reserve = {
    reserveEntries: [...entries, ...dollarReserveEntries([exchange], 'club')],
    reserveExpenses: [purchase('pcs'), { ...purchase('rent'), date: '2026-11-04', amount: 240_000, payment_method: 'usd' }],
    exchangeRows: [exchange],
    dollarExpenses: [dollarRent],
  };

  it('holds the sums as one pot and the USD account in dollars, apart', () => {
    // Sums: 1 000 000 + 2 000 000 + 300 000 - 200 000 - 2 500 000 (the PCs); the dollars are not in them.
    expect(reserveHoldingsOn(reserve, '2026-11-30')).toEqual({ sums: 600_000, usd: 80 });
  });

  it('leaves out what moved after the day', () => {
    // Before the PCs (11-05) and the dollar rent (11-04).
    expect(reserveHoldingsOn(reserve, '2026-11-03')).toEqual({ sums: 3_100_000, usd: 100 });
    // Before the October deposit, the return and the dollars (all 10-31).
    expect(reserveHoldingsOn(reserve, '2026-10-30')).toEqual({ sums: 1_300_000, usd: 0 });
  });
});

describe('reserveMonthMoves', () => {
  it('sums what went in and out of the sums in the month, by the day the money moved', () => {
    // October: the 2 000 000 deposit in, the 200 000 return out; September's moves stay in September.
    expect(reserveMonthMoves(entries, purchases, '2026-10', '2026-10-31')).toEqual({ in: 2_000_000, out: 200_000 });
    expect(reserveMonthMoves(entries, purchases, '2026-09', '2026-09-30')).toEqual({ in: 1_300_000, out: 0 });
    // A purchase is money out of the reserve.
    expect(reserveMonthMoves(entries, purchases, '2026-11', '2026-11-30')).toEqual({ in: 0, out: 2_500_000 });
  });

  it('leaves out what moved after the day', () => {
    expect(reserveMonthMoves(entries, purchases, '2026-11', '2026-11-04')).toEqual({ in: 0, out: 0 });
  });

  // November: dollars bought from the till straight into the USD account, rent paid from it, a Bar purchase,
  // and dollars bought then partly sold inside the reserve.
  const tillBuy = { id: 'till', date: '2026-11-02', from_method: 'cash' as const, to_method: 'usd' as const, from_amount: 1_200_000, to_amount: 100, rate: 12_000 };
  const innerBuy = { id: 'buy', date: '2026-11-06', from_method: 'cash' as const, to_method: 'usd' as const, from_amount: 600_000, to_amount: 50, rate: 12_000 };
  const innerSell = { id: 'sell', date: '2026-11-08', from_method: 'usd' as const, to_method: 'cash' as const, from_amount: 20, to_amount: 250_000, rate: 12_500 };
  const exchanges = [tillBuy, innerBuy, innerSell];
  const novemberEntries = [
    ...entries,
    // The sums halves of the exchanges inside the reserve (170).
    entry('buy-sums', { kind: 'return', period_month: '2026-11-01', entry_date: '2026-11-06', amount: 600_000, paired_exchange_id: 'buy', created_at: '2026-11-06T09:00:00Z' }),
    entry('sell-sums', { kind: 'deposit', period_month: '2026-11-01', entry_date: '2026-11-08', amount: 250_000, paired_exchange_id: 'sell', created_at: '2026-11-08T09:00:00Z' }),
    ...dollarReserveEntries(exchanges, 'club'),
  ];
  const novemberPurchases = [
    ...purchases,
    purchase('rent', { date: '2026-11-04', amount: 240_000, payment_method: 'usd', category: 'rent' }),
    purchase('snacks', { date: '2026-11-07', amount: 90_000, payment_source: 'bar', payment_method: 'cash' }),
  ];
  const reserve = {
    reserveEntries: novemberEntries,
    reserveExpenses: novemberPurchases,
    exchangeRows: exchanges,
    dollarExpenses: [{ id: 'rent', date: '2026-11-04', amount: 240_000, payment_method: 'usd' as const, usd_amount: 20, usd_rate: 12_000 }],
  };

  it('leaves the USD account out: dollars bought from the till and a purchase paid in dollars move no sums', () => {
    const onlyDollars = [...entries, ...dollarReserveEntries([tillBuy], 'club')];
    const rent = [purchase('rent', { date: '2026-11-04', amount: 240_000, payment_method: 'usd' })];
    expect(reserveMonthMoves(onlyDollars, rent, '2026-11', '2026-11-30')).toEqual({ in: 0, out: 0 });
  });

  it('counts the sums paid for dollars inside the reserve as out and the sums a sale brings as in', () => {
    // In: the 250 000 the sale brought. Out: the 2 500 000 PCs, the 600 000 paid for dollars, the 90 000 Bar purchase.
    expect(reserveMonthMoves(novemberEntries, novemberPurchases, '2026-11', '2026-11-30')).toEqual({ in: 250_000, out: 3_190_000 });
  });

  it('reconciles: the sums the month opened with, plus in, minus out, are the sums it ends with', () => {
    for (const through of ['2026-11-03', '2026-11-06', '2026-11-07', '2026-11-30']) {
      const opening = reserveHoldingsOn(reserve, '2026-10-31').sums;
      const closing = reserveHoldingsOn(reserve, through).sums;
      const moves = reserveMonthMoves(reserve.reserveEntries, reserve.reserveExpenses, '2026-11', through);
      expect(opening + moves.in - moves.out).toBe(closing);
    }
    const october = reserveMonthMoves(reserve.reserveEntries, reserve.reserveExpenses, '2026-10', '2026-10-31');
    expect(reserveHoldingsOn(reserve, '2026-09-30').sums + october.in - october.out).toBe(reserveHoldingsOn(reserve, '2026-10-31').sums);
  });
});

describe('reserveReturnLimits', () => {
  const limitsFor = (ledger: OwnerReserveEntry[], paid: ReservePaidExpense[]) => (
    reserveReturnLimits(ledger, reserveSumsHeld(reserveBalances(ledger, paid)))
  );

  it('caps a bucket at the sums held once a purchase took money from the pot', () => {
    // Since 155 every purchase from the reserve's sums is stored as Game Club cash.
    const limits = limitsFor(
      [entry('terminal', { payment_method: 'terminal', amount: 5_000_000 })],
      [purchase('rent', { amount: 3_000_000 })],
    );
    expect(limits.game_club.terminal).toBe(2_000_000);
    expect(limits.game_club.cash).toBe(0);
    expect(limits.bar).toBe(0);
  });

  it('gives every bucket the lower of what it saved and what the pot holds', () => {
    const limits = limitsFor(
      [
        entry('cash', { amount: 5_000_000 }),
        entry('bar', { source: 'bar', payment_method: null, amount: 5_000_000 }),
      ],
      [purchase('pcs', { amount: 6_000_000 })],
    );
    expect(limits.game_club.cash).toBe(4_000_000);
    expect(limits.bar).toBe(4_000_000);
  });

  it('takes earlier returns off the bucket and never goes below zero', () => {
    const ledger = [
      entry('cash', { amount: 3_000_000 }),
      entry('back', { kind: 'return', amount: 1_000_000 }),
      entry('bar', { source: 'bar', payment_method: null, amount: 500_000 }),
      entry('bar-back', { source: 'bar', payment_method: null, kind: 'return', amount: 500_000 }),
    ];
    expect(reserveReturnLimits(ledger, 10_000_000)).toMatchObject({ game_club: { cash: 2_000_000 }, bar: 0 });
    const empty = reserveReturnLimits(ledger, -1);
    expect(empty).toMatchObject({ game_club: { cash: 0 }, bar: 0 });
    expect(canReturnFromReserve(empty)).toBe(false);
    expect(canReturnFromReserve(reserveReturnLimits(ledger, 1))).toBe(true);
  });
});
