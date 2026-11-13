import { describe, expect, it } from 'vitest';
import type { ExpenseRow } from './dashboardMetrics';
import { calculateTotalExpenses, expensesByCategory, expensesByPaymentMethod, filterExpensesByCategory, filterExpensesByDate, type ExpenseEntry } from './expenses';
import { buildBarMoneyDetailRows, buildGameClubMoneyDetailRows } from './moneyDetails';
import type { MoneyExchangeRow } from './moneyExchanges';
import { buildFilteredMoneyReport, buildMoneyReport, expensesFromSource } from './moneyReport';

const DAY = '2026-10-05';
const expense = (id: string, amount: number | null, overrides: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, date: DAY, amount: amount as number, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null,
  created_at: `${DAY}T1${id.slice(-1)}:00:00Z`, ...overrides,
});
const exchange = (id: string, overrides: Partial<MoneyExchangeRow>): MoneyExchangeRow => ({
  id, date: DAY, from_method: 'cash', to_method: 'card', from_amount: 200_000, to_amount: 200_000, rate: null, ...overrides,
});
const cashRow = { id: 'cash-1', date: DAY, cash_income: 2_000_000, terminal_income: null as never, card_income: null as never };

describe('money report with incomplete rows and exchanges', () => {
  const expenses = [
    expense('e1', 300_000, { category: '' }),
    expense('e2', null, { payment_method: 'card' }),
    expense('e4', 70_000, { payment_source: 'bar' }),
  ];
  const debtPayments = [
    { id: 'p1', date: DAY, amount: 80_000, payment_method: 'terminal' },
    { id: 'p2', date: DAY, amount: null as never, payment_method: 'cash' },
  ];
  const exchanges = [
    exchange('x2', { to_method: 'usd', from_amount: '640000', to_amount: '50', rate: '12800', created_at: `${DAY}T09:00:00Z`, comment: 'Bought dollars' }),
    exchange('x1', { creator_name: 'Aziz', comment: '' }),
  ];
  const report = buildMoneyReport([cashRow], expenses, debtPayments, [], [], exchanges);

  it('counts a missing amount as nothing on every method card', () => {
    expect(report.paymentMethods).toEqual({
      // 2 000 000 collected - 300 000 spent - 840 000 exchanged away = 860 000.
      cash: { collected: 2_000_000, expenses: 300_000, exchanged: -840_000, exchangedIn: 0, exchangedOut: 840_000, left: 860_000 },
      terminal: { collected: 80_000, expenses: 0, exchanged: 0, exchangedIn: 0, exchangedOut: 0, left: 80_000 },
      card: { collected: 0, expenses: 0, exchanged: 200_000, exchangedIn: 200_000, exchangedOut: 0, left: 200_000 },
      playstation: { collected: 0, expenses: 0, exchanged: 0, exchangedIn: 0, exchangedOut: 0, left: 0 },
    });
  });

  it('keeps Game Club and Bar apart, and exchanges out of money left', () => {
    expect(report.totalCollected).toBe(2_080_000);
    expect(report.gameClubExpenses).toBe(300_000);
    expect(report.barExpenses).toBe(70_000);
    // Collected minus Game Club expenses: moving 840 000 between methods and into dollars changes nothing.
    expect(report.gameClubLeft).toBe(1_780_000);
    // No bar sales in the period: the Bar expense alone leaves the bar 70 000 short.
    expect(report.barLeft).toBe(-70_000);
    expect(report.usd).toBe(50);
  });

  it('totals the day the same way', () => {
    const [day] = report.days;
    expect(day).toMatchObject({
      date: DAY, cash: 860_000, terminal: 80_000, card: 200_000, playstation: 0, total: 1_780_000,
      income: 2_080_000, expenses: 370_000, gameClubExpenses: 300_000, barExpenses: 70_000,
    });
    // The day total is its income minus its Game Club expenses.
    expect(day.total).toBe(day.income - day.gameClubExpenses);
  });

  it('lists incomes, debt payments, expenses in the order recorded, then exchanges', () => {
    const activities = report.days[0].activities;
    expect(activities.map((activity) => [activity.kind, activity.id, activity.amount])).toEqual([
      ['income', 'cash-1', 2_000_000],
      ['debt_payment', 'p1', 80_000],
      ['debt_payment', 'p2', 0],
      ['expense', 'e1', -300_000],
      ['expense', 'e2', -0],
      ['expense', 'e4', -70_000],
      // The exchange without a time sorts first.
      ['exchange', 'x1', 0],
      ['exchange', 'x2', 0],
    ]);
    expect(activities[0].paymentBreakdown).toEqual({ cash: 2_000_000, terminal: 0, card: 0, playstation: 0 });
    expect(activities[1]).toMatchObject({ paymentMethod: 'terminal', comment: null, createdAt: null });
    // An expense saved without a category shows as "other".
    expect(activities[3]).toMatchObject({ category: 'other', paymentMethod: 'cash', paymentSource: 'game_club' });
    expect(activities[5]).toMatchObject({ category: 'rent', paymentSource: 'bar' });
  });

  it('describes each exchange with numeric amounts and no rate between UZS methods', () => {
    const [moved, bought] = report.days[0].activities.filter((activity) => activity.kind === 'exchange');
    expect(moved).toEqual({
      id: 'x1', source: 'exchange', kind: 'exchange', category: null, amount: 0, paymentMethod: null, comment: null, createdAt: null,
      createdByName: 'Aziz', exchange: { from: 'cash', to: 'card', fromAmount: 200_000, toAmount: 200_000, rate: null },
    });
    expect(bought).toMatchObject({
      comment: 'Bought dollars', createdAt: `${DAY}T09:00:00Z`,
      exchange: { from: 'cash', to: 'usd', fromAmount: 640_000, toAmount: 50, rate: 12_800 },
    });
    expect(bought).not.toHaveProperty('createdByName');
  });

  it('shows only the exchanges under the exchange filter', () => {
    const filtered = buildFilteredMoneyReport([cashRow], expenses, debtPayments, 'exchange', [{ date: DAY, bar_income: 500_000 }], [], exchanges);
    expect(filtered.totalCollected).toBe(0);
    expect(filtered.gameClubExpenses).toBe(0);
    expect(filtered.barLeft).toBe(0);
    // Nothing was collected or spent, so moving money leaves nothing and loses nothing.
    expect(filtered.gameClubLeft).toBe(0);
    expect(filtered.usd).toBe(50);
    expect(filtered.days).toHaveLength(1);
    expect(filtered.days[0].activities.map((activity) => activity.kind)).toEqual(['exchange', 'exchange']);
    expect(filtered.days[0]).toMatchObject({ income: 0, expenses: 0, total: 0, cash: -840_000, card: 200_000 });
  });

  it('keeps one category under an expense category filter, whichever money paid it', () => {
    const filtered = buildFilteredMoneyReport([cashRow], [...expenses, expense('e5', 40_000, { category: 'internet' })], debtPayments, 'expense:rent');
    expect(filtered.totalCollected).toBe(0);
    // e2 has no amount; the Bar rent of 70 000 is kept apart.
    expect(filtered.gameClubExpenses).toBe(0);
    expect(filtered.barExpenses).toBe(70_000);
    expect(filtered.days[0].activities.map((activity) => activity.id)).toEqual(['e2', 'e4']);
  });
});

describe('expenses paid from the club dollars', () => {
  const dollarExpense = expense('e3', 256_000, { payment_method: 'usd', usd_amount: '20', usd_rate: '12800' });
  const report = buildMoneyReport(
    [cashRow],
    [expense('e1', 300_000), dollarExpense],
    [],
    [],
    [],
    [exchange('x2', { to_method: 'usd', from_amount: 640_000, to_amount: 50, rate: 12_800 })],
  );

  it('lowers the dollars held and no UZS method', () => {
    // 50 bought - 20 spent.
    expect(report.usd).toBe(30);
    expect(report.paymentMethods.cash).toMatchObject({ collected: 2_000_000, expenses: 300_000, left: 1_060_000 });
    for (const method of ['terminal', 'card', 'playstation'] as const) {
      expect(report.paymentMethods[method]).toMatchObject({ expenses: 0, left: 0 });
    }
  });

  it('counts the expense in sums in the Game Club expense totals', () => {
    expect(report.gameClubExpenses).toBe(556_000);
    expect(report.days[0]).toMatchObject({ expenses: 556_000, gameClubExpenses: 556_000, barExpenses: 0 });
  });

  it('shows the dollars and rate on the activity', () => {
    const activity = report.days[0].activities.find((item) => item.id === 'e3');
    expect(activity).toMatchObject({ kind: 'expense', amount: -256_000, paymentMethod: 'usd', dollars: { amount: 20, rate: 12_800 } });
  });

  it('shows no dollars for a dollar expense read without them, or for a UZS expense', () => {
    const rows = [
      expense('e6', 256_000, { payment_method: 'usd' }),
      expense('e7', 256_000, { payment_method: 'usd', usd_amount: 20, usd_rate: null }),
      expense('e8', 100_000, { payment_method: 'cash', usd_amount: 20, usd_rate: 12_800 }),
    ];
    for (const activity of buildMoneyReport([], rows).days[0].activities) expect(activity).not.toHaveProperty('dollars');
  });

  it('takes a dollar expense out of Game Club money left, like the dashboard does', () => {
    const report = buildMoneyReport(
      [cashRow],
      [
        expense('e9', 300_000, { payment_method: 'cash' }),
        expense('e10', 256_000, { payment_method: 'usd', usd_amount: 20, usd_rate: 12_800 }),
      ],
      [],
      [],
      [],
      [exchange('x9', { from_method: 'cash', to_method: 'usd', from_amount: 640_000, to_amount: 50, rate: 12_800 })],
    );

    expect(report.gameClubExpenses).toBe(556_000);
    // Cash holds 2 000 000 − 300 000 − 640 000 sent into dollars; the dollar expense never touches it.
    expect(report.paymentMethods.cash.left).toBe(1_060_000);
    expect(report.usd).toBe(30);
    // Buying dollars is not spending, spending them is: 2 000 000 − 300 000 − 256 000.
    expect(report.gameClubLeft).toBe(1_444_000);
    expect(report.days[0].total).toBe(1_444_000);
    expect(report.gameClubLeft).toBe(report.totalCollected - report.gameClubExpenses);
  });
});

describe('a day without cash takings', () => {
  it('still reports the other methods, a Bar expense without an amount, and exchanges in the order made', () => {
    const report = buildMoneyReport(
      [{ id: 'c', date: DAY, cash_income: null as never, terminal_income: 90_000, card_income: 10_000, playstation_income: 5_000 }],
      [expense('e1', null, { payment_source: 'bar' })],
      [],
      [{ date: DAY, bar_income: 60_000 }],
      [{ date: DAY, quantity: 2, cost_price: 5_000 }],
      [
        exchange('late', { created_at: `${DAY}T18:00:00Z`, from_method: 'terminal', to_method: 'cash', from_amount: 20_000, to_amount: 20_000 }),
        exchange('untimed', { from_method: 'card', to_method: 'cash', from_amount: 10_000, to_amount: 10_000 }),
        exchange('early', { created_at: `${DAY}T08:00:00Z`, from_method: 'terminal', to_method: 'card', from_amount: 5_000, to_amount: 5_000 }),
      ],
    );

    expect(report.totalCollected).toBe(105_000);
    expect(report.paymentMethods.cash).toEqual({ collected: 0, expenses: 0, exchanged: 30_000, exchangedIn: 30_000, exchangedOut: 0, left: 30_000 });
    expect(report.paymentMethods.terminal.left).toBe(65_000);
    expect(report.paymentMethods.card.left).toBe(5_000);
    expect(report.paymentMethods.playstation.left).toBe(5_000);
    expect(report.gameClubLeft).toBe(105_000);
    expect(report.barExpenses).toBe(0);
    // Bar cash left: 60 000 sales - 10 000 stock bought.
    expect(report.barLeft).toBe(50_000);
    const [day] = report.days;
    expect(day).toMatchObject({ income: 105_000, barExpenses: 0, gameClubExpenses: 0, total: 105_000 });
    expect(day.activities[0].paymentBreakdown).toEqual({ cash: 0, terminal: 90_000, card: 10_000, playstation: 5_000 });
    expect(day.activities.filter((activity) => activity.kind === 'exchange').map((activity) => activity.id)).toEqual(['untimed', 'early', 'late']);
  });
});

describe('expensesFromSource', () => {
  const rows = [expense('e1', 1), expense('e2', 2, { payment_source: 'bar' }), expense('e3', 3, { payment_source: null })];

  it('treats an expense without a source as Game Club money', () => {
    expect(expensesFromSource(rows, 'game_club').map((row) => row.id)).toEqual(['e1', 'e3']);
    expect(expensesFromSource(rows, 'bar').map((row) => row.id)).toEqual(['e2']);
  });

  it('returns every expense without a source filter', () => {
    expect(expensesFromSource(rows)).toBe(rows);
    expect(expensesFromSource(rows, null)).toBe(rows);
  });
});

describe('game-club money detail rows', () => {
  const cashRows = [
    { date: '2026-07-03', cash_income: 500_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
  ];
  const expenseRows = [
    { date: '2026-07-04', amount: 120_000, category: 'rent', payment_method: 'cash', payment_source: 'game_club' as const, comment: 'July rent' },
    { date: '2026-07-04', amount: 30_000, category: '', comment: null },
    { date: '2026-07-06', amount: 999_000, category: 'bar-fridge', payment_source: 'bar' as const, comment: null },
  ];
  const debtPaymentRows = [{ date: '2026-07-05', amount: 80_000 }, { date: '2026-07-05', amount: null as never, payment_method: null }];

  it('shows only the methods the club enabled, plus PlayStation and debt payments', () => {
    const rows = buildGameClubMoneyDetailRows(cashRows, debtPaymentRows, expenseRows, ['cash', 'terminal']);
    expect(rows[0]).toEqual({
      date: '2026-07-03',
      // Card is not enabled and collected nothing: it is not listed. Terminal is enabled, so its zero shows.
      collected: [
        { key: 'cash', amount: 500_000 },
        { key: 'terminal', amount: 0 },
        { key: 'playstation', amount: 0 },
        { key: 'debtPayments', amount: 0 },
      ],
      collectedTotal: 500_000, deductions: [], deductionsTotal: 0, moneyLeft: 500_000,
    });
  });

  it('still lists a method outside the enabled subset when money was collected through it', () => {
    const rows = buildGameClubMoneyDetailRows(
      [{ date: '2026-07-03', cash_income: 0, terminal_income: 0, card_income: 45_000, playstation_income: 0 }], [], [], ['cash'],
    );
    expect(rows[0].collected).toEqual([
      { key: 'cash', amount: 0 },
      { key: 'card', amount: 45_000 },
      { key: 'playstation', amount: 0 },
      { key: 'debtPayments', amount: 0 },
    ]);
  });

  it('builds days that only have expenses or only debt payments, oldest first', () => {
    const rows = buildGameClubMoneyDetailRows(cashRows, debtPaymentRows, expenseRows, ['cash']);
    expect(rows.map((row) => row.date)).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
    expect(rows[1]).toEqual({
      date: '2026-07-04',
      collected: [{ key: 'cash', amount: 0 }, { key: 'playstation', amount: 0 }, { key: 'debtPayments', amount: 0 }],
      collectedTotal: 0,
      deductions: [
        { kind: 'expense', category: 'rent', comment: 'July rent', amount: 120_000 },
        { kind: 'expense', category: 'other', comment: null, amount: 30_000 },
      ],
      deductionsTotal: 150_000,
      moneyLeft: -150_000,
    });
    expect(rows[2]).toMatchObject({ collectedTotal: 80_000, deductionsTotal: 0, moneyLeft: 80_000 });
    expect(rows[2].collected).toContainEqual({ key: 'debtPayments', amount: 80_000 });
  });

  it('adds up to collected minus Game Club expenses; the Bar-paid expense is not on this page', () => {
    const rows = buildGameClubMoneyDetailRows(cashRows, debtPaymentRows, expenseRows, ['cash']);
    for (const row of rows) expect(row.moneyLeft).toBe(row.collectedTotal - row.deductionsTotal);
    // 500 000 + 80 000 collected - 150 000 spent.
    expect(rows.reduce((sum, row) => sum + row.moneyLeft, 0)).toBe(430_000);
  });
});

describe('bar money detail rows', () => {
  const stockRows = [{ date: '2026-07-05', bar_income: 400_000 }];
  const purchaseRows = [
    { date: '2026-07-01', quantity: 10, cost_price: 12_000, comment: null, product_name: 'Before the cutoff' },
    { date: '2026-07-05', quantity: 5, cost_price: 9_000, comment: 'ignored when the product has a name', product_name: 'Cola' },
    { date: '2026-07-05', quantity: 2, cost_price: 10_000, comment: 'Snacks box', product_name: null },
    { date: '2026-07-05', quantity: null as never, cost_price: 5_000, comment: null },
  ];
  const expenseRows = [
    { date: '2026-07-05', amount: 30_000, category: 'cleaning', payment_source: 'bar' as const, comment: 'Mop' },
    { date: '2026-07-06', amount: 10_000, category: 'other', payment_source: 'bar' as const, comment: null },
    { date: '2026-07-06', amount: null as never, category: 'other', payment_source: 'bar' as const, comment: null },
    { date: '2026-07-07', amount: 888_000, category: 'rent', payment_source: 'game_club' as const, comment: null },
  ];
  const rows = buildBarMoneyDetailRows(stockRows, purchaseRows, expenseRows);

  it('creates no day for a purchase before the deduction date or for a Game Club expense', () => {
    expect(rows.map((row) => row.date)).toEqual(['2026-07-05', '2026-07-06']);
  });

  it('names a purchase by its product, then its comment, and deducts purchases and Bar expenses from sales', () => {
    expect(rows[0]).toEqual({
      date: '2026-07-05',
      collected: [{ key: 'barSales', amount: 400_000 }],
      collectedTotal: 400_000,
      deductions: [
        { kind: 'purchase', name: 'Cola', quantity: 5, amount: 45_000 },
        { kind: 'purchase', name: 'Snacks box', quantity: 2, amount: 20_000 },
        { kind: 'purchase', name: null, quantity: 0, amount: 0 },
        { kind: 'expense', category: 'cleaning', comment: 'Mop', amount: 30_000 },
      ],
      // Cash left, not accounting profit: 400 000 - 65 000 stock bought - 30 000 expense.
      deductionsTotal: 95_000,
      moneyLeft: 305_000,
    });
  });

  it('shows a day with only a Bar expense as money out', () => {
    expect(rows[1]).toEqual({
      date: '2026-07-06',
      collected: [{ key: 'barSales', amount: 0 }],
      collectedTotal: 0,
      deductions: [
        { kind: 'expense', category: 'other', comment: null, amount: 10_000 },
        { kind: 'expense', category: 'other', comment: null, amount: 0 },
      ],
      deductionsTotal: 10_000,
      moneyLeft: -10_000,
    });
  });
});

describe('expense helpers', () => {
  const entry = (id: string, amount: number | null, category: string, method: string, date = '2026-10-05'): ExpenseEntry => ({
    id, date, amount: amount as number, category, payment_method: method, comment: null,
  });
  const rows = [
    entry('a', 300, 'rent', 'cash'),
    entry('b', 200, 'rent', 'card'),
    entry('c', null, 'other', 'cash'),
    entry('d', 50, 'other', 'usd', '2026-10-06'),
  ];

  it('reads a missing amount as zero in every total', () => {
    expect(calculateTotalExpenses(rows)).toBe(550);
    expect(expensesByCategory(rows)).toEqual({ rent: 500, other: 50 });
    expect(expensesByPaymentMethod(rows)).toEqual({ cash: 300, card: 200, usd: 50 });
    expect(expensesByCategory([entry('c', null, 'other', 'cash')])).toEqual({ other: 0 });
    expect(expensesByPaymentMethod([entry('c', null, 'other', 'cash')])).toEqual({ cash: 0 });
  });

  it('filters by exact date and category', () => {
    expect(filterExpensesByDate(rows, '2026-10-06').map((row) => row.id)).toEqual(['d']);
    expect(filterExpensesByCategory(rows, 'rent').map((row) => row.id)).toEqual(['a', 'b']);
    expect(calculateTotalExpenses([])).toBe(0);
  });
});
