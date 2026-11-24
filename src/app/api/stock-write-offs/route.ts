import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessFeature } from '@/lib/permissions';
import type { UserRole } from '@/types';
import { rowStockAdjustment } from '@/lib/stockWriteOffs';
import { actorName } from '@/lib/telegram/actorName';
import { sendClubNotice } from '@/lib/telegram/entryChangeNotification';
import { isIsoDate } from '@/lib/telegram/sendDailyFinanceReport';
import { buildStockWriteOffNotice } from '@/lib/telegram/stockWriteOffNotification';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * Tells the club's group about a bar write-off just saved on Closing Stock or
 * Write-offs. The write-off itself is saved by save_closing_stock_counts
 * (owners and admins with the bar, migration 164); this reads the saved count
 * back, so the message reports what the database
 * holds, never what the browser claims.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ failure: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.clubId) || !isId(body.productId) || typeof body.date !== 'string' || !isIsoDate(body.date)) {
    return Response.json({ failure: 'invalid' }, { status: 400 });
  }
  const { clubId, productId, date } = body as { clubId: string; productId: string; date: string };

  const { data: membership } = await supabase
    .from('club_memberships')
    .select('role, feature_access')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle();
  // The members who can save a write-off: owners and admins with the bar.
  const role = membership?.role as UserRole | undefined;
  if ((role !== 'owner' && role !== 'admin') || !canAccessFeature(role, membership?.feature_access, 'closing_stock')) {
    return Response.json({ failure: 'forbidden' }, { status: 403 });
  }

  const { data: count, error } = await supabase
    .from('daily_stock_counts')
    .select('adjustment_quantity, adjustment_reason, cost_price, products(name)')
    .eq('club_id', clubId)
    .eq('date', date)
    .eq('product_id', productId)
    .maybeSingle();
  if (error) {
    console.error('[stock-write-offs] lookup failed', { clubId, productId, date, error: error.message });
    return Response.json({ failure: 'failed' }, { status: 500 });
  }
  if (!count) return Response.json({ failure: 'not_found' }, { status: 404 });

  const product = count.products as { name?: string | null } | Array<{ name?: string | null }> | null;
  const productName = (Array.isArray(product) ? product[0]?.name : product?.name) || 'Товар';
  const parsed = rowStockAdjustment({
    adjustmentQuantity: String(count.adjustment_quantity ?? 0),
    adjustmentReason: count.adjustment_reason ?? '',
  });
  const kind = parsed && parsed.kind !== 'other' ? parsed.kind : null;
  const quantity = kind ? parsed!.quantity : 0;

  // A correction is announced by the activity notices (migration 183), which
  // report the saved count, so it is not announced here as well.
  if (kind === 'correction') return Response.json({ notified: false });

  // Best-effort, after the response: Telegram never fails or delays the save.
  after(async () => {
    const text = buildStockWriteOffNotice({
      date, productName, kind, quantity, cost: quantity * (Number(count.cost_price ?? 0) || 0), note: parsed?.note ?? '', by: await actorName(supabase, user),
    });
    await sendClubNotice(clubId, text, { productId, date });
  });
  return Response.json({ notified: true });
}
