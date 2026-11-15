import { formatUnitCurrency } from '../formatters';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import { authorLine, details, lines, method, noticeDate, source, sum } from './messageParts';

export { PAYMENT_METHOD_LABELS } from './messageParts';

export interface ExpenseNotificationInput {
  addedBy: string;
  amount: number;
  category: string;
  comment: string | null;
  date: string;
  paymentMethod: string;
  paymentSource: 'game_club' | 'bar';
  /** Dollars spent and their rate, on an expense paid from the club's dollars (124). */
  dollars?: { amount: number; rate: number } | null;
}

export type ExpenseDollars = { amount: number; rate: number } | null;

/** Dollars and rate of a saved expense row, when it was paid in dollars. */
export function expenseDollars(row: { payment_method?: string | null; usd_amount?: unknown; usd_rate?: unknown }): ExpenseDollars {
  return row.payment_method === 'usd' && row.usd_amount != null && row.usd_rate != null
    ? { amount: Number(row.usd_amount), rate: Number(row.usd_rate) }
    : null;
}

/** "$7 по курсу 12 850" for a dollar expense, otherwise the method's label. */
export function expenseMethod(paymentMethod: string | null | undefined, dollars?: ExpenseDollars) {
  return dollars
    ? `$${formatUnitCurrency(dollars.amount)} по курсу ${formatUnitCurrency(dollars.rate)}`
    : method(paymentMethod);
}

export function buildExpenseNotification(input: ExpenseNotificationInput): string {
  return lines(
    `💸 Расход: ${sum(input.amount)}`,
    details(
      source(input.paymentSource),
      RUSSIAN_EXPENSE_CATEGORY_LABELS[input.category] ?? input.category,
      expenseMethod(input.paymentMethod, input.dollars),
      noticeDate(input.date),
    ),
    authorLine(input.addedBy, input.comment),
  );
}
