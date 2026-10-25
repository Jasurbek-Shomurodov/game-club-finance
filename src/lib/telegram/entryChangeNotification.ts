import { formatCurrency, formatDateShort } from '../formatters';
import type { ExchangeMethod } from '../calculations/moneyExchanges';
import { targetChatId } from './clubChat';
import { EXCHANGE_METHOD_LABELS, exchangeAmount } from './exchangeNotification';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import { PAYMENT_METHOD_LABELS } from './expenseNotification';
import { sendTelegramMessage } from './sendDailyFinanceReport';

/**
 * Club-group notices for entries that were deleted or corrected. The original
 * announcement is removed or edited too, but an edit or a deletion makes no
 * sound in Telegram, so every such change also posts its own message.
 */

const date = (iso: string) => formatDateShort(iso, 'ru');
const method = (value: string | null | undefined) => (value ? PAYMENT_METHOD_LABELS[value] ?? value : '—');
const category = (value: string) => RUSSIAN_EXPENSE_CATEGORY_LABELS[value] ?? value;
/** "old → new" when it changed, otherwise the value once. */
const change = (before: string, after: string) => (before === after ? after : `${before} → ${after}`);

export interface ExpenseNoticeRow {
  amount: number;
  category: string;
  comment: string | null;
  date: string;
  payment_method: string | null;
  payment_source: string | null;
}

function expenseLines(expense: ExpenseNoticeRow): string[] {
  return [
    `Сумма: ${formatCurrency(Number(expense.amount))} сум`,
    `Категория: ${category(expense.category)}`,
    `Источник: ${expense.payment_source === 'bar' ? 'Бар' : 'Игровой клуб'}`,
  ];
}

export function buildExpenseDeletedNotice(expense: ExpenseNoticeRow, deletedBy: string): string {
  const lines = [
    '🗑 Удалён расход',
    '',
    ...expenseLines(expense),
    `Способ оплаты: ${method(expense.payment_method)}`,
    `Дата: ${date(expense.date)}`,
    `Удалил(а): ${deletedBy}`,
  ];
  if (expense.comment) lines.push(`Комментарий: ${expense.comment}`);
  return lines.join('\n');
}

export function buildExpenseChangedNotice(before: ExpenseNoticeRow, after: ExpenseNoticeRow, changedBy: string): string {
  const lines = [
    '✏️ Изменён расход',
    '',
    ...expenseLines(after),
    `Способ оплаты: ${change(method(before.payment_method), method(after.payment_method))}`,
    `Дата: ${change(date(before.date), date(after.date))}`,
    `Изменил(а): ${changedBy}`,
  ];
  if (after.comment) lines.push(`Комментарий: ${after.comment}`);
  return lines.join('\n');
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
  const lines = [
    '🗑 Удалён обмен денег',
    '',
    `Из: ${EXCHANGE_METHOD_LABELS[exchange.from_method]} — ${exchangeAmount(exchange.from_method, Number(exchange.from_amount))}`,
    `В: ${EXCHANGE_METHOD_LABELS[exchange.to_method]} — ${exchangeAmount(exchange.to_method, Number(exchange.to_amount))}`,
    `Дата: ${date(exchange.date)}`,
    `Удалил(а): ${deletedBy}`,
  ];
  if (exchange.comment) lines.push(`Комментарий: ${exchange.comment}`);
  return lines.join('\n');
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
  const total = parts.reduce((sum, [, amount]) => sum + amount, 0);
  return [
    '🗑 Удалена выручка клуба',
    '',
    ...parts.filter(([, amount]) => amount !== 0).map(([label, amount]) => `${label}: ${formatCurrency(amount)} сум`),
    `Итого: ${formatCurrency(total)} сум`,
    `Дата: ${date(entry.date)}`,
    `Удалил(а): ${deletedBy}`,
  ].join('\n');
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
