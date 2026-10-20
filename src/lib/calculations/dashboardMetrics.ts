import { calculateGameClubIncome } from './dailyCash';
import { calculateBarMoney } from './barMoney';
import type { StockPurchaseCostRow } from './barMoney';

export type { StockPurchaseCostRow } from './barMoney';

export type DashboardPeriod =
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'week'
  | 'lastWeek'
  | 'month'
  | 'lastMonth'
  | 'custom';

export interface DailyCashRow {
  date: string;
  cash_income: number;
  terminal_income: number;
  card_income: number;
  playstation_income?: number;
  created_at?: string;
  created_by?: string | null;
  creator_name?: string | null;
}

export interface StockCountRow {
  date: string;
  bar_income: number;
  bar_profit: number;
  bar_cost: number;
  sold_quantity: number;
  updated_at?: string;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  category: string;
  payment_method?: string | null;
  payment_source?: 'game_club' | 'bar' | null;
  comment: string | null;
  created_at: string;
  created_by?: string | null;
  creator_name?: string | null;
}

export interface ProductValueRow {
  current_stock: number;
  cost_price: number;
  tracks_inventory?: boolean;
}

export interface InventorySnapshotRow {
  product_id: string;
  date: string;
  closing_stock: number;
  cost_price: number;
  products?: { tracks_inventory?: boolean } | { tracks_inventory?: boolean }[] | null;
}

export interface DebtValueRow {
  date?: string;
  amount?: number;
  remaining_amount: number;
  status: string;
}

export interface DebtPaymentValueRow {
  date: string;
  amount: number;
  payment_method: string;
}

export interface DashboardTotals {
  cashIncome: number;
  terminalIncome: number;
  cardIncome: number;
  debtIncome: number;
  debtPaymentsCollected: number;
  playstationIncome: number;
  computerIncome: number;
  gameClubIncome: number;
  barSales: number;
  barCost: number;
  stockPurchaseCost: number;
  /** Accounting profit: sales minus cost of goods sold and bar-paid expenses. */
  barProfit: number;
  /** Cash left in the bar: sales minus inventory purchases and bar-paid expenses. */
  barIncome: number;
  /** Every expense, whichever money paid it; for category breakdowns only. */
  totalExpenses: number;
  gameClubExpenses: number;
  barExpenses: number;
  gameClubMoneyLeft: number;
  /**
   * Game club result: collections plus new debts minus game-club-paid expenses.
   * The game club and the bar are separate businesses, so there is no combined
   * income or profit; see barProfit for the bar's result.
   */
  gameClubProfit: number;
  inventoryValue: number;
  activeDebts: number;
  activeDebtCount: number;
}

/** One day of each side's money in; the game club and the bar are never added together. */
export interface TrendRow {
  date: string;
  gameClubIncome: number;
  barSales: number;
}

export interface MoneyLeftByPaymentMethod {
  cash: number;
  terminal: number;
  card: number;
  playstation: number;
}

export const emptyMoneyLeftByPaymentMethod: MoneyLeftByPaymentMethod = {
  cash: 0,
  terminal: 0,
  card: 0,
  playstation: 0,
};

export const emptyDashboardTotals: DashboardTotals = {
  cashIncome: 0,
  terminalIncome: 0,
  cardIncome: 0,
  debtIncome: 0,
  debtPaymentsCollected: 0,
  playstationIncome: 0,
  computerIncome: 0,
  gameClubIncome: 0,
  barSales: 0,
  barCost: 0,
  stockPurchaseCost: 0,
  barProfit: 0,
  barIncome: 0,
  totalExpenses: 0,
  gameClubExpenses: 0,
  barExpenses: 0,
  gameClubMoneyLeft: 0,
  gameClubProfit: 0,
  inventoryValue: 0,
  activeDebts: 0,
  activeDebtCount: 0,
};

export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getDashboardRange(
  period: DashboardPeriod,
  selectedDate: string,
  customRange?: { from: string; to: string },
): { from: string; to: string } {
  const base = parseLocalIsoDate(selectedDate);

  if (period === 'today') {
    return { from: selectedDate, to: selectedDate };
  }

  if (period === 'yesterday') {
    const yesterday = localIsoDate(addDays(base, -1));
    return { from: yesterday, to: yesterday };
  }

  if (period === 'last7Days') {
    return { from: localIsoDate(addDays(base, -6)), to: selectedDate };
  }

  if (period === 'week') {
    const day = base.getDay() || 7;
    const monday = addDays(base, 1 - day);
    const sunday = addDays(monday, 6);
    return { from: localIsoDate(monday), to: localIsoDate(sunday) };
  }

  if (period === 'lastWeek') {
    const day = base.getDay() || 7;
    const thisMonday = addDays(base, 1 - day);
    const lastMonday = addDays(thisMonday, -7);
    const lastSunday = addDays(lastMonday, 6);
    return { from: localIsoDate(lastMonday), to: localIsoDate(lastSunday) };
  }

  if (period === 'lastMonth') {
    const monthStart = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const monthEnd = new Date(base.getFullYear(), base.getMonth(), 0);
    return { from: localIsoDate(monthStart), to: localIsoDate(monthEnd) };
  }

  if (period === 'custom' && customRange?.from && customRange?.to) {
    return customRange.from <= customRange.to
      ? customRange
      : { from: customRange.to, to: customRange.from };
  }

  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: localIsoDate(monthStart), to: localIsoDate(monthEnd) };
}

export function getPreviousDashboardRange(range: {
  from: string;
  to: string;
}): { from: string; to: string } {
  const from = parseLocalIsoDate(range.from);
  const to = parseLocalIsoDate(range.to);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, 1 - days);
  return { from: localIsoDate(previousFrom), to: localIsoDate(previousTo) };
}

/**
 * The period a range is compared against. A range that is still in progress
 * (it contains the business today but ends later) is compared with the same
 * number of elapsed days, so month-to-date is not measured against a whole
 * month: 1–14 October compares with 1–14 September. The previous month's end
 * clamps the day, so 31 March compares with 1–28/29 February. Completed
 * ranges, such as last month, compare in full.
 */
export function getDashboardComparisonRange(
  period: DashboardPeriod,
  range: { from: string; to: string },
  businessToday: string,
): { from: string; to: string } {
  const inProgressTo = businessToday >= range.from && businessToday < range.to ? businessToday : null;

  if (period === 'month' || period === 'lastMonth') {
    const currentMonthStart = parseLocalIsoDate(range.from);
    const previousMonthStart = new Date(
      currentMonthStart.getFullYear(),
      currentMonthStart.getMonth() - 1,
      1,
    );
    const previousMonthEnd = new Date(
      currentMonthStart.getFullYear(),
      currentMonthStart.getMonth(),
      0,
    );
    const previousTo = period === 'month' && inProgressTo
      ? new Date(
          previousMonthStart.getFullYear(),
          previousMonthStart.getMonth(),
          Math.min(parseLocalIsoDate(inProgressTo).getDate(), previousMonthEnd.getDate()),
        )
      : previousMonthEnd;
    return { from: localIsoDate(previousMonthStart), to: localIsoDate(previousTo) };
  }

  const previous = getPreviousDashboardRange(range);
  if (!inProgressTo) return previous;

  const elapsedDays = countDashboardRangeDays({ from: range.from, to: inProgressTo });
  return {
    from: previous.from,
    to: localIsoDate(addDays(parseLocalIsoDate(previous.from), elapsedDays - 1)),
  };
}

export function countDashboardRangeDays(range: { from: string; to: string }): number {
  const from = parseLocalIsoDate(range.from);
  const to = parseLocalIsoDate(range.to);
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
}

export function getDashboardAverageDayCount(
  period: DashboardPeriod,
  range: { from: string; to: string },
  selectedDate: string,
): number {
  if (period !== 'week' && period !== 'month') return countDashboardRangeDays(range);

  const from = parseLocalIsoDate(range.from);
  const to = parseLocalIsoDate(range.to);
  const selected = parseLocalIsoDate(selectedDate);

  if (selected < from || selected > to) return countDashboardRangeDays(range);

  return countDashboardRangeDays({ from: range.from, to: localIsoDate(selected) });
}

export function getLatestRowDateInRange<T extends { date: string }>(
  rows: T[],
  range: { from: string; to: string },
): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (row.date < range.from || row.date > range.to) return latest;
    return latest === null || row.date > latest ? row.date : latest;
  }, null);
}

export function countDashboardRangeDaysThroughDate(
  range: { from: string; to: string },
  throughDate: string | null | undefined,
): number {
  if (!throughDate || throughDate < range.from) return countDashboardRangeDays(range);
  const cappedTo = throughDate > range.to ? range.to : throughDate;
  return countDashboardRangeDays({ from: range.from, to: cappedTo });
}

export function calculateAverageDailyIncome(total: number, days: number): number {
  return Math.round(total / Math.max(1, days));
}

export function sumGameClubRows(rows: DailyCashRow[]): Pick<
  DashboardTotals,
  | 'cashIncome'
  | 'terminalIncome'
  | 'cardIncome'
  | 'playstationIncome'
  | 'computerIncome'
  | 'gameClubIncome'
> {
  const cashIncome = rows.reduce((sum, row) => sum + Number(row.cash_income ?? 0), 0);
  const terminalIncome = rows.reduce((sum, row) => sum + Number(row.terminal_income ?? 0), 0);
  const cardIncome = rows.reduce((sum, row) => sum + Number(row.card_income ?? 0), 0);
  const playstationIncome = rows.reduce((sum, row) => sum + Number(row.playstation_income ?? 0), 0);
  const computerIncome = cashIncome + terminalIncome + cardIncome;
  return {
    cashIncome,
    terminalIncome,
    cardIncome,
    playstationIncome,
    computerIncome,
    gameClubIncome: calculateGameClubIncome({ cashIncome, terminalIncome, cardIncome, playstationIncome }),
  };
}

/** An expense paid from bar money; anything else (including no source) is game-club money. */
export function isBarPaidExpense(row: Pick<ExpenseRow, 'payment_source'>): boolean {
  return row.payment_source === 'bar';
}

export function gameClubExpensePaymentBucket(method: string | null | undefined): 'cash' | 'terminal' | 'card' {
  if (method === 'cash') return 'cash';
  if (method === 'terminal') return 'terminal';
  return 'card';
}

export function calculateGameClubMoneyLeftByPaymentMethod(
  cashRows: DailyCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: DebtPaymentValueRow[] = [],
): MoneyLeftByPaymentMethod {
  const gameClub = sumGameClubRows(cashRows);
  const expensesByPayment = expenseRows.reduce(
    (acc, row) => {
      if (isBarPaidExpense(row)) return acc;

      const bucket = gameClubExpensePaymentBucket(row.payment_method);
      acc[bucket] += Number(row.amount ?? 0);
      return acc;
    },
    { cash: 0, terminal: 0, card: 0 },
  );
  const debtPaymentsByMethod = debtPaymentRows.reduce(
    (acc, row) => {
      acc[gameClubExpensePaymentBucket(row.payment_method)] += Number(row.amount ?? 0);
      return acc;
    },
    { cash: 0, terminal: 0, card: 0 },
  );

  return {
    cash: gameClub.cashIncome + debtPaymentsByMethod.cash - expensesByPayment.cash,
    terminal: gameClub.terminalIncome + debtPaymentsByMethod.terminal - expensesByPayment.terminal,
    card: gameClub.cardIncome + debtPaymentsByMethod.card - expensesByPayment.card,
    playstation: gameClub.playstationIncome,
  };
}

export function calculateDashboardTotals(
  cashRows: DailyCashRow[],
  stockRows: StockCountRow[],
  purchaseRows: StockPurchaseCostRow[],
  expenseRows: ExpenseRow[],
  products: ProductValueRow[],
  debts: DebtValueRow[],
  debtPaymentRows: DebtPaymentValueRow[] = [],
  activeDebtSnapshot: DebtValueRow[] = debts,
): DashboardTotals {
  const collectedGameClub = sumGameClubRows(cashRows);
  const debtIncome = debts.reduce((sum, debt) => sum + Number(debt.amount ?? 0), 0);
  const debtPaymentsCollected = debtPaymentRows.reduce(
    (sum, payment) => sum + Number(payment.amount ?? 0),
    0,
  );
  const computerIncome = collectedGameClub.computerIncome + debtIncome;
  const gameClubIncome = collectedGameClub.gameClubIncome + debtIncome;
  const barMoney = calculateBarMoney(stockRows, purchaseRows);
  const barCost = stockRows.reduce((sum, row) => sum + Number(row.bar_cost ?? 0), 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const barExpenses = expenseRows.reduce(
    (sum, row) => (isBarPaidExpense(row) ? sum + Number(row.amount ?? 0) : sum),
    0,
  );
  const gameClubExpenses = totalExpenses - barExpenses;
  const barIncome = barMoney.barMoney - barExpenses;
  const barProfit = barMoney.barSales - barCost - barExpenses;
  const gameClubMoneyLeft = collectedGameClub.gameClubIncome + debtPaymentsCollected - gameClubExpenses;
  const inventoryValue = calculateInventoryValue(products);
  const activeDebtRows = activeDebtSnapshot.filter((debt) => debt.status !== 'paid');
  const activeDebts = activeDebtRows.reduce(
    (sum, debt) => sum + Number(debt.remaining_amount ?? 0),
    0,
  );

  return {
    ...collectedGameClub,
    computerIncome,
    gameClubIncome,
    debtIncome,
    debtPaymentsCollected,
    barSales: barMoney.barSales,
    barCost,
    stockPurchaseCost: barMoney.stockPurchaseCost,
    barProfit,
    barIncome,
    totalExpenses,
    gameClubExpenses,
    barExpenses,
    gameClubMoneyLeft,
    gameClubProfit: gameClubIncome - gameClubExpenses,
    inventoryValue,
    activeDebts,
    activeDebtCount: activeDebtRows.length,
  };
}

export function calculateInventoryValue(products: ProductValueRow[]): number {
  return products.reduce(
    (sum, product) => product.tracks_inventory === false
      ? sum
      : sum + Number(product.current_stock ?? 0) * Number(product.cost_price ?? 0),
    0,
  );
}

export function calculateInventoryValueFromLatestStockCounts(rows: InventorySnapshotRow[]): number {
  const latestByProduct = rows.reduce((map, row) => {
    const existing = map.get(row.product_id);

    if (!existing || row.date > existing.date) {
      map.set(row.product_id, row);
    }

    return map;
  }, new Map<string, InventorySnapshotRow>());

  return Array.from(latestByProduct.values()).reduce(
    (sum, row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      return product?.tracks_inventory === false
        ? sum
        : sum + Number(row.closing_stock ?? 0) * Number(row.cost_price ?? 0);
    },
    0,
  );
}

export function calculateDashboardInventoryValue(
  period: DashboardPeriod,
  liveInventoryValue: number,
  rows: InventorySnapshotRow[],
  range: { from: string; to: string },
): number {
  if (period !== 'lastMonth') return liveInventoryValue;

  return calculateInventoryValueFromLatestStockCounts(
    rows.filter((row) => row.date >= range.from && row.date <= range.to),
  );
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function buildPeriodTrend(
  range: { from: string; to: string },
  cashRows: DailyCashRow[],
  stockRows: StockCountRow[],
  debtRows: DebtValueRow[] = [],
): TrendRow[] {
  const from = parseLocalIsoDate(range.from);
  const to = parseLocalIsoDate(range.to);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const trendDates = Array.from({ length: days }, (_, index) => localIsoDate(addDays(from, index)));

  return trendDates.map((date) => {
    const dayCash = cashRows.filter((row) => row.date === date);
    const dayStock = stockRows.filter((row) => row.date === date);
    const dayDebtIncome = debtRows
      .filter((row) => row.date === date)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const dayGame = sumGameClubRows(dayCash).gameClubIncome;
    const dayBarSales = dayStock.reduce((sum, row) => sum + Number(row.bar_income ?? 0), 0);

    return { date, gameClubIncome: dayGame + dayDebtIncome, barSales: dayBarSales };
  });
}
