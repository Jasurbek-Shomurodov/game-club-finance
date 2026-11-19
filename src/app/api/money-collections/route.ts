import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { actorName } from '@/lib/telegram/actorName';
import { buildMoneyCollectedNotice, sendClubNotice } from '@/lib/telegram/entryChangeNotification';
import { isCollectedMethod, type CollectedMethod } from '@/lib/calculations/collectedMoney';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ERRORS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  INSUFFICIENT_BALANCE: 409,
  SERVER_ERROR: 500,
} as const;

function errorResponse(code: keyof typeof ERRORS) {
  return Response.json({ code }, { status: ERRORS[code] });
}

/** Whole positive sums per method; null when the body is malformed or takes nothing. */
function readAmounts(value: unknown): Partial<Record<CollectedMethod, number>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const amounts: Partial<Record<CollectedMethod, number>> = {};
  for (const [method, amount] of Object.entries(value)) {
    if (!isCollectedMethod(method) || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null;
    if (amount > 0) amounts[method] = amount;
  }
  return Object.keys(amounts).length > 0 ? amounts : null;
}

/**
 * A collector takes money out of the admin's till (migration 169) and the
 * club group is told. The RPC runs as the signed-in user and decides access;
 * a retry of a saved request succeeds without a second notice.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as {
    clubId?: unknown; requestId?: unknown; date?: unknown; amounts?: unknown; comment?: unknown;
  } | null;
  const amounts = readAmounts(body?.amounts);
  if (!body || typeof body.clubId !== 'string' || !UUID.test(body.clubId)
    || typeof body.requestId !== 'string' || !UUID.test(body.requestId)
    || typeof body.date !== 'string' || !ISO_DATE.test(body.date)
    || !amounts
    || (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string')) {
    return errorResponse('INVALID_REQUEST');
  }
  const { clubId, date } = body;
  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;

  const { data: saved, error } = await supabase.rpc('collect_money', {
    p_club_id: clubId,
    p_request_id: body.requestId,
    p_date: date,
    p_amounts: amounts,
    p_comment: comment,
  });
  if (error) {
    if (error.code === '42501') return errorResponse('FORBIDDEN');
    if (error.hint === 'INSUFFICIENT_BALANCE') return errorResponse('INSUFFICIENT_BALANCE');
    if (error.code === '22007' || error.code === '23514') return errorResponse('INVALID_REQUEST');
    console.error('[money-collections] rpc failed', { clubId, date, code: error.code, error: error.message });
    return errorResponse('SERVER_ERROR');
  }

  if (saved) {
    after(async () => sendClubNotice(
      clubId,
      buildMoneyCollectedNotice(date, amounts, await actorName(supabase, user), comment),
      { date, action: 'money_collected' },
    ));
  }
  return Response.json({ saved: Boolean(saved) }, { status: saved ? 201 : 200 });
}
