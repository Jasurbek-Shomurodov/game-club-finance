import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDateOnly } from '../formatters';
import { isMissingDatabaseColumn } from '../supabase/errors';
import { fetchAllRows } from '../supabase/pagination';
import { normalizeBusinessDayStartHour, serverTodayIso } from '../utils';
import {
  buildDailyFinanceReportInput,
  formatRussianDailyFinanceReportCaption,
  formatRussianDailyFinanceReport,
  monthStartIso,
  previousComparableMonthRangeIso,
} from './dailyFinanceReport';
import { renderDailyFinanceReportPng } from './dailyFinanceReportImage';
import type {
  DailyCashRow,
  ExpenseRow,
  InventorySnapshotRow,
  StockCountRow,
  StockPurchaseCostRow,
} from '../calculations/dashboardMetrics';
import type { LowStockProductInput } from '../calculations/stock';
import type {
  DailyFinanceReportDebtPaymentRow,
  DailyFinanceReportDebtRow,
  DailyFinanceGiveawayRow,
  DailyFinanceReportLaterDebtPaymentRow,
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
 * Live catalog rows for the low-stock section. `*` tolerates databases that
 * predate optional product columns. A failure only drops the section; it must
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
        .select('*')
        .eq('club_id', clubId)
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

export async function buildDailyFinanceTelegramReport(
  supabase: SupabaseClient,
  {
    businessDate,
    chatId,
    clubId,
  }: {
    businessDate: string;
    chatId: string;
    clubId: string;
  },
): Promise<DailyFinanceReportBuildResult> {
  const monthStart = monthStartIso(businessDate);
  const previousMonthRange = previousComparableMonthRangeIso(businessDate);
  const [clubRes, cashRes, stockRes, purchaseRes, expenseRes, inventoryRes, debtRes, laterDebtPaymentRes, debtPaymentRes, monthCashRes, monthStockRes, monthPurchaseRes, monthExpenseRes, previousCashRes, previousStockRes, previousPurchaseRes, previousExpenseRes, previousDebtPaymentRes, lowStockProductRows, giveawayRows] = await Promise.all([
    getClub(supabase, clubId),
    fetchAllRows<DailyCashRow>(() =>
      supabase
        .from('daily_cash_entries')
        .select('date,cash_income,terminal_income,card_income,playstation_income')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .order('date', { ascending: true }),
    ),
    fetchAllRows<StockCountRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,bar_income,bar_profit,bar_cost,sold_quantity')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    fetchAllRows<StockPurchaseCostRow>(() =>
      supabase
        .from('stock_purchases')
        .select('id,date,quantity,cost_price')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<ExpenseRow>(() =>
      supabase
        .from('expenses')
        .select('id,date,amount,category,payment_source,comment,created_at')
        .eq('club_id', clubId)
        .eq('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    // Closing counts from the start of the comparable previous month through
    // the report date: the report-date value uses each product's latest count
    // on or before that date, and the comparison uses the previous-month slice.
    // (club_id, date, product_id) is unique, so the ordering pages stably.
    fetchAllRows<InventorySnapshotRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,closing_stock,cost_price,products(tracks_inventory)')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', businessDate)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    fetchAllRows<DailyFinanceReportDebtRow>(() =>
      supabase
        .from('new_debts')
        .select('id,date,amount,remaining_amount,status')
        .eq('club_id', clubId)
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DailyFinanceReportLaterDebtPaymentRow>(() =>
      supabase
        .from('debt_payments')
        .select('id,debt_id,date,amount')
        .eq('club_id', clubId)
        .gt('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DailyFinanceReportDebtPaymentRow>(() =>
      supabase
        .from('debt_payments')
        .select('id,date,amount,payment_method')
        .eq('club_id', clubId)
        .gte('date', monthStart)
        .lte('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DailyCashRow>(() =>
      supabase
        .from('daily_cash_entries')
        .select('date,cash_income,terminal_income,card_income,playstation_income')
        .eq('club_id', clubId)
        .gte('date', monthStart)
        .lte('date', businessDate)
        .order('date', { ascending: true }),
    ),
    fetchAllRows<StockCountRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,bar_income,bar_profit,bar_cost,sold_quantity')
        .eq('club_id', clubId)
        .gte('date', monthStart)
        .lte('date', businessDate)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    fetchAllRows<StockPurchaseCostRow>(() =>
      supabase
        .from('stock_purchases')
        .select('id,date,quantity,cost_price')
        .eq('club_id', clubId)
        .gte('date', monthStart)
        .lte('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<ExpenseRow>(() =>
      supabase
        .from('expenses')
        .select('id,date,amount,category,payment_source,comment,created_at')
        .eq('club_id', clubId)
        .gte('date', monthStart)
        .lte('date', businessDate)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DailyCashRow>(() =>
      supabase
        .from('daily_cash_entries')
        .select('date,cash_income,terminal_income,card_income,playstation_income')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', previousMonthRange.to)
        .order('date', { ascending: true }),
    ),
    fetchAllRows<StockCountRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,bar_income,bar_profit,bar_cost,sold_quantity')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', previousMonthRange.to)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    fetchAllRows<StockPurchaseCostRow>(() =>
      supabase
        .from('stock_purchases')
        .select('id,date,quantity,cost_price')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', previousMonthRange.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<ExpenseRow>(() =>
      supabase
        .from('expenses')
        .select('id,date,amount,category,payment_source,comment,created_at')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', previousMonthRange.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DailyFinanceReportDebtPaymentRow>(() =>
      supabase
        .from('debt_payments')
        .select('id,date,amount,payment_method')
        .eq('club_id', clubId)
        .gte('date', previousMonthRange.from)
        .lte('date', previousMonthRange.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    getLowStockProductRows(supabase, clubId),
    getPromoGiveawayRows(supabase, clubId, businessDate),
  ]);

  const firstError = [
    cashRes.error,
    stockRes.error,
    purchaseRes.error,
    expenseRes.error,
    inventoryRes.error,
    debtRes.error,
    debtPaymentRes.error,
    laterDebtPaymentRes.error,
    monthCashRes.error,
    monthStockRes.error,
    monthPurchaseRes.error,
    monthExpenseRes.error,
    previousCashRes.error,
    previousStockRes.error,
    previousPurchaseRes.error,
    previousExpenseRes.error,
    previousDebtPaymentRes.error,
  ].find(Boolean);

  if (firstError) throw firstError;

  const inventoryRows = (inventoryRes.data ?? []) as InventorySnapshotRow[];

  const input = buildDailyFinanceReportInput({
    clubName: clubRes.name,
    businessDate,
    businessDateLabel: formatDateOnly(businessDate, 'ru'),
    cashRows: (cashRes.data ?? []) as DailyCashRow[],
    stockRows: (stockRes.data ?? []) as StockCountRow[],
    stockPurchaseRows: (purchaseRes.data ?? []) as StockPurchaseCostRow[],
    expenseRows: (expenseRes.data ?? []) as ExpenseRow[],
    monthCashRows: (monthCashRes.data ?? []) as DailyCashRow[],
    monthStockRows: (monthStockRes.data ?? []) as StockCountRow[],
    monthStockPurchaseRows: (monthPurchaseRes.data ?? []) as StockPurchaseCostRow[],
    monthExpenseRows: (monthExpenseRes.data ?? []) as ExpenseRow[],
    previousMonthCashRows: (previousCashRes.data ?? []) as DailyCashRow[],
    previousMonthStockRows: (previousStockRes.data ?? []) as StockCountRow[],
    previousMonthStockPurchaseRows: (previousPurchaseRes.data ?? []) as StockPurchaseCostRow[],
    previousMonthExpenseRows: (previousExpenseRes.data ?? []) as ExpenseRow[],
    previousMonthDebtPaymentRows: (previousDebtPaymentRes.data ?? []) as DailyFinanceReportDebtPaymentRow[],
    previousMonthInventoryRows: inventoryRows.filter(
      (row) => row.date >= previousMonthRange.from && row.date <= previousMonthRange.to,
    ),
    inventoryRows,
    debtRows: (debtRes.data ?? []) as DailyFinanceReportDebtRow[],
    debtPaymentRows: (debtPaymentRes.data ?? []) as DailyFinanceReportDebtPaymentRow[],
    laterDebtPaymentRows: (laterDebtPaymentRes.data ?? []) as DailyFinanceReportLaterDebtPaymentRow[],
    lowStockProductRows,
    giveawayRows,
  });
  let imagePng: Buffer | null = null;
  try {
    imagePng = await renderDailyFinanceReportPng(input);
  } catch (error) {
    console.error('[telegram/daily-finance] report image unavailable; using text fallback:', error);
  }

  return {
    clubId,
    chatId,
    businessDate,
    message: formatRussianDailyFinanceReport(input),
    caption: formatRussianDailyFinanceReportCaption(input),
    imagePng,
    imageFileName: `daily-finance-${clubId}-${businessDate}.png`,
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
  endpoint: 'sendMessage' | 'sendPhoto';
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
      const payload = await response.json().catch(() => null) as TelegramSuccess | TelegramErrorPayload | null;
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

export function sendTelegramMessage({
  text,
  ...options
}: TelegramCommonSendOptions & { text: string }): Promise<TelegramSendResult> {
  return sendTelegramRequest({
    ...options,
    endpoint: 'sendMessage',
    buildRequest: (destinationChatId) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationChatId,
        text: truncateTelegramText(text),
        disable_notification: false,
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
