/**
 * Stable error codes returned by POST /api/salaries. The browser maps each code
 * to a translated message; raw database text is only logged on the server.
 */
export const SALARY_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'OWNER_ONLY',
  'CHECK_FAILED',
  'PAYMENT_METHOD_DISABLED',
  'REQUEST_CONFLICT',
  'INVALID_DATE',
  'INVALID_VALUES',
  'NOT_FOUND',
  'SETTINGS_MISSING',
  'LAST_RATE',
  'SERVER_ERROR',
] as const;

export type SalaryErrorCode = (typeof SALARY_ERROR_CODES)[number];

export const SALARY_ERROR_TEXT: Record<SalaryErrorCode, string> = {
  UNAUTHORIZED: 'Unauthorized',
  INVALID_REQUEST: 'Invalid salary request',
  FORBIDDEN: 'Salary editing access is required',
  OWNER_ONLY: 'Only a club owner can change payroll terms',
  CHECK_FAILED: 'The values were rejected',
  PAYMENT_METHOD_DISABLED: 'Payment method is not enabled for this club',
  REQUEST_CONFLICT: 'This request was already used for a different entry',
  INVALID_DATE: 'Invalid payroll date',
  INVALID_VALUES: 'Invalid salary values',
  NOT_FOUND: 'Salary record not found',
  SETTINGS_MISSING: 'Employee salary settings are missing',
  LAST_RATE: 'The last salary rate cannot be deleted',
  SERVER_ERROR: 'Salary change failed',
};

const STATUS: Record<SalaryErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  OWNER_ONLY: 403,
  CHECK_FAILED: 400,
  PAYMENT_METHOD_DISABLED: 400,
  REQUEST_CONFLICT: 409,
  INVALID_DATE: 400,
  INVALID_VALUES: 400,
  NOT_FOUND: 404,
  SETTINGS_MISSING: 409,
  LAST_RATE: 409,
  SERVER_ERROR: 500,
};

export function isSalaryErrorCode(value: unknown): value is SalaryErrorCode {
  return typeof value === 'string' && (SALARY_ERROR_CODES as readonly string[]).includes(value);
}

/** Maps a payroll RPC error to a stable code; anything unrecognised is a server fault. */
export function salaryErrorCode(error: { code?: string | null; message?: string | null }): SalaryErrorCode {
  const message = error.message ?? '';
  if (error.code === '42501') return /club owner/i.test(message) ? 'OWNER_ONLY' : 'FORBIDDEN';
  if (error.code === '23514') return 'CHECK_FAILED';
  if (error.code === '23505') return 'REQUEST_CONFLICT';
  // Payroll RPCs raise plain exceptions (P0001) for business-rule rejections.
  if (error.code && error.code !== 'P0001') return 'SERVER_ERROR';
  if (/payment method is not enabled/i.test(message)) return 'PAYMENT_METHOD_DISABLED';
  if (/already been used for a different entry/i.test(message)) return 'REQUEST_CONFLICT';
  if (/invalid payroll date|cannot start before|must start on the current business date/i.test(message)) return 'INVALID_DATE';
  if (/does not belong to this club/i.test(message)) return 'NOT_FOUND';
  if (/settings are missing/i.test(message)) return 'SETTINGS_MISSING';
  if (/last salary rate cannot be deleted/i.test(message)) return 'LAST_RATE';
  if (/^invalid /i.test(message)) return 'INVALID_VALUES';
  return error.code === 'P0001' ? 'INVALID_VALUES' : 'SERVER_ERROR';
}

export function salaryErrorResponse(code: SalaryErrorCode) {
  return Response.json({ error: SALARY_ERROR_TEXT[code], code }, { status: STATUS[code] });
}
