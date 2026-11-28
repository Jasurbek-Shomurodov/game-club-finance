import { isReservePaidExpense, reservedNetBy, type ReserveMove } from './reserveMoves';

export const STOCK_PURCHASE_DEDUCTION_START_DATE = '2026-07-02';

export interface BarSalesRow {
  bar_income: number;
}

export interface StockPurchaseCostRow {
  date: string;
  quantity: number;
  cost_price: number;
}

export interface BarMoneyResult {
  barSales: number;
  stockPurchaseCost: number;
  barMoney: number;
}

/** Bar sales of the given saved counts. */
export function sumBarSales(rows: BarSalesRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.bar_income ?? 0), 0);
}

export function sumStockPurchaseCost(rows: StockPurchaseCostRow[]): number {
  return rows.reduce(
    (sum, row) =>
      row.date >= STOCK_PURCHASE_DEDUCTION_START_DATE
        ? sum + Number(row.quantity ?? 0) * Number(row.cost_price ?? 0)
        : sum,
    0,
  );
}

export function calculateBarMoney(
  salesRows: BarSalesRow[],
  purchaseRows: StockPurchaseCostRow[],
): BarMoneyResult {
  const barSales = sumBarSales(salesRows);
  const stockPurchaseCost = sumStockPurchaseCost(purchaseRows);

  return {
    barSales,
    stockPurchaseCost,
    barMoney: barSales - stockPurchaseCost,
  };
}

/** An expense as bar money left reads it: who paid it, and whether the owner reserve did (136, 143). */
export interface BarMoneyLeftExpenseRow {
  amount: number | string;
  payment_source?: string | null;
  paid_from_reserve?: boolean | null;
  payment_method?: string | null;
}

/**
 * Bar money left (156), as the dashboard, Reports and bar money details count
 * it: bar money (sales minus stock purchases) minus the expenses the bar paid,
 * minus the bar's net deposits into the owner reserve. A bar purchase the
 * reserve paid takes nothing from the bar; it stays an expense in accounting
 * profit, which this does not touch.
 */
export function calculateBarMoneyLeft(
  barMoney: number,
  expenseRows: readonly BarMoneyLeftExpenseRow[],
  reserveMoves: readonly ReserveMove[] = [],
): number {
  const barPaid = expenseRows.reduce(
    (sum, row) => (row.payment_source === 'bar' && !isReservePaidExpense(row) ? sum + Number(row.amount ?? 0) : sum),
    0,
  );
  return barMoney - barPaid - reservedNetBy(reserveMoves, 'bar');
}
