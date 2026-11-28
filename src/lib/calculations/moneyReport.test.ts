import { describe, expect, it } from 'vitest';
import {
  buildFilteredMoneyReport,
  buildMoneyReport,
  dollarsHeldAtPeriodEnd,
  earlierDaysRange,
  expensesFromSource,
  moneyLeftByMethod,
  openingBalanceSpan,
  periodOwnLeft,
  openingBalanceTotal,
  withOpeningBalances,
} from './moneyReport';

describe('money report', () => {
  it('carries resolved creator names into report activities', () => {
    const report = buildMoneyReport(
      [{
        date: '2026-08-25',
        cash_income: 100,
        terminal_income: 0,
        card_income: 0,
        creator_name: 'Cash Admin',
      }],
      [{
        id: 'expense',
        date: '2026-08-25',
        amount: 40,
        category: 'rent',
        payment_method: 'cash',
        payment_source: 'game_club',
        comment: null,
        created_at: '2026-08-25T10:00:00Z',
        creator_name: 'Expense Admin',
      }],
    );

    expect(report.days[0].activities.map((activity) => activity.createdByName)).toEqual([
      'Cash Admin',
      'Expense Admin',
    ]);
  });

  it('shows collected, expenses, and money left by payment method', () => {
    const report = buildMoneyReport(
      [
        {
          date: '2026-08-25',
          cash_income: 1_000_000,
          terminal_income: 2_000_000,
          card_income: 300_000,
          playstation_income: 200_000,
        },
      ],
      [
        {
          id: 'cash-expense',
          date: '2026-08-25',
          amount: 150_000,
          category: 'other',
          payment_method: 'cash',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-08-25T10:00:00Z',
        },
        {
          id: 'terminal-expense',
          date: '2026-08-25',
          amount: 250_000,
          category: 'other',
          payment_method: 'terminal',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-08-25T11:00:00Z',
        },
        {
          id: 'bar-expense',
          date: '2026-08-25',
          amount: 900_000,
          category: 'other',
          payment_method: 'cash',
          payment_source: 'bar',
          comment: null,
          created_at: '2026-08-25T12:00:00Z',
        },
      ],
      [{ date: '2026-08-25', amount: 50_000, payment_method: 'card' }],
    );

    expect(report.paymentMethods.cash).toEqual({
      opening: 0,
      collected: 1_000_000,
      expenses: 150_000,
      exchanged: 0,
      exchangedIn: 0,
      exchangedOut: 0,
      left: 850_000,
    });
    expect(report.paymentMethods.terminal.left).toBe(1_750_000);
    expect(report.paymentMethods.card).toEqual({
      opening: 0,
      collected: 350_000,
      expenses: 0,
      exchanged: 0,
      exchangedIn: 0,
      exchangedOut: 0,
      left: 350_000,
    });
    expect(report.paymentMethods.playstation.left).toBe(200_000);
    expect(report.totalCollected).toBe(3_550_000);
    expect(report.gameClubExpenses).toBe(400_000);
    expect(report.barExpenses).toBe(900_000);
    expect(report.gameClubLeft).toBe(3_150_000);
    expect(report.barLeft).toBe(-900_000);
    expect(report.days).toEqual([
      {
        date: '2026-08-25',
        cash: 850_000,
        terminal: 1_750_000,
        card: 350_000,
        playstation: 200_000,
        total: 3_150_000,
        income: 3_550_000,
        expenses: 1_300_000,
        gameClubExpenses: 400_000,
        barExpenses: 900_000,
        activities: [
          {
            id: null,
            source: 'daily_cash',
            kind: 'income',
            category: null,
            amount: 3_500_000,
            paymentMethod: null,
            comment: null,
            createdAt: null,
            paymentBreakdown: {
              cash: 1_000_000,
              terminal: 2_000_000,
              card: 300_000,
              playstation: 200_000,
            },
          },
          {
            id: null,
            source: 'debt_payment',
            kind: 'debt_payment',
            category: null,
            amount: 50_000,
            paymentMethod: 'card',
            comment: null,
            createdAt: null,
          },
          {
            id: 'cash-expense',
            source: 'expense',
            kind: 'expense',
            category: 'other',
            amount: -150_000,
            paymentMethod: 'cash',
            paymentSource: 'game_club',
            comment: null,
            createdAt: '2026-08-25T10:00:00Z',
          },
          {
            id: 'terminal-expense',
            source: 'expense',
            kind: 'expense',
            category: 'other',
            amount: -250_000,
            paymentMethod: 'terminal',
            paymentSource: 'game_club',
            comment: null,
            createdAt: '2026-08-25T11:00:00Z',
          },
          {
            id: 'bar-expense',
            source: 'expense',
            kind: 'expense',
            category: 'other',
            amount: -900_000,
            paymentMethod: 'cash',
            paymentSource: 'bar',
            comment: null,
            createdAt: '2026-08-25T12:00:00Z',
          },
        ],
      },
    ]);
  });

  it('sorts daily closeouts newest first and includes expense-only dates', () => {
    const report = buildMoneyReport(
      [{ date: '2026-08-24', cash_income: 100, terminal_income: 0, card_income: 0 }],
      [{
        id: 'expense-only',
        date: '2026-08-25',
        amount: 40,
        category: 'other',
        payment_method: 'cash',
        payment_source: 'game_club',
        comment: null,
        created_at: '2026-08-25T10:00:00Z',
      }],
    );

    expect(report.days.map((day) => day.date)).toEqual(['2026-08-25', '2026-08-24']);
    expect(report.days[0].total).toBe(-40);
    expect(report.days[0].activities).toEqual([
      {
        id: 'expense-only',
        source: 'expense',
        kind: 'expense',
        category: 'other',
        amount: -40,
        paymentMethod: 'cash',
        paymentSource: 'game_club',
        comment: null,
        createdAt: '2026-08-25T10:00:00Z',
      },
    ]);
    expect(report.days[1].activities).toEqual([
      {
        id: null,
        source: 'daily_cash',
        kind: 'income',
        category: null,
        amount: 100,
        paymentMethod: null,
        comment: null,
        createdAt: null,
        paymentBreakdown: { cash: 100, terminal: 0, card: 0, playstation: 0 },
      },
    ]);
  });

  it('includes bar expenses in daily closeouts without deducting them from game-club balances', () => {
    const report = buildMoneyReport([], [{
      id: 'bar-expense',
      date: '2026-08-26',
      amount: 75_000,
      category: 'food_drinks',
      payment_method: 'cash',
      payment_source: 'bar',
      comment: 'Bar supplies',
      created_at: '2026-08-26T09:00:00Z',
    }]);

    expect(report.gameClubExpenses).toBe(0);
    expect(report.barExpenses).toBe(75_000);
    expect(report.gameClubLeft).toBe(0);
    expect(report.barLeft).toBe(-75_000);
    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({
      date: '2026-08-26',
      expenses: 75_000,
      total: 0,
    });
    expect(report.days[0].activities[0]).toMatchObject({
      id: 'bar-expense',
      paymentSource: 'bar',
      amount: -75_000,
    });
  });

  it('keeps bar cash left apart from game-club money left', () => {
    const report = buildMoneyReport(
      [{ date: '2026-08-26', cash_income: 1_000, terminal_income: 0, card_income: 0 }],
      [{
        id: 'bar-expense',
        date: '2026-08-26',
        amount: 100,
        category: 'food_drinks',
        payment_method: 'cash',
        payment_source: 'bar',
        comment: null,
        created_at: '2026-08-26T09:00:00Z',
      }],
      [],
      [{ date: '2026-08-26', bar_income: 800 }],
      [{ date: '2026-08-26', quantity: 2, cost_price: 150 }],
    );

    expect(report.barLeft).toBe(400);
    expect(report.gameClubLeft).toBe(1_000);
    expect(report.barExpenses).toBe(100);
    expect(report.gameClubExpenses).toBe(0);
  });

  it('leaves purchases the reserve paid out of game-club expenses, so collected minus expenses is money left', () => {
    const expense = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id, date: '2026-11-11', amount, category: 'investments', payment_method: 'cash', payment_source: 'game_club' as const,
      comment: null, created_at: `2026-11-11T09:0${id.length}:00Z`, ...extra,
    });
    const report = buildMoneyReport(
      [{ date: '2026-11-11', cash_income: 7_288_000, terminal_income: 0, card_income: 0 }],
      [
        expense('salary', 5_135_000, { category: 'salary' }),
        expense('pc', 7_200_000, { paid_from_reserve: true }),
        expense('usd', 100, { payment_method: 'usd' }),
      ],
    );

    expect(report.paymentMethods.cash.expenses).toBe(5_135_000);
    expect(report.gameClubExpenses).toBe(5_135_000);
    expect(report.gameClubLeft).toBe(report.totalCollected - report.gameClubExpenses);
    expect(report.days[0].gameClubExpenses).toBe(5_135_000);
    expect(report.days[0].total).toBe(report.days[0].income - report.days[0].gameClubExpenses);
  });

  it('filters the complete report by activity and expense category', () => {
    const cashRows = [
      { date: '2026-08-25', cash_income: 1_000, terminal_income: 0, card_income: 0 },
    ];
    const expenseRows = [
      {
        id: 'rent',
        date: '2026-08-25',
        amount: 300,
        category: 'rent',
        payment_method: 'cash',
        payment_source: 'game_club' as const,
        comment: null,
        created_at: '2026-08-25T10:00:00Z',
      },
      {
        id: 'salary',
        date: '2026-08-25',
        amount: 200,
        category: 'salary',
        payment_method: 'cash',
        payment_source: 'game_club' as const,
        comment: null,
        created_at: '2026-08-25T11:00:00Z',
      },
    ];
    const debtRows = [{ date: '2026-08-25', amount: 100, payment_method: 'card' }];

    const income = buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'income');
    expect(income.totalCollected).toBe(1_000);
    expect(income.gameClubExpenses).toBe(0);
    expect(income.barExpenses).toBe(0);
    expect(income.days[0].activities.map((activity) => activity.kind)).toEqual(['income']);

    // Money in lists exactly the rows behind the unfiltered "total collected".
    const moneyIn = buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'money_in');
    expect(moneyIn.totalCollected).toBe(buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'all').totalCollected);
    expect(moneyIn.totalCollected).toBe(1_100);
    expect(moneyIn.gameClubExpenses).toBe(0);
    expect(moneyIn.days[0].activities.map((activity) => activity.kind).sort()).toEqual(['debt_payment', 'income']);

    const expenses = buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'expense');
    expect(expenses.totalCollected).toBe(0);
    expect(expenses.gameClubExpenses).toBe(500);
    expect(expenses.barExpenses).toBe(0);
    expect(expenses.days[0].activities).toHaveLength(2);

    const rent = buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'expense:rent');
    expect(rent.gameClubExpenses).toBe(300);
    expect(rent.days[0].activities.map((activity) => activity.category)).toEqual(['rent']);

    const debtPayments = buildFilteredMoneyReport(cashRows, expenseRows, debtRows, 'debt_payment');
    expect(debtPayments.totalCollected).toBe(100);
    expect(debtPayments.days[0].activities.map((activity) => activity.kind)).toEqual(['debt_payment']);
  });
});

it.each(['all','expense','expense:salary'] as const)('counts salary payments from both sources for %s without double-deducting cash', (filter) => {
  const rows = [
    {id:'bar',date:'2026-09-26',amount:100000,category:'salary',payment_method:'cash',payment_source:'bar' as const,comment:null,created_at:'2026-09-26T10:00:00Z'},
    {id:'club',date:'2026-09-26',amount:50000,category:'salary',payment_method:'cash',payment_source:'game_club' as const,comment:null,created_at:'2026-09-26T10:00:00Z'},
  ];
  const report=buildFilteredMoneyReport([],rows,[],filter);
  expect(report.gameClubExpenses).toBe(50000);
  expect(report.barExpenses).toBe(100000);
  expect(report.days[0].expenses).toBe(150000);
  expect(report.paymentMethods.cash.expenses).toBe(50000);
  expect(report.gameClubLeft).toBe(-50000);
  expect(report.barLeft).toBe(-100000);
});

it('splits a day header expenses so income minus game-club expenses equals the day total', () => {
  const report = buildMoneyReport(
    [{ date: '2026-09-26', cash_income: 300_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
    [
      { id: 'bar', date: '2026-09-26', amount: 100_000, category: 'other', payment_method: 'cash', payment_source: 'bar', comment: null, created_at: '2026-09-26T10:00:00Z' },
      { id: 'club', date: '2026-09-26', amount: 50_000, category: 'other', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '2026-09-26T11:00:00Z' },
    ],
  );
  const [day] = report.days;
  expect(day).toMatchObject({ income: 300_000, expenses: 150_000, gameClubExpenses: 50_000, barExpenses: 100_000, total: 250_000 });
  expect(day.income - day.gameClubExpenses).toBe(day.total);
});

describe('expensesFromSource', () => {
  const rows = [
    { id: 'club', payment_source: 'game_club' as const },
    { id: 'unmarked', payment_source: null },
    { id: 'bar', payment_source: 'bar' as const },
  ];

  it('keeps only the side a money-flow link came from; unmarked rows are game club money', () => {
    expect(expensesFromSource(rows, 'bar').map((row) => row.id)).toEqual(['bar']);
    expect(expensesFromSource(rows, 'game_club').map((row) => row.id)).toEqual(['club', 'unmarked']);
    expect(expensesFromSource(rows, null)).toBe(rows);
  });

  it('moves money between methods and into dollars without changing collections', () => {
    const report = buildMoneyReport(
      [{ date: '2026-08-25', cash_income: 1_000_000, terminal_income: 500_000, card_income: 0, playstation_income: 0, created_at: '2026-08-25T10:00:00Z' }],
      [],
      [],
      [],
      [],
      [
        { id: 'x1', date: '2026-08-25', from_method: 'terminal', to_method: 'cash', from_amount: 200_000, to_amount: 200_000, rate: null, created_at: '2026-08-25T11:00:00Z' },
        { id: 'x2', date: '2026-08-25', from_method: 'cash', to_method: 'usd', from_amount: 640_000, to_amount: 50, rate: 12_800, created_at: '2026-08-25T12:00:00Z' },
      ],
    );

    expect(report.totalCollected).toBe(1_500_000);
    expect(report.paymentMethods.cash).toEqual({ opening: 0, collected: 1_000_000, expenses: 0, exchanged: -440_000, exchangedIn: 200_000, exchangedOut: 640_000, left: 560_000 });
    expect(report.paymentMethods.terminal).toEqual({ opening: 0, collected: 500_000, expenses: 0, exchanged: -200_000, exchangedIn: 0, exchangedOut: 200_000, left: 300_000 });
    expect(report.usd).toBe(50);
    // The $50 are the owner reserve's (143, 156): the 640 000 paid for them left Game Club money.
    expect(report.gameClubLeft).toBe(860_000);
    expect(report.days[0].total).toBe(860_000);
    const day = report.days[0];
    expect(day.income).toBe(1_500_000);
    expect(day.expenses).toBe(0);
    expect(day.activities.filter((activity) => activity.kind === 'exchange').map((activity) => activity.exchange)).toEqual([
      { from: 'terminal', to: 'cash', fromAmount: 200_000, toAmount: 200_000, rate: null },
      { from: 'cash', to: 'usd', fromAmount: 640_000, toAmount: 50, rate: 12_800 },
    ]);
  });
});

describe('opening balances', () => {
  it('needs nothing when the period starts on the 1st of its last month', () => {
    expect(openingBalanceSpan({ from: '2026-11-01', to: '2026-11-30' })).toBeNull();
    expect(openingBalanceSpan({ from: '2026-11-01', to: '2026-11-01' })).toBeNull();
    expect(openingBalanceSpan({ from: 'not a date', to: '2026-11-30' })).toBeNull();
    expect(openingBalanceSpan({ from: '2026-11-20', to: '2026-11-10' })).toBeNull();
  });

  it('adds the days of the month before a mid-month start', () => {
    expect(openingBalanceSpan({ from: '2026-11-11', to: '2026-11-30' })).toEqual({ kind: 'earlier', from: '2026-11-01', to: '2026-11-10' });
    expect(openingBalanceSpan({ from: '2026-11-02', to: '2026-11-02' })).toEqual({ kind: 'earlier', from: '2026-11-01', to: '2026-11-01' });
  });

  it('takes off the period\'s days before the 1st of its last month when it crosses months', () => {
    expect(openingBalanceSpan({ from: '2026-10-12', to: '2026-11-30' })).toEqual({ kind: 'reset', from: '2026-10-12', to: '2026-10-31' });
    expect(openingBalanceSpan({ from: '2026-09-01', to: '2026-11-05' })).toEqual({ kind: 'reset', from: '2026-09-01', to: '2026-10-31' });
    expect(openingBalanceSpan({ from: '2026-12-20', to: '2027-01-10' })).toEqual({ kind: 'reset', from: '2026-12-20', to: '2026-12-31' });
    expect(openingBalanceSpan({ from: '2028-02-10', to: '2028-03-04' })).toEqual({ kind: 'reset', from: '2028-02-10', to: '2028-02-29' });
  });

  it('makes a cross-month period\'s cards the last month\'s own balance', () => {
    const cash = (date: string, amount: number) => ({ date, cash_income: amount, terminal_income: 0, card_income: 0, playstation_income: 0 });
    const expense = (id: string, date: string, amount: number) => ({ id, date, amount, category: 'supplies', payment_method: 'cash', comment: '', created_at: `${date}T10:00:00Z` });
    const october = { cash: [cash('2026-10-12', 900_000), cash('2026-10-20', 300_000)], expenses: [expense('e1', '2026-10-25', 200_000)] };
    const november = { cash: [cash('2026-11-03', 500_000)], expenses: [expense('e2', '2026-11-04', 150_000)] };
    // The whole range, 12 Oct - 30 Nov, as Reports reads it.
    const period = buildMoneyReport([...october.cash, ...november.cash], [...october.expenses, ...november.expenses]);
    const span = openingBalanceSpan({ from: '2026-10-12', to: '2026-11-30' });
    expect(span?.kind).toBe('reset');
    const spanFlows = buildMoneyReport(october.cash, october.expenses).paymentMethods;
    const cards = withOpeningBalances(period.paymentMethods, { kind: 'reset', methods: spanFlows });

    expect(cards.cash).toMatchObject({ opening: -1_000_000, collected: 1_700_000, expenses: 350_000, left: 350_000 });
    expect(cards.cash.left).toBe(buildMoneyReport(november.cash, november.expenses).paymentMethods.cash.left);
    // The period's own flow, without the opening: 12 Oct - 30 Nov in full.
    expect(periodOwnLeft(cards.cash)).toBe(period.paymentMethods.cash.left);
    expect(periodOwnLeft(cards.cash)).toBe(1_350_000);
    // Methods without earlier-month money stay at +0, not -0.
    expect(Object.is(cards.terminal.opening, 0)).toBe(true);
    expect(openingBalanceTotal({ kind: 'reset', methods: spanFlows })).toBe(-1_000_000);
    const cardsTotal = Object.values(cards).reduce((sum, method) => sum + method.left, 0);
    expect(cardsTotal).toBe(period.gameClubLeft - 1_000_000);
  });

  it('keeps an exchange paid with money from earlier in the month from showing as negative', () => {
    // 1-10 Nov: cash collected and partly spent; 11 Nov: most of it goes into dollars.
    const opening = buildMoneyReport(
      [{ date: '2026-11-05', cash_income: 9_600_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
      [{ id: 'e1', date: '2026-11-06', amount: 1_128_000, category: 'salary', payment_method: 'cash', comment: '', created_at: '2026-11-06T10:00:00Z' }],
    ).paymentMethods;
    const period = buildMoneyReport(
      [{ date: '2026-11-12', cash_income: 7_288_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
      [{ id: 'e2', date: '2026-11-12', amount: 5_135_000, category: 'supplies', payment_method: 'cash', comment: '', created_at: '2026-11-12T10:00:00Z' }],
      [], [], [],
      [{ id: 'x1', date: '2026-11-11', from_method: 'cash', to_method: 'usd', from_amount: 7_200_000, to_amount: 600, rate: 12_000, comment: '', created_by: null, created_at: '2026-11-11T14:00:00Z' }],
    ).paymentMethods;
    expect(period.cash.left).toBe(-5_047_000);

    const cards = withOpeningBalances(period, { kind: 'earlier', methods: opening });
    expect(cards.cash).toMatchObject({ opening: 8_472_000, collected: 7_288_000, expenses: 5_135_000, exchangedOut: 7_200_000, left: 3_425_000 });
    expect(cards.terminal).toMatchObject({ opening: 0, left: 0 });
    expect(periodOwnLeft(cards.cash)).toBe(-5_047_000);
    expect(periodOwnLeft(period.cash)).toBe(period.cash.left);
    expect(withOpeningBalances(period, null)).toBe(period);
  });
});

describe('opening balance total', () => {
  it('is what the cards add from earlier in the month, so they sum to the headline plus it', () => {
    const opening = buildMoneyReport(
      [{ date: '2026-11-03', cash_income: 800_000, terminal_income: 300_000, card_income: 0, playstation_income: 50_000 }],
      [{ id: 'e1', date: '2026-11-04', amount: 200_000, category: 'supplies', payment_method: 'cash', comment: '', created_at: '2026-11-04T10:00:00Z' }],
    ).paymentMethods;
    const period = buildMoneyReport(
      [{ date: '2026-11-12', cash_income: 400_000, terminal_income: 0, card_income: 100_000, playstation_income: 0 }],
      [],
    );
    const cards = withOpeningBalances(period.paymentMethods, { kind: 'earlier', methods: opening });
    const cardsTotal = Object.values(cards).reduce((sum, method) => sum + method.left, 0);

    expect(openingBalanceTotal({ kind: 'earlier', methods: opening })).toBe(950_000);
    expect(cardsTotal).toBe(period.gameClubLeft + 950_000);
    expect(openingBalanceTotal(null)).toBeNull();
  });
});

describe('money left by method', () => {
  it('takes each method\'s money left', () => {
    const report = buildMoneyReport(
      [{ date: '2026-11-03', cash_income: 800_000, terminal_income: 300_000, card_income: 20_000, playstation_income: 50_000 }],
      [{ id: 'e1', date: '2026-11-04', amount: 200_000, category: 'supplies', payment_method: 'terminal', comment: '', created_at: '2026-11-04T10:00:00Z' }],
    );
    expect(moneyLeftByMethod(report.paymentMethods)).toEqual({ cash: 800_000, terminal: 100_000, card: 20_000, playstation: 50_000 });
  });
});

describe('dollars held at a period end', () => {
  const exchange = (id: string, date: string, from: 'cash' | 'usd', to: 'cash' | 'usd', fromAmount: number, toAmount: number) => ({
    id, date, from_method: from, to_method: to, from_amount: fromAmount, to_amount: toAmount, rate: 12_500, comment: '', created_by: null, created_at: `${date}T10:00:00Z`,
  });

  it('covers every day before the period from the ledger start', () => {
    expect(earlierDaysRange('2026-11-01')).toEqual({ from: '2000-01-01', to: '2026-10-31' });
    expect(earlierDaysRange('2026-03-01')).toEqual({ from: '2000-01-01', to: '2026-02-28' });
    expect(earlierDaysRange('2026-11-15')).toEqual({ from: '2000-01-01', to: '2026-11-14' });
    expect(earlierDaysRange('2000-01-01')).toBeNull();
    expect(earlierDaysRange('not a date')).toBeNull();
  });

  it('adds the period\'s movement to what earlier days left, so selling dollars bought earlier is not negative', () => {
    // October: $200 bought, $30 spent. November: $80 of it sold.
    const earlier = [exchange('x1', '2026-10-05', 'cash', 'usd', 2_500_000, 200)];
    const earlierSpent = [{ date: '2026-10-20', amount: 375_000, payment_method: 'usd', usd_amount: 30 }];
    const november = buildMoneyReport([], [], [], [], [], [exchange('x2', '2026-11-10', 'usd', 'cash', 80, 1_000_000)]);

    expect(november.usd).toBe(-80);
    expect(dollarsHeldAtPeriodEnd(earlier, earlierSpent, november.usd)).toBe(90);
    expect(dollarsHeldAtPeriodEnd([], [], 40.5)).toBe(40.5);
  });
});
