import { mutateFinanceRequest } from '@/lib/supabase/client';
import type { RecordShortageInput, ShortageErrorCode } from '@/lib/supabase/cashShortages';

/** Through the route, so the club's owners-only Telegram group hears about it once. */
export async function recordCashShortage(clubId: string, input: RecordShortageInput): Promise<ShortageErrorCode | null> {
  const response = await mutateFinanceRequest('/api/cash-shortages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.id,
      clubId,
      date: input.date,
      source: input.source,
      method: input.method,
      amount: input.amount,
      reason: input.reason,
      employeeId: input.employeeId,
      comment: input.comment.trim(),
      recoverAmount: input.employeeId ? input.recoverAmount : 0,
      recoveryId: input.employeeId && input.recoverAmount > 0 ? input.recoveryId : null,
    }),
  });
  if (response.ok) return null;
  const result = await response.json().catch(() => null) as { code?: string } | null;
  const codes: readonly string[] = ['note_required', 'day_collected', 'recovery_too_large', 'no_employee', 'has_recoveries', 'migration_required', 'forbidden'];
  return result?.code && codes.includes(result.code) ? result.code as ShortageErrorCode : response.status === 401 ? 'forbidden' : 'failed';
}
