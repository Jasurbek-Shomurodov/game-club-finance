import { isNoteRequiredError } from '@/lib/entryNote';
import { isDayCollectedError } from '@/lib/supabase/dailyCashCollections';

/**
 * Stable error codes returned by /api/expenses. The browser maps each code to a
 * translated message; raw database text is only logged on the server.
 */
export const EXPENSE_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'NOTE_REQUIRED',
  'FORBIDDEN',
  'PAYMENT_METHOD_DISABLED',
  'CHECK_FAILED',
  'REQUEST_CONFLICT',
  'INVALID_VALUES',
  'NOT_FOUND',
  'SALARY_PAYMENT_IMMUTABLE',
  'PRESET_UNAVAILABLE',
  'DAY_COLLECTED',
  'SERVER_ERROR',
] as const;

export type ExpenseErrorCode = (typeof EXPENSE_ERROR_CODES)[number];

const ERRORS: Record<ExpenseErrorCode, { status: number; text: string }> = {
  UNAUTHORIZED: { status: 401, text: 'Unauthorized' },
  INVALID_REQUEST: { status: 400, text: 'Invalid expense data' },
  NOTE_REQUIRED: { status: 400, text: 'The note must have at least 5 words' },
  FORBIDDEN: { status: 403, text: 'Forbidden' },
  PAYMENT_METHOD_DISABLED: { status: 400, text: 'Payment method is not enabled for this club' },
  CHECK_FAILED: { status: 400, text: 'The values were rejected' },
  REQUEST_CONFLICT: { status: 409, text: 'This request was already used for a different expense' },
  INVALID_VALUES: { status: 400, text: 'Invalid expense values' },
  NOT_FOUND: { status: 404, text: 'Expense not found' },
  SALARY_PAYMENT_IMMUTABLE: { status: 409, text: 'Salary payments can only be removed from Salaries' },
  PRESET_UNAVAILABLE: { status: 409, text: 'The planned expense is archived or no longer matches this expense' },
  DAY_COLLECTED: { status: 409, text: 'The money for this day was collected; the day is closed' },
  SERVER_ERROR: { status: 500, text: 'Expense change failed' },
};

export function isExpenseErrorCode(value: unknown): value is ExpenseErrorCode {
  return typeof value === 'string' && (EXPENSE_ERROR_CODES as readonly string[]).includes(value);
}

/** Maps a database error to a stable code; anything unrecognised is a server fault. */
export function expenseErrorCode(error: { code?: string | null; message?: string | null; hint?: string | null }): ExpenseErrorCode {
  const message = error.message ?? '';
  // The 097 trigger: the day's money was collected, so the day is closed.
  if (isDayCollectedError(error)) return 'DAY_COLLECTED';
  // The 108 trigger: a manual expense needs a note of at least 5 words.
  if (isNoteRequiredError(error)) return 'NOTE_REQUIRED';
  if (/salary payments cannot be (deleted|edited)/i.test(message)) return 'SALARY_PAYMENT_IMMUTABLE';
  // The 091 trigger: an archived, foreign or mismatched planned expense.
  if (/expense preset is not available|does not match its preset/i.test(message)) return 'PRESET_UNAVAILABLE';
  if (error.code === '42501') return 'FORBIDDEN';
  if (error.code === '23514') return 'CHECK_FAILED';
  if (error.code === '23505') return 'REQUEST_CONFLICT';
  if (error.code === 'P0001') return 'INVALID_VALUES';
  if (error.code === 'P0002') return 'NOT_FOUND';
  return 'SERVER_ERROR';
}

export function expenseErrorResponse(code: ExpenseErrorCode) {
  const { status, text } = ERRORS[code];
  return Response.json({ error: text, code }, { status });
}
