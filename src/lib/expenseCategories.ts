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

/**
 * Bar money pays only for cleaning: bar stock is recorded as a bar purchase,
 * not as an expense, so admins are not offered anything else there.
 */
const BAR_EXPENSE_CATEGORIES: readonly string[] = ['cleaning'];

/** Never chosen by hand from any source: food and drinks are bar purchases. */
const RETIRED_MANUAL_CATEGORIES: readonly string[] = ['food_drinks'];

/** Whether a manual expense of this category may be paid from this source. */
export function isExpenseCategoryAllowedForSource(
  category: string,
  source: 'game_club' | 'bar' | 'reserve',
): boolean {
  if (RETIRED_MANUAL_CATEGORIES.includes(category)) return false;
  return source !== 'bar' || BAR_EXPENSE_CATEGORIES.includes(category);
}

/** The manual categories offered when paying from this source. */
export function manualExpenseCategoriesFor(source: 'game_club' | 'bar' | 'reserve'): string[] {
  return MANUAL_EXPENSE_CATEGORIES.filter((category) => isExpenseCategoryAllowedForSource(category, source));
}
