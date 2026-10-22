/** Categories a person can choose when registering an expense by hand. */
export const MANUAL_EXPENSE_CATEGORIES = [
  'rent', 'electricity', 'internet', 'repair', 'cleaning',
  'food_drinks', 'marketing', 'equipment', 'tax',
  'correction', 'discount', 'supplies', 'investments',
] as const;

/**
 * Every category an expense row may have. `salary` is written only by the
 * payroll flow (record_salary_entry), never chosen by hand. Migrations 068, 069 and 088
 * enforce this list in the database.
 */
export const EXPENSE_CATEGORIES = [
  'salary', ...MANUAL_EXPENSE_CATEGORIES,
] as const;

export type KnownExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isKnownExpenseCategory(category: string): category is KnownExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(category);
}

export function isManualExpenseCategory(category: string): boolean {
  return (MANUAL_EXPENSE_CATEGORIES as readonly string[]).includes(category);
}
