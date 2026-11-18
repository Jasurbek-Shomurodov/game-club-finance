import { formatCurrency } from '../formatters';
import type { ExchangeMethod } from '../calculations/moneyExchanges';
import { targetChatId } from './clubChat';
import { exchangeAmounts, exchangeMethods, exchangeReserveNote } from './exchangeNotification';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import { expenseDollars, expenseFromReserve, expenseMethod, expenseSource } from './expenseNotification';
import { commentLine, details, lines, noticeDate, sum } from './messageParts';
import { sendTelegramMessage } from './sendDailyFinanceReport';

/**
 * Club-group notices for entries that were deleted or corrected. The original
 * announcement is removed or edited too, but an edit or a deletion makes no
 * sound in Telegram, so every such change also posts its own message.
 */

const category = (value: string) => RUSSIAN_EXPENSE_CATEGORY_LABELS[value] ?? value;

export interface ExpenseNoticeRow {
  amount: number;
  category: string;
  comment: string | null;
  date: string;
  payment_method: string | null;
  payment_source: string | null;
  usd_amount?: number | string | null;
  usd_rate?: number | string | null;
  paid_from_reserve?: boolean | null;
}

const paymentLabel = (expense: ExpenseNoticeRow) => expenseMethod(expense.payment_method, expenseDollars(expense), expenseFromReserve(expense));

const expenseDetails = (expense: ExpenseNoticeRow) => details(
  expenseSource(expense.payment_source, expenseFromReserve(expense)),
  category(expense.category),
  paymentLabel(expense),
  noticeDate(expense.date),
);

export function buildExpenseDeletedNotice(expense: ExpenseNoticeRow, deletedBy: string): string {
  return lines(
    `🗑 Удалён расход${expenseFromReserve(expense) ? ' из резерва, деньги вернулись в резерв' : ''}: ${sum(Number(expense.amount))}`,
    expenseDetails(expense),
    commentLine(expense.comment),
    `Удалил(а) ${deletedBy}`,
  );
}

/** The current expense, then "Field: old → new" for each field that changed. */
export function buildExpenseChangedNotice(before: ExpenseNoticeRow, after: ExpenseNoticeRow, changedBy: string): string {
  const changes: Array<[string, string, string]> = [
    ['Сумма', sum(Number(before.amount)), sum(Number(after.amount))],
    ['Источник', expenseSource(before.payment_source, expenseFromReserve(before)), expenseSource(after.payment_source, expenseFromReserve(after))],
    ['Категория', category(before.category), category(after.category)],
    ['Оплата', paymentLabel(before), paymentLabel(after)],
    ['Дата', noticeDate(before.date), noticeDate(after.date)],
  ];
  const commentChanged = (before.comment ?? '') !== (after.comment ?? '');
  return lines(
    `✏️ Изменён расход${expenseFromReserve(after) ? ' из резерва' : ''}: ${sum(Number(after.amount))}`,
    expenseDetails(after),
    ...changes.filter(([, old, now]) => old !== now).map(([label, old, now]) => `${label}: ${old} → ${now}`),
    commentChanged ? `Комментарий: ${before.comment || '—'} → ${after.comment || '—'}` : commentLine(after.comment),
    `Изменил(а) ${changedBy}`,
  );
}

export interface ExchangeNoticeRow {
  date: string;
  from_method: ExchangeMethod;
  to_method: ExchangeMethod;
  from_amount: number | string;
  to_amount: number | string;
  comment: string | null;
}

export function buildExchangeDeletedNotice(exchange: ExchangeNoticeRow, deletedBy: string): string {
  return lines(
    `🗑 Удалён обмен: ${exchangeAmounts(exchange.from_method, Number(exchange.from_amount), exchange.to_method, Number(exchange.to_amount))}`,
    details(
      exchangeMethods(exchange.from_method, exchange.to_method),
      // Undoing it reverses the reserve move it made (143).
      exchangeReserveNote(exchange.from_method, exchange.to_method)
        && (exchange.to_method === 'usd' ? 'доллары вышли из резерва' : 'доллары вернулись в резерв'),
      noticeDate(exchange.date),
    ),
    commentLine(exchange.comment),
    `Удалил(а) ${deletedBy}`,
  );
}

export interface IncomeNoticeRow {
  date: string;
  cash_income: number | null;
  terminal_income: number | null;
  card_income: number | null;
  playstation_income: number | null;
}

export function buildIncomeDeletedNotice(entry: IncomeNoticeRow, deletedBy: string): string {
  const parts: Array<[string, number]> = [
    ['Наличные', Number(entry.cash_income ?? 0)],
    ['Терминал', Number(entry.terminal_income ?? 0)],
    ['Карта', Number(entry.card_income ?? 0)],
    ['PlayStation', Number(entry.playstation_income ?? 0)],
  ];
  const total = parts.reduce((total, [, amount]) => total + amount, 0);
  return lines(
    `🗑 Удалена выручка: ${sum(total)}`,
    details(...parts.filter(([, amount]) => amount !== 0).map(([label, amount]) => `${label} ${formatCurrency(amount)}`), noticeDate(entry.date)),
    `Удалил(а) ${deletedBy}`,
  );
}

/** A business date was ticked as collected in Reports, which closes the day. */
export function buildDayCollectedNotice(isoDate: string, collectedBy: string): string {
  return `✅ День собран: ${noticeDate(isoDate)} · ${collectedBy}`;
}

/** An owner removed a collected tick, which reopens the day for changes. */
export function buildDayUncollectedNotice(isoDate: string, removedBy: string): string {
  return `↩️ День снова открыт: ${noticeDate(isoDate)} · ${removedBy}`;
}

/**
 * Posts `text` to the club's own configured group. Best-effort: a missing
 * group or bot token, or a Telegram failure, is logged and never thrown, so
 * an already committed change is never reported as failed.
 */
export async function sendClubNotice(clubId: string, text: string, context: Record<string, unknown>): Promise<boolean> {
  const chatId = targetChatId(clubId);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return false;
  try {
    await sendTelegramMessage({ botToken, chatId, text });
    return true;
  } catch (error) {
    console.error('[telegram/entry-change] notice failed', {
      clubId, ...context, error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
