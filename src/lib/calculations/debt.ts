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
