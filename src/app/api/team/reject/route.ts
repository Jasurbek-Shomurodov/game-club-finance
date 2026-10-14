import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isMissingDatabaseColumn, isMissingDatabaseFunction } from '@/lib/supabase/errors';

interface RejectRequestBody {
  userId?: unknown;
}

type RejectOutcome = 'rejected' | 'has_access' | 'not_pending';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(status: number, code: string) {
  return Response.json({ error: code, code }, { status });
}

/**
 * Before migration 074: the same checks without the row lock. Kept so the
 * route keeps working while the migration is being deployed. Before 072 there
 * is no rejection mark, so the request can only be deleted ('unmarked').
 */
async function legacyMarkRejected(
  supabase: Awaited<ReturnType<typeof createClient>>,
  service: ReturnType<typeof createServiceClient>,
  ownerId: string,
  userId: string,
): Promise<RejectOutcome | 'unmarked' | { error: unknown }> {
  // RLS scopes this read to the caller's own memberships.
  const { data: ownedClubs, error: ownerError } = await supabase
    .from('club_memberships')
    .select('club_id')
    .eq('user_id', ownerId)
    .eq('role', 'owner')
    .limit(1);
  if (ownerError) return { error: ownerError };
  if (!ownedClubs || ownedClubs.length === 0) return { error: 'forbidden' };

  const [{ data: memberships, error: membershipError }, { data: profiles, error: profileError }] = await Promise.all([
    service.from('club_memberships').select('club_id').eq('user_id', userId).limit(1),
    service.from('profiles').select('id, access_rejected_at').eq('id', userId).limit(1),
  ]);
  const markAvailable = !isMissingDatabaseColumn(profileError, 'access_rejected_at');
  if (membershipError || (profileError && markAvailable)) return { error: membershipError ?? profileError };
  if (memberships && memberships.length > 0) return 'has_access';
  if (!markAvailable) return 'unmarked';
  const profile = (profiles as Array<{ id: string; access_rejected_at?: string | null }> | null)?.[0];
  if (!profile || profile.access_rejected_at) return 'not_pending';

  const { data: marked, error: markError } = await service
    .from('profiles')
    .update({ access_rejected_at: new Date().toISOString(), access_rejected_by: ownerId })
    .eq('id', userId)
    .is('access_rejected_at', null)
    .select('id');
  if (markError) return { error: markError };
  return marked && marked.length > 0 ? 'rejected' : 'not_pending';
}

/**
 * Rejects an open access request: someone with no club access anywhere who
 * has not been rejected yet. Only club owners may reject.
 *
 * The request is first marked rejected by `reject_access_request` (074), which
 * locks the profile, re-checks memberships, and blocks any approval of that
 * person from then on. Only after that does the route delete the sign-up, so a
 * concurrent approval can never be wiped out by the delete. The person can
 * sign up again later and a fresh request appears.
 *
 * A former teammate's account is still referenced by the records they created,
 * so the delete is refused; the rejection mark then simply stays, hiding the
 * request while keeping that history intact.
 *
 * Errors are returned as codes only; details are logged on the server.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure(401, 'unauthorized');

  const body = await request.json().catch(() => null) as RejectRequestBody | null;
  const userId = typeof body?.userId === 'string' && UUID.test(body.userId) ? body.userId : null;
  if (!userId || userId === user.id) return failure(400, 'invalid_request');

  const service = createServiceClient();
  let outcome: RejectOutcome | 'unmarked';

  const { data, error } = await supabase.rpc('reject_access_request', { p_user_id: userId });
  if (!error) {
    outcome = data as RejectOutcome;
  } else if (isMissingDatabaseFunction(error, 'reject_access_request')) {
    const legacy = await legacyMarkRejected(supabase, service, user.id, userId);
    if (typeof legacy !== 'string') {
      if (legacy.error === 'forbidden') return failure(403, 'forbidden');
      console.error('[team/reject] legacy rejection failed', { userId, error: legacy.error });
      return failure(500, 'reject_failed');
    }
    outcome = legacy;
  } else if (error.code === '42501') {
    return failure(403, 'forbidden');
  } else if (error.code === '22023') {
    return failure(400, 'invalid_request');
  } else {
    console.error('[team/reject] reject_access_request failed', { userId, error });
    return failure(500, 'reject_failed');
  }

  if (outcome === 'has_access') return failure(409, 'has_access');
  if (outcome === 'not_pending') return failure(404, 'not_pending');
  if (outcome !== 'rejected' && outcome !== 'unmarked') {
    console.error('[team/reject] unexpected outcome', { userId, outcome });
    return failure(500, 'reject_failed');
  }

  // The request is closed. Remove the sign-up when it has no history.
  const { error: deleteError } = await service.auth.admin.deleteUser(userId);
  if (!deleteError) return Response.json({ ok: true, outcome: 'deleted' });

  if (outcome === 'unmarked') {
    console.error('[team/reject] sign-up could not be deleted', { userId, error: deleteError.message });
    return failure(500, 'reject_failed');
  }

  // Usually "referenced by created_by": a former teammate. The mark hides it.
  console.info('[team/reject] sign-up kept after rejection', { userId, error: deleteError.message });
  return Response.json({ ok: true, outcome: 'hidden' });
}
