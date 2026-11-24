import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { deliverActivityNotices } from '@/lib/telegram/activityDelivery';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One small round per call, every send done well before maxDuration, so the
// function is never stopped holding claimed rows: what is not sent in time is
// given back to pending for the next call or the nightly report.
const ACTIVITY_NOTICE_BATCH = 10;
const DELIVERY_BUDGET_MS = 45_000;

/**
 * Asks for a club's pending activity notices (migration 183) to be sent,
 * after a page saved something investors should hear about. The page says
 * nothing about the change: the notices report what the database captured.
 * Any member may ask; the sending runs after the response and never fails
 * or delays the save.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ failure: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { clubId?: unknown } | null;
  if (!body || typeof body.clubId !== 'string' || !UUID.test(body.clubId)) {
    return Response.json({ failure: 'invalid' }, { status: 400 });
  }
  const { clubId } = body as { clubId: string };

  const { data: membership, error } = await supabase
    .from('club_memberships')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('[activity] membership lookup failed', { clubId, error: error.message });
    return Response.json({ failure: 'failed' }, { status: 500 });
  }
  if (!membership) return Response.json({ failure: 'forbidden' }, { status: 403 });

  const deadlineAt = Date.now() + DELIVERY_BUDGET_MS;
  after(async () => {
    try {
      await deliverActivityNotices(createServiceClient(), clubId, {
        batchSize: ACTIVITY_NOTICE_BATCH,
        maxBatches: 1,
        deadlineAt,
      });
    } catch (deliveryError) {
      console.error('[activity] delivery failed', {
        clubId, error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
      });
    }
  });
  return Response.json({ queued: true });
}
