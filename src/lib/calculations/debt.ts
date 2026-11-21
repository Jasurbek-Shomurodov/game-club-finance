export function calculateRemainingDebt(amount: number, paidAmount: number): number {
  return Math.max(0, amount - paidAmount);
}

export function getDebtStatus(
  amount: number,
  paidAmount: number,
): 'unpaid' | 'partial' | 'paid' {
  if (paidAmount <= 0) return 'unpaid';
  if (paidAmount >= amount) return 'paid';
  return 'partial';
}

export function canManageDebts(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export type DebtPaymentInsertIssue = 'exceeds_remaining' | 'before_debt_date' | 'future_date' | 'other';

/**
 * Classifies a rejected debt_payments insert. The database re-checks payments
 * under a row lock (023/036), so a payment that passed the form can still be
 * refused when another payment landed first.
 */
export function classifyDebtPaymentInsertError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): DebtPaymentInsertIssue {
  const message = (error?.message ?? '').toLowerCase();
  if (error?.code === '22007') return 'future_date';
  if (error?.code !== '23514') return 'other';
  if (message.includes('earlier than the debt date')) return 'before_debt_date';
  if (message.includes('exceeds remaining debt') || message.includes('new_debts_paid_amount_valid')) {
    return 'exceeds_remaining';
  }
  return 'other';
}

/**
 * The date each debt was settled: its latest payment's business date. Dates
 * are ISO `YYYY-MM-DD`, so the string comparison is chronological.
 */
export function latestPaymentDateByDebt(
  payments: ReadonlyArray<{ debt_id: string; date: string }>,
): Record<string, string> {
  const latest: Record<string, string> = {};
  for (const { debt_id, date } of payments) {
    if (!latest[debt_id] || date > latest[debt_id]) latest[debt_id] = date;
  }
  return latest;
}

/** An open debt this many days old is flagged as overdue. */
export const OVERDUE_DEBT_DAYS = 30;

/** Whole days from the debt's business date to `today` (both ISO `YYYY-MM-DD`); never negative. */
export function debtAgeDays(date: string, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !/^\d{4}-\d{2}-\d{2}/.test(today)) return 0;
  const from = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const to = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const days = Math.round((to - from) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

export type OpenDebtSort = 'newest' | 'largest' | 'oldest';

interface SortableDebt {
  id: string | number;
  date: string;
  amount: number | string;
  paid_amount: number | string;
}

const remainingOf = (debt: SortableDebt) => calculateRemainingDebt(Number(debt.amount) || 0, Number(debt.paid_amount) || 0);

/**
 * Open debts in the order asked for, as a new array. `newest` keeps the order
 * they were read in (latest date first); ties keep that order too.
 */
export function sortOpenDebts<T extends SortableDebt>(debts: readonly T[], sort: OpenDebtSort): T[] {
  if (sort === 'newest') return [...debts];
  return debts
    .map((debt, index) => ({ debt, index }))
    .sort((a, b) => (
      (sort === 'largest' ? remainingOf(b.debt) - remainingOf(a.debt) : a.debt.date.localeCompare(b.debt.date))
      || a.index - b.index
    ))
    .map(({ debt }) => debt);
}

/** One person under every spelling of their name: case and spacing are ignored. */
export const debtPersonKey = (name: string | null | undefined) => (name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

export interface PersonOpenDebts {
  remaining: number;
  count: number;
}

/** What each person still owes across all their open debts, by `debtPersonKey`. */
export function openDebtsByPerson(
  debts: ReadonlyArray<SortableDebt & { person_name: string | null }>,
): Map<string, PersonOpenDebts> {
  const byPerson = new Map<string, PersonOpenDebts>();
  for (const debt of debts) {
    const remaining = remainingOf(debt);
    if (remaining <= 0) continue;
    const key = debtPersonKey(debt.person_name);
    const person = byPerson.get(key) ?? { remaining: 0, count: 0 };
    person.remaining += remaining;
    person.count += 1;
    byPerson.set(key, person);
  }
  return byPerson;
}

export interface DebtsSummary {
  /** What is still owed across every debt that is not paid off. */
  outstandingTotal: number;
  /** Distinct people (by trimmed, case-insensitive name) with a debt that is not paid off. */
  debtorCount: number;
  /** Everything paid back so far, across open and paid debts. */
  paidTotal: number;
}

/** The Debts page's headline totals. A debt is open until its status is `paid`. */
export function summarizeDebts(
  debts: ReadonlyArray<{ amount: number | string; paid_amount: number | string; person_name: string; status?: string | null }>,
): DebtsSummary {
  const debtors = new Set<string>();
  let outstandingTotal = 0;
  let paidTotal = 0;
  for (const debt of debts) {
    paidTotal += Number(debt.paid_amount) || 0;
    if (debt.status === 'paid') continue;
    outstandingTotal += calculateRemainingDebt(Number(debt.amount) || 0, Number(debt.paid_amount) || 0);
    debtors.add(debt.person_name.trim().toLocaleLowerCase());
  }
  return { outstandingTotal, debtorCount: debtors.size, paidTotal };
}
