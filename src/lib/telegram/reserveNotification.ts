import { formatCurrency, formatYearMonth } from '../formatters';
import { authorLine, commentLine, details, lines, method, source, sum } from './messageParts';

/** One method's share of a reserve move; Bar moves have a single part without a method. */
export interface ReserveNoticePart {
  method: string | null;
  amount: number;
}

export interface ReserveMoveNoticeInput {
  kind: 'deposit' | 'return';
  /** YYYY-MM whose owner profit the money left (deposit) or joined (return). */
  month: string;
  source: string;
  parts: readonly ReserveNoticePart[];
  comment: string | null;
  by: string;
}

/** "октябрь 2026" */
const profitMonth = (month: string) => formatYearMonth(month, 'ru').toLocaleLowerCase('ru');

/** "Наличные 649 200 · PlayStation 210 000", or just the method for a single part. */
const partsLine = (parts: readonly ReserveNoticePart[]) => (
  parts.length === 1
    ? (parts[0].method ? method(parts[0].method) : null)
    : parts.map((part) => `${method(part.method)} ${formatCurrency(part.amount)}`).join(' · ')
);

/** Money moved between a month's owner profit and the reserve. */
export function buildReserveMoveNotice(input: ReserveMoveNoticeInput): string {
  const total = input.parts.reduce((all, part) => all + part.amount, 0);
  const deposit = input.kind === 'deposit';
  return lines(
    deposit ? `🏦 В резерв: ${sum(total)}` : `↩️ Из резерва в прибыль: ${sum(total)}`,
    details(
      source(input.source),
      partsLine(input.parts),
      `${deposit ? 'из прибыли за' : 'в прибыль за'} ${profitMonth(input.month)}`,
    ),
    authorLine(input.by, input.comment),
  );
}

export interface ReserveEntryNoticeRow {
  kind: 'deposit' | 'return';
  /** First day of the month, YYYY-MM-DD. */
  period_month: string;
  source: string;
  payment_method: string | null;
  amount: number | string;
  comment: string | null;
}

/** A deposit or return was deleted, so the money went back where it came from. */
export function buildReserveEntryDeletedNotice(entry: ReserveEntryNoticeRow, deletedBy: string): string {
  const deposit = entry.kind === 'deposit';
  return lines(
    `🗑 Удалено ${deposit ? 'внесение в резерв' : 'возвращение из резерва'}: ${sum(Number(entry.amount))}`,
    details(
      source(entry.source),
      entry.payment_method && method(entry.payment_method),
      `${deposit ? 'деньги вернулись в прибыль за' : 'деньги вернулись в резерв из прибыли за'} ${profitMonth(entry.period_month.slice(0, 7))}`,
    ),
    commentLine(entry.comment),
    `Удалил(а) ${deletedBy}`,
  );
}
