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
  /** Paid from the owner reserve's sums (136); dollar expenses are always the reserve's (143). */
  fromReserve?: boolean;
  /** Paid from money a collector took out of the till (169), not from the admin. */
  fromCollected?: boolean;
}

export type ExpenseDollars = { amount: number; rate: number } | null;

/** Dollars and rate of a saved expense row, when it was paid in dollars. */
export function expenseDollars(row: { payment_method?: string | null; usd_amount?: unknown; usd_rate?: unknown }): ExpenseDollars {
  return row.payment_method === 'usd' && row.usd_amount != null && row.usd_rate != null
    ? { amount: Number(row.usd_amount), rate: Number(row.usd_rate) }
    : null;
}

/** Whether the owner reserve paid a saved expense: its sums (136) or its dollars (143). */
export const expenseFromReserve = (row: { paid_from_reserve?: boolean | null; payment_method?: string | null }) => (
  row.paid_from_reserve === true || row.payment_method === 'usd'
);

/**
 * "$7 по курсу 12 850" for a dollar expense; "Сумы" for the reserve's sums,
 * which have no method (155 stores them as cash); otherwise the method's label.
 */
export function expenseMethod(paymentMethod: string | null | undefined, dollars?: ExpenseDollars, fromReserve = false) {
  if (dollars) return `$${formatUnitCurrency(dollars.amount)} по курсу ${formatUnitCurrency(dollars.rate)}`;
  return fromReserve && paymentMethod !== 'usd' ? 'Сумы' : method(paymentMethod);
}

/** Where the money came from: the reserve is the owner's own money, apart from Game Club and Bar. */
export const expenseSource = (paymentSource: string | null | undefined, fromReserve: boolean) => (
  fromReserve ? 'Резерв' : source(paymentSource)
);

export function buildExpenseNotification(input: ExpenseNotificationInput): string {
  const fromReserve = input.fromReserve === true || input.paymentMethod === 'usd';
  return lines(
    `${fromReserve ? '🏦 Расход из резерва' : '💸 Расход'}: ${sum(input.amount)}`,
    details(
      expenseSource(input.paymentSource, fromReserve),
      !fromReserve && input.fromCollected === true && 'из собранных денег',
      RUSSIAN_EXPENSE_CATEGORY_LABELS[input.category] ?? input.category,
      expenseMethod(input.paymentMethod, input.dollars, fromReserve),
      noticeDate(input.date),
    ),
    authorLine(input.addedBy, input.comment),
  );
}
