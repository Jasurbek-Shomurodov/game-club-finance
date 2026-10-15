// Per-day rows for /game-club-money-details and /bar-money-details. Every
// money figure comes from buildMoneyReport / calculateBarMoney, so the rows add
// up to the dashboard headline they explain by construction.

import {
  STOCK_PURCHASE_DEDUCTION_START_DATE,
  calculateBarMoney,
  sumStockPurchaseCost,
  type BarSalesRow,
  type StockPurchaseCostRow,
} from './barMoney';
import {
  isBarPaidExpense,
  sumGameClubRows,
  type DailyCashRow,
  type ExpenseRow,
} from './dashboardMetrics';
import { buildMoneyReport } from './moneyReport';

/** Collected-money buckets; translated at render time so language changes never refetch. */
export type MoneyDetailCollectedKey = 'barSales' | 'cash' | 'terminal' | 'card' | 'playstation' | 'debtPayments';

export type MoneyDetailLine =
  | {
      kind: 'purchase';
      /** Product name, or the purchase comment when the product is gone. */
      name: string | null;
      quantity: number;
      amount: number;
    }
  | {
      kind: 'expense';
      /** Stored expense category: a known category key or custom text. */
      category: string;
      comment: string | null;
      amount: number;
    };

export interface MoneyDetailRow {
  date: string;
  /** Positive contributions, shown on the left. */
  collected: Array<{ key: MoneyDetailCollectedKey; amount: number }>;
  collectedTotal: number;
  deductions: MoneyDetailLine[];
  deductionsTotal: number;
  moneyLeft: number;
}

export type MoneyDetailCashRow = DailyCashRow;

export interface MoneyDetailDebtPaymentRow {
  date: string;
  amount: number;
  /** Only splits money by method; the details rows show one combined total. */
  payment_method?: string | null;
}

/** An expense row as either the snapshot RPC or the migration-049 fallback returns it. */
export interface MoneyDetailExpenseRow {
  id?: string;
  date: string;
  amount: number;
  category: string;
  payment_method?: string | null;
  payment_source?: 'game_club' | 'bar' | null;
  comment: string | null;
  created_at?: string;
}

export interface MoneyDetailStockRow extends BarSalesRow {
  date: string;
}

export interface MoneyDetailPurchaseRow extends StockPurchaseCostRow {
  comment: string | null;
  product_name?: string | null;
}

export type MoneyDetailPaymentMethod = 'cash' | 'terminal' | 'card';

function groupByDate<T extends { date: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.date) ?? [];
    group.push(row);
    groups.set(row.date, group);
  }
  return groups;
}

function toReportExpenseRow(row: MoneyDetailExpenseRow, index: number): ExpenseRow {
  return {
    id: row.id ?? `${row.date}-${index}`,
    date: row.date,
    amount: row.amount,
    category: row.category,
    payment_method: row.payment_method ?? null,
    payment_source: row.payment_source ?? null,
    comment: row.comment,
    created_at: row.created_at ?? '',
  };
}

/**
 * One row per day with game-club collections (cash, terminal, card,
 * playstation and debt payments) against the expenses paid from game-club
 * money. `moneyLeft` is the money report's day total, so the rows sum to the
 * dashboard's game-club money left for the same range.
 */
export function buildGameClubMoneyDetailRows(
  cashRows: MoneyDetailCashRow[],
  debtPaymentRows: MoneyDetailDebtPaymentRow[],
  expenseRows: MoneyDetailExpenseRow[],
  enabledMethods: MoneyDetailPaymentMethod[],
): MoneyDetailRow[] {
  // Bar-paid expenses belong to the bar page; left in, they would create empty days here.
  const gameClubExpenseRows = expenseRows
    .filter((row) => !isBarPaidExpense(row))
    .map(toReportExpenseRow);
  const report = buildMoneyReport(
    cashRows,
    gameClubExpenseRows,
    debtPaymentRows.map((row) => ({ ...row, payment_method: row.payment_method ?? '' })),
  );
  const cashByDate = groupByDate(cashRows);
  const debtPaymentsByDate = groupByDate(debtPaymentRows);

  return [...report.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const income = sumGameClubRows(cashByDate.get(day.date) ?? []);
      const debtPayments = (debtPaymentsByDate.get(day.date) ?? [])
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      const collected = [
        { key: 'cash' as const, amount: income.cashIncome },
        { key: 'terminal' as const, amount: income.terminalIncome },
        { key: 'card' as const, amount: income.cardIncome },
        { key: 'playstation' as const, amount: income.playstationIncome },
        { key: 'debtPayments' as const, amount: debtPayments },
      ].filter((item) => (
        item.amount !== 0
        || item.key === 'playstation'
        || item.key === 'debtPayments'
        || enabledMethods.includes(item.key)
      ));
      const deductions: MoneyDetailLine[] = day.activities
        .filter((activity) => activity.kind === 'expense')
        .map((activity) => ({
          kind: 'expense',
          category: activity.category ?? 'other',
          comment: activity.comment,
          amount: Math.abs(activity.amount),
        }));

      return {
        date: day.date,
        collected,
        collectedTotal: day.income,
        deductions,
        deductionsTotal: day.gameClubExpenses,
        moneyLeft: day.total,
      };
    });
}

/**
 * One row per day with bar sales against qualifying stock purchases and
 * bar-paid expenses. `moneyLeft` follows `calculateBarMoney`, so the rows sum
 * to the dashboard's bar money left for the same range.
 */
export function buildBarMoneyDetailRows(
  stockRows: MoneyDetailStockRow[],
  purchaseRows: MoneyDetailPurchaseRow[],
  expenseRows: MoneyDetailExpenseRow[],
): MoneyDetailRow[] {
  const stockByDate = groupByDate(stockRows);
  // Purchases before the deduction start date never reduce bar money, so they
  // must not create an otherwise empty day either.
  const purchasesByDate = groupByDate(
    purchaseRows.filter((row) => row.date >= STOCK_PURCHASE_DEDUCTION_START_DATE),
  );
  const barExpensesByDate = groupByDate(expenseRows.filter(isBarPaidExpense));
  const dates = Array.from(new Set([
    ...stockByDate.keys(),
    ...purchasesByDate.keys(),
    ...barExpensesByDate.keys(),
  ])).sort((a, b) => a.localeCompare(b));

  return dates.map((date) => {
    const dayPurchases = purchasesByDate.get(date) ?? [];
    const dayExpenses = barExpensesByDate.get(date) ?? [];
    const barMoney = calculateBarMoney(stockByDate.get(date) ?? [], dayPurchases);
    const barExpenses = dayExpenses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const deductions: MoneyDetailLine[] = [
      ...dayPurchases.map((row): MoneyDetailLine => ({
        kind: 'purchase',
        name: row.product_name ?? row.comment ?? null,
        quantity: Number(row.quantity ?? 0),
        amount: sumStockPurchaseCost([row]),
      })),
      ...dayExpenses.map((row): MoneyDetailLine => ({
        kind: 'expense',
        category: row.category,
        comment: row.comment,
        amount: Number(row.amount ?? 0),
      })),
    ];

    return {
      date,
      collected: [{ key: 'barSales', amount: barMoney.barSales }],
      collectedTotal: barMoney.barSales,
      deductions,
      deductionsTotal: barMoney.stockPurchaseCost + barExpenses,
      moneyLeft: barMoney.barMoney - barExpenses,
    };
  });
}
