import {
  calculateGameClubMoneyLeftByPaymentMethod,
  gameClubExpensePaymentBucket,
  type DailyCashRow,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type MoneyLeftByPaymentMethod,
} from './dashboardMetrics';
import {
  calculateBarMoney,
  type BarSalesRow,
  type StockPurchaseCostRow,
} from './barMoney';

export interface MoneyReportPaymentBreakdown {
  collected: number;
  expenses: number;
  left: number;
}

export interface MoneyReportActivity {
  id: string | null;
  source: 'daily_cash' | 'debt_payment' | 'expense';
  kind: 'income' | 'debt_payment' | 'expense';
  category: string | null;
  /** Positive values are collections; negative values are deductions. */
  amount: number;
  paymentMethod: string | null;
  paymentSource?: 'game_club' | 'bar' | null;
  comment: string | null;
  createdAt: string | null;
  createdByName?: string | null;
  paymentBreakdown?: {
    cash: number;
    terminal: number;
    card: number;
    playstation: number;
  };
}

export interface MoneyReportDay {
  date: string;
  cash: number;
  terminal: number;
  card: number;
  playstation: number;
  /** Game-club money left for the day: income minus `gameClubExpenses`. */
  total: number;
  income: number;
  /** Every expense recorded on the day, whichever money paid it. */
  expenses: number;
  /** Expenses paid from game-club money; the only ones deducted from `total`. */
  gameClubExpenses: number;
  /** Expenses paid from bar money; they reduce bar cash, not `total`. */
  barExpenses: number;
  activities: MoneyReportActivity[];
}

/** Game-club and bar money are separate businesses and are never added together. */
export interface MoneyReport {
  totalCollected: number;
  /** Expenses paid from game-club money. */
  gameClubExpenses: number;
  /** Expenses paid from bar money. */
  barExpenses: number;
  /** Game-club money collected minus game-club expenses. */
  gameClubLeft: number;
  barLeft: number;
  paymentMethods: Record<keyof MoneyLeftByPaymentMethod, MoneyReportPaymentBreakdown>;
  days: MoneyReportDay[];
}

export interface MoneyReportCashRow extends DailyCashRow {
  id?: string;
  comment?: string | null;
}

export interface MoneyReportDebtPaymentRow extends DebtPaymentValueRow {
  id?: string;
  comment?: string | null;
  created_at?: string;
}

export interface MoneyReportBarSalesRow extends BarSalesRow {
  date: string;
}

export type MoneyReportCategoryFilter =
  | 'all'
  | 'income'
  | 'debt_payment'
  | 'expense'
  | `expense:${string}`;

function buildPaymentMethods(
  cashRows: DailyCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: DebtPaymentValueRow[],
): MoneyReport['paymentMethods'] {
  const collected = cashRows.reduce(
    (totals, row) => {
      totals.cash += Number(row.cash_income ?? 0);
      totals.terminal += Number(row.terminal_income ?? 0);
      totals.card += Number(row.card_income ?? 0);
      totals.playstation += Number(row.playstation_income ?? 0);
      return totals;
    },
    { cash: 0, terminal: 0, card: 0, playstation: 0 },
  );

  debtPaymentRows.forEach((row) => {
    collected[gameClubExpensePaymentBucket(row.payment_method)] += Number(row.amount ?? 0);
  });

  const expenses = expenseRows.reduce(
    (totals, row) => {
      if (row.payment_source !== 'bar') {
        totals[gameClubExpensePaymentBucket(row.payment_method)] += Number(row.amount ?? 0);
      }
      return totals;
    },
    { cash: 0, terminal: 0, card: 0, playstation: 0 },
  );

  const left = calculateGameClubMoneyLeftByPaymentMethod(cashRows, expenseRows, debtPaymentRows);

  return {
    cash: { collected: collected.cash, expenses: expenses.cash, left: left.cash },
    terminal: { collected: collected.terminal, expenses: expenses.terminal, left: left.terminal },
    card: { collected: collected.card, expenses: expenses.card, left: left.card },
    playstation: {
      collected: collected.playstation,
      expenses: expenses.playstation,
      left: left.playstation,
    },
  };
}

function buildDailyActivities(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[],
): MoneyReportActivity[] {
  const activities: MoneyReportActivity[] = [];

  cashRows.forEach((row) => {
    const paymentBreakdown = {
      cash: Number(row.cash_income ?? 0),
      terminal: Number(row.terminal_income ?? 0),
      card: Number(row.card_income ?? 0),
      playstation: Number(row.playstation_income ?? 0),
    };
    activities.push({
      id: row.id ?? null,
      source: 'daily_cash',
      kind: 'income',
      category: null,
      amount: Object.values(paymentBreakdown).reduce((sum, amount) => sum + amount, 0),
      paymentMethod: null,
      comment: row.comment ?? null,
      createdAt: row.created_at ?? null,
      ...(row.creator_name !== undefined ? { createdByName: row.creator_name } : {}),
      paymentBreakdown,
    });
  });

  debtPaymentRows.forEach((row) => {
    activities.push({
      id: row.id ?? null,
      source: 'debt_payment',
      kind: 'debt_payment',
      category: null,
      amount: Number(row.amount ?? 0),
      paymentMethod: row.payment_method,
      comment: row.comment ?? null,
      createdAt: row.created_at ?? null,
    });
  });

  expenseRows
    .sort((rowA, rowB) => rowA.created_at.localeCompare(rowB.created_at))
    .forEach((row) => {
      activities.push({
        id: row.id,
        source: 'expense',
        kind: 'expense',
        category: row.category || 'other',
        amount: -Number(row.amount ?? 0),
        paymentMethod: row.payment_method ?? null,
        paymentSource: row.payment_source ?? null,
        comment: row.comment,
        createdAt: row.created_at,
        ...(row.creator_name !== undefined ? { createdByName: row.creator_name } : {}),
      });
    });

  return activities;
}

export function buildMoneyReport(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[] = [],
  barSalesRows: MoneyReportBarSalesRow[] = [],
  stockPurchaseRows: StockPurchaseCostRow[] = [],
): MoneyReport {
  const paymentMethods = buildPaymentMethods(cashRows, expenseRows, debtPaymentRows);
  const totalCollected = Object.values(paymentMethods)
    .reduce((sum, method) => sum + method.collected, 0);
  const gameClubLeft = Object.values(paymentMethods)
    .reduce((sum, method) => sum + method.left, 0);
  const barExpenses = expenseRows.reduce(
    (sum, row) => row.payment_source === 'bar' ? sum + Number(row.amount ?? 0) : sum,
    0,
  );
  const gameClubExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) - barExpenses;
  const barLeft = calculateBarMoney(barSalesRows, stockPurchaseRows).barMoney - barExpenses;
  const dates = Array.from(new Set([
    ...cashRows.map((row) => row.date),
    ...expenseRows.map((row) => row.date),
    ...debtPaymentRows.map((row) => row.date),
  ])).sort((a, b) => b.localeCompare(a));

  const cashByDate = new Map<string, MoneyReportCashRow[]>();
  const expensesByDate = new Map<string, ExpenseRow[]>();
  const debtPaymentsByDate = new Map<string, MoneyReportDebtPaymentRow[]>();
  for (const row of cashRows) {
    const rows = cashByDate.get(row.date) ?? [];
    rows.push(row);
    cashByDate.set(row.date, rows);
  }
  for (const row of expenseRows) {
    const rows = expensesByDate.get(row.date) ?? [];
    rows.push(row);
    expensesByDate.set(row.date, rows);
  }
  for (const row of debtPaymentRows) {
    const rows = debtPaymentsByDate.get(row.date) ?? [];
    rows.push(row);
    debtPaymentsByDate.set(row.date, rows);
  }

  const days = dates.map((date) => {
    const dayCashRows = cashByDate.get(date) ?? [];
    const dayExpenseRows = expensesByDate.get(date) ?? [];
    const dayDebtPaymentRows = debtPaymentsByDate.get(date) ?? [];
    const dayMethods = buildPaymentMethods(
      dayCashRows,
      dayExpenseRows,
      dayDebtPaymentRows,
    );
    const activities = buildDailyActivities(
      dayCashRows,
      dayExpenseRows,
      dayDebtPaymentRows,
    );
    const day = {
      date,
      cash: dayMethods.cash.left,
      terminal: dayMethods.terminal.left,
      card: dayMethods.card.left,
      playstation: dayMethods.playstation.left,
      total: Object.values(dayMethods).reduce((sum, method) => sum + method.left, 0),
      income: activities
        .filter((activity) => activity.amount > 0)
        .reduce((sum, activity) => sum + activity.amount, 0),
      expenses: activities
        .filter((activity) => activity.kind === 'expense')
        .reduce((sum, activity) => sum + Math.abs(activity.amount), 0),
      gameClubExpenses: dayExpenseRows
        .reduce((sum, row) => row.payment_source === 'bar' ? sum : sum + Number(row.amount ?? 0), 0),
      barExpenses: dayExpenseRows
        .reduce((sum, row) => row.payment_source === 'bar' ? sum + Number(row.amount ?? 0) : sum, 0),
      activities,
    };

    return day;
  });

  return { totalCollected, gameClubExpenses, barExpenses, gameClubLeft, barLeft, paymentMethods, days };
}

export function buildFilteredMoneyReport(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[] = [],
  categoryFilter: MoneyReportCategoryFilter = 'all',
  barSalesRows: MoneyReportBarSalesRow[] = [],
  stockPurchaseRows: StockPurchaseCostRow[] = [],
): MoneyReport {
  if (categoryFilter === 'income') {
    return buildMoneyReport(cashRows, [], []);
  }
  if (categoryFilter === 'debt_payment') {
    return buildMoneyReport([], [], debtPaymentRows);
  }
  if (categoryFilter === 'expense') {
    return buildMoneyReport([], expenseRows, []);
  }
  if (categoryFilter.startsWith('expense:')) {
    const category = categoryFilter.slice('expense:'.length);
    return buildMoneyReport(
      [],
      expenseRows.filter((row) => row.category === category),
      [],
    );
  }

  return buildMoneyReport(cashRows, expenseRows, debtPaymentRows, barSalesRows, stockPurchaseRows);
}
