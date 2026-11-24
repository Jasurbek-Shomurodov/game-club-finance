import { formatDollars } from '../formatters';
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
  /** Dollars spent, on an expense paid from the reserve's USD account (124, 143). */
  dollars?: ExpenseDollars;
  /** Paid from the owner reserve's sums (136); dollar expenses are always the reserve's (143). */
  fromReserve?: boolean;
  /** Paid from money a collector took out of the till (169), not from the admin. */
  fromCollected?: boolean;
}

/**
 * The dollars of a USD-account expense. Its sums are what those dollars cost,
 * set by the database (184), so a notice names the dollars alone.
 */
export type ExpenseDollars = { amount: number } | null;

/** The dollars of a saved expense row, when it was paid from the USD account. */
export function expenseDollars(row: { payment_method?: string | null; usd_amount?: unknown }): ExpenseDollars {
  return row.payment_method === 'usd' && row.usd_amount != null ? { amount: Number(row.usd_amount) } : null;
}

/** The reserve's dollars, as the app names the account. */
export const USD_ACCOUNT_LABEL = 'Долларовый счёт';

/** What an expense took: "$90" from the USD account, otherwise its sums. */
export const expenseFigure = (amount: number, dollars?: ExpenseDollars) => (dollars ? formatDollars(dollars.amount) : sum(amount));

/** Whether the owner reserve paid a saved expense: its sums (136) or its dollars (143). */
export const expenseFromReserve = (row: { paid_from_reserve?: boolean | null; payment_method?: string | null }) => (
  row.paid_from_reserve === true || row.payment_method === 'usd'
);

/**
 * "Долларовый счёт" for a dollar expense; "Сумы" for the reserve's sums,
 * which have no method (155 stores them as cash); otherwise the method's label.
 */
export function expenseMethod(paymentMethod: string | null | undefined, dollars?: ExpenseDollars, fromReserve = false) {
  if (dollars) return USD_ACCOUNT_LABEL;
  return fromReserve && paymentMethod !== 'usd' ? 'Сумы' : method(paymentMethod);
}

/** Where the money came from: the reserve is the owner's own money, apart from Game Club and Bar. */
export const expenseSource = (paymentSource: string | null | undefined, fromReserve: boolean) => (
  fromReserve ? 'Резерв' : source(paymentSource)
);

/**
 * Where an expense's money came from and how, as the details line shows them.
 * The USD account stands in for both ("Долларовый счёт"): the reserve paid it,
 * and in dollars.
 */
export function expenseSourceAndMethod(
  paymentSource: string | null | undefined,
  paymentMethod: string | null | undefined,
  dollars: ExpenseDollars | undefined,
  fromReserve: boolean,
): [string, string | null] {
  return dollars
    ? [USD_ACCOUNT_LABEL, null]
    : [expenseSource(paymentSource, fromReserve), expenseMethod(paymentMethod, null, fromReserve)];
}

export function buildExpenseNotification(input: ExpenseNotificationInput): string {
  const fromReserve = input.fromReserve === true || input.paymentMethod === 'usd';
  const [paidFrom, paidWith] = expenseSourceAndMethod(input.paymentSource, input.paymentMethod, input.dollars, fromReserve);
  return lines(
    `${fromReserve ? '🏦 Расход из резерва' : '💸 Расход'}: ${expenseFigure(input.amount, input.dollars)}`,
    details(
      paidFrom,
      !fromReserve && input.fromCollected === true && 'из собранных денег',
      RUSSIAN_EXPENSE_CATEGORY_LABELS[input.category] ?? input.category,
      paidWith,
      noticeDate(input.date),
    ),
    authorLine(input.addedBy, input.comment),
  );
}
