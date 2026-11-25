import { fetchReserveMoves } from '@/lib/supabase/reserveMoves';
import { fetchMoneyExchanges } from '@/lib/supabase/moneyExchanges';
import { fetchCollectedMoneyMoves } from '@/lib/supabase/moneyCollections';
import { fetchOwnerReserve } from '@/lib/supabase/ownerMoney';
import { reserveHoldingsOn } from '@/lib/calculations/ownerReserve';
import type { CollectedMoneyMove } from '@/lib/calculations/collectedMoney';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDateOnly } from '../formatters';
import { isMissingDatabaseColumn } from '../supabase/errors';
import { fetchAllRows } from '../supabase/pagination';
import { normalizeBusinessDayStartHour, serverTodayIso } from '../utils';
import { normalizePaymentMethods } from '../paymentMethods';
import type { EntryPaymentMethod } from '@/types';
import {
  buildDailyFinanceReportInput,
  formatRussianDailyFinanceReportCaption,
  formatRussianDailyFinanceReport,
  formatRussianStockAdjustmentsCaption,
  monthStartIso,
  previousComparableMonthRangeIso,
} from './dailyFinanceReport';
import { renderDailyFinanceReportPng, renderForecastReportPng, renderMonthlyFinanceReportPng, renderStockAdjustmentsReportPng } from './dailyFinanceReportImage';
import type {
  DailyCashRow,
  ExpenseRow,
  InventorySnapshotRow,
  StockCountRow,
  StockPurchaseCostRow,
} from '../calculations/dashboardMetrics';
import type { LowStockProductInput } from '../calculations/stock';
import { buildMoneyChecks, LOW_INCOME_WEEKS, type MoneyCheck } from '../calculations/moneyChecks';
import type {
  DailyFinanceReportDebtPaymentRow,
  DailyFinanceReportDebtRow,
  DailyFinanceGiveawayRow,
  DailyFinanceWriteOffRow,
  DailyFinanceReportLaterDebtPaymentRow,
  DailyFinanceWithdrawalRow,
} from './dailyFinanceReport';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
/** Telegram rejects sendMessage text longer than 4096 characters. */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4_096;
/** Telegram rejects photo captions longer than 1024 characters. */
export const TELEGRAM_CAPTION_MAX_LENGTH = 1_024;

interface ClubRow {
  id: string;
  name: string;
}

export interface DailyFinanceReportBuildResult {
  clubId: string;
  chatId: string;
  businessDate: string;
  message: string;
  caption: string;
  imagePng: Buffer | null;
  imageFileName: string;
  /**
   * The day's bar write-offs and corrections on an image of their own, sent
   * after the report; null when there were none (or it could not be drawn).
   */
  adjustmentsImage: { png: Buffer; fileName: string; caption: string } | null;
  /**
   * The month so far (money by method, reserve, investments, forecast, flows,
   * trends) on its own image, sent right after the day image; null when it
   * could not be drawn.
   */
  monthImage: { png: Buffer; fileName: string } | null;
  /** The month-end forecast with its running-total charts, sent after the month image; null when absent. */
  forecastImage: { png: Buffer; fileName: string } | null;
}

/** Strict YYYY-MM-DD that names a real calendar date (rejects 2026-02-31). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The club's most recent fully closed business day: the day before its current
 * business date. The current business day began at the club's start hour, so
 * the previous one has always ended by the time this runs.
 */
export function previousClubBusinessDateIso(now: Date, businessDayStartHour: number): string {
  return addDaysIso(serverTodayIso(now, businessDayStartHour), -1);
}

/** UTC hour the scheduled daily report runs (08:00 Tashkent, migration 073). */
export const DAILY_REPORT_UTC_HOUR = 3;

/**
 * The business date the next scheduled daily report will carry. Before
 * today's report time this is judged at that time, not now: a club whose day
 * starts at 08:00 is still on yesterday's business day at 07:50, yet the 08:00
 * report covers the day that is just closing.
 */
export function nextDailyReportBusinessDateIso(now: Date, businessDayStartHour: number): string {
  const reportAt = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_REPORT_UTC_HOUR,
  ));
  return previousClubBusinessDateIso(reportAt > now ? reportAt : now, businessDayStartHour);
}

/** The club's configured business-day start hour (0 on pre-019 databases). */
export async function getClubBusinessDayStartHour(
  supabase: SupabaseClient,
  clubId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('clubs')
    .select('business_day_start_hour')
    .eq('id', clubId)
    .single();

  if (error) {
    if (isMissingDatabaseColumn(error, 'business_day_start_hour')) return 0;
    throw error;
  }
  if (!data) throw new Error('Club not found');
  return normalizeBusinessDayStartHour((data as { business_day_start_hour?: unknown }).business_day_start_hour);
}

/**
 * Fits text into Telegram's length limit. Messages are sent without
 * parse_mode, so there are no tags or entities to keep intact; this only avoids
 * splitting a UTF-16 surrogate pair and prefers ending at a line break.
 */
export function truncateTelegramText(text: string, maxLength = TELEGRAM_MESSAGE_MAX_LENGTH): string {
  if (text.length <= maxLength) return text;
  const marker = '\n…';
  let end = maxLength - marker.length;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  const lineBreak = text.lastIndexOf('\n', end);
  if (lineBreak > end * 0.8) end = lineBreak;
  return `${text.slice(0, end)}${marker}`;
}

/**
 * Live catalog rows for the low-stock section: only the columns the section
 * reads, only active products. A failure only drops the section; it must
 * never block the finance report.
 */
export async function getLowStockProductRows(
  supabase: SupabaseClient,
  clubId: string,
): Promise<LowStockProductInput[] | undefined> {
  try {
    const { data, error } = await fetchAllRows<LowStockProductInput>(() =>
      supabase
        .from('products')
        .select('name,current_stock,low_stock_threshold,tracks_inventory,is_active,is_deleted')
        .eq('club_id', clubId)
        .eq('is_active', true)
        .order('id', { ascending: true }),
    );
    if (error) throw error;
    return (data ?? []) as LowStockProductInput[];
  } catch (error) {
    console.error('[telegram/daily-finance] low-stock products unavailable; omitting section:', error);
    return undefined;
  }
}

/**
 * The club's internet payment day (migration 087). Older databases have no
 * column; a failure only drops the reminder.
 */
export async function getInternetPaymentDay(
  supabase: SupabaseClient,
  clubId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('internet_payment_day')
      .eq('id', clubId)
      .single();
    if (error) throw error;
    const day = Number((data as { internet_payment_day?: unknown } | null)?.internet_payment_day);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
  } catch (error) {
    console.error('[telegram/daily-finance] internet payment day unavailable; omitting reminder:', error);
    return null;
  }
}

/**
 * The club's enabled payment methods for the day's payment section. A failure
 * (or a database without the column) shows every method, so no money is hidden.
 */
export async function getEnabledPaymentMethods(
  supabase: SupabaseClient,
  clubId: string,
): Promise<EntryPaymentMethod[]> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('enabled_payment_methods')
      .eq('id', clubId)
      .single();
    if (error) throw error;
    return normalizePaymentMethods((data as { enabled_payment_methods?: unknown } | null)?.enabled_payment_methods);
  } catch (error) {
    console.error('[telegram/daily-finance] enabled payment methods unavailable; showing every method:', error);
    return normalizePaymentMethods(undefined);
  }
}

/**
 * Report-date counts with promo giveaways (migration 078). Older databases
 * have no giveaway columns; a failure only drops the section.
 */
export async function getPromoGiveawayRows(
  supabase: SupabaseClient,
  clubId: string,
  businessDate: string,
): Promise<DailyFinanceGiveawayRow[] | undefined> {
  try {
    const { data, error } = await fetchAllRows<DailyFinanceGiveawayRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,giveaway_quantity,giveaway_cost,products(name),promotions(name)')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .gt('giveaway_quantity', 0)
        .order('product_id', { ascending: true }),
    );
    if (error) throw error;
    return (data ?? []) as DailyFinanceGiveawayRow[];
  } catch (error) {
    console.error('[telegram/daily-finance] promo giveaways unavailable; omitting section:', error);
    return undefined;
  }
}

/**
 * Report-date counts with an inventory adjustment; the report keeps
 * shortage/expired write-offs and corrections. A failure only drops them.
 */
export async function getStockWriteOffRows(
  supabase: SupabaseClient,
  clubId: string,
  businessDate: string,
): Promise<DailyFinanceWriteOffRow[] | undefined> {
  try {
    const { data, error } = await fetchAllRows<DailyFinanceWriteOffRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,adjustment_quantity,adjustment_reason,cost_price,products(name)')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .neq('adjustment_quantity', 0)
        .order('product_id', { ascending: true }),
    );
    if (error) throw error;
    return (data ?? []) as DailyFinanceWriteOffRow[];
  } catch (error) {
    console.error('[telegram/daily-finance] stock write-offs unavailable; omitting section:', error);
    return undefined;
  }
}

/** This month's owner withdrawals, or undefined when they cannot be read (the report still goes out). */
async function getMonthWithdrawalRows(
  supabase: SupabaseClient,
  clubId: string,
  monthStart: string,
): Promise<DailyFinanceWithdrawalRow[] | undefined> {
  const { data, error } = await fetchAllRows<DailyFinanceWithdrawalRow>(() => supabase
    .from('owner_withdrawals')
    .select('id,period_month,source,amount')
    .eq('club_id', clubId)
    .eq('period_month', monthStart)
    .order('id', { ascending: true }));
  if (error) {
    console.error('[telegram/daily-finance] owner withdrawals unavailable:', error.message);
    return undefined;
  }
  return data ?? [];
}

/**
 * What "where the money is" needs beyond the report's own ledgers: collected
 * money moves over the month so far (Reports reads the same window) and the
 * reserve's holdings at the end of the report date. The reserve is read from
 * its ledgers, as the Reserve page reads it: get_owner_reserve_balances
 * answers only a signed-in owner, and this runs under the service role. The
 * reserve is read strictly: a failed dollar or purchase read would overstate
 * it, so it drops the lines like any other failure, and so does a database
 * without the reserve (136). A failure drops the lines, never the report, and
 * never shows them as 0.
 */
export async function getMoneyWhereaboutsRows(
  supabase: SupabaseClient,
  clubId: string,
  monthStart: string,
  businessDate: string,
): Promise<{ collectedMoves: CollectedMoneyMove[]; reserveHoldings: { sums: number; usd: number } } | undefined> {
  try {
    const [collectedMoves, reserve] = await Promise.all([
      fetchCollectedMoneyMoves(supabase, clubId, monthStart, businessDate),
      fetchOwnerReserve(supabase, clubId, businessDate, undefined, { strict: true }),
    ]);
    if (!reserve.reserveSupported) {
      console.error('[telegram/daily-finance] owner reserve not migrated (136); omitting money whereabouts');
      return undefined;
    }
    return { collectedMoves, reserveHoldings: reserveHoldingsOn(reserve, businessDate) };
  } catch (error) {
    console.error('[telegram/daily-finance] money whereabouts unavailable; omitting them:', error);
    return undefined;
  }
}

/** The club's current business date at `now`, or null when it cannot be read (the checks block is then omitted). */
async function getCurrentBusinessDateOrNull(supabase: SupabaseClient, clubId: string, now: Date): Promise<string | null> {
  try {
    return serverTodayIso(now, await getClubBusinessDayStartHour(supabase, clubId));
  } catch (error) {
    console.error('[telegram/daily-finance] business day unavailable; omitting money checks:', error);
    return null;
  }
}

/**
 * The money checks for the report date ("Worth checking"), from ledgers the
 * report has already read. A low day is judged only once the day is closed
 * (before the club's current business date at send time) and has a daily-cash
 * entry, so its figures are the ones the report shows as final: a dry run or
 * forced resend for a day still in progress gets no low-day check. Anything
 * failing here only drops the block; it never fails the report.
 */
export function getReportMoneyChecks({
  businessDate,
  currentBusinessDate,
  cashRows,
  stockRows,
  expenseRows,
}: {
  businessDate: string;
  /** The club's business date when the report is built; null when unknown. */
  currentBusinessDate: string | null;
  /** Daily cash from LOW_INCOME_WEEKS before the report date through it. */
  cashRows: readonly DailyCashRow[];
  /** Bar sales per product and day over the same window. */
  stockRows: readonly Pick<StockCountRow, 'date' | 'bar_income'>[];
  /** Expenses on the report date (duplicates are same-day). */
  expenseRows: readonly ExpenseRow[];
}): MoneyCheck[] | undefined {
  if (currentBusinessDate === null) return undefined;
  try {
    const closedWithEntry = businessDate < currentBusinessDate
      && cashRows.some((row) => row.date === businessDate);
    const checks = buildMoneyChecks({
      // Only the report date: duplicates that day and that day's income.
      range: { from: businessDate, to: businessDate },
      today: currentBusinessDate,
      expenseRows,
      cashRows,
      stockRows,
      // Category spikes are not shown, so plans do not matter here.
      presets: [],
    });
    return closedWithEntry ? checks : checks.filter((check) => check.kind !== 'low_income_day');
  } catch (error) {
    console.error('[telegram/daily-finance] money checks unavailable; omitting block:', error);
    return undefined;
  }
}

async function getClub(supabase: SupabaseClient, clubId: string): Promise<ClubRow> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id,name')
    .eq('id', clubId)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Club not found');
  return data as ClubRow;
}

/** One stock-count row carrying both the sales and the inventory columns. */
type StockWindowRow = StockCountRow & InventorySnapshotRow;

function inRange<T extends { date: string }>(rows: T[], from: string, to: string): T[] {
  return rows.filter((row) => row.date >= from && row.date <= to);
}

/**
 * Debts that can affect the report: those recorded in the comparison window
 * (debt income), those still open on the report date, and paid ones whose
 * payments landed after it (so an as-of rerun shows that day's balance).
 * The whole ledger is never read; it only grows.
 */
async function getDebtRows(
  supabase: SupabaseClient,
  clubId: string,
  businessDate: string,
  windowFrom: string,
  laterPaidDebtIds: string[],
): Promise<{ data: DailyFinanceReportDebtRow[] | null; error: unknown }> {
  const debts = () => supabase
    .from('new_debts')
    .select('id,date,amount,remaining_amount,status')
    .eq('club_id', clubId)
    .lte('date', businessDate);
  const paged = (query: ReturnType<typeof debts>) =>
    fetchAllRows<DailyFinanceReportDebtRow>(() => query.order('id', { ascending: true }) as never);
  const results = await Promise.all([
    paged(debts().gte('date', windowFrom)),
    paged(debts().neq('status', 'paid')),
    ...(laterPaidDebtIds.length > 0 ? [paged(debts().in('id', laterPaidDebtIds))] : []),
  ]);
  const error = results.find((result) => result.error)?.error ?? null;
  if (error) return { data: null, error };
  const byId = new Map<string, DailyFinanceReportDebtRow>();
  for (const result of results) {
    for (const row of result.data ?? []) if (row.id) byId.set(row.id, row);
  }
  return { data: Array.from(byId.values()), error: null };
}

export async function buildDailyFinanceTelegramReport(
  supabase: SupabaseClient,
  {
    businessDate,
    chatId,
    clubId,
    now = new Date(),
  }: {
    businessDate: string;
    chatId: string;
    clubId: string;
    /** When the report is sent; its calendar date drives the internet reminder. */
    now?: Date;
  },
): Promise<DailyFinanceReportBuildResult> {
  const monthStart = monthStartIso(businessDate);
  const previousMonthRange = previousComparableMonthRangeIso(businessDate);
  // Every ledger is read once over the widest window the report needs (the
  // start of the comparable previous month through the report date) and
  // sliced in memory for the day, the month to date and the previous month.
  const windowFrom = previousMonthRange.from;
  // Daily cash and bar sales reach back far enough for the money checks' usual
  // weekday level too; the rest of the report still slices from windowFrom.
  const lowDayHistoryFrom = addDaysIso(businessDate, -LOW_INCOME_WEEKS * 7);
  const incomeFrom = lowDayHistoryFrom < windowFrom ? lowDayHistoryFrom : windowFrom;
  const windowed = <T extends { date: string }>(table: string, columns: string, orderBy: string[], from = windowFrom) =>
    fetchAllRows<T>(() => {
      let query = supabase
        .from(table)
        .select(columns)
        .eq('club_id', clubId)
        .gte('date', from)
        .lte('date', businessDate);
      for (const column of orderBy) query = query.order(column, { ascending: true });
      return query as never;
    });

  const laterDebtPaymentsPromise = fetchAllRows<DailyFinanceReportLaterDebtPaymentRow>(() =>
    supabase
      .from('debt_payments')
      .select('id,debt_id,date,amount')
      .eq('club_id', clubId)
      .gt('date', businessDate)
      .order('date', { ascending: true })
      .order('id', { ascending: true }),
  );
  const [clubRes, cashRes, stockRes, purchaseRes, expenseRes, debtPaymentRes, laterDebtPaymentRes, debtRes, lowStockProductRows, giveawayRows, writeOffRows, internetPaymentDay, reserveMoves, monthExchangeRows, withdrawalRows, currentBusinessDate, enabledPaymentMethods, whereaboutsRows] = await Promise.all([
    getClub(supabase, clubId),
    windowed<DailyCashRow>('daily_cash_entries', 'date,cash_income,terminal_income,card_income,playstation_income', ['date'], incomeFrom),
    // (club_id, date, product_id) is unique, so the ordering pages stably.
    windowed<StockWindowRow>(
      'daily_stock_counts',
      'product_id,date,bar_income,bar_profit,bar_cost,sold_quantity,closing_stock,cost_price,products(tracks_inventory,deleted_at)',
      ['date', 'product_id'],
      incomeFrom,
    ),
    windowed<StockPurchaseCostRow>('stock_purchases', 'id,date,quantity,cost_price', ['date', 'id']),
    // The method and reserve flag keep reserve purchases out of money left (156).
    windowed<ExpenseRow>('expenses', 'id,date,amount,category,payment_method,payment_source,paid_from_reserve,comment,created_at', ['date', 'id']),
    windowed<DailyFinanceReportDebtPaymentRow>('debt_payments', 'id,date,amount,payment_method', ['date', 'id']),
    laterDebtPaymentsPromise,
    laterDebtPaymentsPromise.then((later) => (later.error
      ? { data: null, error: later.error }
      : getDebtRows(
        supabase,
        clubId,
        businessDate,
        windowFrom,
        Array.from(new Set((later.data ?? []).map((payment) => payment.debt_id))),
      ))),
    getLowStockProductRows(supabase, clubId),
    getPromoGiveawayRows(supabase, clubId, businessDate),
    getStockWriteOffRows(supabase, clubId, businessDate),
    getInternetPaymentDay(supabase, clubId),
    fetchReserveMoves(supabase, clubId, windowFrom, businessDate),
    fetchMoneyExchanges(supabase, clubId, monthStart, businessDate),
    getMonthWithdrawalRows(supabase, clubId, monthStart),
    getCurrentBusinessDateOrNull(supabase, clubId, now),
    getEnabledPaymentMethods(supabase, clubId),
    getMoneyWhereaboutsRows(supabase, clubId, monthStart, businessDate),
  ]);

  const firstError = [
    cashRes.error,
    stockRes.error,
    purchaseRes.error,
    expenseRes.error,
    debtPaymentRes.error,
    laterDebtPaymentRes.error,
    debtRes.error,
  ].find(Boolean);

  if (firstError) throw firstError;

  const incomeCashRows = (cashRes.data ?? []) as DailyCashRow[];
  const incomeStockRows = (stockRes.data ?? []) as StockWindowRow[];
  // Everything but the money checks keeps the comparison window it always had.
  const cashRows = inRange(incomeCashRows, windowFrom, businessDate);
  const stockRows = inRange(incomeStockRows, windowFrom, businessDate);
  const purchaseRows = (purchaseRes.data ?? []) as StockPurchaseCostRow[];
  const expenseRows = (expenseRes.data ?? []) as ExpenseRow[];
  const debtPaymentRows = (debtPaymentRes.data ?? []) as DailyFinanceReportDebtPaymentRow[];
  const day = <T extends { date: string }>(rows: T[]) => inRange(rows, businessDate, businessDate);
  const month = <T extends { date: string }>(rows: T[]) => inRange(rows, monthStart, businessDate);
  const previous = <T extends { date: string }>(rows: T[]) => inRange(rows, previousMonthRange.from, previousMonthRange.to);
  const moneyChecks = getReportMoneyChecks({
    businessDate,
    currentBusinessDate,
    cashRows: incomeCashRows,
    stockRows: incomeStockRows,
    expenseRows: day(expenseRows),
  });

  const input = buildDailyFinanceReportInput({
    clubName: clubRes.name,
    businessDate,
    businessDateLabel: formatDateOnly(businessDate, 'ru'),
    cashRows: day(cashRows),
    stockRows: day(stockRows),
    stockPurchaseRows: day(purchaseRows),
    expenseRows: day(expenseRows),
    monthCashRows: month(cashRows),
    monthStockRows: month(stockRows),
    monthStockPurchaseRows: month(purchaseRows),
    monthExpenseRows: month(expenseRows),
    previousMonthCashRows: previous(cashRows),
    previousMonthStockRows: previous(stockRows),
    previousMonthStockPurchaseRows: previous(purchaseRows),
    previousMonthExpenseRows: previous(expenseRows),
    previousMonthDebtPaymentRows: previous(debtPaymentRows),
    previousMonthInventoryRows: previous(stockRows),
    inventoryRows: stockRows,
    debtRows: (debtRes.data ?? []) as DailyFinanceReportDebtRow[],
    debtPaymentRows: month(debtPaymentRows),
    laterDebtPaymentRows: (laterDebtPaymentRes.data ?? []) as DailyFinanceReportLaterDebtPaymentRow[],
    lowStockProductRows,
    giveawayRows,
    writeOffRows,
    internetPaymentDay,
    reserveMoves,
    monthExchangeRows,
    withdrawalRows,
    // The window already spans all of last month, so its full totals are known.
    forecastLedgers: {
      cashRows,
      stockRows,
      purchaseRows,
      expenseRows,
      debtRows: (debtRes.data ?? []) as DailyFinanceReportDebtRow[],
      debtPaymentRows,
      reserveMoves,
    },
    // Calendar date in the club's time zone, independent of its business-day start.
    sendDate: serverTodayIso(now, 0),
    moneyChecks,
    enabledPaymentMethods,
    collectedMoves: whereaboutsRows?.collectedMoves,
    reserveHoldings: whereaboutsRows?.reserveHoldings,
  });
  let imagePng: Buffer | null = null;
  try {
    imagePng = await renderDailyFinanceReportPng(input);
  } catch (error) {
    console.error('[telegram/daily-finance] report image unavailable; using text fallback:', error);
  }
  let monthPng: Buffer | null = null;
  try {
    monthPng = await renderMonthlyFinanceReportPng(input);
  } catch (error) {
    console.error('[telegram/daily-finance] month image unavailable; omitting it:', error);
  }
  let forecastPng: Buffer | null = null;
  try {
    forecastPng = await renderForecastReportPng(input);
  } catch (error) {
    console.error('[telegram/daily-finance] forecast image unavailable; omitting it:', error);
  }
  let adjustmentsPng: Buffer | null = null;
  try {
    adjustmentsPng = await renderStockAdjustmentsReportPng(input);
  } catch (error) {
    console.error('[telegram/daily-finance] write-offs image unavailable; omitting it:', error);
  }

  return {
    clubId,
    chatId,
    businessDate,
    message: formatRussianDailyFinanceReport(input),
    caption: formatRussianDailyFinanceReportCaption(input),
    imagePng,
    imageFileName: `daily-finance-${clubId}-${businessDate}.png`,
    monthImage: monthPng
      ? { png: monthPng, fileName: `month-finance-${clubId}-${businessDate}.png` }
      : null,
    forecastImage: forecastPng
      ? { png: forecastPng, fileName: `forecast-finance-${clubId}-${businessDate}.png` }
      : null,
    adjustmentsImage: adjustmentsPng
      ? {
          png: adjustmentsPng,
          fileName: `daily-write-offs-${clubId}-${businessDate}.png`,
          caption: formatRussianStockAdjustmentsCaption(input),
        }
      : null,
  };
}

export interface TelegramSuccess {
  ok: true;
  result: {
    message_id: number;
    chat: {
      id: number;
      title?: string;
      type: string;
    };
    date: number;
  };
}

export type TelegramAttemptOutcome =
  | 'sent'
  | 'chat_migrated'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_response'
  | 'client_error'
  | 'network_error'
  | 'timeout';

export interface TelegramSendAttempt extends Record<string, unknown> {
  attempt: number;
  startedAt: string;
  finishedAt: string;
  outcome: TelegramAttemptOutcome;
  httpStatus: number | null;
  telegramErrorCode: number | null;
  description: string | null;
  retryAfterSeconds: number | null;
  retryDelayMs: number | null;
}

export interface TelegramSendResult extends TelegramSuccess {
  attempts: TelegramSendAttempt[];
}

interface TelegramErrorPayload {
  ok?: false;
  error_code?: number;
  description?: string;
  parameters?: {
    migrate_to_chat_id?: number | string;
    retry_after?: number;
  };
}

function isTelegramErrorPayload(value: unknown): value is TelegramErrorPayload & {
  ok: false;
  error_code: number;
} {
  if (!value || typeof value !== 'object') return false;
  const payload = value as TelegramErrorPayload;
  return payload.ok === false && typeof payload.error_code === 'number';
}

function isTelegramSuccess(value: unknown): value is TelegramSuccess {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<TelegramSuccess>;
  const result = payload.result;

  return payload.ok === true
    && Boolean(result)
    && typeof result?.message_id === 'number'
    && typeof result.chat?.id === 'number'
    && typeof result.chat.type === 'string'
    && typeof result.date === 'number';
}

export class TelegramSendError extends Error {
  readonly attempts: TelegramSendAttempt[];
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly requiresManualReview: boolean;

  constructor(
    message: string,
    attempts: TelegramSendAttempt[],
    retryable: boolean,
    requiresManualReview = false,
  ) {
    super(message);
    this.name = 'TelegramSendError';
    this.attempts = attempts;
    this.retryable = retryable;
    this.retryAfterSeconds = attempts.at(-1)?.retryAfterSeconds ?? null;
    this.requiresManualReview = requiresManualReview;
  }
}

/**
 * Telegram refused to process the uploaded image (`IMAGE_PROCESS_FAILED`,
 * 400). The rejection is definite: no message was created, so sending the
 * same report again, or as text, cannot duplicate it.
 */
export function isTelegramImageRejection(error: unknown): error is TelegramSendError {
  if (!(error instanceof TelegramSendError) || error.requiresManualReview) return false;
  const last = error.attempts.at(-1);
  return last?.outcome === 'client_error'
    && /IMAGE_PROCESS_FAILED|PHOTO_INVALID_DIMENSIONS/i.test(last.description ?? '');
}

function boundedDescription(value: unknown, botToken: string): string {
  const raw = value instanceof Error ? value.message : String(value ?? 'Unknown Telegram error');
  return raw.replaceAll(botToken, '[REDACTED]').slice(0, 500);
}

function retryDelayMs(attempt: number, retryAfterSeconds: number | null, baseDelayMs: number) {
  const backoff = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  return Math.max(backoff, retryAfterSeconds === null ? 0 : retryAfterSeconds * 1_000);
}

interface TelegramRequestOptions {
  botToken: string;
  chatId: string;
  endpoint: 'sendMessage' | 'sendPhoto' | 'sendMediaGroup';
  buildRequest: (destinationChatId: string) => Omit<RequestInit, 'signal'>;
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxInProcessRetryDelayMs?: number;
  /**
   * Epoch milliseconds after which no further attempt may still be running.
   * An attempt (plus any retry wait) that would not finish by then is not
   * started; the failure is reported as retryable so a later run can resume.
   */
  deadlineAt?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

async function sendTelegramRequest({
  botToken,
  chatId,
  endpoint,
  buildRequest,
  maxAttempts = 3,
  timeoutMs = 8_000,
  baseDelayMs = 500,
  maxInProcessRetryDelayMs = 3_000,
  deadlineAt,
  now = Date.now,
  fetchImpl = fetch,
  sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: TelegramRequestOptions): Promise<TelegramSendResult> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('Telegram maxAttempts must be between 1 and 5');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('Telegram timeoutMs must be positive');
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new Error('Telegram baseDelayMs cannot be negative');
  }
  if (!Number.isFinite(maxInProcessRetryDelayMs) || maxInProcessRetryDelayMs < 0) {
    throw new Error('Telegram maxInProcessRetryDelayMs cannot be negative');
  }

  const attempts: TelegramSendAttempt[] = [];
  let destinationChatId = chatId;

  const fitsDeadline = (waitMs: number) =>
    deadlineAt === undefined || now() + waitMs + timeoutMs <= deadlineAt;

  if (!fitsDeadline(0)) {
    throw new TelegramSendError(
      'Telegram send skipped: not enough time left in this invocation',
      attempts,
      true,
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const request = buildRequest(destinationChatId);
      const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${botToken}/${endpoint}`, {
        ...request,
        method: 'POST',
        signal: controller.signal,
      });
      const rawPayload = await response.json().catch(() => null) as TelegramSuccess | TelegramErrorPayload | { ok: true; result: unknown[] } | null;
      // sendMediaGroup answers with every message of the album; the first one
      // (the one carrying the caption) identifies the delivery.
      const payload = (rawPayload && 'result' in rawPayload && Array.isArray(rawPayload.result)
        ? { ...rawPayload, result: rawPayload.result[0] }
        : rawPayload) as TelegramSuccess | TelegramErrorPayload | null;
      const finishedAt = new Date().toISOString();

      if (response.ok && isTelegramSuccess(payload)) {
        attempts.push({
          attempt,
          startedAt,
          finishedAt,
          outcome: 'sent',
          httpStatus: response.status,
          telegramErrorCode: null,
          description: null,
          retryAfterSeconds: null,
          retryDelayMs: null,
        });
        return { ...payload, attempts };
      }

      const structuredTelegramError = isTelegramErrorPayload(payload);
      const errorPayload = structuredTelegramError ? payload : null;
      const telegramErrorCode = errorPayload?.error_code ?? null;
      const description = errorPayload?.description
        ? boundedDescription(errorPayload.description, botToken)
        : `Telegram returned HTTP ${response.status}`;
      const migratedChatId = errorPayload?.parameters?.migrate_to_chat_id;

      if (typeof migratedChatId === 'number' || typeof migratedChatId === 'string') {
        attempts.push({
          attempt,
          startedAt,
          finishedAt,
          outcome: 'chat_migrated',
          httpStatus: response.status,
          telegramErrorCode,
          description,
          retryAfterSeconds: null,
          retryDelayMs: 0,
        });

        if (attempt === maxAttempts) {
          throw new TelegramSendError(
            `Telegram changed the destination chat but the retry limit was reached: ${description}`,
            attempts,
            true,
          );
        }

        destinationChatId = String(migratedChatId);
        continue;
      }

      const retryAfter = typeof errorPayload?.parameters?.retry_after === 'number'
        && errorPayload.parameters.retry_after >= 0
        ? errorPayload.parameters.retry_after
        : null;
      const rateLimited = telegramErrorCode !== null
        && (response.status === 429 || telegramErrorCode === 429);
      const serverError = telegramErrorCode !== null
        && (response.status >= 500 || telegramErrorCode >= 500);
      // A 2xx response without Telegram's documented `{ ok: true, result }`
      // shape is ambiguous: Telegram may have accepted the message while a
      // proxy corrupted its response. Quarantine it instead of retrying.
      const invalidSuccessResponse = response.ok;
      const ambiguousErrorResponse = !structuredTelegramError
        && (response.status === 429 || response.status >= 500);
      const retryable = rateLimited || serverError;
      const requestedDelay = retryable && attempt < maxAttempts
        ? retryDelayMs(attempt, retryAfter, baseDelayMs)
        : null;
      // Never retry sooner than retry_after. When Telegram asks us to wait
      // longer than this invocation can safely remain open (or the retry would
      // overrun its deadline), persist a retryable failure so a later
      // invocation can reclaim it instead.
      const delay = requestedDelay !== null
        && requestedDelay <= maxInProcessRetryDelayMs
        && fitsDeadline(requestedDelay)
        ? requestedDelay
        : null;

      attempts.push({
        attempt,
        startedAt,
        finishedAt,
        outcome: invalidSuccessResponse || ambiguousErrorResponse
          ? 'invalid_response'
          : rateLimited
            ? 'rate_limited'
            : serverError
              ? 'server_error'
              : 'client_error',
        httpStatus: response.status,
        telegramErrorCode,
        description,
        retryAfterSeconds: retryAfter,
        retryDelayMs: delay,
      });

      if (invalidSuccessResponse || ambiguousErrorResponse) {
        throw new TelegramSendError(
          `Telegram returned an ambiguous response: ${description}`,
          attempts,
          false,
          true,
        );
      }

      if (!retryable || attempt === maxAttempts || requestedDelay !== delay) {
        const deferredRetry = requestedDelay !== null && requestedDelay !== delay
          ? `; a retry after ${requestedDelay}ms does not fit this invocation`
          : '';
        throw new TelegramSendError(
          `Telegram send failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${description}${deferredRetry}`,
          attempts,
          retryable,
        );
      }

      await sleep(delay!);
    } catch (error) {
      if (error instanceof TelegramSendError) throw error;

      const finishedAt = new Date().toISOString();
      const timedOut = controller.signal.aborted;
      const description = timedOut
        ? `Telegram request timed out after ${timeoutMs}ms`
        : boundedDescription(error, botToken);

      attempts.push({
        attempt,
        startedAt,
        finishedAt,
        outcome: timedOut ? 'timeout' : 'network_error',
        httpStatus: null,
        telegramErrorCode: null,
        description,
        retryAfterSeconds: null,
        retryDelayMs: null,
      });

      // A connection failure cannot distinguish "Telegram never received the
      // request" from "Telegram accepted it but the response was lost". Never
      // retry that ambiguity automatically; the delivery ledger quarantines it.
      throw new TelegramSendError(
        `Telegram delivery outcome is unknown after ${attempt} attempt: ${description}`,
        attempts,
        false,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new TelegramSendError('Telegram send failed without an attempt', attempts, true);
}

interface TelegramCommonSendOptions {
  botToken: string;
  chatId: string;
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxInProcessRetryDelayMs?: number;
  deadlineAt?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * `replyToMessageId` threads the message under an earlier one in the same
 * chat. A missing original (too old, removed, or a migrated chat) still gets
 * the message, as a plain one.
 */
export function sendTelegramMessage({
  text,
  replyToMessageId,
  ...options
}: TelegramCommonSendOptions & { text: string; replyToMessageId?: number | null }): Promise<TelegramSendResult> {
  return sendTelegramRequest({
    ...options,
    endpoint: 'sendMessage',
    buildRequest: (destinationChatId) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationChatId,
        text: truncateTelegramText(text),
        disable_notification: false,
        ...(replyToMessageId
          ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
          : {}),
      }),
    }),
  });
}

export function sendTelegramPhoto({
  imagePng,
  imageFileName,
  caption,
  ...options
}: TelegramCommonSendOptions & {
  imagePng: Buffer;
  imageFileName: string;
  caption: string;
}): Promise<TelegramSendResult> {
  return sendTelegramRequest({
    ...options,
    endpoint: 'sendPhoto',
    buildRequest: (destinationChatId) => {
      const form = new FormData();
      form.set('chat_id', destinationChatId);
      form.set('photo', new Blob([new Uint8Array(imagePng)], { type: 'image/png' }), imageFileName);
      form.set('caption', truncateTelegramText(caption, TELEGRAM_CAPTION_MAX_LENGTH));
      form.set('disable_notification', 'false');
      return { body: form };
    },
  });
}

/**
 * Several PNGs as one Telegram album. The caption sits on the first photo,
 * which is the message the result identifies.
 */
export function sendTelegramPhotoAlbum({
  photos,
  caption,
  ...options
}: TelegramCommonSendOptions & {
  photos: Array<{ png: Buffer; fileName: string }>;
  caption: string;
}): Promise<TelegramSendResult> {
  if (photos.length < 2 || photos.length > 10) {
    throw new Error('A Telegram album holds 2 to 10 photos');
  }
  return sendTelegramRequest({
    ...options,
    endpoint: 'sendMediaGroup',
    buildRequest: (destinationChatId) => {
      const form = new FormData();
      form.set('chat_id', destinationChatId);
      form.set('media', JSON.stringify(photos.map((_, index) => ({
        type: 'photo',
        media: `attach://photo${index}`,
        ...(index === 0 ? { caption: truncateTelegramText(caption, TELEGRAM_CAPTION_MAX_LENGTH) } : {}),
      }))));
      photos.forEach((photo, index) => {
        form.set(`photo${index}`, new Blob([new Uint8Array(photo.png)], { type: 'image/png' }), photo.fileName);
      });
      form.set('disable_notification', 'false');
      return { body: form };
    },
  });
}
