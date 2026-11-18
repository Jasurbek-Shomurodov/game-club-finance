/** Categories a person can choose when registering an expense by hand. */
export const MANUAL_EXPENSE_CATEGORIES = [
  'rent', 'electricity', 'internet', 'repair', 'cleaning',
  'food_drinks', 'marketing', 'equipment', 'tax',
  'correction', 'discount', 'supplies', 'investments',
] as const;

/**
 * Every category an expense row may have. `salary` is written only by the
 * payroll flow (record_salary_entry) and `shortage` only with a cash shortage
 * (record_cash_shortage), never chosen by hand. Migrations 068, 069, 088 and
 * 135 enforce this list in the database.
 */
export const EXPENSE_CATEGORIES = [
  'salary', ...MANUAL_EXPENSE_CATEGORIES, 'shortage',
] as const;

export type KnownExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isKnownExpenseCategory(category: string): category is KnownExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(category);
}

export function isManualExpenseCategory(category: string): boolean {
  return (MANUAL_EXPENSE_CATEGORIES as readonly string[]).includes(category);
}

/** Categories only the owner reserve may pay: investments are the owner's own money put into the club. */
export const RESERVE_ONLY_EXPENSE_CATEGORIES: readonly string[] = ['investments'];

/** Whether an expense of `category` may be paid this way; reserve-only categories need the reserve. */
export function isCategoryAllowedForSource(category: string, fromReserve: boolean): boolean {
  return fromReserve || !RESERVE_ONLY_EXPENSE_CATEGORIES.includes(category);
}

/** The hand-chosen categories offered for an expense paid from the reserve or not. */
export function manualExpenseCategoriesFor(fromReserve: boolean): string[] {
  return MANUAL_EXPENSE_CATEGORIES.filter((category) => isCategoryAllowedForSource(category, fromReserve));
}
