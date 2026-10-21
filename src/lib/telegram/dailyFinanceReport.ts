import { formatCurrency } from '../formatters';
import {
  calculateAverageDailyIncome,
  calculateDashboardTotals,
  calculateInventoryValueFromLatestStockCounts,
  getAverageIncomeDayCounts,
  percentChange,
  sumGameClubRows,
} from '../calculations/dashboardMetrics';
import type {
  DailyCashRow,
  ExpenseRow,
  InventorySnapshotRow,
  StockCountRow,
  StockPurchaseCostRow,
  ProductValueRow,
} from '../calculations/dashboardMetrics';
import { listLowStockProducts } from '../calculations/stock';
import type { AnalysisLedgers } from '../calculations/financialAnalysis';
import { buildDrillSankey, type DrillSankey } from '../calculations/sankeyDrill';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import type { LowStockProduct, LowStockProductInput } from '../calculations/stock';

export interface DailyFinanceReportInput {
  clubName: string;
  businessDateLabel: string;
  gameClubIncome: number;
  computerIncome: number;
  debtIncome: number;
  playstationIncome: number;
  barSales: number;
  barCost: number;
  /** Game club income minus expenses paid from game club money. */
  gameClubProfit: number;
  /** Bar sales minus bar cost and expenses paid from bar money. */
  barProfit: number;
  stockPurchases: number;
  gameClubExpenses: number;
  barExpenses: number;
  gameClubExpenseCategories: DailyFinanceExpenseCategory[];
  barExpenseCategories: DailyFinanceExpenseCategory[];
  monthToDateRevenue: number;
  gameClubMoneyLeft: number;
  averageDailyGameClubIncome: number;
  barMoneyLeft: number;
  inventoryValue: number;
  averageDailyGameClubIncomeChange?: number | null;
  barMoneyLeftChange?: number | null;
  inventoryValueChange?: number | null;
  activeDebts: number;
  /** Month-to-date bar sales. */
  monthBarSales?: number;
  /** Month-to-date game club income minus expenses paid from game club money. */
  monthGameClubProfit?: number;
  /** Month-to-date bar sales minus bar cost and expenses paid from bar money. */
  monthBarProfit?: number;
  /**
   * Month-to-date flow of game club money: its income sources → its expense
   * categories and what is left. Club and bar money are never pooled.
   */
  monthGameClubSankey?: DrillSankey;
  /** Month-to-date flow of bar money: bar sales → bar cost, its expense categories and what is left. */
  monthBarSankey?: DrillSankey;
  /** Game club income per calendar day from the first of the month through the report date. */
  monthDailyGameClubIncome?: DailyFinanceIncomePoint[];
  /** Active tracked products that are out of stock or at/below their threshold. */
  lowStockProducts?: LowStockProduct[];
  /** Units handed out free under promotions on the report date, by product. */
  promoGiveaways?: DailyFinancePromoGiveaway[];
}

export interface DailyFinancePromoGiveaway {
  productName: string;
  promotionName: string | null;
  quantity: number;
  /** quantity × cost price; already inside bar cost. */
  cost: number;
}

/** A saved stock count with a promo giveaway, joined to its product and promotion names. */
export interface DailyFinanceGiveawayRow {
  product_id: string;
  giveaway_quantity: number | string | null;
  giveaway_cost: number | string | null;
  products?: { name?: string | null } | { name?: string | null }[] | null;
  promotions?: { name?: string | null } | { name?: string | null }[] | null;
}

export interface DailyFinanceIncomePoint {
  date: string;
  amount: number;
}

export interface DailyFinanceExpenseCategory {
  name: string;
  amount: number;
}

export interface DailyFinanceReportDebtRow {
  id?: string;
  date?: string;
  amount?: number;
  remaining_amount: number;
  status: string;
}

export interface DailyFinanceReportDebtPaymentRow {
  date: string;
  amount: number;
  payment_method: string;
}

/** A debt payment recorded after the report date (used to rewind balances). */
export interface DailyFinanceReportLaterDebtPaymentRow {
  debt_id: string;
  date: string;
  amount: number;
}

export interface DailyFinanceReportRows {
  clubName: string;
  businessDate: string;
  businessDateLabel: string;
  cashRows: DailyCashRow[];
  stockRows: StockCountRow[];
  stockPurchaseRows: StockPurchaseCostRow[];
  expenseRows: ExpenseRow[];
  monthCashRows?: DailyCashRow[];
  monthStockRows?: StockCountRow[];
  monthStockPurchaseRows?: StockPurchaseCostRow[];
  monthExpenseRows?: ExpenseRow[];
  previousMonthCashRows?: DailyCashRow[];
  previousMonthStockRows?: StockCountRow[];
  previousMonthStockPurchaseRows?: StockPurchaseCostRow[];
  previousMonthExpenseRows?: ExpenseRow[];
  previousMonthDebtPaymentRows?: DailyFinanceReportDebtPaymentRow[];
  previousMonthInventoryRows?: InventorySnapshotRow[];
  productRows?: ProductValueRow[];
  /**
   * Saved closing counts on or before the report date, including archived
   * products. The warehouse value uses each product's latest count in these
   * rows, so a day without a count still shows the last known stock.
   */
  inventoryRows?: InventorySnapshotRow[];
  debtRows: DailyFinanceReportDebtRow[];
  debtPaymentRows?: DailyFinanceReportDebtPaymentRow[];
  /**
   * Debt payments dated after the report date. Adding them back to the live
   * remaining balance gives the debt outstanding at the end of the report date.
   */
  laterDebtPaymentRows?: DailyFinanceReportLaterDebtPaymentRow[];
  /** Live product catalog rows; omitted when the catalog could not be read. */
  lowStockProductRows?: LowStockProductInput[];
  /** Report-date stock counts with giveaways; omitted when they could not be read. */
  giveawayRows?: DailyFinanceGiveawayRow[];
}

function relationName(value: DailyFinanceGiveawayRow['products']): string | null {
  const relation = Array.isArray(value) ? value[0] : value;
  const name = relation?.name?.trim();
  return name ? name : null;
}

/** Giveaways with units, largest first, then by product name. */
export function summarizePromoGiveaways(rows: DailyFinanceGiveawayRow[]): DailyFinancePromoGiveaway[] {
  return rows
    .map((row) => ({
      productName: relationName(row.products) ?? 'Товар',
      promotionName: relationName(row.promotions),
      quantity: Number(row.giveaway_quantity ?? 0) || 0,
      cost: Number(row.giveaway_cost ?? 0) || 0,
    }))
    .filter((item) => item.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'ru'));
}

function quantityLabel(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} шт.`;
}

function promoGiveawayLines(items: DailyFinancePromoGiveaway[] | undefined): string[] {
  if (!items?.length) return [];
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const cost = items.reduce((sum, item) => sum + item.cost, 0);
  return [
    '',
    `🎁 Бонусы по акциям: ${quantityLabel(units)}, себестоимость ${money(cost)}`,
    ...items.map((item) => `  • ${item.productName}: ${quantityLabel(item.quantity)}${item.promotionName ? ` — ${item.promotionName}` : ''}`),
  ];
}

function percent(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format((value / total) * 100)}%`;
}

function money(value: number): string {
  return `${formatCurrency(value)} UZS`;
}

function expenseName(row: ExpenseRow): string {
  const comment = row.comment?.trim();
  if (row.category === 'other' && comment) return comment;

  return RUSSIAN_EXPENSE_CATEGORY_LABELS[row.category] ?? row.category;
}

function summarizeExpenseCategories(
  rows: ExpenseRow[],
  paymentSource: 'game_club' | 'bar',
): DailyFinanceExpenseCategory[] {
  const totals = rows.reduce((categoryMap, row) => {
    if ((row.payment_source ?? 'game_club') !== paymentSource) return categoryMap;

    const name = expenseName(row);
    categoryMap.set(name, (categoryMap.get(name) ?? 0) + Number(row.amount ?? 0));
    return categoryMap;
  }, new Map<string, number>());

  return Array.from(totals, ([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ru'));
}

function categoryLines(categories: DailyFinanceExpenseCategory[]): string[] {
  return categories.map((category) => `  - ${category.name}: ${money(category.amount)}`);
}

function quantity(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/** Russian text for one low-stock product, e.g. "Cola: 3 шт. (порог 5)". */
export function lowStockItemLabel(item: LowStockProduct): string {
  return item.level === 'out'
    ? `${item.name}: нет в наличии`
    : `${item.name}: ${quantity(item.currentStock)} шт. (порог ${quantity(item.threshold)})`;
}

function lowStockLines(items: LowStockProduct[] | undefined): string[] {
  if (!items?.length) return [];
  return [
    '',
    `⚠️ Заканчивается на складе (${items.length}):`,
    ...items.map((item) => `  • ${lowStockItemLabel(item)}`),
  ];
}

/** Builds one game club income point per day, including debts recorded that day. */
export function buildDailyGameClubIncomeSeries(
  cashRows: DailyCashRow[],
  debtRows: DailyFinanceReportDebtRow[],
  range: { from: string; to: string },
): DailyFinanceIncomePoint[] {
  const points: DailyFinanceIncomePoint[] = [];
  const [year, month, firstDay] = range.from.split('-').map(Number);
  const lastDay = Number(range.to.slice(8, 10));

  for (let day = firstDay; day <= lastDay; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const collected = sumGameClubRows(cashRows.filter((row) => row.date === date)).gameClubIncome;
    const debts = debtRows
      .filter((row) => row.date === date)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    points.push({ date, amount: collected + debts });
  }

  return points;
}

export function monthStartIso(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The previous month from its 1st through the same day (clamped to its length). */
export function previousComparableMonthRangeIso(date: string): { from: string; to: string } {
  const [year, month, day] = date.split('-').map(Number);
  const previousMonthStart = new Date(Date.UTC(year, month - 2, 1));
  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const comparableDay = Math.min(day, previousMonthLastDay);
  const prefix = `${previousMonthStart.getUTCFullYear()}-${String(previousMonthStart.getUTCMonth() + 1).padStart(2, '0')}`;

  return { from: `${prefix}-01`, to: `${prefix}-${String(comparableDay).padStart(2, '0')}` };
}

/**
 * Customer debt still owed at the end of `businessDate`. Debts recorded later
 * are excluded, and payments recorded later are added back to the live
 * remaining balance (the payment ledger is append-only and the database keeps
 * `remaining_amount` in step with it), so recovery runs for past dates show
 * that day's balance rather than today's.
 */
export function calculateOutstandingDebtsAsOf(
  debtRows: DailyFinanceReportDebtRow[],
  laterPaymentRows: DailyFinanceReportLaterDebtPaymentRow[],
  businessDate: string,
): number {
  const laterPaidByDebt = laterPaymentRows.reduce((map, payment) => {
    if (payment.date > businessDate) {
      map.set(payment.debt_id, (map.get(payment.debt_id) ?? 0) + Number(payment.amount ?? 0));
    }
    return map;
  }, new Map<string, number>());

  return debtRows.reduce((sum, debt) => {
    if (debt.date && debt.date > businessDate) return sum;
    const liveRemaining = debt.status === 'paid' ? 0 : Number(debt.remaining_amount ?? 0);
    const outstanding = liveRemaining + (debt.id ? laterPaidByDebt.get(debt.id) ?? 0 : 0);
    const principal = debt.amount === undefined ? Number.POSITIVE_INFINITY : Number(debt.amount);
    return sum + Math.max(0, Math.min(outstanding, principal));
  }, 0);
}

export function buildDailyFinanceReportInput(rows: DailyFinanceReportRows): DailyFinanceReportInput {
  const monthRange = { from: monthStartIso(rows.businessDate), to: rows.businessDate };
  const previousMonthRange = previousComparableMonthRangeIso(rows.businessDate);
  const dailyDebtRows = rows.debtRows.filter((row) => row.date === rows.businessDate);
  const monthDebtRows = rows.debtRows.filter(
    (row) => Boolean(row.date && row.date >= monthRange.from && row.date <= monthRange.to),
  );
  const dailyDebtPaymentRows = (rows.debtPaymentRows ?? []).filter(
    (row) => row.date === rows.businessDate,
  );
  const monthDebtPaymentRows = (rows.debtPaymentRows ?? []).filter(
    (row) => row.date >= monthRange.from && row.date <= monthRange.to,
  );
  const dailyTotals = calculateDashboardTotals(
    rows.cashRows,
    rows.stockRows,
    rows.stockPurchaseRows,
    rows.expenseRows,
    rows.productRows ?? [],
    dailyDebtRows,
    dailyDebtPaymentRows,
    rows.debtRows,
  );
  const monthTotals = calculateDashboardTotals(
    rows.monthCashRows ?? rows.cashRows,
    rows.monthStockRows ?? rows.stockRows,
    rows.monthStockPurchaseRows ?? rows.stockPurchaseRows,
    rows.monthExpenseRows ?? rows.expenseRows,
    [],
    monthDebtRows,
    monthDebtPaymentRows,
    rows.debtRows,
  );
  const previousMonthDebtRows = rows.debtRows.filter((row) =>
    Boolean(row.date && row.date >= previousMonthRange.from && row.date <= previousMonthRange.to));
  const previousMonthTotals = calculateDashboardTotals(
    rows.previousMonthCashRows ?? [],
    rows.previousMonthStockRows ?? [],
    rows.previousMonthStockPurchaseRows ?? [],
    rows.previousMonthExpenseRows ?? [],
    [],
    previousMonthDebtRows,
    rows.previousMonthDebtPaymentRows ?? [],
    rows.debtRows,
  );
  // Same day counts as the dashboard and financial analysis (latest cash entry or new debt).
  const averageRevenueDayCount = getAverageIncomeDayCounts(monthRange, {
    cashRows: rows.monthCashRows ?? rows.cashRows,
    debtRows: monthDebtRows,
    stockRows: [],
  }).gameClub;
  const previousAverageDayCount = getAverageIncomeDayCounts(previousMonthRange, {
    cashRows: rows.previousMonthCashRows ?? [],
    debtRows: previousMonthDebtRows,
    stockRows: [],
  }).gameClub;
  const previousAverageDailyGameClubIncome = calculateAverageDailyIncome(
    previousMonthTotals.gameClubIncome,
    previousAverageDayCount,
  );
  const previousInventoryValue = calculateInventoryValueFromLatestStockCounts(
    rows.previousMonthInventoryRows ?? [],
  );
  const inventoryValue = rows.inventoryRows === undefined
    ? dailyTotals.inventoryValue
    : calculateInventoryValueFromLatestStockCounts(
      rows.inventoryRows.filter((row) => row.date <= rows.businessDate),
    );
  const averageDailyGameClubIncome = calculateAverageDailyIncome(
    monthTotals.gameClubIncome,
    averageRevenueDayCount,
  );
  const monthToDateRevenue = monthTotals.gameClubIncome;
  const monthLedgers: AnalysisLedgers = {
    cashRows: rows.monthCashRows ?? rows.cashRows,
    stockRows: rows.monthStockRows ?? rows.stockRows,
    purchaseRows: rows.monthStockPurchaseRows ?? rows.stockPurchaseRows,
    expenseRows: rows.monthExpenseRows ?? rows.expenseRows,
    debtRows: monthDebtRows,
    debtPaymentRows: monthDebtPaymentRows,
  };

  return {
    clubName: rows.clubName,
    businessDateLabel: rows.businessDateLabel,
    gameClubIncome: dailyTotals.gameClubIncome,
    computerIncome: dailyTotals.computerIncome,
    debtIncome: dailyTotals.debtIncome,
    playstationIncome: dailyTotals.playstationIncome,
    barSales: dailyTotals.barSales,
    barCost: dailyTotals.barCost,
    gameClubProfit: dailyTotals.gameClubIncome - dailyTotals.gameClubExpenses,
    barProfit: dailyTotals.barSales - dailyTotals.barCost - dailyTotals.barExpenses,
    stockPurchases: dailyTotals.stockPurchaseCost,
    gameClubExpenses: dailyTotals.gameClubExpenses,
    barExpenses: dailyTotals.barExpenses,
    gameClubExpenseCategories: summarizeExpenseCategories(rows.expenseRows, 'game_club'),
    barExpenseCategories: summarizeExpenseCategories(rows.expenseRows, 'bar'),
    monthToDateRevenue,
    gameClubMoneyLeft: monthTotals.gameClubMoneyLeft,
    averageDailyGameClubIncome,
    barMoneyLeft: monthTotals.barIncome,
    inventoryValue,
    averageDailyGameClubIncomeChange: percentChange(
      averageDailyGameClubIncome,
      previousAverageDailyGameClubIncome,
    ),
    barMoneyLeftChange: percentChange(monthTotals.barIncome, previousMonthTotals.barIncome),
    inventoryValueChange: percentChange(inventoryValue, previousInventoryValue),
    activeDebts: calculateOutstandingDebtsAsOf(
      rows.debtRows,
      rows.laterDebtPaymentRows ?? [],
      rows.businessDate,
    ),
    monthBarSales: monthTotals.barSales,
    monthGameClubProfit: monthTotals.gameClubIncome - monthTotals.gameClubExpenses,
    monthBarProfit: monthTotals.barSales - monthTotals.barCost - monthTotals.barExpenses,
    monthGameClubSankey: buildDrillSankey({ kind: 'gameClub' }, monthLedgers),
    monthBarSankey: buildDrillSankey({ kind: 'bar' }, monthLedgers),
    monthDailyGameClubIncome: buildDailyGameClubIncomeSeries(
      rows.monthCashRows ?? rows.cashRows,
      monthDebtRows,
      monthRange,
    ),
    lowStockProducts: rows.lowStockProductRows === undefined
      ? undefined
      : listLowStockProducts(rows.lowStockProductRows),
    promoGiveaways: rows.giveawayRows === undefined
      ? undefined
      : summarizePromoGiveaways(rows.giveawayRows),
  };
}

export function formatRussianDailyFinanceReport(input: DailyFinanceReportInput): string {
  return [
    '📊 Ежедневный финансовый отчёт',
    input.clubName,
    `Рабочий день: ${input.businessDateLabel}`,
    '',
    `🎮 Доход клуба: ${money(input.gameClubIncome)}`,
    `  • Компьютеры: ${money(input.computerIncome)} (${percent(input.computerIncome, input.gameClubIncome)})`,
    `  • Долги: ${money(input.debtIncome)} (${percent(input.debtIncome, input.gameClubIncome)})`,
    `  • PlayStation: ${money(input.playstationIncome)} (${percent(input.playstationIncome, input.gameClubIncome)})`,
    `💸 Расходы из денег клуба: ${money(input.gameClubExpenses)}`,
    ...categoryLines(input.gameClubExpenseCategories),
    `🎮 Прибыль клуба: ${money(input.gameClubProfit)}`,
    '',
    `🍫 Продажи бара: ${money(input.barSales)}`,
    `📉 Себестоимость бара: ${money(input.barCost)}`,
    `💸 Расходы из денег бара: ${money(input.barExpenses)}`,
    ...categoryLines(input.barExpenseCategories),
    `🍫 Прибыль бара: ${money(input.barProfit)}`,
    `📦 Закупки склада: ${money(input.stockPurchases)}`,
    '',
    `🗓 Доход клуба с начала месяца: ${money(input.monthToDateRevenue)}`,
    ...(input.monthGameClubProfit === undefined
      ? []
      : [`🎮 Прибыль клуба за месяц: ${money(input.monthGameClubProfit)}`]),
    ...(input.monthBarProfit === undefined
      ? []
      : [`🍫 Прибыль бара за месяц: ${money(input.monthBarProfit)}`]),
    `💰 Остаток денег клуба за месяц: ${money(input.gameClubMoneyLeft)}`,
    `📈 Средний дневной доход клуба за месяц: ${money(input.averageDailyGameClubIncome)}`,
    `🧾 Остаток денег бара за месяц: ${money(input.barMoneyLeft)}`,
    '',
    `📦 Стоимость склада: ${money(input.inventoryValue)}`,
    `🤝 Активные долги: ${money(input.activeDebts)}`,
    ...promoGiveawayLines(input.promoGiveaways),
    ...lowStockLines(input.lowStockProducts),
  ].join('\n');
}

export function formatRussianDailyFinanceReportCaption(input: DailyFinanceReportInput): string {
  return [
    '📊 Ежедневный финансовый отчёт',
    `Рабочий день: ${input.businessDateLabel}`,
    ...(input.promoGiveaways?.length
      ? [`🎁 Бонусы по акциям: ${quantityLabel(input.promoGiveaways.reduce((sum, item) => sum + item.quantity, 0))}`]
      : []),
    ...(input.lowStockProducts?.length
      ? [`⚠️ Заканчивается на складе: ${input.lowStockProducts.length}`]
      : []),
  ].join('\n');
}
