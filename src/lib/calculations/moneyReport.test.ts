import { describe, expect, it } from 'vitest';
import { buildFilteredMoneyReport, buildMoneyReport, expensesFromSource } from './moneyReport';

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
      collected: 1_000_000,
      expenses: 150_000,
      left: 850_000,
    });
    expect(report.paymentMethods.terminal.left).toBe(1_750_000);
    expect(report.paymentMethods.card).toEqual({
      collected: 350_000,
      expenses: 0,
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
});
