import { calculateGameClubIncome } from './dailyCash';
import { calculateBarMoney } from './barMoney';
import type { BarSalesRow, StockPurchaseCostRow } from './barMoney';

export interface DailyCashEntry {
  cash_income: number;
  terminal_income: number;
  card_income: number;
  playstation_income?: number;
}

export interface FinancialReportStockRow extends BarSalesRow {
  bar_cost: number;
  /** Units sold; only the per-product rows of a day carry it. */
  sold_quantity?: number | null;
  /** Sales minus cost of the units sold; only the per-product rows of a day carry it. */
  bar_profit?: number | null;
}

export interface FinancialReportExpenseRow {
  amount: number;
  payment_source?: 'game_club' | 'bar' | null;
}

export interface FinancialReportInput {
  manualIncome: number;
  debtIncome?: number;
  stockRows: FinancialReportStockRow[];
  purchaseRows: StockPurchaseCostRow[];
  expenseRows: FinancialReportExpenseRow[];
}

export interface FinancialReportTotals {
  manualIncome: number;
  debtIncome: number;
  /** Everything the game club took in: the day's entered income plus debt income. */
  gameClubIncome: number;
  /** Units the bar sold, summed over the stock rows that carry a quantity. */
  barUnitsSold: number;
  /** Bar sales minus cost of goods, summed from the stock rows' own profit (before bar expenses). */
  barGrossProfit: number;
  /** Gross bar revenue recorded by closing stock. */
  barSales: number;
  /** Cost of the products sold during the report period. */
  barCost: number;
  /** Inventory cash outflow included in bar money from the configured cutoff date. */
  stockPurchaseCost: number;
  barExpenses: number;
  /** Expenses paid from game-club money. */
  gameClubExpenses: number;
  /** Bar cash left after inventory purchases and expenses paid by the bar. */
  barCashLeft: number;
  /**
   * The game club and the bar are separate businesses; their money is never
   * added together. Game club: collections plus new debts minus its expenses.
   */
  gameClubProfit: number;
  /** Bar: sales minus cost of goods sold and expenses paid by the bar. */
  barProfit: number;
}

/** Debt income of a period: the amounts of its debt rows, with a missing amount read as zero. */
export function sumDebtIncome(rows: ReadonlyArray<{ amount?: number | string | null }>): number {
  return rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

export function calculateManualIncome(entry: DailyCashEntry): number {
  return calculateGameClubIncome({
    cashIncome: entry.cash_income,
    terminalIncome: entry.terminal_income,
    cardIncome: entry.card_income,
    playstationIncome: entry.playstation_income ?? 0,
  });
}

/**
 * Uses the same game-club, bar and bar-cash definitions as the dashboard while
 * keeping those views separate. Inventory purchases affect bar cash left;
 * cost of goods sold affects accounting profit.
 */
export function calculateFinancialReportTotals({
  manualIncome,
  debtIncome = 0,
  stockRows,
  purchaseRows,
  expenseRows,
}: FinancialReportInput): FinancialReportTotals {
  const { barSales, stockPurchaseCost, barMoney } = calculateBarMoney(stockRows, purchaseRows);
  const barCost = stockRows.reduce((sum, row) => sum + Number(row.bar_cost ?? 0), 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const barExpenses = expenseRows.reduce(
    (sum, row) => row.payment_source === 'bar' ? sum + Number(row.amount ?? 0) : sum,
    0,
  );
  const gameClubExpenses = totalExpenses - barExpenses;

  return {
    manualIncome,
    debtIncome,
    gameClubIncome: manualIncome + debtIncome,
    barUnitsSold: stockRows.reduce((sum, row) => sum + Number(row.sold_quantity ?? 0), 0),
    barGrossProfit: stockRows.reduce((sum, row) => sum + Number(row.bar_profit ?? 0), 0),
    barSales,
    barCost,
    stockPurchaseCost,
    barExpenses,
    gameClubExpenses,
    barCashLeft: barMoney - barExpenses,
    gameClubProfit: manualIncome + debtIncome - gameClubExpenses,
    barProfit: barSales - barCost - barExpenses,
  };
}
