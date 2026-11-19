export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ok = (): ValidationResult => ({ valid: true });
const fail = (error: string): ValidationResult => ({ valid: false, error });

/** Date must be a valid ISO date string YYYY-MM-DD */
export function validateDate(value: unknown): ValidationResult {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail('Date must be in YYYY-MM-DD format.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return fail('Invalid date.');
  }
  return ok();
}

/** Debt payment cannot exceed remaining balance */
export function validateDebtPayment(opts: {
  paymentAmount: number;
  remainingDebt: number;
}): ValidationResult {
  if (opts.paymentAmount <= 0) return fail('Payment amount must be positive.');
  if (opts.paymentAmount > opts.remainingDebt) {
    return fail(
      `Payment (${opts.paymentAmount}) exceeds remaining debt (${opts.remainingDebt}). Overpayment is not allowed.`,
    );
  }
  return ok();
}

export type DebtDateIssue = 'invalid' | 'future' | 'before_debt' | null;

/** Debt ledger dates must be valid business dates and payments cannot predate the debt. */
export function getDebtDateIssue(opts: {
  date: string;
  businessDate: string;
  debtDate?: string;
}): DebtDateIssue {
  if (!validateDate(opts.date).valid || !validateDate(opts.businessDate).valid) return 'invalid';
  if (opts.date > opts.businessDate) return 'future';
  if (opts.debtDate && (!validateDate(opts.debtDate).valid || opts.date < opts.debtDate)) return 'before_debt';
  return null;
}

/** Cookie that carries the post-login destination across the OAuth round trip. */
export const LOGIN_NEXT_COOKIE = 'gcf-login-next';

const REDIRECT_PROBE_ORIGIN = 'http://redirect.invalid';

/**
 * Returns a same-origin, path-only redirect target, or null when the value is
 * unsafe (absolute or protocol-relative URL, backslashes, control characters)
 * or would loop back into the login flow.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // Browsers treat "\" like "/", so "/\evil.com" would be protocol-relative.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, REDIRECT_PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== REDIRECT_PROBE_ORIGIN) return null;
  // Dot segments normalize away: "/.//evil.com" parses to the path "//evil.com",
  // which is protocol-relative again once it is returned.
  if (url.pathname.startsWith('//')) return null;
  if (url.pathname === '/login' || url.pathname.startsWith('/login/') || url.pathname.startsWith('/auth/')) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
