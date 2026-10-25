import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchIsDateCollected } from '@/lib/supabase/dailyCashCollections';
import { actorName } from '@/lib/telegram/actorName';
import { buildDayCollectedNotice, buildDayUncollectedNotice, sendClubNotice } from '@/lib/telegram/entryChangeNotification';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && ISO_DATE.test(value);

const ERRORS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  SERVER_ERROR: 500,
} as const;

function errorResponse(code: keyof typeof ERRORS) {
  return Response.json({ code }, { status: ERRORS[code] });
}

async function readRequest(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');
  const body = await request.json().catch(() => null) as { clubId?: unknown; date?: unknown } | null;
  if (!body || !isId(body.clubId) || !isDate(body.date)) return errorResponse('INVALID_REQUEST');
  return { supabase, user, clubId: body.clubId, date: body.date };
}

function rpcFailure(error: { code?: string; message?: string }, context: Record<string, unknown>) {
  if (error.code === '42501') return errorResponse('FORBIDDEN');
  if (error.code === '22007') return errorResponse('INVALID_REQUEST');
  console.error('[collections] rpc failed', { ...context, code: error.code, error: error.message });
  return errorResponse('SERVER_ERROR');
}

/**
 * Ticks a business date as collected and tells the club group. The RPC runs
 * as the signed-in user and decides access (migration 096); a date that was
 * already ticked succeeds without a second notice.
 */
export async function POST(request: Request) {
  const parsed = await readRequest(request);
  if (parsed instanceof Response) return parsed;
  const { supabase, user, clubId, date } = parsed;

  const { data: ticked, error } = await supabase.rpc('mark_daily_cash_collected', { p_club_id: clubId, p_date: date });
  if (error) return rpcFailure(error, { clubId, date, action: 'mark' });

  if (ticked) {
    after(async () => sendClubNotice(clubId, buildDayCollectedNotice(date, await actorName(supabase, user)), { date, action: 'collected' }));
  }
  return Response.json({ collected: true });
}

/**
 * Removes a collected tick (owner only, enforced by the RPC) and tells the
 * club group. A date that was not ticked succeeds without a notice.
 */
export async function DELETE(request: Request) {
  const parsed = await readRequest(request);
  if (parsed instanceof Response) return parsed;
  const { supabase, user, clubId, date } = parsed;

  let wasCollected: boolean;
  try {
    wasCollected = await fetchIsDateCollected(supabase, clubId, date);
  } catch (lookupError) {
    console.error('[collections] lookup failed', { clubId, date, error: lookupError instanceof Error ? lookupError.message : String(lookupError) });
    return errorResponse('SERVER_ERROR');
  }

  const { error } = await supabase.rpc('unmark_daily_cash_collected', { p_club_id: clubId, p_date: date });
  if (error) return rpcFailure(error, { clubId, date, action: 'unmark' });

  if (wasCollected) {
    after(async () => sendClubNotice(clubId, buildDayUncollectedNotice(date, await actorName(supabase, user)), { date, action: 'uncollected' }));
  }
  return Response.json({ collected: false });
}
