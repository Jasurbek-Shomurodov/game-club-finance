import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteDailyCashEntry } from '@/lib/supabase/dailyCashEntries';
import { actorName } from '@/lib/telegram/actorName';
import { buildIncomeDeletedNotice, sendClubNotice, type IncomeNoticeRow } from '@/lib/telegram/entryChangeNotification';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const ERRORS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

function errorResponse(code: keyof typeof ERRORS) {
  return Response.json({ code }, { status: ERRORS[code] });
}

/**
 * Deletes a daily income entry and tells the club group. The delete runs as
 * the signed-in user, so RLS (owner only, migration 036) decides; a refused
 * or missing row is a 404 and sends nothing.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as { clubId?: unknown; entryId?: unknown } | null;
  if (!body || !isId(body.clubId) || !isId(body.entryId)) return errorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const entryId = body.entryId;

  const { data: entry, error } = await supabase
    .from('daily_cash_entries')
    .select('date, cash_income, terminal_income, card_income, playstation_income')
    .eq('club_id', clubId)
    .eq('id', entryId)
    .maybeSingle();
  if (error) {
    console.error('[daily-cash] lookup failed', { clubId, entryId, code: error.code, error: error.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!entry || !(await deleteDailyCashEntry(supabase, clubId, entryId))) return errorResponse('NOT_FOUND');

  // A deletion is silent in Telegram, so the group gets its own notice.
  after(async () => sendClubNotice(
    clubId,
    buildIncomeDeletedNotice(entry as IncomeNoticeRow, await actorName(supabase, user)),
    { entryId },
  ));
  return Response.json({ deleted: true });
}
