import {
  PAYMENT_METHODS,
  type EntryPaymentMethod,
  type ExpensePaymentMethod,
  type ExpensePaymentSource,
} from '../types';

export function normalizePaymentMethods(value: unknown): EntryPaymentMethod[] {
  if (!Array.isArray(value)) return [...PAYMENT_METHODS];

  const requested = new Set(value);
  const methods = PAYMENT_METHODS.filter((method) => requested.has(method));

  return methods.length > 0 ? methods : [...PAYMENT_METHODS];
}

/** The club's enabled methods, plus PlayStation money and US dollars when Game Club money pays the expense. */
export function expensePaymentMethods(
  enabled: readonly EntryPaymentMethod[],
  source: ExpensePaymentSource,
): ExpensePaymentMethod[] {
  return source === 'game_club' ? [...enabled, 'playstation', 'usd'] : [...enabled];
}

/** Expense amount in sums for dollars at a rate, as the 124 constraint stores it. */
export function dollarExpenseAmount(usdAmount: number, rate: number): number | null {
  if (!Number.isFinite(usdAmount) || !Number.isFinite(rate) || usdAmount <= 0 || rate <= 0) return null;
  const amount = Math.round(usdAmount * rate);
  return amount > 0 ? amount : null;
}

export function defaultPaymentMethod(methods: readonly EntryPaymentMethod[]): EntryPaymentMethod {
  return methods[0] ?? PAYMENT_METHODS[0];
}
