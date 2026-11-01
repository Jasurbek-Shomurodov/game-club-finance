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

/** The club's enabled methods, plus PlayStation money when Game Club money pays the expense. */
export function expensePaymentMethods(
  enabled: readonly EntryPaymentMethod[],
  source: ExpensePaymentSource,
): ExpensePaymentMethod[] {
  return source === 'game_club' ? [...enabled, 'playstation'] : [...enabled];
}

export function defaultPaymentMethod(methods: readonly EntryPaymentMethod[]): EntryPaymentMethod {
  return methods[0] ?? PAYMENT_METHODS[0];
}
