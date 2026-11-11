import { after } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { validateEntryNote } from '@/lib/entryNote';
import { createClient } from '@/lib/supabase/server';
import { shortageErrorCode, type ShortageErrorCode } from '@/lib/supabase/cashShortages';
import { actorName } from '@/lib/telegram/actorName';
import { buildCashShortageNotification } from '@/lib/telegram/cashShortageNotification';
import { ownerChatId } from '@/lib/telegram/clubChat';
import { isIsoDate, sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';
import { CASH_SHORTAGE_REASONS, type CashShortageMethod, type CashShortageReason, type OwnerWithdrawalSource } from '@/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const METHODS: readonly string[] = ['cash', 'terminal', 'card', 'playstation'];

const STATUS: Record<ShortageErrorCode, number> = {
  note_required: 400,
  day_collected: 409,
  recovery_too_large: 409,
  no_employee: 400,
  has_recoveries: 409,
  migration_required: 503,
  forbidden: 403,
  failed: 500,
};

const errorResponse = (code: ShortageErrorCode | 'invalid_request' | 'unauthorized') => Response.json(
  { code },
  { status: code === 'invalid_request' ? 400 : code === 'unauthorized' ? 401 : STATUS[code] },
);

interface ShortageInput {
  clubId: string;
  date: string;
  source: OwnerWithdrawalSource;
  method: CashShortageMethod;
  amount: number;
  reason: CashShortageReason;
  employeeId: string | null;
  recoverAmount: number;
  comment: string;
}

/** Best-effort, after the response, to the owners-only group: admins never see a shortage. */
async function notifyOwners(supabase: SupabaseClient, user: User, input: ShortageInput) {
  const chatId = ownerChatId(input.clubId);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return;
  try {
    const employee = input.employeeId
      ? (await supabase.from('salary_employees').select('name').eq('club_id', input.clubId).eq('id', input.employeeId).maybeSingle()).data?.name ?? null
      : null;
    await sendTelegramMessage({
      botToken,
      chatId,
      text: buildCashShortageNotification({
        addedBy: await actorName(supabase, user),
        date: input.date,
        source: input.source,
        method: input.method,
        amount: input.amount,
        reason: input.reason,
        employee,
        recovered: input.recoverAmount,
        comment: input.comment,
      }),
    });
  } catch (error) {
    console.error('[telegram/cash-shortage] notification failed', {
      clubId: input.clubId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Records a cash shortage (owner-only, migration 135) and tells the club's owners group once. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('unauthorized');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.id) || !isId(body.clubId) || typeof body.date !== 'string' || !isIsoDate(body.date)
    || (body.source !== 'game_club' && body.source !== 'bar')
    || typeof body.method !== 'string' || !METHODS.includes(body.method)
    || !isWhole(body.amount) || body.amount <= 0
    || typeof body.reason !== 'string' || !(CASH_SHORTAGE_REASONS as readonly string[]).includes(body.reason)
    || (body.employeeId !== null && !isId(body.employeeId))
    || !isWhole(body.recoverAmount) || body.recoverAmount > body.amount
    || (body.recoverAmount > 0 && (!isId(body.recoveryId) || body.employeeId === null))
    || typeof body.comment !== 'string' || body.comment.length > 1000) {
    return errorResponse('invalid_request');
  }
  if (!validateEntryNote(body.comment).valid) return errorResponse('note_required');
  const input: ShortageInput = {
    clubId: body.clubId,
    date: body.date,
    source: body.source,
    method: body.method as CashShortageMethod,
    amount: body.amount,
    reason: body.reason as CashShortageReason,
    employeeId: body.employeeId as string | null,
    recoverAmount: body.recoverAmount,
    comment: body.comment.trim(),
  };

  // Ownership, the business date, the method and the recovery are checked atomically; a retried id is saved once.
  const { data, error } = await supabase.rpc('record_cash_shortage', {
    p_club_id: input.clubId,
    p_id: body.id,
    p_date: input.date,
    p_payment_source: input.source,
    p_payment_method: input.method,
    p_amount: input.amount,
    p_reason: input.reason,
    p_employee_id: input.employeeId,
    p_comment: input.comment,
    p_recover_amount: input.recoverAmount,
    p_recovery_id: input.recoverAmount > 0 ? body.recoveryId : null,
  });
  if (error) {
    const code = shortageErrorCode(error, 'record_cash_shortage');
    if (code === 'failed') console.error('[cash-shortages] record failed', { clubId: input.clubId, code: error.code, error: error.message });
    return errorResponse(code);
  }
  const created = data === true;
  if (created) after(() => notifyOwners(supabase, user, input));
  return Response.json({ created }, { status: created ? 201 : 200 });
}
